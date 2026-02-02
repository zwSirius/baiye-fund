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
from datetime import datetime, timedelta, time
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
    """全局 HTTP 会话"""
    _session = None

    @classmethod
    def get(cls):
        if cls._session is None:
            cls._session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(pool_connections=50, pool_maxsize=100)
            cls._session.mount('http://', adapter)
            cls._session.mount('https://', adapter)
        return cls._session

class CacheService:
    """内存缓存服务"""
    def __init__(self):
        self._funds_list_cache = {"data": [], "time": 0}
        self._market_cache = {"data": [], "time": 0}
        self._holdings_cache = {} # code -> {data, time}

    def get_funds_list(self):
        if time_module.time() - self._funds_list_cache['time'] < 86400: # 24h
            return self._funds_list_cache['data']
        return None

    def set_funds_list(self, data: list):
        self._funds_list_cache = {"data": data, "time": time_module.time()}

    def get_holdings(self, code: str):
        entry = self._holdings_cache.get(code)
        if entry and (time_module.time() - entry['time'] < 86400): # 24h
            return entry['data']
        return None

    def set_holdings(self, code: str, data: list):
        self._holdings_cache[code] = {"data": data, "time": time_module.time()}
    
    def get_market_indices(self):
        if time_module.time() - self._market_cache['time'] < 60: # 60s
            return self._market_cache['data']
        return None
    
    def set_market_indices(self, data: list):
        self._market_cache = {"data": data, "time": time_module.time()}

cache_service = CacheService()

