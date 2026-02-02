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
        self._estimate_cache = {}
        self._funds_list_cache = []
        self._funds_list_time = None
        self._holdings_cache = {}
        self._industry_cache = {}

    def get_estimate(self, code: str):
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

    def get_holdings(self, code: str):
        entry = self._holdings_cache.get(code)
        if entry and (datetime.now() - entry['time']).total_seconds() < 86400:
            return entry['data']
        return None

    def set_holdings(self, code: str, data: list):
        self._holdings_cache[code] = {"data": data, "time": datetime.now()}

    def get_industry(self, code: str):
        return self._industry_cache.get(code)

    def set_industry(self, code: str, industry: str):
        self._industry_cache[code] = industry

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
    """Encapsulates Akshare and Data Fetching Logic"""
    
    @staticmethod
    def get_headers():
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Referer": "http://fund.eastmoney.com/",
            "Connection": "keep-alive"
        }

    @staticmethod
    def get_quote_headers():
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Referer": "http://quote.eastmoney.com/",
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
        try:
            ts = int(time_module.time() * 1000)
            url = f"http://fund.eastmoney.com/pingzhongdata/{code}.js?v={ts}"
            resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=3.0)
            
            if resp.status_code == 200:
                match = re.search(r'var Data_netWorthTrend = (\[.*?\]);', resp.text)
                if match:
                    json_str = match.group(1)
                    data = json.loads(json_str)
                    df = pd.DataFrame(data)
                    df['净值日期'] = pd.to_datetime(df['x'], unit='ms') + timedelta(hours=8)
                    df['净值日期'] = df['净值日期'].dt.strftime('%Y-%m-%d')
                    df['单位净值'] = df['y']
                    return df
        except Exception as e:
            logger.warning(f"Pingzhongdata history failed, fallback: {e}")
        return pd.DataFrame()

    @staticmethod
    def fetch_realtime_estimate_sync(code: str):
        cached = cache_service.get_estimate(code)
        if cached: return cached

        data = { "gsz": "0", "gszzl": "0", "dwjz": "0", "jzrq": "", "name": "", "gztime": "", "source": "official" }
        try:
            ts = int(time_module.time() * 1000)
            url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={ts}"
            resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=2.0)
            match = re.search(r'jsonpgz\((.*?)\);', resp.text)
            if match:
                fetched = json.loads(match.group(1))
                if fetched:
                    data.update(fetched)
                    cache_service.set_estimate(code, data)
        except Exception: pass
        return data

    @staticmethod
    def fetch_holdings_sync(code: str) -> List[Dict]:
        try:
            year = datetime.now().year
            all_dfs = []
            for y in [year, year - 1]:
                try:
                    df = ak.fund_portfolio_hold_em(symbol=code, date=y)
                    if not df.empty and '季度' in df.columns: all_dfs.append(df)
                except: continue
            
            if not all_dfs: return []
            combined = pd.concat(all_dfs)
            
            def parse_rank(q):
                try:
                    if '年报' in q: return int(re.search(r'(\d{4})', q).group(1)) * 100 + 4
                    return int(re.search(r'(\d{4})', q).group(1)) * 100 + int(re.search(r'(\d)季度', q).group(1))
                except: return 0

            combined['rank'] = combined['季度'].apply(parse_rank)
            combined['占净值比例'] = pd.to_numeric(combined['占净值比例'], errors='coerce').fillna(0)
            sorted_df = combined.sort_values(by=['rank', '占净值比例'], ascending=[False, False])
            
            if sorted_df.empty: return []
            latest_rank = sorted_df.iloc[0]['rank']
            
            holdings = []
            for _, r in sorted_df[sorted_df['rank'] == latest_rank].head(10).iterrows():
                raw_code = str(r['股票代码']).strip()
                holdings.append({
                    "code": raw_code,
                    "name": str(r['股票名称']).strip(),
                    "percent": float(r['占净值比例'])
                })
            return holdings
        except Exception as e:
            logger.error(f"Holdings error {code}: {e}")
            return []

    @staticmethod
    def fetch_industry_sync(code: str) -> str:
        try:
            df = ak.fund_portfolio_industry_allocation_em(symbol=code, date=datetime.now().year)
            if df.empty:
                df = ak.fund_portfolio_industry_allocation_em(symbol=code, date=datetime.now().year - 1)
            
            if not df.empty:
                 df['占净值比例'] = pd.to_numeric(df['占净值比例'], errors='coerce')
                 top = df.sort_values('占净值比例', ascending=False).iloc[0]
                 return str(top['行业类别'])
        except: pass
        return ""

    @staticmethod
    def fetch_stock_quotes_sync(codes: List[str]) -> Dict[str, Dict[str, float]]:
        """
        Robust Real-time Quote Fetcher.
        Handles: A-Shares, ETF (51/15), HK Stocks (116), Indices (100/1/0)
        """
        if not codes: return {}
        unique = list(set([c.strip() for c in codes if c.strip()]))
        quotes = {}
        batch_size = 40
        
        for i in range(0, len(unique), batch_size):
            batch = unique[i:i+batch_size]
            secids = []
            
            for c in batch:
                # 1. Already formatted secid (e.g. "1.000001" passed from frontend)
                if '.' in c:
                    secids.append(c)
                    continue

                # 2. Logic for raw codes
                prefix = "0"
                
                # Length 6: A-Share / ETF / Index
                if len(c) == 6:
                    # Shanghai: 6(Stock), 9(B), 5(Fund/ETF), 000(Index)
                    if c.startswith('6') or c.startswith('9') or c.startswith('5') or c.startswith('000'): 
                        prefix = "1"
                    # Shenzhen: 0(Stock), 3(Stock), 1(Fund/ETF/Bond), 399(Index)
                    elif c.startswith('0') or c.startswith('3') or c.startswith('1') or c.startswith('399'):
                        prefix = "0"
                    # Beijing: 8, 4
                    elif c.startswith('8') or c.startswith('4'):
                        prefix = "0"
                    else:
                        prefix = "0" # Default fallback
                
                # Length 5: HK Stocks (e.g. 00700)
                elif len(c) == 5 and c.isdigit():
                    prefix = "116"
                
                # Short codes (e.g. 700 -> 00700 HK)
                elif len(c) < 5 and c.isdigit():
                    c = c.zfill(5)
                    prefix = "116"
                
                # Non-digit: Global Indices likely (HSI, NDX)
                elif not c.isdigit():
                    prefix = "100"
                
                secids.append(f"{prefix}.{c}")
            
            if not secids: continue

            # Using push2.eastmoney.com (Stable endpoint)
            url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f14&secids={','.join(secids)}"
            try:
                resp = GlobalSession.get().get(url, headers=AkshareService.get_quote_headers(), timeout=4.0)
                data = resp.json()
                if data and 'data' in data and 'diff' in data['data']:
                    diff = data['data']['diff']
                    if isinstance(diff, dict): diff = diff.values()
                        
                    for item in diff:
                        ret_code = str(item['f12'])
                        
                        price = item['f2']
                        change = item['f3']
                        
                        # Handle invalid data
                        final_price = 0.0
                        final_change = 0.0
                        
                        if price != '-':
                            try: final_price = float(price)
                            except: pass
                        
                        if change != '-':
                            try: final_change = float(change)
                            except: pass
                        
                        quotes[ret_code] = {
                            "price": final_price,
                            "change": final_change
                        }
            except Exception as e: 
                logger.error(f"Quote fetch error for batch {batch}: {e}")
        return quotes

    @staticmethod
    def fetch_fund_list_sync():
        try:
            df = ak.fund_name_em()
            df = df.rename(columns={'基金代码': 'code', '基金简称': 'name', '基金类型': 'type', '拼音缩写': 'pinyin'})
            result = df[['code', 'name', 'type', 'pinyin']].to_dict('records')
            for r in result:
                r['code'] = str(r['code'])
                r['name'] = str(r['name'])
                r['type'] = str(r['type'])
                r['pinyin'] = str(r['pinyin'])
            return result
        except Exception as e:
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
        for f in cached:
            if key in f['code'] or key in f['name'] or key in f['pinyin']:
                res.append(f)
                if len(res) >= 20: break
        return res

    @staticmethod
    async def get_fund_detail(code: str):
        manager_task = run_in_threadpool(ak.fund_manager_em, symbol=code)
        
        cached_holdings = cache_service.get_holdings(code)
        if cached_holdings is not None:
            holdings = cached_holdings
        else:
            holdings = await run_in_threadpool(AkshareService.fetch_holdings_sync, code)
            cache_service.set_holdings(code, holdings)

        manager_name = "暂无"
        try:
            m_df = await manager_task
            if not m_df.empty: manager_name = m_df.iloc[-1]['姓名']
        except: pass

        industry_tag = cache_service.get_industry(code)
        if not industry_tag:
            industry_tag = await run_in_threadpool(AkshareService.fetch_industry_sync, code)
            if not industry_tag and holdings and GEMINI_API_KEY:
                try:
                    stocks = ", ".join([h['name'] for h in holdings[:5]])
                    model = genai.GenerativeModel("gemini-3-flash-preview")
                    prompt = f"Based on these fund holdings: {stocks}. What is the single specific industry sector name (e.g., 'Liquor', 'Semiconductor', 'New Energy'). Answer in Chinese, max 4 chars."
                    resp = await run_in_threadpool(model.generate_content, prompt)
                    if resp.text: industry_tag = resp.text.strip()
                except: pass
            cache_service.set_industry(code, industry_tag or "")

        if holdings:
            quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_sync, [h['code'] for h in holdings])
            for h in holdings: 
                q = quotes.get(h['code'])
                # Fuzzy match for HK stocks (e.g. holdings says 700, quote has 00700)
                if not q and h['code'].isdigit():
                    q = quotes.get(h['code'].zfill(5)) # Try 00700
                    if not q:
                         q = quotes.get(str(int(h['code']))) # Try 700
                         
                if q:
                    h['changePercent'] = q['change']
                    h['currentPrice'] = q['price']
                else:
                    h['changePercent'] = 0
                    h['currentPrice'] = 0

        return {
            "code": code, 
            "manager": manager_name, 
            "holdings": holdings,
            "industry": industry_tag 
        }

    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        
        loop = asyncio.get_running_loop()
        
        async def fetch_one(c):
            official = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_sync, c)
            history = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync, c)
            return c, official, history

        base_results = await asyncio.gather(*[fetch_one(c) for c in codes])
        
        results_map = {}
        calc_needed = []
        phase = AkshareService.get_time_phase()
        today_str = (datetime.utcnow() + timedelta(hours=8)).strftime('%Y-%m-%d')

        for code, official, history in base_results:
            res = { "fundcode": code, **official }
            
            last_nav = 1.0
            last_date = ""
            
            if not history.empty:
                latest = history.iloc[-1]
                last_nav = float(latest['单位净值'])
                last_date = str(latest['净值日期'])
                
                if last_date == today_str:
                    res['dwjz'] = str(last_nav)
                    res['jzrq'] = last_date
                    res['gsz'] = str(last_nav)
                    res['gszzl'] = str(latest.get('日增长率', 0) if '日增长率' in latest else 0)
                    res['source'] = "official_final"
                    results_map[code] = res
                    continue 

            res['dwjz'] = str(last_nav)
            res['jzrq'] = last_date
            res['_last_nav'] = last_nav
            
            off_gsz = float(res.get("gsz", 0))
            off_gszzl = float(res.get("gszzl", 0))
            
            is_valid_official = False
            if off_gsz > 0 and off_gsz != last_nav:
                is_valid_official = True
            if phase in ['MARKET', 'LUNCH_BREAK'] and abs(off_gszzl) < 0.001:
                is_valid_official = False
            
            if is_valid_official:
                res['source'] = "official_estimate"
                results_map[code] = res
            else:
                calc_needed.append(code)
                results_map[code] = res

        if calc_needed:
            codes_to_fetch_h = [c for c in calc_needed if not cache_service.get_holdings(c)]
            if codes_to_fetch_h:
                 h_tasks = [run_in_threadpool(AkshareService.fetch_holdings_sync, c) for c in codes_to_fetch_h]
                 fetched_h = await asyncio.gather(*h_tasks)
                 for i, c in enumerate(codes_to_fetch_h):
                     cache_service.set_holdings(c, fetched_h[i])
            
            all_target_codes = []
            fund_holdings_map = {}
            for c in calc_needed:
                h = cache_service.get_holdings(c) or []
                fund_holdings_map[c] = h
                all_target_codes.extend([x['code'] for x in h])
            
            # Fetch Quotes (Using Improved Logic)
            quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_sync, all_target_codes)
            
            for c in calc_needed:
                data = results_map[c]
                holdings = fund_holdings_map.get(c, [])
                
                if not holdings: continue
                
                weighted_change = 0
                total_weight = 0
                
                for h in holdings:
                    w = h['percent']
                    q = quotes.get(h['code'])
                    
                    # Fuzzy match
                    if not q and h['code'].isdigit():
                         q = quotes.get(h['code'].zfill(5))
                         if not q: q = quotes.get(str(int(h['code'])))
                    
                    change = q['change'] if q else 0
                    weighted_change += (change * w)
                    total_weight += w
                
                est_change = 0
                if total_weight > 0:
                    normalized_change = weighted_change / total_weight
                    est_change = normalized_change * 0.95 
                
                est_nav = data['_last_nav'] * (1 + est_change / 100.0)
                
                data['gsz'] = "{:.4f}".format(est_nav)
                data['gszzl'] = "{:.2f}".format(est_change)
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

