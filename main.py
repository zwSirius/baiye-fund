import uvicorn
from fastapi import FastAPI, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
import akshare as ak
import pandas as pd
import requests
import re
import json
import logging
import asyncio
from datetime import datetime, timedelta, time
from typing import List, Dict, Any

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SmartFund API", description="High Performance Fund Data API")

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CACHE ---
class DataCache:
    def __init__(self):
        self.funds_list = pd.DataFrame()
        self.funds_list_time = None
        self.holdings = {}

    async def get_funds(self):
        if self.funds_list.empty or not self.funds_list_time or (datetime.now() - self.funds_list_time).total_seconds() > 86400:
            logger.info("Updating fund list...")
            try:
                df = await run_in_threadpool(ak.fund_name_em)
                self.funds_list = df
                self.funds_list_time = datetime.now()
            except Exception as e:
                logger.error(f"Fund list update failed: {e}")
                if self.funds_list.empty: return pd.DataFrame()
        return self.funds_list

    async def get_holdings(self, code):
        cache_entry = self.holdings.get(code)
        if cache_entry and (datetime.now() - cache_entry['time']).total_seconds() < 86400:
            return cache_entry['data']
        return None

    def set_holdings(self, code, data):
        self.holdings[code] = { "data": data, "time": datetime.now() }

data_cache = DataCache()

# --- UTILS ---

def _get_current_china_time():
    return datetime.utcnow() + timedelta(hours=8)

def _get_time_phase():
    now = _get_current_china_time()
    if now.weekday() >= 5: return 'WEEKEND'
    t = now.time()
    if t < time(9, 30): return 'PRE_MARKET'
    elif t <= time(15, 0): return 'MARKET'
    else: return 'POST_MARKET'

def _get_current_china_date_str():
    return _get_current_china_time().strftime('%Y-%m-%d')

# --- DATA FETCHING (Blocking Wrappers) ---

def _fetch_akshare_history_sync(code: str):
    try:
        df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
        if not df.empty:
            if '净值日期' in df.columns: df['净值日期'] = df['净值日期'].astype(str)
            if '单位净值' in df.columns: df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce')
            return df
    except Exception: pass
    return pd.DataFrame()

def _fetch_official_estimate_sync(code: str):
    """Fetch real-time estimate from Eastmoney JS interface"""
    data = { "gsz": "0", "gszzl": "0", "dwjz": "0", "jzrq": "", "name": "", "source": "official" }
    try:
        timestamp = int(datetime.now().timestamp() * 1000)
        url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={timestamp}"
        resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=1.5)
        match = re.search(r'jsonpgz\((.*?)\);', resp.text)
        if match:
            fetched = json.loads(match.group(1))
            if fetched: data.update(fetched)
    except: pass
    return data

def _parse_quarter_str(q_str):
    """Helper to parse '2023年4季度' into comparable int 20234"""
    try:
        # Expected format: YYYY年N季度
        if '年' in q_str and '季度' in q_str:
            parts = q_str.split('年')
            year = int(parts[0])
            quarter = int(parts[1].replace('季度', ''))
            return year * 10 + quarter
    except:
        pass
    return 0

def _fetch_holdings_sync(code: str):
    """
    Robust fetching of latest holdings.
    Iterates recent years, merges data, sorts by Quarter to find the absolute latest.
    """
    try:
        current_year = datetime.now().year
        all_dfs = []
        
        # Try fetching this year and last year to ensure we get the latest report
        for year in [current_year, current_year - 1]:
            try:
                df = ak.fund_portfolio_hold_em(symbol=code, date=year)
                if not df.empty and '季度' in df.columns:
                    all_dfs.append(df)
            except: 
                continue
        
        if not all_dfs:
            return []

        # Combine all found dataframes
        combined_df = pd.concat(all_dfs)
        
        if combined_df.empty:
            return []

        # Get unique quarters and sort them properly
        unique_quarters = combined_df['季度'].unique()
        # Sort quarters descending based on parsed value (e.g. 20241 > 20234)
        sorted_quarters = sorted(unique_quarters, key=_parse_quarter_str, reverse=True)
        
        if not sorted_quarters:
            return []
            
        latest_q = sorted_quarters[0] # The most recent quarter string
        
        # Filter for the latest quarter
        latest_df = combined_df[combined_df['季度'] == latest_q].copy()
        
        # Process holdings
        latest_df['占净值比例'] = pd.to_numeric(latest_df['占净值比例'], errors='coerce').fillna(0)
        # Sort by percentage to get top holdings
        latest_df = latest_df.sort_values(by='占净值比例', ascending=False).head(10)
        
        holdings = []
        for _, row in latest_df.iterrows():
            holdings.append({
                "code": str(row['股票代码']),
                "name": str(row['股票名称']),
                "percent": float(row['占净值比例'])
            })
            
        return holdings
    except Exception as e:
        logger.error(f"Error fetching holdings for {code}: {e}")
        return []

