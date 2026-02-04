import uvicorn
from fastapi import FastAPI, Query, Body, APIRouter, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
import akshare as ak
import pandas as pd
import requests
import re
import json
import logging
import asyncio
import time as time_module
import os
import google.generativeai as genai
from datetime import datetime, timedelta, time
from typing import List, Dict, Any, Optional

# --- Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SmartFund")

# --- Utils ---
class SafeUtils:
    @staticmethod
    def clean_num(val: Any, default=0.0) -> float:
        if pd.isna(val) or val is None or val == "" or str(val).strip() == "-":
            return default
        s_val = str(val).strip().replace(',', '').replace('%', '')
        try:
            return float(s_val)
        except:
            return default

class GlobalSession:
    _session = None
    @classmethod
    def get(cls):
        if cls._session is None:
            cls._session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=50, max_retries=3)
            cls._session.mount('http://', adapter)
            cls._session.mount('https://', adapter)
        return cls._session

class CacheService:
    """Optimized In-Memory Cache with Auto-Expiration"""
    _instance = None
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CacheService, cls).__new__(cls)
            cls._instance._cache = {}
        return cls._instance

    def get(self, key: str, ttl: int = 60):
        entry = self._cache.get(key)
        if entry:
            # Check TTL
            if ttl == 0 or time_module.time() - entry['time'] < ttl:
                return entry['data']
            else:
                del self._cache[key] # Lazy delete
        return None

    def set(self, key: str, data: any):
        # Overwrite existing key
        self._cache[key] = {"data": data, "time": time_module.time()}

cache_service = CacheService()

