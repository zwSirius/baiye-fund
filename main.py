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
import numpy as np
from datetime import datetime, timedelta, time
from typing import List, Dict, Any

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SmartFund API", description="基于 Akshare 的基金数据接口")

# --- CORS 设置 ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 缓存系统 ---
class DataCache:
    def __init__(self):
        # 基金列表缓存
        self.funds_list = pd.DataFrame()
        self.funds_list_time = None
        
        # 基金持仓缓存 { "005827": { "data": [...], "time": datetime } }
        self.holdings = {}

    async def get_funds(self):
        # 列表缓存 24 小时
        if self.funds_list.empty or not self.funds_list_time or (datetime.now() - self.funds_list_time).total_seconds() > 86400:
            logger.info("正在更新全量基金列表...")
            try:
                # Akshare 是同步 IO，放入线程池运行
                df = await run_in_threadpool(ak.fund_name_em)
                self.funds_list = df
                self.funds_list_time = datetime.now()
            except Exception as e:
                logger.error(f"更新基金列表失败: {e}")
                if self.funds_list.empty: return pd.DataFrame()
        return self.funds_list

    async def get_holdings(self, code):
        # 持仓缓存 24 小时
        cache_entry = self.holdings.get(code)
        if cache_entry and (datetime.now() - cache_entry['time']).total_seconds() < 86400:
            return cache_entry['data']
        return None

    def set_holdings(self, code, data):
        self.holdings[code] = {
            "data": data,
            "time": datetime.now()
        }

data_cache = DataCache()

# --- 内部逻辑 ---

def _get_current_china_time():
    """获取当前中国时间"""
    return datetime.utcnow() + timedelta(hours=8)

def _get_time_phase():
    """
    获取当前时间阶段
    Returns: 'PRE_MARKET' | 'MARKET' | 'POST_MARKET' | 'WEEKEND'
    """
    now = _get_current_china_time()
    
    # 周末 (周六=5, 周日=6)
    if now.weekday() >= 5:
        return 'WEEKEND'
    
    t = now.time()
    # 00:00 - 09:30 盘前
    if t < time(9, 30):
        return 'PRE_MARKET'
    # 09:30 - 15:00 盘中
    elif t <= time(15, 0):
        return 'MARKET'
    # 15:00 - 24:00 盘后
    else:
        return 'POST_MARKET'

def _get_fund_history_akshare_sync(code: str):
    """(同步) 使用 akshare 获取历史净值"""
    try:
        # 单位净值走势
        df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
        if not df.empty:
            if '净值日期' in df.columns:
                df['净值日期'] = df['净值日期'].astype(str)
            if '单位净值' in df.columns:
                df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce')
            return df
    except Exception as e:
        logger.error(f"Akshare history fetch error for {code}: {e}")
    return pd.DataFrame()

async def _get_fund_history_akshare(code: str):
    """(异步) 使用 akshare 获取历史净值"""
    return await run_in_threadpool(_get_fund_history_akshare_sync, code)

def _get_fund_holdings_internal_sync(code: str):
    """(同步) 获取持仓逻辑"""
    try:
        current_year = datetime.now().year
        years_to_try = [current_year, current_year - 1, current_year - 2]
        portfolio_df = pd.DataFrame()
        
        for year in years_to_try:
            try:
                df = ak.fund_portfolio_hold_em(symbol=code, date=year)
                if not df.empty:
                    portfolio_df = df
                    break 
            except:
                continue

        holdings = []
        if not portfolio_df.empty and '季度' in portfolio_df.columns:
            quarters = portfolio_df['季度'].unique()
            if len(quarters) > 0:
                latest_df = portfolio_df[portfolio_df['季度'] == quarters[0]]
                latest_df['占净值比例'] = pd.to_numeric(latest_df['占净值比例'], errors='coerce').fillna(0)
                latest_df = latest_df.sort_values(by='占净值比例', ascending=False).head(10)
                
                for _, row in latest_df.iterrows():
                    holdings.append({
                        "code": str(row['股票代码']),
                        "name": str(row['股票名称']),
                        "percent": float(row['占净值比例'])
                    })
        return holdings
    except Exception as e:
        logger.warning(f"Holdings fetch failed for {code}: {e}")
        return []