app = FastAPI(title="SmartFund API", description="Optimized Backend")

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
    target_codes = codes.split(',') if codes else ["1.000001", "0.399001"]
    
    # Use the robust fetcher directly. 
    # The new fetch_stock_quotes_sync handles secid formatting automatically.
    try:
        quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_sync, target_codes)
        result = []
        for code, data in quotes.items():
            # For indices, code might be '000001' or '399001' or 'HSI'
            # We want to return what frontend expects.
            # But the fetcher returns the clean code as key.
            # Let's try to match names if possible, but API doesn't return name in dict easily unless we modify it.
            # Modified fetch_stock_quotes_sync to key by f12 (code).
            
            # We need names. Let's adjust fetch_stock_quotes_sync return or just use what we have.
            # For market page, we need name and code.
            # Since fetch_stock_quotes_sync returns dict of {price, change}, we lose the name.
            # Let's do a direct call here to preserve name.
            pass

        # Direct call for Market Page to keep Names
        # Re-use the smart secid logic
        unique = list(set([c.strip() for c in target_codes if c.strip()]))
        secids = []
        for c in unique:
             # Just copy the logic from fetch_stock_quotes_sync for consistency
             if '.' in c: secids.append(c)
             elif len(c) == 6:
                if c.startswith('6') or c.startswith('9') or c.startswith('5') or c.startswith('000'): secids.append(f"1.{c}")
                elif c.startswith('0') or c.startswith('3') or c.startswith('1') or c.startswith('399'): secids.append(f"0.{c}")
                elif c.startswith('8') or c.startswith('4'): secids.append(f"0.{c}")
                else: secids.append(f"0.{c}")
             elif len(c) == 5 and c.isdigit(): secids.append(f"116.{c}")
             elif len(c) < 5 and c.isdigit(): secids.append(f"116.{c.zfill(5)}")
             elif not c.isdigit(): secids.append(f"100.{c}")

        url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f14&secids={','.join(secids)}"
        resp = await run_in_threadpool(lambda: requests.get(url, headers=AkshareService.get_quote_headers(), timeout=3))
        data = resp.json()
        result = []
        if data and 'data' in data and 'diff' in data['data']:
            for item in data['data']['diff']:
                change = float(item['f3']) if item['f3'] != '-' else 0.0
                price = float(item['f2']) if item['f2'] != '-' else 0.0
                score = max(0, min(100, 50 + change * 10))
                
                # If it's an index like 1.000001, f12 is 000001. 
                # We should try to return the full code or match frontend expectation?
                # Frontend just displays what we return.
                
                result.append({
                    "name": item['f14'], 
                    "code": str(item['f12']), 
                    "changePercent": change, 
                    "score": int(score), 
                    "leadingStock": "--", 
                    "value": price
                })
        return result
    except Exception as e: 
        logger.error(f"Market fetch error: {e}")
        return []

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
    df = df.sort_values('净值日期')
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
