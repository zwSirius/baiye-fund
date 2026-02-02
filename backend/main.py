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

# --- Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SmartFund")

# Configure Gemini API (Server Side Key)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# --- Constants ---
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

# --- Core Services ---

class GlobalSession:
    """Singleton session for HTTP requests"""
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
    """Simple in-memory cache"""
    def __init__(self):
        self._estimate_cache = {} # Individual cache
        self._all_estimates_cache = {"data": [], "time": None} # Bulk cache
        self._funds_list_cache = []
        self._funds_list_time = None
        self._holdings_cache = {}
        self._market_cache = {"data": [], "time": None}

    def get_estimate(self, code: str):
        # 1. Try individual cache
        entry = self._estimate_cache.get(code)
        if entry and time_module.time() < entry['expire']:
            return entry['data']
        
        # 2. Try bulk cache (valid for 3 min)
        if self._all_estimates_cache['data'] and self._all_estimates_cache['time']:
             if (datetime.now() - self._all_estimates_cache['time']).total_seconds() < 180:
                 # Find in list
                 found = next((x for x in self._all_estimates_cache['data'] if x['fundcode'] == code), None)
                 if found: return found
        return None

    def set_estimate(self, code: str, data: dict, ttl: int = 60):
        if data:
            self._estimate_cache[code] = {
                'data': data,
                'expire': time_module.time() + ttl
            }

    def set_all_estimates(self, data: list):
        self._all_estimates_cache = {
            "data": data,
            "time": datetime.now()
        }

    def get_holdings(self, code: str):
        entry = self._holdings_cache.get(code)
        if entry and (datetime.now() - entry['time']).total_seconds() < 86400: # 24h
            return entry['data']
        return None

    def set_holdings(self, code: str, data: list):
        self._holdings_cache[code] = {"data": data, "time": datetime.now()}

    async def get_funds_list(self):
        if not self._funds_list_cache or not self._funds_list_time or \
           (datetime.now() - self._funds_list_time).total_seconds() > 86400:
            return None
        return self._funds_list_cache

    def set_funds_list(self, data: list):
        self._funds_list_cache = data
        self._funds_list_time = datetime.now()

cache_service = CacheService()

