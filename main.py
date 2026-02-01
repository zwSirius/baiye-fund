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
        self.funds_df = pd.DataFrame()
        self.funds_search_cache = [] # Optimized list of dicts for fast search
        self.funds_list_time = None
        self.holdings = {}

    async def get_funds_search_list(self):
        # 缓存有效期 24 小时
        if not self.funds_search_cache or not self.funds_list_time or (datetime.now() - self.funds_list_time).total_seconds() > 86400:
            logger.info("Updating fund list cache...")
            try:
                # Akshare 同步接口放入线程池
                df = await run_in_threadpool(ak.fund_name_em)
                self.funds_df = df
                
                # 预处理搜索列表
                temp_list = []
                for _, row in df.iterrows():
                    temp_list.append({
                        "code": str(row['基金代码']),
                        "name": str(row['基金简称']),
                        "type": str(row['基金类型']),
                        "pinyin": str(row['拼音缩写'])
                    })
                self.funds_search_cache = temp_list
                self.funds_list_time = datetime.now()
                logger.info(f"Fund list updated. Total: {len(temp_list)}")
            except Exception as e:
                logger.error(f"Fund list update failed: {e}")
                if not self.funds_search_cache: return []
        return self.funds_search_cache

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
    """
    Returns: 'PRE_MARKET' | 'MARKET' | 'LUNCH_BREAK' | 'POST_MARKET' | 'WEEKEND'
    """
    now = _get_current_china_time()
    
    if now.weekday() >= 5: return 'WEEKEND'
    
    t = now.time()
    if t < time(9, 30): 
        return 'PRE_MARKET'
    elif t >= time(11, 30) and t < time(13, 0):
        return 'LUNCH_BREAK'
    elif t <= time(15, 0): 
        return 'MARKET'
    else: 
        return 'POST_MARKET'

def _get_current_china_date_str():
    return _get_current_china_time().strftime('%Y-%m-%d')

# --- DATA FETCHING (Blocking Wrappers) ---

def _fetch_akshare_history_sync(code: str):
    try:
        # 只取最近一年的数据，减少网络传输和内存占用
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

def _parse_quarter_rank(q_str):
    """
    解析季度字符串，返回一个可排序的整数 rank。
    格式如：2024年4季度 -> 202404
    """
    if not isinstance(q_str, str): return 0
    try:
        # 匹配 20xx年x季度
        match = re.search(r'(\d{4})年.*?(\d)季度', q_str)
        if match:
            year = int(match.group(1))
            quarter = int(match.group(2))
            return year * 100 + quarter
        
        # 备用匹配：可能没有'第'或者其他格式
        # 简单匹配年份
        match_year = re.search(r'(\d{4})年', q_str)
        if match_year:
            year = int(match_year.group(1))
            # 如果是“年报”，当作第4季度
            if '年报' in q_str or '年度' in q_str:
                return year * 100 + 4
            # 如果是“中报”，当作第2季度
            if '中报' in q_str:
                return year * 100 + 2
            return year * 100 + 1 # 默认
    except:
        pass
    return 0

def _fetch_holdings_sync(code: str):
    try:
        current_year = datetime.now().year
        all_dfs = []
        # 获取今年和去年的数据
        for year in [current_year, current_year - 1]:
            try:
                df = ak.fund_portfolio_hold_em(symbol=code, date=year)
                if not df.empty and '季度' in df.columns:
                    all_dfs.append(df)
            except: continue
        
        if not all_dfs: return []

        combined_df = pd.concat(all_dfs)
        if combined_df.empty: return []

        # 计算排序 Rank
        # 这里的关键是：直接给 DataFrame 每一行加上 Rank，而不是先取 unique 季度再筛选
        # 这样能避免字符串匹配回填时的错位
        combined_df['rank'] = combined_df['季度'].apply(_parse_quarter_rank)
        combined_df['占净值比例'] = pd.to_numeric(combined_df['占净值比例'], errors='coerce').fillna(0)
        
        # 排序：先按季度 Rank 降序 (最新的在最前)，再按占比降序
        sorted_df = combined_df.sort_values(by=['rank', '占净值比例'], ascending=[False, False])
        
        if sorted_df.empty: return []

        # 获取最大的 rank (即最新的季度)
        latest_rank = sorted_df.iloc[0]['rank']
        
        # 只保留最新季度的数据
        latest_df = sorted_df[sorted_df['rank'] == latest_rank].head(10)
        
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
    """Batch fetch stock quotes"""
    if not stock_codes: return {}
    unique_codes = list(set(stock_codes))
    batch_size = 30 
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
            resp = requests.get(url, headers=headers, timeout=2.5)
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
    loop = asyncio.get_running_loop()
    official_task = loop.run_in_executor(None, _fetch_official_estimate_sync, code)
    history_task = loop.run_in_executor(None, _fetch_akshare_history_sync, code)
    official_data, history_df = await asyncio.gather(official_task, history_task)
    return code, official_data, history_df

# --- API ENDPOINTS ---

@app.get("/api/status")
def get_market_status():
    return {"phase": _get_time_phase(), "timestamp": datetime.now().timestamp()}