class AkshareService:
    """AKShare / Eastmoney 接口封装"""
    
    @staticmethod
    def get_headers():
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Referer": "http://fund.eastmoney.com/",
            "Connection": "keep-alive"
        }

    @staticmethod
    def get_time_phase():
        now = datetime.utcnow() + timedelta(hours=8)
        if now.weekday() >= 5: return 'WEEKEND'
        t = now.time()
        if t < time(9, 15): return 'PRE_MARKET'
        elif t >= time(11, 30) and t < time(13, 0): return 'LUNCH_BREAK'
        elif t <= time(15, 0): return 'MARKET'
        else: return 'POST_MARKET'

    @staticmethod
    def fetch_fund_list_sync():
        """获取所有基金列表 (ak.fund_name_em)"""
        try:
            df = ak.fund_name_em()
            result = []
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
    def fetch_realtime_estimate_direct_sync(code: str):
        """
        [关键修复] 直接访问 fundgz 接口获取实时估值
        URL: http://fundgz.1234567.com.cn/js/gszzl_{code}.js
        """
        data = { 
            "fundcode": code,
            "name": "", 
            "gsz": "0", 
            "gszzl": "0", 
            "dwjz": "0", 
            "jzrq": "", 
            "source": "none" 
        }
        try:
            ts = int(time_module.time() * 1000)
            url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={ts}"
            # 必须设置 Referer 否则可能被拒
            headers = AkshareService.get_headers()
            
            resp = GlobalSession.get().get(url, headers=headers, timeout=1.5)
            
            if resp.status_code == 200:
                # 返回格式: jsonpgz({"fundcode":"001186","name":"...","jzrq":"2023-12-01","dwjz":"1.1234","gsz":"1.1111","gszzl":"-1.00","gztime":"..."});
                match = re.search(r'jsonpgz\((.*?)\);', resp.text)
                if match:
                    fetched = json.loads(match.group(1))
                    if fetched:
                        data.update(fetched)
                        data['source'] = 'official_realtime'
        except Exception as e:
            pass # 忽略网络错误，后续会 fallback
        return data

    @staticmethod
    def fetch_fund_history_sync(code: str) -> pd.DataFrame:
        """获取基金历史净值 (ak.fund_open_fund_info_em)"""
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not df.empty:
                if '净值日期' in df.columns: df['净值日期'] = df['净值日期'].astype(str)
                if '单位净值' in df.columns: df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce')
                return df
        except Exception as e:
            logger.warning(f"Fetch history error {code}: {e}")
        return pd.DataFrame()

    @staticmethod
    def fetch_holdings_sync(code: str) -> List[Dict]:
        """获取基金持仓 (ak.fund_portfolio_hold_em)"""
        try:
            year = datetime.now().year
            all_dfs = []
            # 尝试最近两年
            for y in [year, year - 1]:
                try:
                    df = ak.fund_portfolio_hold_em(symbol=code, date=str(y))
                    if not df.empty and '季度' in df.columns: 
                        all_dfs.append(df)
                except: continue
            
            if not all_dfs: return []
            combined = pd.concat(all_dfs)
            
            # 排序：年报 > 4季度 > 3季度 ...
            def parse_rank(q):
                try:
                    if '年报' in q: return int(re.search(r'(\d{4})', q).group(1)) * 100 + 5 
                    q_match = re.search(r'(\d)季度', q)
                    year_match = re.search(r'(\d{4})', q)
                    if q_match and year_match:
                        return int(year_match.group(1)) * 100 + int(q_match.group(1))
                    return 0
                except: return 0

            combined['rank'] = combined['季度'].apply(parse_rank)
            combined['占净值比例'] = pd.to_numeric(combined['占净值比例'], errors='coerce').fillna(0)
            sorted_df = combined.sort_values(by=['rank', '占净值比例'], ascending=[False, False])
            
            if sorted_df.empty: return []
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
        """获取基金基本信息"""
        try:
            df = ak.fund_individual_basic_info_xq(symbol=code)
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
        """获取全市场指数行情 (ak.stock_zh_index_spot_em)"""
        try:
            df = ak.stock_zh_index_spot_em(symbol="沪深重要指数")
            if df.empty: return []
            
            result = []
            for _, row in df.iterrows():
                raw_code = str(row['代码'])
                name = str(row['名称'])
                
                # [关键修复] 标准化代码，用于前端匹配
                # 东方财富规则: 
                # 1.000001 (上证指数)
                # 0.399001 (深证成指)
                # 0.399006 (创业板指)
                # 1.000688 (科创50)
                # 1.000300 (沪深300 - 上交所) / 0.399300 (沪深300 - 深交所)
                
                std_code = raw_code
                if raw_code.startswith('000'): std_code = f"1.{raw_code}"
                elif raw_code.startswith('399'): std_code = f"0.{raw_code}"
                
                result.append({
                    "name": name, 
                    "code": std_code,
                    "raw_code": raw_code,
                    "changePercent": float(row['涨跌幅']), 
                    "value": float(row['最新价']),
                    "score": int(max(0, min(100, 50 + float(row['涨跌幅']) * 10))),
                    "leadingStock": "--"
                })
            return result
        except Exception as e:
            logger.error(f"Fetch market indices error: {e}")
            return []
            
    @staticmethod
    def fetch_stock_quotes_direct_sync(codes: List[str]) -> Dict[str, Dict[str, float]]:
        """
        [关键修复] 批量获取股票实时行情
        修复 secid 映射规则，确保能查到价格
        """
        if not codes: return {}
        unique_codes = list(set(codes))
        quotes = {}
        batch_size = 40
        
        for i in range(0, len(unique_codes), batch_size):
            batch = unique_codes[i:i+batch_size]
            secids = []
            for c in batch:
                # --- 市场代码映射规则 (参考 Eastmoney Web API) ---
                # 60xxxx, 688xxx (科创) -> 1.xxxxxx
                if c.startswith('6'):
                    secids.append(f"1.{c}")
                # 900xxx (B股) -> 1.xxxxxx
                elif c.startswith('900'):
                    secids.append(f"1.{c}")
                # 00xxxx, 30xxxx (创业) -> 0.xxxxxx
                elif c.startswith('0') or c.startswith('3'):
                    secids.append(f"0.{c}")
                # 8xxxxx, 4xxxxx (北交所) -> 0.xxxxxx (通常东财接口把北交所放在0下)
                elif c.startswith('8') or c.startswith('4'):
                    secids.append(f"0.{c}")
                # 港股/美股暂不支持
                else:
                    # 默认尝试 0
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
            except Exception: 
                pass
        return quotes

