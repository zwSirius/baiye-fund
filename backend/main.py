import uvicorn
from fastapi import FastAPI, Query, Body, APIRouter, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
import akshare as ak
import pandas as pd
import requests
import re
import json
import logging
import asyncio
import random
import time as time_module
import os
import google.generativeai as genai
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

# --- 配置 ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SmartFund")

# 配置 Gemini API
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# --- 常量 ---
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

# --- 核心服务 ---

class GlobalSession:
    """全局 HTTP 会话，用于复用 TCP 连接"""
    _session = None

    @classmethod
    def get(cls):
        if cls._session is None:
            cls._session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20)
            cls._session.mount('http://', adapter)
            cls._session.mount('https://', adapter)
        return cls._session

class CacheService:
    """内存缓存服务"""
    def __init__(self):
        self._all_estimates_cache = {"data": [], "time": 0} # 全量估值缓存
        self._funds_list_cache = {"data": [], "time": 0}    # 基金列表缓存
        self._holdings_cache = {}                           # 持仓缓存
        self._market_cache = {"data": [], "time": 0}        # 指数缓存

    def get_all_estimates(self):
        # 缓存有效期 3 分钟
        if time_module.time() - self._all_estimates_cache['time'] < 180:
            return self._all_estimates_cache['data']
        return None

    def set_all_estimates(self, data: list):
        self._all_estimates_cache = {"data": data, "time": time_module.time()}

    def get_funds_list(self):
        # 缓存有效期 24 小时
        if time_module.time() - self._funds_list_cache['time'] < 86400:
            return self._funds_list_cache['data']
        return None

    def set_funds_list(self, data: list):
        self._funds_list_cache = {"data": data, "time": time_module.time()}

    def get_holdings(self, code: str):
        # 缓存有效期 24 小时
        entry = self._holdings_cache.get(code)
        if entry and (time_module.time() - entry['time'] < 86400):
            return entry['data']
        return None

    def set_holdings(self, code: str, data: list):
        self._holdings_cache[code] = {"data": data, "time": time_module.time()}
    
    def get_market_indices(self):
        # 缓存有效期 30 秒
        if time_module.time() - self._market_cache['time'] < 30:
            return self._market_cache['data']
        return None
    
    def set_market_indices(self, data: list):
        self._market_cache = {"data": data, "time": time_module.time()}

cache_service = CacheService()