class AkshareService:
    
    @staticmethod
    def get_time_phase():
        """
        Determine Market Phase (UTC+8):
        RESET: 09:00 - 09:30 (Clear display)
        MARKET: 09:30 - 15:01 (Intra-day Estimates)
        POST_MARKET: 15:01 - 09:00 (Official NAV with fallback)
        """
        # Convert to Beijing Time
        now = datetime.utcnow() + timedelta(hours=8)
        t = now.time()
        
        # 09:00 - 09:30
        if t >= time(9, 0) and t < time(9, 30):
            return 'RESET'
        
        # 09:30 - 15:01
        if t >= time(9, 30) and t < time(15, 1):
            return 'MARKET'
            
        # 15:01 - 09:00 (Next Day)
        return 'POST_MARKET'

    # --- 1. Basic Fund Info (24h Cache) ---
    @staticmethod
    def fetch_fund_info_cached():
        key = "fund_basic_info_all"
        cached = cache_service.get(key, 86400) # 24h cache
        if cached: return cached
        
        try:
            # Interface: fund_name_em
            df = ak.fund_name_em()
            res = {}
            for r in df.to_dict('records'):
                code = str(r.get('基金代码'))
                res[code] = {
                    "name": str(r.get('基金简称')),
                    "type": str(r.get('基金类型'))
                }
            cache_service.set(key, res)
            return res
        except Exception as e:
            logger.error(f"Fund Info Error: {e}")
            return {}

    # --- 2. Holdings (24h Cache) - Display Only ---
    @staticmethod
    def fetch_holdings_cached(code: str):
        key = f"holdings_{code}"
        cached = cache_service.get(key, 86400)
        if cached: return cached
        
        try:
            current_year = datetime.now().year
            # Interface: fund_portfolio_hold_em
            df = ak.fund_portfolio_hold_em(symbol=code, date=str(current_year))
            if df.empty:
                df = ak.fund_portfolio_hold_em(symbol=code, date=str(current_year - 1))
            
            if df.empty: return []

            if '季度' in df.columns:
                quarters = sorted(df['季度'].unique(), reverse=True)
                if quarters:
                    latest_q = quarters[0]
                    df = df[df['季度'] == latest_q]

            holdings = []
            sorted_df = df.sort_values(by='占净值比例', ascending=False).head(10)
            
            for _, r in sorted_df.iterrows():
                holdings.append({
                    "code": str(r['股票代码']),
                    "name": str(r['股票名称']),
                    "percent": SafeUtils.clean_num(r['占净值比例']),
                    "changePercent": 0 # Removed real-time fetching logic
                })
            
            cache_service.set(key, holdings)
            return holdings
        except:
            return []

    # --- 3. Industry Allocation (24h Cache) ---
    @staticmethod
    def fetch_industry_cached(code: str):
        key = f"industry_{code}"
        cached = cache_service.get(key, 86400)
        if cached: return cached
        
        try:
            current_year = datetime.now().year
            df = ak.fund_portfolio_industry_allocation_em(symbol=code, date=str(current_year))
            if df.empty:
                df = ak.fund_portfolio_industry_allocation_em(symbol=code, date=str(current_year - 1))
            
            if df.empty: return []
            
            if '截止时间' in df.columns:
                latest_date = df['截止时间'].max()
                df = df[df['截止时间'] == latest_date]
            
            res = []
            for _, r in df.iterrows():
                res.append({
                    "name": str(r['行业类别']),
                    "percent": SafeUtils.clean_num(r['占净值比例'])
                })
            res.sort(key=lambda x: x['percent'], reverse=True)
            
            cache_service.set(key, res)
            return res
        except:
            return []

    # --- 4. Sector Trends (30min Cache) ---
    @staticmethod
    def fetch_sector_rankings_cached():
        key = "sector_rankings_ths"
        cached = cache_service.get(key, 1800)
        if cached: return cached
        
        try:
            # Interface: stock_board_industry_summary_ths
            df = ak.stock_board_industry_summary_ths()
            records = []
            if '板块' in df.columns and '涨跌幅' in df.columns:
                for _, row in df.iterrows():
                    records.append({
                        "name": str(row['板块']),
                        "changePercent": SafeUtils.clean_num(row['涨跌幅']),
                        "inflow": SafeUtils.clean_num(row.get('净流入', 0))
                    })
                
                records.sort(key=lambda x: x['changePercent'], reverse=True)
                
                res = {
                    "top": records[:5],
                    "bottom": records[-5:][::-1]
                } 
                cache_service.set(key, res)
                return res
            return {"top": [], "bottom": []}
        except Exception as e:
            logger.error(f"Sector Error: {e}")
            return {"top": [], "bottom": []}

    # --- 5. Fund Rankings (1h Cache) ---
    @staticmethod
    def fetch_fund_rankings_cached():
        key = "fund_rankings_top20"
        cached = cache_service.get(key, 3600)
        if cached: return cached
        
        try:
            df = ak.fund_open_fund_rank_em(symbol="全部")
            df = df.dropna(subset=['日增长率'])
            
            formatted = []
            for _, r in df.iterrows():
                formatted.append({
                    "code": str(r['基金代码']),
                    "name": str(r['基金简称']),
                    "changePercent": SafeUtils.clean_num(r['日增长率'])
                })
            
            formatted.sort(key=lambda x: x['changePercent'], reverse=True)
            
            res = {
                "gainers": formatted[:20],
                "losers": formatted[-20:][::-1]
            }
            cache_service.set(key, res)
            return res
        except:
            return {"gainers": [], "losers": []}

    # --- 6. Post-Market: Official Daily NAV (LV1) (30min Cache) ---
    @staticmethod
    def fetch_official_daily_cached():
        key = "fund_official_daily_em_v2"
        cached = cache_service.get(key, 1800)
        if cached: return cached
        
        try:
            # Interface: fund_open_fund_daily_em
            df = ak.fund_open_fund_daily_em()
            res = {}
            current_date_str = datetime.now().strftime('%Y-%m-%d')
            for r in df.to_dict('records'):
                code = str(r.get('基金代码'))
                res[code] = {
                    "nav": SafeUtils.clean_num(r.get('单位净值')),
                    "prev_nav": SafeUtils.clean_num(r.get('前交易日-单位净值')),
                    "changePercent": SafeUtils.clean_num(r.get('日增长率')),
                    "fee": str(r.get('手续费', '0.00%')),
                    "date": current_date_str
                }
            cache_service.set(key, res)
            return res
        except:
            return {}

    # --- 7. Post-Market: Single History (LV2) (1h Cache) ---
    @staticmethod
    def fetch_fund_history_latest_cached(code: str):
        key = f"fund_history_latest_v2_{code}"
        cached = cache_service.get(key, 3600)
        if cached: return cached

        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not df.empty and len(df) >= 2:
                df['净值日期'] = pd.to_datetime(df['净值日期'])
                df = df.sort_values('净值日期', ascending=False)
                
                latest = df.iloc[0]
                prev = df.iloc[1]
                
                res = {
                    "nav": SafeUtils.clean_num(latest['单位净值']),
                    "prev_nav": SafeUtils.clean_num(prev['单位净值']),
                    "changePercent": SafeUtils.clean_num(latest['日增长率']),
                    "date": latest['净值日期'].strftime('%Y-%m-%d')
                }
                cache_service.set(key, res)
                return res
        except:
            pass
        return None

    # --- 8. Intra-Market: Batch Estimates (LV2) (5min Cache) ---
    @staticmethod
    def fetch_lv2_estimate_cached():
        key = "fund_estimate_lv2_batch"
        cached = cache_service.get(key, 300)
        if cached: return cached
        
        try:
            # Interface: fund_value_estimation_em
            df = ak.fund_value_estimation_em(symbol="全部")
            res = {}
            for r in df.to_dict('records'):
                code = str(r.get('基金代码'))
                res[code] = {
                    "gsz": str(r.get('交易日-估算数据-估算值')),
                    "gszzl": str(r.get('交易日-估算数据-估算增长率')),
                    "gztime": datetime.now().strftime('%H:%M')
                }
            cache_service.set(key, res)
            return res
        except:
            return {}

    # --- 10. Market Indices (Optimized: Direct Fetch & Decoupled) ---
    @staticmethod
    def fetch_market_indices_cached():
        key = "market_indices_main_v2"
        cached = cache_service.get(key, 60) # 1 min cache
        if cached: return cached
        
        task_list = [
            {"secid": "1.000001", "name": "上证指数"},
            {"secid": "0.399001", "name": "深证成指"},
            {"secid": "0.399006", "name": "创业板指"},
            {"secid": "100.NDX", "name": "纳指100"}
        ]
        
        headers = {
            "Referer": "https://quote.eastmoney.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        
        res = []
        for task in task_list:
            try:
                ts = int(time_module.time() * 1000)
                url = f"https://push2.eastmoney.com/api/qt/stock/get?secid={task['secid']}&fields=f12,f14,f43,f170&_={ts}"
                
                resp = GlobalSession.get().get(url, headers=headers, timeout=1.5)
                
                if resp.status_code == 200:
                    data = resp.json().get("data")
                    if data and data.get("f43") and data["f43"] != 0:
                        res.append({
                            "name": task['name'],
                            "code": str(data.get('f12')),
                            "value": data["f43"] / 100.0,
                            "changePercent": data["f170"] / 100.0
                        })
            except Exception as e:
                logger.error(f"Fetch Index {task['name']} Error: {e}")
                continue
            
        if res:
            cache_service.set(key, res)
        return res

    # --- 11. Intra-Market: LV1 JS API (Real-time Estimate) ---
    @staticmethod
    def fetch_lv1_js(code: str):
        try:
            ts = int(time_module.time() * 1000)
            url = f"https://fundgz.1234567.com.cn/js/{code}.js?rt={ts}"
            resp = GlobalSession.get().get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=1.5)
            if resp.status_code == 200:
                match = re.search(r'jsonpgz\s*=?\s*\((.*?)\)', resp.text, re.S)
                if match:
                    data = json.loads(match.group(1))
                    return {
                        "gsz": data.get('gsz'),
                        "gszzl": data.get('gszzl'),
                        "gztime": data.get('gztime'),
                        "name": data.get('name')
                    }
        except: pass
        return None

    # --- 12. History (24h Cache) ---
    @staticmethod
    def fetch_history_cached(code: str):
        key = f"history_{code}"
        cached = cache_service.get(key, 86400)
        if cached: return cached
        
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            res = []
            for _, r in df.iterrows():
                res.append({
                    "date": str(r['净值日期']),
                    "value": SafeUtils.clean_num(r['单位净值'])
                })
            cache_service.set(key, res)
            return res
        except:
            return []

