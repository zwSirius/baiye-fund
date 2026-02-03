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
        # Overwrite existing key (Clear old cache logic)
        self._cache[key] = {"data": data, "time": time_module.time()}

cache_service = CacheService()

class AkshareService:
    
    @staticmethod
    def get_time_phase():
        """
        Determine Market Phase:
        POST_MARKET: 15:00 - Next Day 09:00 (Try Official Data, Fallback to Estimate)
        MARKET: 09:00 - 15:00 (Use Estimates)
        """
        now = datetime.utcnow() + timedelta(hours=8)
        t = now.time()
        # 15:00 Close to 09:00 Next Day
        if t >= time(15, 0) or t < time(9, 0):
            return 'POST_MARKET'
        return 'MARKET'

    # --- 1. Basic Fund Info (24h Cache) ---
    @staticmethod
    def fetch_fund_info_cached():
        key = "fund_basic_info_all"
        cached = cache_service.get(key, 86400)
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

    # --- 2. Holdings (24h Cache) ---
    @staticmethod
    def fetch_holdings_cached(code: str):
        key = f"holdings_{code}"
        cached = cache_service.get(key, 86400)
        if cached: return cached
        
        try:
            current_year = datetime.now().year
            # Interface: fund_portfolio_hold_em
            # Logic: Try current year, then last year. Auto-select latest quarter.
            df = ak.fund_portfolio_hold_em(symbol=code, date=str(current_year))
            if df.empty:
                df = ak.fund_portfolio_hold_em(symbol=code, date=str(current_year - 1))
            
            if df.empty: return []

            # Auto-detect latest quarter (Sort by '季度' desc)
            if '季度' in df.columns:
                quarters = sorted(df['季度'].unique(), reverse=True)
                if quarters:
                    latest_q = quarters[0]
                    df = df[df['季度'] == latest_q]

            holdings = []
            # Top 10 by weight
            sorted_df = df.sort_values(by='占净值比例', ascending=False).head(10)
            
            for _, r in sorted_df.iterrows():
                holdings.append({
                    "code": str(r['股票代码']),
                    "name": str(r['股票名称']),
                    "percent": SafeUtils.clean_num(r['占净值比例'])
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
            # Interface: fund_portfolio_industry_allocation_em
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
            # Check necessary columns exist
            if '板块' in df.columns and '涨跌幅' in df.columns:
                for _, row in df.iterrows():
                    records.append({
                        "name": str(row['板块']),
                        "changePercent": SafeUtils.clean_num(row['涨跌幅']),
                        "inflow": SafeUtils.clean_num(row.get('净流入', 0))
                    })
                
                records.sort(key=lambda x: x['changePercent'], reverse=True)
                
                # Top 5 and Bottom 5
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
            # Interface: fund_open_fund_rank_em
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

    # --- 6. Official Daily NAV (LV1 - Batch) (30min Cache, Post-Market) ---
    @staticmethod
    def fetch_official_daily_cached():
        key = "fund_official_daily_em"
        cached = cache_service.get(key, 1800)
        if cached: return cached
        
        try:
            # Interface: fund_open_fund_daily_em
            # Returns: 基金代码, 基金简称, 单位净值, 前交易日-单位净值, 日增长率, 手续费
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

    # --- 7. Single Fund History (LV2 - Single) (1h Cache) ---
    @staticmethod
    def fetch_fund_history_latest_cached(code: str):
        """
        LV2 Strategy: Get latest 2 days history for specific fund.
        Used when LV1 batch interface returns 0.
        """
        key = f"fund_history_latest_{code}"
        cached = cache_service.get(key, 3600)
        if cached: return cached

        try:
            # Interface: fund_open_fund_info_em
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not df.empty and len(df) >= 2:
                # Sort descending by date just in case
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

    # --- 8. Batch Estimates (5min Cache, LV3) ---
    @staticmethod
    def fetch_lv2_estimate_cached():
        key = "fund_estimate_lv2"
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

    # --- 9. Stock Real-time (30min Cache, for LV4) ---
    @staticmethod
    def fetch_stock_map_cached():
        key = "full_market_spot_map"
        cached = cache_service.get(key, 1800)
        if cached: return cached
        
        res = {}
        try:
            df = ak.stock_zh_a_spot_em()
            for r in df.to_dict('records'):
                res[str(r['代码'])] = {"chg": SafeUtils.clean_num(r['涨跌幅'])}
        except: pass
        try:
            df = ak.stock_hk_spot_em()
            for r in df.to_dict('records'):
                res[str(r['代码'])] = {"chg": SafeUtils.clean_num(r['涨跌幅'])}
        except: pass
        
        cache_service.set(key, res)
        return res

    # --- 10. Market Indices (Real-time/Short Cache) ---
    @staticmethod
    def fetch_market_indices_cached():
        key = "market_indices_main"
        cached = cache_service.get(key, 60) # 1 min cache
        if cached: return cached
        
        res = []
        targets = ["上证指数", "深证成指", "创业板指"]
        
        for name in targets:
            try:
                # Use general index spot interface
                df = ak.stock_zh_index_spot_em(symbol=name)
                if not df.empty:
                    rec = df.iloc[0]
                    res.append({
                        "name": name,
                        "code": str(rec.get('代码')),
                        "value": SafeUtils.clean_num(rec.get('最新价')),
                        "changePercent": SafeUtils.clean_num(rec.get('涨跌幅'))
                    })
            except: pass
            
        cache_service.set(key, res)
        return res

    # --- 11. LV1 JS API (Real-time Estimate) ---
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
            # Interface: fund_open_fund_info_em
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
        t_market = run_in_threadpool(AkshareService.fetch_stock_map_cached)
        
        info_dict, holdings, industry, market_map = await asyncio.gather(t_info, t_holdings, t_industry, t_market)
        
        base_info = info_dict.get(code, {})
        
        for h in holdings:
            spot = market_map.get(h['code'])
            h['changePercent'] = spot['chg'] if spot else 0

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
        
        # Pre-fetch Batch Data
        t_lv2_est = run_in_threadpool(AkshareService.fetch_lv2_estimate_cached)
        t_official_batch = run_in_threadpool(AkshareService.fetch_official_daily_cached)
        t_market = run_in_threadpool(AkshareService.fetch_stock_map_cached)
        
        lv2_est_map, official_map, market_map = await asyncio.gather(t_lv2_est, t_official_batch, t_market)
        if official_map is None: official_map = {}
        if market_map is None: market_map = {}

        async def process_one(code):
            res = {
                "fundcode": code, "name": "", 
                "gsz": "0", "gszzl": "0", "dwjz": "0", "prev_dwjz": "0",
                "gztime": "--", "source": "none"
            }
            
            # Helper to fill estimate data (used for MARKET phase OR Post-Market Fallback)
            async def fill_estimate_data(r):
                # Strategy: LV1 JS -> LV2 Batch -> LV3 Holdings
                
                # 1. JS API
                js_data = await run_in_threadpool(AkshareService.fetch_lv1_js, code)
                if js_data and SafeUtils.clean_num(js_data.get('gsz')) > 0:
                    r.update(js_data)
                    r['source'] = "official_data_1"
                    return r
                
                # 2. Batch Estimate
                if code in lv2_est_map:
                    l2 = lv2_est_map[code]
                    if SafeUtils.clean_num(l2.get('gsz')) > 0:
                        r.update(l2)
                        r['source'] = "official_data_2"
                        return r
                
                # 3. Holdings Calc
                holdings = await run_in_threadpool(AkshareService.fetch_holdings_cached, code)
                if holdings:
                    total_w = 0.0
                    total_chg = 0.0
                    for h in holdings:
                        stock_c = h['code']
                        w = h['percent']
                        spot = market_map.get(stock_c)
                        if spot:
                            total_chg += spot['chg'] * w
                            total_w += w
                    
                    if total_w > 0:
                        est_chg = (total_chg / total_w) * 0.95
                        r['gszzl'] = f"{est_chg:.2f}"
                        r['source'] = "holdings_calc"
                        r['gztime'] = datetime.now().strftime('%H:%M')
                return r

            # === POST MARKET STRATEGY (15:00 - 09:00) ===
            if phase == 'POST_MARKET':
                # LV1: Official Daily Batch
                if code in official_map:
                    off = official_map[code]
                    # Only accept if NAV is valid (> 0)
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
                
                # LV2: Single History Fetch (Fallback if LV1 is missing/zero)
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

                # Fallback: Official data not out yet, use Estimate logic but mark source
                return await fill_estimate_data(res)

            # === MARKET STRATEGY (09:00 - 15:00) ===
            return await fill_estimate_data(res)

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
