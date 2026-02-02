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
            adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20)
            cls._session.mount('http://', adapter)
            cls._session.mount('https://', adapter)
        return cls._session

class CacheService:
    """内存缓存服务"""
    def __init__(self):
        self._estimate_cache = {} 
        self._all_estimates_cache = {"data": [], "time": 0}
        self._funds_list_cache = {"data": [], "time": 0}
        self._holdings_cache = {}
        self._market_cache = {"data": [], "time": 0}

    def get_estimate(self, code: str):
        # 1. 优先查全量缓存 (3分钟有效)
        if self._all_estimates_cache['data'] and (time_module.time() - self._all_estimates_cache['time'] < 180):
             found = next((x for x in self._all_estimates_cache['data'] if x['fundcode'] == code), None)
             if found: return found
        
        # 2. 查单条缓存
        entry = self._estimate_cache.get(code)
        if entry and time_module.time() < entry['expire']:
            return entry['data']
        return None

    def set_estimate(self, code: str, data: dict, ttl: int = 60):
        if data:
            self._estimate_cache[code] = {
                'data': data,
                'expire': time_module.time() + ttl
            }

    def set_all_estimates(self, data: list):
        self._all_estimates_cache = {"data": data, "time": time_module.time()}

    def get_funds_list(self):
        if time_module.time() - self._funds_list_cache['time'] < 86400:
            return self._funds_list_cache['data']
        return None

    def set_funds_list(self, data: list):
        self._funds_list_cache = {"data": data, "time": time_module.time()}

    def get_holdings(self, code: str):
        entry = self._holdings_cache.get(code)
        if entry and (time_module.time() - entry['time'] < 86400):
            return entry['data']
        return None

    def set_holdings(self, code: str, data: list):
        self._holdings_cache[code] = {"data": data, "time": time_module.time()}
    
    def get_market_indices(self):
        if time_module.time() - self._market_cache['time'] < 30:
            return self._market_cache['data']
        return None
    
    def set_market_indices(self, data: list):
        self._market_cache = {"data": data, "time": time_module.time()}

cache_service = CacheService()