class AkshareService:
    """
    AKShare 接口封装层
    负责直接调用 akshare 库获取数据，并进行初步清洗
    """
    
    @staticmethod
    def get_headers():
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Connection": "keep-alive"
        }

    @staticmethod
    def get_time_phase():
        """判断当前市场状态"""
        now = datetime.utcnow() + timedelta(hours=8)
        if now.weekday() >= 5: return 'WEEKEND'
        t = now.time()
        if t < time(9, 15): return 'PRE_MARKET'
        elif t >= time(11, 30) and t < time(13, 0): return 'LUNCH_BREAK'
        elif t <= time(15, 0): return 'MARKET'
        else: return 'POST_MARKET'

    @staticmethod
    def fetch_fund_list_sync():
        """
        接口: fund_name_em
        描述: 获取所有基金的基本信息
        """
        try:
            df = ak.fund_name_em()
            # 原始列: 基金代码, 拼音缩写, 基金简称, 基金类型, 拼音全称
            if df.empty: return []
            
            result = []
            # 转换为字典列表
            for row in df.itertuples():
                result.append({
                    "code": str(row.基金代码),
                    "name": str(row.基金简称),
                    "type": str(row.基金类型),
                    "pinyin": str(row.拼音缩写)
                })
            return result
        except Exception as e:
            logger.error(f"Fetch fund list error: {e}")
            return []

    @staticmethod
    def fetch_all_estimates_sync():
        """
        接口: fund_value_estimation_em
        描述: 获取全市场基金的实时估值数据
        """
        try:
            # symbol='全部' 返回所有
            df = ak.fund_value_estimation_em(symbol="全部")
            if df.empty: return []

            results = []
            today_str = datetime.now().strftime('%Y-%m-%d')
            
            # 列名可能包含: 基金代码, 基金名称, 交易日-估算数据-估算值, 交易日-估算数据-估算增长率, 交易日-公布数据-单位净值...
            # 注意：akshare 返回的 dataframe 列名是中文
            for _, row in df.iterrows():
                try:
                    est_val = row.get('交易日-估算数据-估算值')
                    est_rate = row.get('交易日-估算数据-估算增长率')
                    
                    # 只有当数据有效时才添加
                    if pd.notna(est_val) and str(est_val) != '--':
                        results.append({
                            "fundcode": str(row['基金代码']),
                            "name": str(row['基金名称']),
                            "gsz": str(est_val), # 估算值
                            "gszzl": str(est_rate).replace('%', '') if pd.notna(est_rate) else "0", # 估算增长率
                            "dwjz": str(row.get('交易日-公布数据-单位净值', '')), # 昨日净值
                            "jzrq": today_str, # 估值日期默认今天
                            "source": "official_akshare"
                        })
                except: continue
            return results
        except Exception as e:
            logger.error(f"Fetch all estimates error: {e}")
            return []

    @staticmethod
    def fetch_fund_history_sync(code: str) -> pd.DataFrame:
        """
        接口: fund_open_fund_info_em
        描述: 获取基金历史净值
        """
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not df.empty:
                # 确保列名正确并转换类型
                if '净值日期' in df.columns: df['净值日期'] = df['净值日期'].astype(str)
                if '单位净值' in df.columns: df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce')
                return df
        except Exception as e:
            logger.warning(f"Fetch history error {code}: {e}")
        return pd.DataFrame()

    @staticmethod
    def fetch_holdings_sync(code: str) -> List[Dict]:
        """
        接口: fund_portfolio_hold_em
        描述: 获取基金前十大重仓股
        """
        try:
            year = datetime.now().year
            all_dfs = []
            # 尝试今年和去年的数据，因为年初可能还没有当年的年报
            for y in [year, year - 1]:
                try:
                    df = ak.fund_portfolio_hold_em(symbol=code, date=str(y))
                    if not df.empty and '季度' in df.columns: 
                        all_dfs.append(df)
                except: continue
            
            if not all_dfs: return []
            combined = pd.concat(all_dfs)
            
            # 辅助函数：解析"2023年4季度股票投资明细"为排序数字
            def parse_rank(q):
                try:
                    if '年报' in q: return int(re.search(r'(\d{4})', q).group(1)) * 100 + 5 # 年报权重最高
                    q_match = re.search(r'(\d)季度', q)
                    year_match = re.search(r'(\d{4})', q)
                    if q_match and year_match:
                        return int(year_match.group(1)) * 100 + int(q_match.group(1))
                    return 0
                except: return 0

            combined['rank'] = combined['季度'].apply(parse_rank)
            # 转换比例为数字
            combined['占净值比例'] = pd.to_numeric(combined['占净值比例'], errors='coerce').fillna(0)
            
            # 按季度倒序排序
            sorted_df = combined.sort_values(by=['rank', '占净值比例'], ascending=[False, False])
            
            if sorted_df.empty: return []
            
            # 取最新一个季度的前10条
            latest_rank = sorted_df.iloc[0]['rank']
            top10 = sorted_df[sorted_df['rank'] == latest_rank].head(10)
            
            result = []
            for _, r in top10.iterrows():
                result.append({
                    "code": str(r['股票代码']), 
                    "name": str(r['股票名称']), 
                    "percent": float(r['占净值比例'])
                })
            return result
        except Exception as e:
            logger.error(f"Fetch holdings error {code}: {e}")
            return []

    @staticmethod
    def fetch_fund_basic_info_sync(code: str):
        """
        接口: fund_individual_basic_info_xq
        描述: 获取基金经理、成立时间、规模等基本信息
        """
        try:
            df = ak.fund_individual_basic_info_xq(symbol=code)
            # df 列: item, value
            info = {}
            if not df.empty:
                for _, row in df.iterrows():
                    info[row['item']] = row['value']
            return info
        except Exception as e:
            logger.warning(f"Basic info error {code}: {e}")
            return {}

    @staticmethod
    def fetch_market_indices_sync():
        """
        接口: stock_zh_index_spot_em
        描述: 获取沪深重要指数实时行情
        """
        try:
            df = ak.stock_zh_index_spot_em(symbol="沪深重要指数")
            if df.empty: return []
            
            # 需要关注的指数列表
            target_indices = ["上证指数", "深证成指", "创业板指", "科创50", "沪深300"]
            result = []
            for _, row in df.iterrows():
                name = row['名称']
                if name in target_indices:
                    chg = float(row['涨跌幅'])
                    result.append({
                        "name": name, 
                        "code": str(row['代码']),
                        "changePercent": chg, 
                        "value": float(row['最新价']),
                        "score": int(max(0, min(100, 50 + chg * 10))), # 简单的热度评分
                        "leadingStock": "--"
                    })
            return result
        except Exception as e:
            logger.error(f"Fetch market indices error: {e}")
            return []
            
    @staticmethod
    def fetch_stock_quotes_direct_sync(codes: List[str]) -> Dict[str, Dict[str, float]]:
        """
        优化：批量获取股票实时行情。
        虽然 AKShare 有 ak.stock_zh_a_spot_em()，但获取全市场数据太慢。
        这里使用 AKShare 底层逻辑相同的批量接口，针对特定股票代码列表进行查询，以保证速度。
        """
        if not codes: return {}
        unique_codes = list(set(codes))
        quotes = {}
        batch_size = 40 # 一次查40个
        
        for i in range(0, len(unique_codes), batch_size):
            batch = unique_codes[i:i+batch_size]
            secids = []
            for c in batch:
                # 构造东方财富 secid
                # 6开头: 上证(1.6xxxxx)
                # 0/3开头: 深证(0.0xxxxx, 0.3xxxxx)
                # 8/4开头: 北交所(0.8xxxxx, 0.4xxxxx)
                # 159开头: 深证ETF(0.159xxx)
                # 5开头: 上证ETF/基金(1.5xxxxx)
                
                if c.startswith('6') or c.startswith('5') or c.startswith('9') or c.startswith('11'): 
                    secids.append(f"1.{c}")
                else: 
                    # 默认深证/北交所
                    secids.append(f"0.{c}")
            
            # f2: 最新价, f3: 涨跌幅, f12: 代码, f14: 名称
            url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f14&secids={','.join(secids)}"
            try:
                resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=3.0)
                data = resp.json()
                if data and 'data' in data and 'diff' in data['data']:
                    for item in data['data']['diff']:
                        code_val = str(item['f12'])
                        quotes[code_val] = {
                            "price": float(item['f2']) if item['f2'] != '-' else 0.0,
                            "change": float(item['f3']) if item['f3'] != '-' else 0.0,
                            "name": item['f14']
                        }
            except Exception: pass
        return quotes