# --- Models ---

class AnalyzeRequest(BaseModel):
    prompt: str
    api_key: Optional[str] = Field(None, alias="apiKey")

class EstimateRequest(BaseModel):
    codes: List[str]

# --- Controller ---

class FundController:
    
    @staticmethod
    async def get_fund_detail(code: str):
        t_info = run_in_threadpool(AkshareService.fetch_fund_info_cached)
        t_holdings = run_in_threadpool(AkshareService.fetch_holdings_cached, code)
        t_industry = run_in_threadpool(AkshareService.fetch_industry_cached, code)
        
        info_dict, holdings, industry = await asyncio.gather(t_info, t_holdings, t_industry)
        
        base_info = info_dict.get(code, {})
        
        return {
            "code": code,
            "name": base_info.get('name', ''),
            "type": base_info.get('type', ''),
            "holdings": holdings,
            "industryDistribution": industry
        }

    @staticmethod
    async def estimate_batch(codes: List[str]):
        if not codes: return []
        
        phase = AkshareService.get_time_phase()
        
        # === RESET PERIOD (09:00 - 09:30) ===
        if phase == 'RESET':
            # Return empty/reset data to avoid confusion
            return [{
                "fundcode": c, "name": "", "gsz": "", "gszzl": "", "dwjz": "", "prev_dwjz": "",
                "gztime": "--", "source": "reset"
            } for c in codes]

        # Prepare Batch Data Sources
        # We pre-fetch batch sources regardless of individual logic to optimize
        t_lv2_est = run_in_threadpool(AkshareService.fetch_lv2_estimate_cached)
        t_official_batch = run_in_threadpool(AkshareService.fetch_official_daily_cached) if phase == 'POST_MARKET' else asyncio.sleep(0)
        
        lv2_est_map, official_map = await asyncio.gather(t_lv2_est, t_official_batch)
        if lv2_est_map is None: lv2_est_map = {}
        if official_map is None: official_map = {}

        async def process_one(code):
            res = {
                "fundcode": code, "name": "", 
                "gsz": "0", "gszzl": "0", "dwjz": "0", "prev_dwjz": "0",
                "gztime": "--", "source": "none"
            }
            
            # --- Helper: Intra-day Estimate Logic ---
            async def apply_estimates(r):
                # LV1: JS API (Individual)
                js_data = await run_in_threadpool(AkshareService.fetch_lv1_js, code)
                if js_data and SafeUtils.clean_num(js_data.get('gsz')) > 0:
                    r.update(js_data)
                    r['source'] = "official_data_1"
                    return r
                
                # LV2: Batch API
                if code in lv2_est_map:
                    l2 = lv2_est_map[code]
                    if SafeUtils.clean_num(l2.get('gsz')) > 0:
                        r.update(l2)
                        r['source'] = "official_data_2"
                        return r
                return r

            # === POST MARKET STRATEGY (15:01 - 09:00) ===
            if phase == 'POST_MARKET':
                # LV1: Official Daily Batch
                if code in official_map:
                    off = official_map[code]
                    if off['nav'] > 0:
                        res.update({
                            "gsz": str(off['nav']),
                            "dwjz": str(off['nav']),
                            "prev_dwjz": str(off['prev_nav']),
                            "gszzl": str(off['changePercent']),
                            "gztime": off['date'],
                            "source": "official_published",
                            "fee": off['fee']
                        })
                        return res
                
                # LV2: History Fetch (Fallback)
                hist_data = await run_in_threadpool(AkshareService.fetch_fund_history_latest_cached, code)
                if hist_data and hist_data['nav'] > 0:
                    res.update({
                        "gsz": str(hist_data['nav']),
                        "dwjz": str(hist_data['nav']),
                        "prev_dwjz": str(hist_data['prev_nav']),
                        "gszzl": str(hist_data['changePercent']),
                        "gztime": hist_data['date'],
                        "source": "official_published"
                    })
                    return res

                # Fallback: Official data not out yet, show estimates
                return await apply_estimates(res)

            # === MARKET STRATEGY (09:30 - 15:01) ===
            return await apply_estimates(res)

        tasks = [process_one(c) for c in codes]
        return await asyncio.gather(*tasks)

    @staticmethod
    async def chat_with_ai(request: AnalyzeRequest):
        if not request.api_key:
            raise HTTPException(status_code=400, detail="Missing API Key")
        try:
            genai.configure(api_key=request.api_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            response = await run_in_threadpool(model.generate_content, request.prompt)
            return {"text": response.text}
        except Exception as e:
            return {"text": f"AI服务暂时不可用: {str(e)}"}

# --- App Definition ---
app = FastAPI(title="SmartFund API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
router = APIRouter(prefix="/api")

@router.post("/estimate/batch")
async def api_estimate(payload: EstimateRequest):
    return await FundController.estimate_batch(payload.codes)

@router.get("/estimate/{code}")
async def api_estimate_one(code: str):
    res = await FundController.estimate_batch([code])
    return res[0] if res else {}

@router.get("/fund/{code}")
async def api_detail(code: str):
    return await FundController.get_fund_detail(code)

@router.get("/history/{code}")
async def api_history(code: str):
    return await run_in_threadpool(AkshareService.fetch_history_cached, code)

@router.get("/market/overview")
async def api_market():
    # Gather Market Data
    t_indices = run_in_threadpool(AkshareService.fetch_market_indices_cached)
    t_sector = run_in_threadpool(AkshareService.fetch_sector_rankings_cached)
    t_rank = run_in_threadpool(AkshareService.fetch_fund_rankings_cached)
    
    indices, sector, rank = await asyncio.gather(t_indices, t_sector, t_rank)
    
    return {
        "indices": indices,
        "sectors": sector,
        "fundRankings": rank
    }

@router.post("/analyze")
async def api_analyze(req: AnalyzeRequest):
    return await FundController.chat_with_ai(req)

@router.get("/search")
async def api_search(key: str):
    all_funds = await run_in_threadpool(AkshareService.fetch_fund_info_cached)
    res = []
    count = 0
    for code, info in all_funds.items():
        if key in code or key in info['name']:
            res.append({"code": code, "name": info['name'], "type": info['type']})
            count += 1
            if count >= 10: break
    return res

app.include_router(router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