async def _get_fund_holdings_with_cache(code: str):
    """获取持仓 (带缓存的异步封装)"""
    cached = await data_cache.get_holdings(code)
    if cached is not None:
        return cached
    
    # 无缓存，执行同步抓取
    data = await run_in_threadpool(_get_fund_holdings_internal_sync, code)
    data_cache.set_holdings(code, data)
    return data

def _get_stock_realtime_quotes(stock_codes: list):
    """批量获取股票实时行情 (同步, IO bound but fast)"""
    if not stock_codes: return {}
    
    # 去重
    unique_codes = list(set(stock_codes))
    
    # 分批处理，防止 URL 过长 (每批 30 个)
    batch_size = 30
    quotes = {}
    
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "http://quote.eastmoney.com/"
    }

    for i in range(0, len(unique_codes), batch_size):
        batch = unique_codes[i:i + batch_size]
        secids = []
        for code in batch:
            if code.startswith('6'): 
                secids.append(f"1.{code}")
            elif code.startswith('8') or code.startswith('4'): 
                secids.append(f"0.{code}")
            else:
                secids.append(f"0.{code}")
        
        url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12&secids={','.join(secids)}"
        
        try:
            resp = requests.get(url, headers=headers, timeout=5)
            data = resp.json()
            if data and 'data' in data and 'diff' in data['data']:
                for item in data['data']['diff']:
                    stock_code = item.get('f12')
                    change_pct = item.get('f3')
                    try:
                        val = float(change_pct)
                    except (ValueError, TypeError):
                        val = 0.0
                    if stock_code: quotes[stock_code] = val
        except Exception as e:
            logger.error(f"Quote fetch error: {e}")
            pass
            
    return quotes

def _get_current_china_date_str():
    return _get_current_china_time().strftime('%Y-%m-%d')