def _fetch_stock_quotes_sync(stock_codes: list):
    """Batch fetch stock quotes (IO Bound but fast)"""
    if not stock_codes: return {}
    unique_codes = list(set(stock_codes))
    batch_size = 40
    quotes = {}
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "http://quote.eastmoney.com/"}

    for i in range(0, len(unique_codes), batch_size):
        batch = unique_codes[i:i + batch_size]
        secids = []
        for code in batch:
            pfx = "1." if code.startswith('6') else "0."
            secids.append(f"{pfx}{code}")
        
        url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12&secids={','.join(secids)}"
        try:
            resp = requests.get(url, headers=headers, timeout=3)
            data = resp.json()
            if data and 'data' in data and 'diff' in data['data']:
                for item in data['data']['diff']:
                    c = item.get('f12')
                    v = item.get('f3')
                    if c: quotes[c] = float(v) if v is not None else 0.0
        except: pass
    return quotes

# --- ASYNC HELPERS ---

async def _fetch_fund_base_data_concurrently(code: str):
    """
    Parallely fetch:
    1. Official real-time data (HTTP)
    2. Akshare history (HTTP/Processing)
    """
    loop = asyncio.get_running_loop()
    
    # Run these in parallel threads
    official_task = loop.run_in_executor(None, _fetch_official_estimate_sync, code)
    history_task = loop.run_in_executor(None, _fetch_akshare_history_sync, code)
    
    official_data, history_df = await asyncio.gather(official_task, history_task)
    
    return code, official_data, history_df

# --- API ENDPOINTS ---

@app.get("/api/search")
async def search_funds_api(key: str = Query(..., min_length=1)):
    try:
        df = await data_cache.get_funds()
        if df.empty: return []
        key = key.upper()
        mask = (df['基金代码'].str.contains(key, na=False) | 
                df['基金简称'].str.contains(key, na=False) | 
                df['拼音缩写'].str.contains(key, na=False))
        result = df[mask].head(20)
        return [{"code": str(r['基金代码']),"name": str(r['基金简称']),"type": str(r['基金类型'])} for _, r in result.iterrows()]
    except: return []

@app.get("/api/market")
async def get_market_indices(codes: str = Query(None)):
    target_codes = codes.split(',') if codes else ["1.000001", "0.399001", "0.399006"]
    secids = ",".join(target_codes)
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12,f14,f2&secids={secids}"
    try:
        resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=3)
        data = resp.json()
        result = []
        if data and 'data' in data and 'diff' in data['data']:
            for item in data['data']['diff']:
                change = float(item['f3']) if item['f3'] else 0.0
                score = max(0, min(100, 50 + change * 10))
                result.append({
                    "name": item['f14'], "code": item['f12'], 
                    "changePercent": change, "score": int(score), 
                    "leadingStock": "--", "value": item['f2']
                })
        return result
    except: return []

@app.get("/api/estimate/{code}")
async def get_estimate_api(code: str):
    # Single item wrapper for batch logic
    res = await get_batch_estimate(codes=[code])
    return res[0] if res else {}