# --- 业务逻辑 ---

class FundController:
    
    @staticmethod
    async def get_search_results(key: str):
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
            if key in f['code'] or key in f['name'] or key in f['pinyin']:
                res.append(f)
                count += 1
                if count >= 30: break 
        return res

    @staticmethod
    async def get_fund_detail(code: str):
        # 1. 获取持仓 & 基本信息
        holdings_task = run_in_threadpool(AkshareService.fetch_holdings_sync, code)
        basic_task = run_in_threadpool(AkshareService.fetch_fund_basic_info_sync, code)
        
        holdings, basic = await asyncio.gather(holdings_task, basic_task)
        
        # 2. [关键] 获取重仓股实时行情
        if holdings:
            stock_codes = [h['code'] for h in holdings]
            quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_direct_sync, stock_codes)
            
            for h in holdings: 
                q = quotes.get(h['code'])
                if q:
                    h['changePercent'] = q['change']
                    h['currentPrice'] = q['price']
                    # 优先使用实时接口返回的股票名称
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
    async def get_market_status(codes_str: Optional[str] = None):
        """
        [关键修复] 市场指数获取与筛选
        """
        cached = cache_service.get_market_indices()
        if not cached:
            cached = await run_in_threadpool(AkshareService.fetch_market_indices_sync)
            if cached:
                cache_service.set_market_indices(cached)
        
        if not cached: return []

        # 默认指数
        target_codes = ["1.000001", "0.399001", "0.399006", "1.000688", "0.000300"]
        if codes_str:
            target_codes = codes_str.split(',')

        result = []
        for item in cached:
            # item 包含 code (标准 1.xxx) 和 raw_code (原始 xxx)
            # 只要匹配其中一个即可
            if item['code'] in target_codes or item['raw_code'] in target_codes:
                result.append(item)
                
        return result

    @staticmethod
    async def batch_estimate(codes: List[str]):
        """
        [重构] 批量获取估值
        逻辑：
        1. 并发调用 http://fundgz.1234567.com.cn/js/gszzl_{code}.js 获取官方实时估值。
        2. 获取历史净值作为基准 (dwjz)。
        3. 如果官方实时估值失效 (gsz=0 or gsz=dwjz 且盘中)，则调用 calc_estimate_by_holdings 进行持仓穿透计算。
        """
        if not codes: return []
        
        loop = asyncio.get_running_loop()
        
        # 1. 定义并发任务：获取估值 + 获取历史
        async def fetch_one(c):
            # 直接调用 JS 接口 (最快，最准)
            est = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_direct_sync, c)
            # 历史净值 (用于兜底昨日净值)
            hist = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync, c)
            return c, est, hist

        results_data = await asyncio.gather(*[fetch_one(c) for c in codes])
        
        final_results = []
        calc_needed = [] # 需要手动计算的
        
        phase = AkshareService.get_time_phase()
        today_str = (datetime.utcnow() + timedelta(hours=8)).strftime('%Y-%m-%d')

        results_map = {} # code -> result_dict

        for code, est, hist in results_data:
            res = est # 已经包含 gsz, gszzl, dwjz, jzrq
            
            # 修正昨日净值 (dwjz)
            last_nav = 0.0
            last_date = ""
            
            # 优先用接口返回的
            if res.get('dwjz') and float(res['dwjz']) > 0:
                last_nav = float(res['dwjz'])
                last_date = res['jzrq']
            
            # 如果接口没返回有效的昨日净值，去历史数据找
            if (last_nav <= 0 or not last_date) and not hist.empty:
                latest = hist.iloc[-1]
                last_nav = float(latest['单位净值'])
                last_date = str(latest['净值日期'])
                res['dwjz'] = str(last_nav)
                res['jzrq'] = last_date
            
            res['_last_nav'] = last_nav
            
            # --- 判断是否需要手动计算 ---
            need_manual = False
            
            gsz = float(res.get('gsz', 0))
            
            if phase in ['PRE_MARKET', 'WEEKEND']:
                pass 
            elif phase == 'POST_MARKET':
                # 盘后，如果净值还没更新到今天，且估值也是0，尝试计算
                if res.get('jzrq') != today_str:
                    if gsz <= 0: need_manual = True
                else:
                    res['source'] = 'real_updated'
            else:
                # 盘中
                # 如果估值是0，或者估值完全没变(等于昨日净值)且我们确信现在是交易时间
                if gsz <= 0 or (abs(gsz - last_nav) < 0.0001 and last_nav > 0):
                    need_manual = True
            
            if need_manual:
                calc_needed.append(code)
            
            results_map[code] = res

        # 2. 批量手动计算 (针对官方数据缺失的基金)
        if calc_needed:
            # A. 获取持仓
            holdings_tasks = [run_in_threadpool(AkshareService.fetch_holdings_sync, c) for c in calc_needed]
            holdings_list = await asyncio.gather(*holdings_tasks)
            
            # B. 汇总所有股票代码
            all_stocks = set()
            fund_holdings = {} # code -> list
            for i, c in enumerate(calc_needed):
                h = holdings_list[i]
                fund_holdings[c] = h
                for stock in h:
                    all_stocks.add(stock['code'])
            
            # C. 批量获取股票行情
            stock_quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_direct_sync, list(all_stocks))
            
            # D. 计算
            for c in calc_needed:
                data = results_map[c]
                holdings = fund_holdings.get(c, [])
                if not holdings: continue
                
                weighted_chg = 0
                total_w = 0
                for h in holdings:
                    w = h['percent']
                    q = stock_quotes.get(h['code'])
                    if q:
                        # 股票涨跌幅
                        chg = q['change']
                        weighted_chg += (chg * w)
                        total_w += w
                
                est_chg = 0
                if total_w > 0:
                    # 归一化后打折(0.9)模拟仓位
                    est_chg = (weighted_chg / total_w) * 0.9
                
                # 更新数据
                last_n = data['_last_nav']
                if last_n > 0:
                    est_val = last_n * (1 + est_chg / 100.0)
                    data['gsz'] = "{:.4f}".format(est_val)
                    data['gszzl'] = "{:.2f}".format(est_chg)
                    data['source'] = 'holdings_calc'

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