@app.get("/api/search")
async def search_funds_api(key: str = Query(..., min_length=1)):
    try:
        funds_list = await data_cache.get_funds_search_list()
        if not funds_list: return []
        
        key = key.upper()
        results = []
        count = 0
        for f in funds_list:
            if key in f['code'] or key in f['name'] or key in f['pinyin']:
                results.append(f)
                count += 1
                if count >= 20: break 
        return results
    except Exception as e: 
        logger.error(f"Search error: {e}")
        return []

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
    res = await get_batch_estimate(codes=[code])
    return res[0] if res else {}

@app.post("/api/estimate/batch")
async def get_batch_estimate(codes: List[str] = Body(..., embed=True)):
    if not codes: return []
    
    tasks = [_fetch_fund_base_data_concurrently(code) for code in codes]
    base_results = await asyncio.gather(*tasks)
    
    results_map = {}
    calc_needed_codes = []
    phase = _get_time_phase()
    today_str = _get_current_china_date_str()
    
    for code, official_data, history_df in base_results:
        res = { "fundcode": code, **official_data }
        
        last_nav = 1.0
        if not history_df.empty:
            latest = history_df.iloc[-1]
            last_nav = float(latest['单位净值'])
            res['dwjz'] = str(latest['单位净值'])
            res['jzrq'] = str(latest['净值日期'])
        elif float(res.get('dwjz', 0)) > 0:
            last_nav = float(res['dwjz'])
            
        res['_last_nav'] = last_nav
        
        need_calc = False
        
        if phase in ['PRE_MARKET', 'WEEKEND']:
            res['gsz'] = res['dwjz']
            if len(history_df) >= 2:
                prev = float(history_df.iloc[-2]['单位净值'])
                if prev > 0:
                    res['gszzl'] = "{:.4f}".format(((last_nav - prev)/prev)*100) # PRECISION FIX
            else:
                res['gszzl'] = "0.00"
            res['source'] = 'real_history'
        
        elif phase == 'POST_MARKET':
             official_updated = (res.get('jzrq') == today_str)
             if official_updated:
                 curr = float(res.get('dwjz', 0))
                 prev = 0
                 if not history_df.empty:
                    if str(history_df.iloc[-1]['净值日期']) == today_str:
                         if len(history_df) >= 2: prev = float(history_df.iloc[-2]['单位净值'])
                    else:
                         prev = float(history_df.iloc[-1]['单位净值'])
                 
                 if prev > 0:
                     res['gsz'] = str(curr)
                     res['gszzl'] = "{:.4f}".format(((curr - prev)/prev)*100) # PRECISION FIX
                     res['source'] = "real_updated"
             else:
                 need_calc = True
        
        else: # MARKET / LUNCH_BREAK
            off_gsz = float(res.get("gsz", 0))
            if off_gsz > 0 and off_gsz != last_nav:
                pass 
            else:
                need_calc = True
        
        if need_calc:
            calc_needed_codes.append(code)
        
        results_map[code] = res

    if calc_needed_codes:
        fund_holdings_map = {}
        all_stocks = []
        
        for code in calc_needed_codes:
            holdings = await data_cache.get_holdings(code)
            if not holdings:
                holdings = await run_in_threadpool(_fetch_holdings_sync, code)
                data_cache.set_holdings(code, holdings)
            
            fund_holdings_map[code] = holdings
            for h in holdings: all_stocks.append(h['code'])
            
        quotes = await run_in_threadpool(_fetch_stock_quotes_sync, all_stocks)
        
        for code in calc_needed_codes:
            data = results_map[code]
            holdings = fund_holdings_map.get(code, [])
            last_nav = data['_last_nav']
            
            if not holdings:
                data['gsz'] = str(last_nav)
                data['gszzl'] = "0.00"
                continue
            
            weighted_change_sum = 0
            total_weight_top10 = 0
            
            for h in holdings:
                stock_change = quotes.get(h['code'], 0)
                weight = h['percent']
                weighted_change_sum += (stock_change * weight)
                total_weight_top10 += weight
            
            est_change_pct = 0
            if total_weight_top10 > 0:
                normalized_change = weighted_change_sum / total_weight_top10
                if total_weight_top10 < 30:
                    est_change_pct = weighted_change_sum / 100.0
                else:
                    est_change_pct = normalized_change * 0.85
            
            est_nav = last_nav * (1 + est_change_pct / 100.0)
            data['gsz'] = "{:.4f}".format(est_nav)
            # PRECISION FIX: 4 Decimal Places
            data['gszzl'] = "{:.4f}".format(est_change_pct)
            data['source'] = "holdings_calc_batch"

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
             m_df = await run_in_threadpool(ak.fund_manager_em, symbol=code)
             if not m_df.empty: manager_name = m_df.iloc[-1]['姓名']
        except: pass

        holdings = await data_cache.get_holdings(code)
        if not holdings:
            holdings = await run_in_threadpool(_fetch_holdings_sync, code)
            data_cache.set_holdings(code, holdings)
        
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