# --- 核心处理逻辑封装 (复用) ---
async def _process_single_fund_estimate(code: str):
    """处理单个基金估值 (内部使用)"""
    # 默认空结构
    data = {
        "fundcode": code, 
        "gsz": "0", "gszzl": "0", 
        "dwjz": "0", "jzrq": "", 
        "name": "", 
        "source": "official"
    }
    
    phase = _get_time_phase()
    today_str = _get_current_china_date_str()
    
    # 1. 尝试获取官方实时数据
    try:
        timestamp = int(datetime.now().timestamp() * 1000)
        url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={timestamp}"
        headers = {"User-Agent": "Mozilla/5.0", "Referer": "http://fund.eastmoney.com/"}
        # 使用 requests (同步) 因为通常很快，或者可以用 httpx 优化，这里暂保持 requests 但在 async 路由中无妨
        response = requests.get(url, headers=headers, timeout=2)
        match = re.search(r'jsonpgz\((.*?)\);', response.text)
        if match:
            fetched = json.loads(match.group(1))
            if fetched: 
                data.update(fetched)
    except: pass
    
    # 2. 获取 Akshare 历史数据
    history_df = await _get_fund_history_akshare(code)
    
    last_confirmed_nav = 1.0
    if not history_df.empty:
        latest = history_df.iloc[-1]
        last_confirmed_nav = float(latest['单位净值'])
        data['dwjz'] = str(latest['单位净值'])
        data['jzrq'] = str(latest['净值日期'])
    elif float(data.get('dwjz', 0)) > 0:
        last_confirmed_nav = float(data['dwjz'])

    # 3. 确定“实时估值” (gsz)
    
    # 盘前/周末 -> 强制显示静态历史
    if phase == 'PRE_MARKET' or phase == 'WEEKEND':
        data['gsz'] = data['dwjz']
        if len(history_df) >= 2:
            prev = history_df.iloc[-2]
            prev_nav = float(prev['单位净值'])
            if prev_nav > 0:
                change = ((last_confirmed_nav - prev_nav) / prev_nav) * 100
                data['gszzl'] = "{:.2f}".format(change)
        else:
            data['gszzl'] = "0.00"
        data['source'] = 'real_history'
        return data

    # 准备计算持仓所需的函数
    async def get_calc_result():
        holdings = await _get_fund_holdings_with_cache(code)
        if not holdings: return None
        
        stock_codes = [h['code'] for h in holdings]
        # 注意：这里是单个基金请求，效率较低。Batch 接口会优化这里
        quotes = await run_in_threadpool(_get_stock_realtime_quotes, stock_codes)
        
        total_weighted_change = 0
        total_weight = 0
        for h in holdings:
            change = quotes.get(h['code'], 0)
            total_weighted_change += (change * h['percent'])
            total_weight += h['percent']
        
        if total_weight == 0: return None
        estimated_change = total_weighted_change / 100.0
        estimated_nav = last_confirmed_nav * (1 + estimated_change / 100.0)
        return {
            "gsz": "{:.4f}".format(estimated_nav),
            "gszzl": "{:.2f}".format(estimated_change)
        }

    # 盘中
    if phase == 'MARKET':
        official_gsz = float(data.get("gsz", 0))
        # 如果官方数据有效且有变动，直接返回
        if official_gsz > 0 and official_gsz != last_confirmed_nav:
             return data
        else:
             calc = await get_calc_result()
             if calc:
                 data['gsz'] = calc['gsz']
                 data['gszzl'] = calc['gszzl']
                 data['source'] = "holdings_calc"
             else:
                 data['gsz'] = str(last_confirmed_nav)
                 data['gszzl'] = "0.00"
             return data

    # 盘后
    if phase == 'POST_MARKET':
        official_updated = False
        if data.get('jzrq') == today_str:
            official_updated = True
        
        if official_updated:
            current_nav = float(data.get('dwjz', 0))
            prev_nav = 0
            if not history_df.empty:
                # 检查 Akshare 是否已更新到今日
                if str(history_df.iloc[-1]['净值日期']) == today_str:
                     if len(history_df) >= 2:
                         prev_nav = float(history_df.iloc[-2]['单位净值'])
                else:
                     prev_nav = float(history_df.iloc[-1]['单位净值'])
            
            if prev_nav > 0 and current_nav > 0:
                change = ((current_nav - prev_nav) / prev_nav) * 100
                data['gsz'] = str(current_nav)
                data['gszzl'] = "{:.2f}".format(change)
                data['source'] = "real_updated"
        else:
            calc = await get_calc_result()
            if calc:
                data['gsz'] = calc['gsz']
                data['gszzl'] = calc['gszzl']
                data['source'] = "holdings_close_est"
            else:
                data['gsz'] = str(last_confirmed_nav)
                data['gszzl'] = "0.00"
        return data
    
    return data

# --- API ---

@app.get("/")
def home():
    return {"status": "SmartFund API Running (Async Optimized)"}

@app.get("/api/search")
async def search_funds_api(key: str = Query(..., min_length=1)):
    try:
        df = await data_cache.get_funds()
        if df.empty: return []
        key = key.upper()
        # 简单过滤，若数据量大可优化
        mask = (df['基金代码'].str.contains(key, na=False) | 
                df['基金简称'].str.contains(key, na=False) | 
                df['拼音缩写'].str.contains(key, na=False))
        result = df[mask].head(20)
        response_list = []
        for _, row in result.iterrows():
            response_list.append({"code": str(row['基金代码']),"name": str(row['基金简称']),"type": str(row['基金类型'])})
        return response_list
    except: return []