@app.post("/api/estimate/batch")
async def get_batch_estimate(codes: List[str] = Body(..., embed=True)):
    if not codes: return []
    
    # 1. Concurrent Fetching of Base Data
    # This is the biggest performance boost: Fetching 20 funds takes same time as 1
    tasks = [_fetch_fund_base_data_concurrently(code) for code in codes]
    base_results = await asyncio.gather(*tasks)
    
    # 2. Process Initial Data
    results_map = {}
    calc_needed_codes = []
    phase = _get_time_phase()
    today_str = _get_current_china_date_str()
    
    for code, official_data, history_df in base_results:
        res = { "fundcode": code, **official_data }
        
        # Merge History NAV
        last_nav = 1.0
        if not history_df.empty:
            latest = history_df.iloc[-1]
            last_nav = float(latest['单位净值'])
            res['dwjz'] = str(latest['单位净值'])
            res['jzrq'] = str(latest['净值日期'])
        elif float(res.get('dwjz', 0)) > 0:
            last_nav = float(res['dwjz'])
            
        res['_last_nav'] = last_nav
        
        # Decide if we need calculation
        need_calc = False
        
        if phase == 'PRE_MARKET' or phase == 'WEEKEND':
            res['gsz'] = res['dwjz']
            if len(history_df) >= 2:
                prev = float(history_df.iloc[-2]['单位净值'])
                if prev > 0:
                    res['gszzl'] = "{:.2f}".format(((last_nav - prev)/prev)*100)
            else:
                res['gszzl'] = "0.00"
            res['source'] = 'real_history'
        
        elif phase == 'POST_MARKET':
             official_updated = (res.get('jzrq') == today_str)
             if official_updated:
                 # Official data is updated for today
                 curr = float(res.get('dwjz', 0))
                 prev = 0
                 if not history_df.empty:
                    if str(history_df.iloc[-1]['净值日期']) == today_str:
                         if len(history_df) >= 2: prev = float(history_df.iloc[-2]['单位净值'])
                    else:
                         prev = float(history_df.iloc[-1]['单位净值'])
                 if prev > 0:
                     res['gsz'] = str(curr)
                     res['gszzl'] = "{:.2f}".format(((curr - prev)/prev)*100)
                     res['source'] = "real_updated"
             else:
                 need_calc = True
        
        else: # MARKET
            off_gsz = float(res.get("gsz", 0))
            if off_gsz > 0 and off_gsz != last_nav:
                pass # Official data is alive
            else:
                need_calc = True
        
        if need_calc:
            calc_needed_codes.append(code)
        
        results_map[code] = res

    # 3. Batch Calculation for needed funds
    if calc_needed_codes:
        # Fetch holdings (Cache -> Sync Fetch in Thread)
        fund_holdings_map = {}
        all_stocks = []
        
        for code in calc_needed_codes:
            holdings = await data_cache.get_holdings(code)
            if not holdings:
                holdings = await run_in_threadpool(_fetch_holdings_sync, code)
                data_cache.set_holdings(code, holdings)
            
            fund_holdings_map[code] = holdings
            for h in holdings: all_stocks.append(h['code'])
            
        # Fetch Quotes (Once)
        quotes = await run_in_threadpool(_fetch_stock_quotes_sync, all_stocks)
        
        # Compute
        for code in calc_needed_codes:
            data = results_map[code]
            holdings = fund_holdings_map.get(code, [])
            last_nav = data['_last_nav']
            
            if not holdings:
                data['gsz'] = str(last_nav)
                data['gszzl'] = "0.00"
                continue
                
            w_change = 0
            total_w = 0
            for h in holdings:
                w_change += (quotes.get(h['code'], 0) * h['percent'])
                total_w += h['percent']
            
            if total_w > 0:
                est_change = w_change / 100.0
                est_nav = last_nav * (1 + est_change / 100.0)
                data['gsz'] = "{:.4f}".format(est_nav)
                data['gszzl'] = "{:.2f}".format(est_change)
                data['source'] = "holdings_calc_batch"
            else:
                data['gsz'] = str(last_nav)
                data['gszzl'] = "0.00"

    # Cleanup
    final = []
    for code in codes:
        r = results_map[code]
        r.pop('_last_nav', None)
        final.append(r)
    return final

@app.get("/api/fund/{code}")
async def get_fund_detail(code: str):
    try:
        manager_name = "暂无"
        try:
             # Fast sync call wrapped in thread
             m_df = await run_in_threadpool(ak.fund_manager_em, symbol=code)
             if not m_df.empty: manager_name = m_df.iloc[-1]['姓名']
        except: pass

        # Reuse holding fetch logic
        holdings = await data_cache.get_holdings(code)
        if not holdings:
            holdings = await run_in_threadpool(_fetch_holdings_sync, code)
            data_cache.set_holdings(code, holdings)
        
        # Fill quotes for detail view
        if holdings:
            quotes = await run_in_threadpool(_fetch_stock_quotes_sync, [h['code'] for h in holdings])
            for h in holdings: h['changePercent'] = quotes.get(h['code'], 0)
        
        return {"code": code, "manager": manager_name, "holdings": holdings}
    except:
        return {"code": code, "manager": "数据获取失败", "holdings": []}

@app.get("/api/history/{code}")
async def get_history(code: str):
    df = await run_in_threadpool(_fetch_akshare_history_sync, code)
    if df.empty: return []
    res = []
    for _, row in df.tail(365).iterrows():
        try: res.append({ "date": str(row['净值日期']), "value": float(row['单位净值']) })
        except: continue
    return res

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