class AkshareService:
    """Encapsulates AKShare and Data Fetching Logic"""
    
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
        if t < time(9, 30): return 'PRE_MARKET'
        elif t >= time(11, 30) and t < time(13, 0): return 'LUNCH_BREAK'
        elif t <= time(15, 0): return 'MARKET'
        else: return 'POST_MARKET'

    @staticmethod
    def fetch_fund_history_sync(code: str) -> pd.DataFrame:
        """
        Interface: fund_open_fund_info_em
        Target: http://fund.eastmoney.com/pingzhongdata/710001.js
        """
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not df.empty:
                if '净值日期' in df.columns: df['净值日期'] = df['净值日期'].astype(str)
                if '单位净值' in df.columns: df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce')
                return df
        except Exception as e:
            logger.warning(f"Akshare history error {code}: {e}")
        return pd.DataFrame()

    @staticmethod
    def fetch_all_estimates_sync():
        """
        Interface: fund_value_estimation_em
        Desc: Get real-time estimation for ALL funds.
        """
        try:
            # symbol='全部' returns all
            df = ak.fund_value_estimation_em(symbol="全部")
            if df.empty: return []
            
            # DataFrame columns: 基金代码, 基金名称, 交易日-估算数据-估算值, 交易日-估算数据-估算增长率, ...
            results = []
            now_str = datetime.now().strftime('%Y-%m-%d')
            
            # Iterate efficiently
            for row in df.itertuples():
                try:
                    # Access by index or name if safe. Use dict access for safety with spaces.
                    # akshare dataframe columns often have chinese names.
                    r_dict = row._asdict()
                    # Map based on known column names from doc
                    # _1='基金代码', _3='交易日-估算数据-估算值', _4='交易日-估算数据-估算增长率' roughly
                    # Better to convert to dict first if column names are dynamic, but let's assume standard
                    pass 
                except: continue

            # Convert to dict list
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
                        "jzrq": now_str,
                        "source": "official_all"
                    })
                except: continue
                
            return results
        except Exception as e:
            logger.error(f"Fetch all estimates error: {e}")
            return []

    @staticmethod
    def fetch_realtime_estimate_fallback_sync(code: str):
        """
        Fallback direct request if bulk interface misses or fails
        """
        data = { "gsz": "0", "gszzl": "0", "dwjz": "0", "jzrq": "", "name": "", "source": "official_fallback" }
        try:
            ts = int(time_module.time() * 1000)
            url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={ts}"
            resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=1.5)
            match = re.search(r'jsonpgz\((.*?)\);', resp.text)
            if match:
                fetched = json.loads(match.group(1))
                if fetched:
                    data.update(fetched)
        except Exception: pass
        return data

    @staticmethod
    def fetch_holdings_sync(code: str) -> List[Dict]:
        """
        Interface: fund_portfolio_hold_em
        Target: http://fundf10.eastmoney.com/ccmx_000001.html
        """
        try:
            year = datetime.now().year
            all_dfs = []
            # Try current year and previous year
            for y in [year, year - 1]:
                try:
                    df = ak.fund_portfolio_hold_em(symbol=code, date=str(y))
                    if not df.empty and '季度' in df.columns: 
                        all_dfs.append(df)
                except: continue
            
            if not all_dfs: return []
            combined = pd.concat(all_dfs)
            
            # Parse '2024年1季度股票投资明细' -> Rank
            def parse_rank(q):
                try:
                    if '年报' in q: return int(re.search(r'(\d{4})', q).group(1)) * 100 + 4
                    return int(re.search(r'(\d{4})', q).group(1)) * 100 + int(re.search(r'(\d)季度', q).group(1))
                except: return 0

            combined['rank'] = combined['季度'].apply(parse_rank)
            combined['占净值比例'] = pd.to_numeric(combined['占净值比例'], errors='coerce').fillna(0)
            
            # Sort by date desc, then weight desc
            sorted_df = combined.sort_values(by=['rank', '占净值比例'], ascending=[False, False])
            
            if sorted_df.empty: return []
            latest_rank = sorted_df.iloc[0]['rank']
            top10 = sorted_df[sorted_df['rank'] == latest_rank].head(10)
            
            return [
                {
                    "code": str(r['股票代码']), 
                    "name": str(r['股票名称']), 
                    "percent": float(r['占净值比例'])
                }
                for _, r in top10.iterrows()
            ]
        except Exception as e:
            logger.error(f"Holdings error {code}: {e}")
            return []

    @staticmethod
    def fetch_fund_basic_info_sync(code: str):
        """
        Interface: fund_individual_basic_info_xq
        Target: https://danjuanfunds.com/funding/000001
        """
        try:
            df = ak.fund_individual_basic_info_xq(symbol=code)
            # DF columns: item, value
            info = {}
            if not df.empty:
                for _, row in df.iterrows():
                    info[row['item']] = row['value']
            return info
        except Exception as e:
            logger.warning(f"Basic info error {code}: {e}")
            return {}

    @staticmethod
    def fetch_stock_quotes_sync(codes: List[str]) -> Dict[str, Dict[str, float]]:
        """
        Batch fetch stock quotes for holdings valuation.
        Direct API is used here for performance (fetching 10 specific items vs downloading full market).
        Logic updated to support BJ/ETF.
        """
        if not codes: return {}
        unique = list(set(codes))
        quotes = {}
        batch_size = 40
        
        for i in range(0, len(unique), batch_size):
            batch = unique[i:i+batch_size]
            secids = []
            for c in batch:
                # Eastmoney secid rules:
                # 1.xxx: SH Main(6), SH 科创(688), SH B(900), SH Bond(11), SH Fund(5)
                # 0.xxx: SZ Main(00), SZ ChiNext(30), SZ B(20), BJ(8/4), SZ Fund(159)
                
                if c.startswith('6') or c.startswith('900') or c.startswith('5') or c.startswith('11'): 
                    secids.append(f"1.{c}")
                else: 
                    # Covers 00x, 30x, 8xx(BJ), 4xx(BJ), 159(SZ ETF)
                    secids.append(f"0.{c}")
            
            # f2: price, f3: change%
            url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12&secids={','.join(secids)}"
            try:
                resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=3.0)
                data = resp.json()
                if data and 'data' in data and 'diff' in data['data']:
                    for item in data['data']['diff']:
                        quotes[str(item['f12'])] = {
                            "price": float(item['f2']) if item['f2'] != '-' else 0.0,
                            "change": float(item['f3']) if item['f3'] != '-' else 0.0
                        }
            except Exception: pass
        return quotes

    @staticmethod
    def fetch_fund_list_sync():
        """
        Interface: fund_name_em
        Target: http://fund.eastmoney.com/fund.html
        """
        try:
            df = ak.fund_name_em()
            # Columns: 基金代码, 拼音缩写, 基金简称, 基金类型, 拼音全称
            result = []
            for _, row in df.iterrows():
                result.append({
                    "code": str(row['基金代码']),
                    "name": str(row['基金简称']),
                    "type": str(row['基金类型']),
                    "pinyin": str(row['拼音缩写'])
                })
            return result
        except Exception as e:
            logger.error(f"Fetch fund list error: {e}")
            return []

    @staticmethod
    def fetch_market_indices_sync():
        """
        Interface: stock_zh_index_spot_em
        Symbol: 沪深重要指数
        """
        try:
            df = ak.stock_zh_index_spot_em(symbol="沪深重要指数")
            if df.empty: return []
            
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
                        "score": int(max(0, min(100, 50 + chg * 10))),
                        "leadingStock": "--"
                    })
            return result
        except Exception as e:
            logger.error(f"Market indices error: {e}")
            return []