# --- 业务逻辑控制器 ---

class FundController:
    
    @staticmethod
    async def get_search_results(key: str):
        # 优先从缓存获取基金列表
        cached = cache_service.get_funds_list()
        if not cached:
            cached = await run_in_threadpool(AkshareService.fetch_fund_list_sync)
            if cached:
                cache_service.set_funds_list(cached)
        
        if not cached: return []
        
        key = key.upper()
        res = []
        count = 0
        for f in cached:
            # 支持代码、名称、拼音搜索
            if key in f['code'] or key in f['name'] or key in f['pinyin']:
                res.append(f)
                count += 1
                if count >= 20: break # 限制返回数量
        return res

    @staticmethod
    async def get_fund_detail(code: str):
        # 并行获取：持仓 + 基本信息
        holdings_task = run_in_threadpool(AkshareService.fetch_holdings_sync, code)
        basic_task = run_in_threadpool(AkshareService.fetch_fund_basic_info_sync, code)
        
        holdings, basic = await asyncio.gather(holdings_task, basic_task)
        
        # 获取重仓股的实时行情，计算涨跌幅
        if holdings:
            stock_codes = [h['code'] for h in holdings]
            quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_direct_sync, stock_codes)
            for h in holdings: 
                q = quotes.get(h['code'])
                if q:
                    h['changePercent'] = q['change']
                    h['currentPrice'] = q['price']
                    # 如果持仓里名字不对，可以用行情的修正
                    if q['name'] and len(q['name']) > 0:
                        h['name'] = q['name']
                else:
                    h['changePercent'] = 0
                    h['currentPrice'] = 0

        manager = basic.get('基金经理', '暂无')
        return {
            "code": code, 
            "manager": manager, 
            "holdings": holdings,
            "fund_size": basic.get('最新规模', '--'),
            "start_date": basic.get('成立时间', '--'),
            "type": basic.get('基金类型', '未分类')
        }

    @staticmethod
    async def get_market_status():
        # 优先缓存
        cached = cache_service.get_market_indices()
        if cached: return cached
        
        data = await run_in_threadpool(AkshareService.fetch_market_indices_sync)
        if data:
            cache_service.set_market_indices(data)
        return data

    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        
        # 1. 尝试刷新全局估值缓存 (如果为空或过期)
        if not cache_service.get_all_estimates():
             all_est = await run_in_threadpool(AkshareService.fetch_all_estimates_sync)
             if all_est: cache_service.set_all_estimates(all_est)
        
        # 获取缓存的全局数据
        cached_estimates = cache_service.get_all_estimates() or []
        # 转为字典加速查找
        est_map = {item['fundcode']: item for item in cached_estimates}

        loop = asyncio.get_running_loop()
        
        # 定义单个基金的处理逻辑
        async def process_one(c):
            est = est_map.get(c)
            # 获取历史净值（用于获取昨日净值 dwjz，如果实时接口没有的话）
            history = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync, c)
            return c, est, history

        base_results = await asyncio.gather(*[process_one(c) for c in codes])
        
        results = []
        calc_needed_codes = []      # 需要手动计算估值的基金
        results_map = {}            # 暂存结果

        phase = AkshareService.get_time_phase()
        today_str = (datetime.utcnow() + timedelta(hours=8)).strftime('%Y-%m-%d')

        for code, official, history in base_results:
            # 基础数据结构
            res = { 
                "fundcode": code, 
                "name": official['name'] if official else "",
                "gsz": official['gsz'] if official else "0",
                "gszzl": official['gszzl'] if official else "0",
                "dwjz": official['dwjz'] if official else "0",
                "jzrq": official['jzrq'] if official else "",
                "source": official['source'] if official else "none"
            }
            
            # 确定最新的确认净值 (DWJZ)
            last_nav = 1.0
            if not history.empty:
                latest = history.iloc[-1]
                last_nav = float(latest['单位净值'])
                # 如果官方接口没给昨日净值，用历史数据的最后一条
                if float(res['dwjz']) <= 0:
                    res['dwjz'] = str(latest['单位净值'])
                    res['jzrq'] = str(latest['净值日期'])
            elif float(res['dwjz']) > 0:
                last_nav = float(res['dwjz'])
            
            res['_last_nav'] = last_nav # 内部字段，用于计算

            # 判断是否需要手动计算估值
            # 场景：盘中交易时间，且官方估值缺失或为0（通常发生在QDII或部分新基金）
            need_calc = False
            
            if phase in ['PRE_MARKET', 'WEEKEND']:
                # 盘前/周末：显示静态数据
                # 如果官方估值是0，这不正常，但在非交易时间不计算动态
                pass
            elif phase == 'POST_MARKET':
                # 盘后：如果净值日期已经是今天，说明已更新真实净值
                if res.get('jzrq') == today_str:
                    res['source'] = "real_updated" # 真实净值已出
                else:
                    # 还没出净值，需要估值
                    if float(res.get('gsz', 0)) <= 0: need_calc = True
            else:
                 # 盘中：如果官方估值无效
                 off_gsz = float(res.get("gsz", 0))
                 if off_gsz <= 0 or abs(off_gsz - last_nav) < 0.0001:
                     # 估值没变或者为0，尝试手动计算
                     need_calc = True
                 else:
                     res['source'] = 'official_live'
            
            if need_calc:
                calc_needed_codes.append(code)
            
            results_map[code] = res

        # 3. 对缺失估值的基金进行手动计算 (基于持仓)
        if calc_needed_codes:
            # 1. 获取持仓
            holdings_tasks = [run_in_threadpool(AkshareService.fetch_holdings_sync, c) for c in calc_needed_codes]
            holdings_list = await asyncio.gather(*holdings_tasks)
            
            # 2. 收集所有涉及的股票代码
            all_stocks = set()
            fund_holdings_map = {} # code -> holdings list
            for idx, c in enumerate(calc_needed_codes):
                h = holdings_list[idx]
                fund_holdings_map[c] = h
                for stock in h:
                    all_stocks.add(stock['code'])
            
            # 3. 批量获取股票行情
            quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_direct_sync, list(all_stocks))
            
            # 4. 计算
            for c in calc_needed_codes:
                data = results_map[c]
                holdings = fund_holdings_map.get(c, [])
                if not holdings: continue
                
                weighted_change = 0
                total_weight = 0
                for h in holdings:
                    w = h['percent'] # 比如 5.5 代表 5.5%
                    q = quotes.get(h['code'])
                    if q:
                        change = q['change'] # 比如 1.2 代表 1.2%
                        weighted_change += (change * w)
                        total_weight += w
                
                # 估算涨跌幅
                est_change = 0
                if total_weight > 0:
                    # 假设非重仓股走势与重仓股一致，但波动稍小 (0.9系数)
                    # 归一化：(加权涨跌幅 / 总权重)
                    normalized_change = weighted_change / total_weight
                    # 考虑到仓位通常不是100%，比如80%仓位，剩下是现金。
                    # 简单模型：估算涨跌幅 = 归一化涨跌幅 * (总权重/100 * 放大系数 或者 0.8经验值)
                    # 这里简化：假设前十大占比 total_weight (如50%)，则整体涨跌 ≈ 归一化涨跌 * 0.95(修正)
                    est_change = normalized_change * 0.95
                
                last_n = data['_last_nav']
                est_val = last_n * (1 + est_change / 100.0)
                
                data['gsz'] = "{:.4f}".format(est_val)
                data['gszzl'] = "{:.2f}".format(est_change)
                data['source'] = "holdings_calc"

        return [results_map[c] for c in codes]

    @staticmethod
    async def analyze_content(prompt: str):
        if not GEMINI_API_KEY:
            raise HTTPException(status_code=500, detail="Server Gemini Key not configured")
        try:
            model = genai.GenerativeModel("gemini-1.5-flash") 
            response = await run_in_threadpool(model.generate_content, prompt)
            return {"text": response.text}
        except Exception as e:
            logger.error(f"Gemini Error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

# --- FastAPI App ---

app = FastAPI(title="SmartFund API", description="Based on AKShare Interfaces")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter(prefix="/api")

@router.get("/status")
def status():
    return {
        "phase": AkshareService.get_time_phase(), 
        "ts": datetime.now().timestamp(),
        "backend": "akshare_v1"
    }

@router.get("/search")
async def search(key: str = Query(..., min_length=1)):
    """搜索基金"""
    return await FundController.get_search_results(key)

@router.get("/market")
async def market():
    """获取大盘指数"""
    return await FundController.get_market_status()

@router.get("/estimate/{code}")
async def estimate_one(code: str):
    """单只估值"""
    res = await FundController.batch_estimate([code])
    return res[0] if res else {}

@router.post("/estimate/batch")
async def estimate_batch(payload: dict = Body(...)):
    """批量估值"""
    return await FundController.batch_estimate(payload.get('codes', []))

@router.get("/fund/{code}")
async def detail(code: str):
    """基金详情（含重仓股）"""
    return await FundController.get_fund_detail(code)

@router.get("/history/{code}")
async def history(code: str):
    """基金历史净值"""
    df = await run_in_threadpool(AkshareService.fetch_fund_history_sync, code)
    if df.empty: return []
    # 返回最近 365 条
    return [{"date": str(r['净值日期']), "value": float(r['单位净值'])} for _, r in df.tail(365).iterrows()]

@router.post("/analyze")
async def analyze(payload: dict = Body(...)):
    """AI 分析"""
    prompt = payload.get("prompt", "")
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    return await FundController.analyze_content(prompt)

app.include_router(router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