@app.get("/api/market")
async def get_market_indices(codes: str = Query(None)):
    default_codes = ["1.000001", "0.399001", "0.399006", "0.399997", "0.399976"]
    target_codes = codes.split(',') if codes else default_codes
    if not target_codes: return []

    secids = ",".join(target_codes)
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12,f14,f2&secids={secids}"
    
    headers = {"User-Agent": "Mozilla/5.0"}

    result = []
    try:
        # 市场指数请求较快，同步请求尚可，或后续优化为 async
        resp = requests.get(url, headers=headers, timeout=5)
        data = resp.json()
        if data and 'data' in data and 'diff' in data['data']:
            for item in data['data']['diff']:
                try:
                    change = float(item['f3'])
                except (ValueError, TypeError):
                    change = 0.0
                score = 50 + change * 10 
                score = max(0, min(100, score))
                result.append({
                    "name": item['f14'],
                    "code": item['f12'], 
                    "changePercent": change,
                    "score": int(score),
                    "leadingStock": "--", 
                    "value": item['f2']
                })
    except Exception as e:
        logger.error(f"Market index fetch error: {e}")
        pass
    return result

@app.get("/api/estimate/{code}")
async def get_estimate_api(code: str):
    """
    单个查询接口 (兼容旧版)
    """
    return await _process_single_fund_estimate(code)

@app.post("/api/estimate/batch")
async def get_batch_estimate(codes: List[str] = Body(..., embed=True)):
    """
    批量估值接口：大幅优化性能
    """
    if not codes: return []
    
    # 1. 初始并行：获取所有 Official Info 和 Akshare History
    # 为简化逻辑，我们先用简单循环调用内部逻辑的第一部分，
    # 但为了性能，我们需要重构 _process_single_fund_estimate 里的逻辑以便批量处理。
    # 鉴于代码复杂度，这里采用 "先聚合后计算" 的策略。
    
    results = {} # code -> result dict
    phase = _get_time_phase()
    
    # 获取基础信息 (串行循环网络请求，但比前端发 N 个要快，因为内网回环/长连接复用)
    # 理想情况是用 aiohttp 并发，这里简化保持 requests
    for code in codes:
        # 默认结构
        results[code] = {
            "fundcode": code, "gsz": "0", "gszzl": "0", 
            "dwjz": "0", "jzrq": "", "name": "", "source": "official"
        }
        # 尝试官方数据
        try:
            timestamp = int(datetime.now().timestamp() * 1000)
            url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={timestamp}"
            resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=1)
            match = re.search(r'jsonpgz\((.*?)\);', resp.text)
            if match:
                results[code].update(json.loads(match.group(1)))
        except: pass

    # 2. 批量处理 Akshare 历史 (这些是慢 IO)
    # 我们可以并发执行这些任务
    for code in codes:
        history_df = await _get_fund_history_akshare(code)
        last_confirmed_nav = 1.0
        if not history_df.empty:
            latest = history_df.iloc[-1]
            last_confirmed_nav = float(latest['单位净值'])
            results[code]['dwjz'] = str(latest['单位净值'])
            results[code]['jzrq'] = str(latest['净值日期'])
        elif float(results[code].get('dwjz', 0)) > 0:
            last_confirmed_nav = float(results[code]['dwjz'])
            
        results[code]['_last_nav'] = last_confirmed_nav # 临时存储用于后续计算
        results[code]['_history_df'] = history_df

    # 3. 筛选需要“重仓股计算”的基金
    calc_needed_codes = []
    
    for code in codes:
        data = results[code]
        hist_df = data['_history_df']
        last_nav = data['_last_nav']
        
        # 逻辑A: 盘前/周末 -> 静态
        if phase == 'PRE_MARKET' or phase == 'WEEKEND':
            data['gsz'] = data['dwjz']
            if len(hist_df) >= 2:
                prev = hist_df.iloc[-2]
                prev_nav = float(prev['单位净值'])
                if prev_nav > 0:
                    change = ((last_nav - prev_nav) / prev_nav) * 100
                    data['gszzl'] = "{:.2f}".format(change)
            else:
                data['gszzl'] = "0.00"
            data['source'] = 'real_history'
            continue # Done for this fund

        # 逻辑B/C: 盘中或盘后，检查是否需要计算
        official_gsz = float(data.get("gsz", 0))
        official_valid = (official_gsz > 0 and official_gsz != last_nav)
        
        # 盘后特殊检查
        if phase == 'POST_MARKET':
             today_str = _get_current_china_date_str()
             official_updated = (data.get('jzrq') == today_str)
             if official_updated:
                 # 已更新真实净值，计算变化
                 curr = float(data.get('dwjz', 0))
                 prev = 0
                 if not hist_df.empty:
                    if str(hist_df.iloc[-1]['净值日期']) == today_str:
                         if len(hist_df) >= 2: prev = float(hist_df.iloc[-2]['单位净值'])
                    else:
                         prev = float(hist_df.iloc[-1]['单位净值'])
                 if prev > 0:
                     change = ((curr - prev) / prev) * 100
                     data['gsz'] = str(curr)
                     data['gszzl'] = "{:.2f}".format(change)
                     data['source'] = "real_updated"
                     continue
        
        if not official_valid:
            calc_needed_codes.append(code)

    # 4. 批量计算 (核心优化：合并股票行情请求)
    if calc_needed_codes:
        # 收集所有需要的持仓
        all_stock_codes = []
        fund_holdings_map = {} # code -> holdings list
        
        for code in calc_needed_codes:
            holdings = await _get_fund_holdings_with_cache(code)
            fund_holdings_map[code] = holdings
            if holdings:
                for h in holdings:
                    all_stock_codes.append(h['code'])
        
        # 批量获取行情 (一次请求搞定所有！)
        quotes = await run_in_threadpool(_get_stock_realtime_quotes, all_stock_codes)
        
        # 分发计算结果
        for code in calc_needed_codes:
            data = results[code]
            holdings = fund_holdings_map.get(code, [])
            last_nav = data['_last_nav']
            
            if not holdings:
                data['gsz'] = str(last_nav)
                data['gszzl'] = "0.00"
                continue
                
            total_weighted_change = 0
            total_weight = 0
            for h in holdings:
                change = quotes.get(h['code'], 0)
                total_weighted_change += (change * h['percent'])
                total_weight += h['percent']
            
            if total_weight > 0:
                est_change = total_weighted_change / 100.0
                est_nav = last_nav * (1 + est_change / 100.0)
                data['gsz'] = "{:.4f}".format(est_nav)
                data['gszzl'] = "{:.2f}".format(est_change)
                data['source'] = "holdings_calc_batch"
            else:
                data['gsz'] = str(last_nav)
                data['gszzl'] = "0.00"

    # 清理临时字段并返回列表
    final_list = []
    for code in codes:
        res = results[code]
        res.pop('_last_nav', None)
        res.pop('_history_df', None)
        final_list.append(res)
        
    return final_list