# --- Business Logic Controller ---

class FundController:
    
    @staticmethod
    async def get_search_results(key: str):
        cached = await cache_service.get_funds_list()
        if not cached:
            cached = await run_in_threadpool(AkshareService.fetch_fund_list_sync)
            cache_service.set_funds_list(cached)
        
        if not cached: return []
        
        key = key.upper()
        res = []
        # Optimized search
        for f in cached:
            if key in f['code'] or key in f['name'] or key in f['pinyin']:
                res.append(f)
                if len(res) >= 20: break
        return res

    @staticmethod
    async def get_fund_detail(code: str):
        # Parallel fetch: Holdings + Basic Info
        holdings_task = run_in_threadpool(AkshareService.fetch_holdings_sync, code)
        basic_task = run_in_threadpool(AkshareService.fetch_fund_basic_info_sync, code)
        
        holdings, basic = await asyncio.gather(holdings_task, basic_task)
        
        # Add real-time quotes to holdings
        if holdings:
            quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_sync, [h['code'] for h in holdings])
            for h in holdings: 
                q = quotes.get(h['code'])
                if q:
                    h['changePercent'] = q['change']
                    h['currentPrice'] = q['price']
                else:
                    h['changePercent'] = 0
                    h['currentPrice'] = 0

        manager = basic.get('基金经理', '暂无')
        return {
            "code": code, 
            "manager": manager, 
            "holdings": holdings,
            # Additional details from basic info
            "fund_size": basic.get('最新规模', ''),
            "start_date": basic.get('成立时间', '')
        }

    @staticmethod
    async def get_market_status():
        cached = cache_service.get_market_data()
        if cached: return cached
        
        data = await run_in_threadpool(AkshareService.fetch_market_indices_sync)
        if data:
            cache_service.set_market_data(data)
        return data

    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        
        # 1. Try to refresh global estimates if empty
        if not cache_service._all_estimates_cache['data']:
             all_est = await run_in_threadpool(AkshareService.fetch_all_estimates_sync)
             if all_est: cache_service.set_all_estimates(all_est)

        loop = asyncio.get_running_loop()
        
        # 2. Process each fund
        async def process_one(c):
            # Try cache first (populated by all_estimates)
            est = cache_service.get_estimate(c)
            if not est:
                # Fallback to single fetch
                est = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_fallback_sync, c)
            
            # Fetch history for last NAV reference
            history = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync, c)
            return c, est, history

        base_results = await asyncio.gather(*[process_one(c) for c in codes])
        
        results_map = {}
        calc_needed = []
        phase = AkshareService.get_time_phase()
        today_str = (datetime.utcnow() + timedelta(hours=8)).strftime('%Y-%m-%d')

        for code, official, history in base_results:
            res = { "fundcode": code, **(official or {}) }
            
            # Determine Last NAV
            last_nav = 1.0
            if not history.empty:
                latest = history.iloc[-1]
                # If history has today's data (updated after close), use it
                last_nav = float(latest['单位净值'])
                res['dwjz'] = str(latest['单位净值'])
                res['jzrq'] = str(latest['净值日期'])
            elif float(res.get('dwjz', 0)) > 0:
                last_nav = float(res['dwjz'])
            
            res['_last_nav'] = last_nav
            
            # Logic to determine if we need manual calculation
            need_calc = False
            
            if phase in ['PRE_MARKET', 'WEEKEND']:
                # Market closed, show last close
                res['gsz'] = res['dwjz']
                res['gszzl'] = "0.00"
                if len(history) >= 2:
                    prev = float(history.iloc[-2]['单位净值'])
                    if prev > 0: 
                        res['gszzl'] = "{:.4f}".format(((last_nav - prev)/prev)*100)
                res['source'] = 'real_history'
                
            elif phase == 'POST_MARKET':
                # Market closed today
                if res.get('jzrq') == today_str:
                    # Official NAV updated
                    curr = float(res.get('dwjz', 0))
                    # Calculate change based on history
                    prev = 0
                    if not history.empty:
                        # Check if history implies today is the latest
                        if str(history.iloc[-1]['净值日期']) == today_str:
                             if len(history) >= 2: prev = float(history.iloc[-2]['单位净值'])
                        else:
                             # History not yet updated but realtime interface has today's dwjz
                             prev = float(history.iloc[-1]['单位净值'])
                    
                    if prev > 0:
                        res['gsz'] = str(curr)
                        res['gszzl'] = "{:.4f}".format(((curr - prev)/prev)*100)
                        res['source'] = "real_updated"
                else:
                    # Not yet updated, try calc
                    need_calc = True
            else:
                 # Market Open: Check if official estimate is valid
                 off_gsz = float(res.get("gsz", 0))
                 # If estimate is 0 or same as last nav (no movement), try calc
                 if off_gsz <= 0 or abs(off_gsz - last_nav) < 0.0001:
                     need_calc = True
                 else:
                     res['source'] = 'official_live'
            
            if need_calc: calc_needed.append(code)
            results_map[code] = res

        # 3. Manual Calculation for funds missing official data
        if calc_needed:
            # Fetch holdings
            codes_to_fetch = [c for c in calc_needed if not cache_service.get_holdings(c)]
            if codes_to_fetch:
                 h_tasks = [run_in_threadpool(AkshareService.fetch_holdings_sync, c) for c in codes_to_fetch]
                 fetched_h = await asyncio.gather(*h_tasks)
                 for i, c in enumerate(codes_to_fetch):
                     cache_service.set_holdings(c, fetched_h[i])
            
            # Aggregate stock codes
            all_stocks = []
            fund_holdings_map = {}
            for c in calc_needed:
                h = cache_service.get_holdings(c) or []
                fund_holdings_map[c] = h
                all_stocks.extend([x['code'] for x in h])
            
            # Fetch Quotes
            quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_sync, all_stocks)
            
            # Calculate
            for c in calc_needed:
                data = results_map[c]
                holdings = fund_holdings_map.get(c, [])
                if not holdings: continue
                
                weighted_change = 0
                total_weight = 0
                for h in holdings:
                    w = h['percent']
                    q = quotes.get(h['code'])
                    change = q['change'] if q else 0
                    weighted_change += (change * w)
                    total_weight += w
                
                est_change = 0
                if total_weight > 0:
                    # Normalize: Assume non-top10 holdings move similarly (with 0.95 dampening)
                    normalized = weighted_change / total_weight
                    est_change = normalized * 0.95
                
                est_nav = data['_last_nav'] * (1 + est_change / 100.0)
                data['gsz'] = "{:.4f}".format(est_nav)
                data['gszzl'] = "{:.4f}".format(est_change)
                data['source'] = "holdings_calc_batch"

        return [results_map[c] for c in codes]

    @staticmethod
    async def analyze_content(prompt: str):
        if not GEMINI_API_KEY:
            raise HTTPException(status_code=500, detail="Server Gemini Key not configured")
        try:
            model = genai.GenerativeModel("gemini-3-flash-preview") 
            response = await run_in_threadpool(model.generate_content, prompt)
            return {"text": response.text}
        except Exception as e:
            logger.error(f"Gemini Error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

# --- FastAPI App ---

app = FastAPI(title="SmartFund API", description="Optimized Backend using AKShare Interfaces")

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
    return {"phase": AkshareService.get_time_phase(), "ts": datetime.now().timestamp()}

@router.get("/search")
async def search(key: str = Query(..., min_length=1)):
    return await FundController.get_search_results(key)

@router.get("/market")
async def market(codes: str = Query(None)):
    # Return standard market indices
    return await FundController.get_market_status()

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