class AkshareService:
    """AKShare 接口封装层"""
    
    @staticmethod
    def get_headers():
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Referer": "http://fund.eastmoney.com/",
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
        """ak.fund_name_em: 获取所有基金列表"""
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
    def fetch_all_estimates_sync():
        """ak.fund_value_estimation_em: 获取全市场实时估值"""
        try:
            # 获取所有基金实时估值
            df = ak.fund_value_estimation_em(symbol="全部")
            if df.empty: return []

            results = []
            today_str = datetime.now().strftime('%Y-%m-%d')
            
            # 清洗数据
            # 原始列名可能包含: 基金代码, 基金名称, 交易日-估算数据-估算值, 交易日-估算数据-估算增长率, 交易日-公布数据-单位净值...
            records = df.to_dict('records')
            for r in records:
                try:
                    est_val = r.get('交易日-估算数据-估算值')
                    est_rate = r.get('交易日-估算数据-估算增长率')
                    if not est_val or str(est_val) == '--': continue
                    
                    results.append({
                        "fundcode": str(r.get('基金代码')),
                        "name": str(r.get('基金名称')),
                        "gsz": str(est_val),
                        "gszzl": str(est_rate).replace('%', '') if est_rate else "0",
                        "dwjz": str(r.get('交易日-公布数据-单位净值', '')),
                        "jzrq": today_str,
                        "source": "official_all"
                    })
                except: continue
            return results
        except Exception as e:
            logger.error(f"Fetch all estimates error: {e}")
            return []

    @staticmethod
    def fetch_realtime_estimate_single_sync(code: str):
        """单个基金实时估值备用接口 (轻量级)"""
        data = { "gsz": "0", "gszzl": "0", "dwjz": "0", "jzrq": "", "name": "", "source": "official_fallback" }
        try:
            ts = int(time_module.time() * 1000)
            url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={ts}"
            resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=2.0)
            match = re.search(r'jsonpgz\((.*?)\);', resp.text)
            if match:
                fetched = json.loads(match.group(1))
                if fetched:
                    data.update(fetched)
        except Exception: pass
        return data

    @staticmethod
    def fetch_fund_history_sync(code: str) -> pd.DataFrame:
        """ak.fund_open_fund_info_em: 获取基金历史净值"""
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
        """ak.fund_portfolio_hold_em: 获取基金持仓"""
        try:
            year = datetime.now().year
            all_dfs = []
            for y in [year, year - 1]:
                try:
                    df = ak.fund_portfolio_hold_em(symbol=code, date=str(y))
                    if not df.empty and '季度' in df.columns: 
                        all_dfs.append(df)
                except: continue
            
            if not all_dfs: return []
            combined = pd.concat(all_dfs)
            
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
        """ak.fund_individual_basic_info_xq: 获取基金基本信息"""
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
        """ak.stock_zh_index_spot_em: 获取全市场指数实时行情"""
        try:
            # 获取 沪深重要指数, 上证系列, 深证系列 等等
            # 这里为了性能和全面性，我们获取一个较大的集合，然后在内存里筛选
            # 实际上 stock_zh_index_spot_em(symbol="沪深重要指数") 已经包含主流的了
            df = ak.stock_zh_index_spot_em(symbol="沪深重要指数")
            if df.empty: return []
            
            result = []
            for _, row in df.iterrows():
                # 兼容返回字段
                # 序号, 代码, 名称, 最新价, 涨跌幅 ...
                code = str(row['代码'])
                # 东财指数代码处理: 
                # 000001 -> 1.000001 (上证)
                # 399001 -> 0.399001 (深证)
                # 为了前端匹配，我们保留原始代码，或者加上市场前缀
                # 这里我们尽量标准化返回
                full_code = code
                if code.startswith('000'): full_code = f"1.{code}"
                elif code.startswith('399'): full_code = f"0.{code}"
                
                result.append({
                    "name": str(row['名称']), 
                    "code": full_code, # 返回带前缀的，或者原始的，前端需要自己对齐
                    "raw_code": code,
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
        批量获取股票实时行情。
        核心修复：准确判断市场代码前缀 (secid)。
        """
        if not codes: return {}
        unique_codes = list(set(codes))
        quotes = {}
        batch_size = 30 # 稍微减小 Batch Size 防止超时
        
        for i in range(0, len(unique_codes), batch_size):
            batch = unique_codes[i:i+batch_size]
            secids = []
            for c in batch:
                # --- 市场代码判断逻辑 (重要!) ---
                # 上海证券交易所 (1.xxx)
                if c.startswith('6'): # 主板, 科创板(688)
                    secids.append(f"1.{c}")
                elif c.startswith('900'): # B股
                    secids.append(f"1.{c}")
                elif c.startswith('5'): # 上证ETF/基金
                    secids.append(f"1.{c}")
                elif c.startswith('11'): # 上证债券
                    secids.append(f"1.{c}")
                # 深圳证券交易所 (0.xxx)
                elif c.startswith('0'): # 主板, 中小板
                    secids.append(f"0.{c}")
                elif c.startswith('3'): # 创业板
                    secids.append(f"0.{c}")
                elif c.startswith('200'): # B股
                    secids.append(f"0.{c}")
                elif c.startswith('159'): # 深证ETF
                    secids.append(f"0.{c}")
                # 北京证券交易所 (0.xxx) - 东财接口归类在 0
                elif c.startswith('8') or c.startswith('4'): 
                    secids.append(f"0.{c}")
                else: 
                    # 默认深证 (兼容)
                    secids.append(f"0.{c}")
            
            # f2: 最新价, f3: 涨跌幅, f12: 代码, f14: 名称
            url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f14&secids={','.join(secids)}"
            try:
                resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=4.0)
                data = resp.json()
                if data and 'data' in data and 'diff' in data['data']:
                    for item in data['data']['diff']:
                        code_val = str(item['f12'])
                        quotes[code_val] = {
                            "price": float(item['f2']) if item['f2'] != '-' else 0.0,
                            "change": float(item['f3']) if item['f3'] != '-' else 0.0,
                            "name": item['f14']
                        }
            except Exception as e:
                logger.warning(f"Stock quote error: {e}")
                pass
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
            if key in f['code'] or key in f['name'] or key in f['pinyin']:
                res.append(f)
                count += 1
                if count >= 30: break 
        return res

    @staticmethod
    async def get_fund_detail(code: str):
        # 1. 并行获取：持仓 + 基本信息
        holdings_task = run_in_threadpool(AkshareService.fetch_holdings_sync, code)
        basic_task = run_in_threadpool(AkshareService.fetch_fund_basic_info_sync, code)
        
        holdings, basic = await asyncio.gather(holdings_task, basic_task)
        
        # 2. 获取重仓股的实时行情，计算涨跌幅
        if holdings:
            stock_codes = [h['code'] for h in holdings]
            quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_direct_sync, stock_codes)
            for h in holdings: 
                q = quotes.get(h['code'])
                if q:
                    h['changePercent'] = q['change']
                    h['currentPrice'] = q['price']
                    # 修正名称（以行情为准）
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
    async def get_market_status(target_codes_str: str = None):
        """
        获取市场指数状态
        支持前端传 target_codes_str: "1.000001,0.399001" 这种格式
        """
        cached = cache_service.get_market_indices()
        
        # 如果没有缓存，重新获取
        if not cached:
            cached = await run_in_threadpool(AkshareService.fetch_market_indices_sync)
            if cached:
                cache_service.set_market_indices(cached)
        
        if not cached: return []

        # 默认展示的指数
        default_codes = ["1.000001", "0.399001", "0.399006", "1.000688", "0.000300"]
        
        filter_codes = []
        if target_codes_str:
            filter_codes = target_codes_str.split(',')
        else:
            filter_codes = default_codes

        # 筛选逻辑
        result = []
        for item in cached:
            # item['code'] 可能是 "1.000001" 或 "000001"
            # item['raw_code'] 是 "000001"
            
            # 我们需要支持两种匹配模式：
            # 1. 前端传了 "1.000001" -> 匹配 item['code']
            # 2. 前端传了 "000001" -> 匹配 item['raw_code']
            
            is_match = False
            for target in filter_codes:
                if target == item['code'] or target == item['raw_code']:
                    is_match = True
                    break
            
            if is_match:
                result.append(item)
                
        return result

    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        
        # 1. 尝试刷新全局估值缓存 (如果为空或过期)
        # 这是为了快速获取大部分基金的官方估值
        if not cache_service.get_all_estimates():
             all_est = await run_in_threadpool(AkshareService.fetch_all_estimates_sync)
             if all_est: cache_service.set_all_estimates(all_est)
        
        # 获取缓存的全局数据并索引
        cached_estimates = cache_service.get_all_estimates() or []
        est_map = {item['fundcode']: item for item in cached_estimates}

        loop = asyncio.get_running_loop()
        
        # 定义单个基金的处理逻辑
        async def process_one(c):
            est = est_map.get(c)
            # 如果全局缓存没有，尝试单独请求一下 (Fallback)
            if not est:
                est_data = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_single_sync, c)
                if est_data and est_data.get('gsz') != "0":
                    est = {
                        "fundcode": c,
                        "name": est_data.get('name'),
                        "gsz": est_data.get('gsz'),
                        "gszzl": est_data.get('gszzl'),
                        "dwjz": est_data.get('dwjz'),
                        "jzrq": est_data.get('jzrq'),
                        "source": "official_fallback"
                    }

            # 并发获取历史净值 (用于确定 dwjz 锚点)
            history = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync, c)
            return c, est, history

        base_results = await asyncio.gather(*[process_one(c) for c in codes])
        
        results_map = {}
        calc_needed_codes = []      # 需要手动计算估值的基金代码列表
        
        phase = AkshareService.get_time_phase()
        today_str = (datetime.utcnow() + timedelta(hours=8)).strftime('%Y-%m-%d')

        for code, official, history in base_results:
            # 初始化基础数据
            res = { 
                "fundcode": code, 
                "name": official['name'] if official else "",
                "gsz": official['gsz'] if official else "0",
                "gszzl": official['gszzl'] if official else "0",
                "dwjz": official['dwjz'] if official else "0",
                "jzrq": official['jzrq'] if official else "",
                "source": official['source'] if official else "none"
            }
            
            # 确定最新的确认净值 (DWJZ) - 作为计算基准
            last_nav = 1.0
            if not history.empty:
                latest = history.iloc[-1]
                # 历史数据里的最新一条
                last_nav = float(latest['单位净值'])
                
                # 如果官方接口没给昨日净值(0)，或者官方给的是旧的，用历史数据填充
                if float(res['dwjz']) <= 0:
                    res['dwjz'] = str(latest['单位净值'])
                    res['jzrq'] = str(latest['净值日期'])
            elif float(res['dwjz']) > 0:
                last_nav = float(res['dwjz'])
            
            res['_last_nav'] = last_nav # 内部字段

            # --- 判断是否需要手动计算估值 (核心逻辑) ---
            need_calc = False
            
            if phase in ['PRE_MARKET', 'WEEKEND']:
                # 非交易时间，通常不需要计算，显示昨日收盘即可
                # 但如果官方估值完全缺失，至少算一个参考
                pass
            elif phase == 'POST_MARKET':
                # 盘后：检查是否已更新真实净值
                if res.get('jzrq') == today_str:
                    res['source'] = "real_updated" # 真实净值已出
                else:
                    # 还没出净值，如果官方估值也是0，则需要计算
                    if float(res.get('gsz', 0)) <= 0: need_calc = True
            else:
                 # 盘中 (MARKET, LUNCH_BREAK)
                 off_gsz = float(res.get("gsz", 0))
                 # 如果官方估值无效(<=0) 或者 估值完全等于昨日净值(波动为0，这在交易时段极不正常)
                 # 则认为官方数据缺失/延迟，启动手动计算
                 if off_gsz <= 0 or abs(off_gsz - last_nav) < 0.0001:
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
            
            # 3. 批量获取股票行情 (精准)
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
                    # 归一化：假设前十大重仓股代表了整体趋势
                    # (加权涨跌幅 / 总权重) = 这一部分的平均涨跌幅
                    normalized_change = weighted_change / total_weight
                    
                    # 修正系数：通常股票仓位在80%-95%，我们取 0.9 作为仓位修正系数
                    # 即：如果重仓股平均涨1%，基金整体涨 0.9%
                    est_change = normalized_change * 0.9
                
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
        "backend": "akshare_refined_v2"
    }

@router.get("/search")
async def search(key: str = Query(..., min_length=1)):
    """搜索基金"""
    return await FundController.get_search_results(key)

@router.get("/market")
async def market(codes: Optional[str] = Query(None)):
    """
    获取大盘指数
    :param codes: 逗号分隔的指数代码字符串，例如 "1.000001,0.399001"
    """
    return await FundController.get_market_status(codes)

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