app = FastAPI(title="SmartFund API", description="Based on AKShare/Eastmoney Interfaces")

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
        "backend": "akshare_direct_v3"
    }

@router.get("/search")
async def search(key: str = Query(..., min_length=1)):
    return await FundController.get_search_results(key)

@router.get("/market")
async def market(codes: Optional[str] = Query(None)):
    """获取市场指数"""
    return await FundController.get_market_status(codes)

@router.get("/estimate/{code}")
async def estimate_one(code: str):
    res = await FundController.batch_estimate([code])
    return res[0] if res else {}

@router.post("/estimate/batch")
async def estimate_batch(payload: dict = Body(...)):
    return await FundController.batch_estimate(payload.get('codes', []))

@router.get("/fund/{code}")
async def detail(code: str):
    return await FundController.get_fund_detail(code)

@router.get("/history/{code}")
async def history(code: str):
    df = await run_in_threadpool(AkshareService.fetch_fund_history_sync, code)
    if df.empty: return []
    return [{"date": str(r['净值日期']), "value": float(r['单位净值'])} for _, r in df.tail(365).iterrows()]

@router.post("/analyze")
async def analyze(payload: dict = Body(...)):
    prompt = payload.get("prompt", "")
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    return await FundController.analyze_content(prompt)

app.include_router(router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