@app.get("/api/fund/{code}")
async def get_fund_detail(code: str):
    try:
        manager_name = "暂无"
        try:
            # 放入线程池
            manager_df = await run_in_threadpool(ak.fund_manager_em, symbol=code)
            if not manager_df.empty: manager_name = manager_df.iloc[-1]['姓名']
        except: pass

        holdings_list = await _get_fund_holdings_with_cache(code)
        
        if holdings_list:
            # 详情页也可优化为批量获取行情，这里暂保持逻辑
            quotes = await run_in_threadpool(_get_stock_realtime_quotes, [h['code'] for h in holdings_list])
            for h in holdings_list:
                h['changePercent'] = quotes.get(h['code'], 0)
        
        return {"code": code, "manager": manager_name, "holdings": holdings_list}
    except:
        return {"code": code, "manager": "数据获取失败", "holdings": []}

@app.get("/api/history/{code}")
async def get_history(code: str):
    try:
        df = await _get_fund_history_akshare(code)
        if df.empty: return []
        
        recent_df = df.tail(365)
        
        result = []
        for _, row in recent_df.iterrows():
            try:
                val = float(row['单位净值'])
                date_str = str(row['净值日期'])
                result.append({
                    "date": date_str,
                    "value": val
                })
            except: continue
            
        return result
    except: return []

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
