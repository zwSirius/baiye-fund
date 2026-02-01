import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import akshare as ak
import pandas as pd
import requests
import re
import json
import logging
import numpy as np
from datetime import datetime, timedelta, time

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

    def get_funds(self):
        # 列表缓存 24 小时
        if self.funds_list.empty or not self.funds_list_time or (datetime.now() - self.funds_list_time).total_seconds() > 86400:
            logger.info("正在更新全量基金列表...")
            try:
                df = ak.fund_name_em()
                self.funds_list = df
                self.funds_list_time = datetime.now()
            except Exception as e:
                logger.error(f"更新基金列表失败: {e}")
                if self.funds_list.empty: return pd.DataFrame()
        return self.funds_list

    def get_holdings(self, code):
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

def _get_fund_history_akshare(code: str):
    """使用 akshare 获取历史净值"""
    try:
        # 单位净值走势
        df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
        if not df.empty:
            # 确保列名存在且类型正确
            if '净值日期' in df.columns:
                df['净值日期'] = df['净值日期'].astype(str)
            if '单位净值' in df.columns:
                df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce')
            return df
    except Exception as e:
        logger.error(f"Akshare history fetch error for {code}: {e}")
    return pd.DataFrame()

def _get_fund_holdings_internal(code: str):
    """获取持仓 (带缓存)"""
    cached = data_cache.get_holdings(code)
    if cached is not None:
        return cached

    try:
        current_year = datetime.now().year
        # 尝试最近3年的报告，防止新基金或停更基金
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
            # 找到最新的季度
            quarters = portfolio_df['季度'].unique()
            if len(quarters) > 0:
                latest_df = portfolio_df[portfolio_df['季度'] == quarters[0]] # 假设第一个是最新的
                
                latest_df['占净值比例'] = pd.to_numeric(latest_df['占净值比例'], errors='coerce').fillna(0)
                latest_df = latest_df.sort_values(by='占净值比例', ascending=False).head(10)
                
                for _, row in latest_df.iterrows():
                    holdings.append({
                        "code": str(row['股票代码']),
                        "name": str(row['股票名称']),
                        "percent": float(row['占净值比例'])
                    })
        
        data_cache.set_holdings(code, holdings)
        return holdings

    except Exception as e:
        logger.warning(f"Holdings fetch failed for {code}: {e}")
        return []

def _get_stock_realtime_quotes(stock_codes: list):
    """批量获取股票实时行情"""
    if not stock_codes: return {}
    secids = []
    for code in stock_codes:
        if code.startswith('6'): 
            secids.append(f"1.{code}")
        elif code.startswith('8') or code.startswith('4'): # 北交所
             secids.append(f"0.{code}")
        else:
            secids.append(f"0.{code}")
    
    # 东方财富实时行情接口
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12&secids={','.join(secids)}"
    quotes = {}
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "http://quote.eastmoney.com/"
    }
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

def _calculate_estimate_via_holdings(code: str, last_nav: float):
    """通过持仓计算实时估值"""
    holdings = _get_fund_holdings_internal(code)
    if not holdings: return None
    
    stock_codes = [h['code'] for h in holdings]
    quotes = _get_stock_realtime_quotes(stock_codes)
    if not quotes: return None

    total_weighted_change = 0
    total_weight = 0
    
    for h in holdings:
        stock_code = h['code']
        weight = h['percent'] 
        change = quotes.get(stock_code, 0)
        
        total_weighted_change += (change * weight)
        total_weight += weight
    
    if total_weight == 0: return None

    # 加权涨跌幅
    estimated_change_percent = (total_weighted_change / 100.0)
    estimated_nav = last_nav * (1 + estimated_change_percent / 100.0)
    
    return {
        "gsz": "{:.4f}".format(estimated_nav),
        "gszzl": "{:.2f}".format(estimated_change_percent),
    }

# --- API ---

@app.get("/")
def home():
    return {"status": "SmartFund API Running"}

@app.get("/api/search")
def search_funds(key: str = Query(..., min_length=1)):
    try:
        df = data_cache.get_funds()
        if df.empty: return []
        key = key.upper()
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
def get_market_indices(codes: str = Query(None)):
    default_codes = ["1.000001", "0.399001", "0.399006", "0.399997", "0.399976"]
    target_codes = codes.split(',') if codes else default_codes
    if not target_codes: return []

    secids = ",".join(target_codes)
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12,f14,f2&secids={secids}"
    
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "http://quote.eastmoney.com/"
    }

    result = []
    try:
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
def get_estimate(code: str):
    """
    核心估值接口：强健壮性版本
    """
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
    
    # 1. 尝试获取官方实时数据 (作为 gsz/gszzl 的参考)
    #    注意：即使这里返回了 dwjz，通常也是昨天的，而且可能为 "0"
    try:
        timestamp = int(datetime.now().timestamp() * 1000)
        url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={timestamp}"
        headers = {"User-Agent": "Mozilla/5.0", "Referer": "http://fund.eastmoney.com/"}
        response = requests.get(url, headers=headers, timeout=2)
        match = re.search(r'jsonpgz\((.*?)\);', response.text)
        if match:
            fetched = json.loads(match.group(1))
            if fetched: 
                data.update(fetched)
    except: pass
    
    # 2. 获取 Akshare 历史数据 (作为 dwjz 的真理来源)
    history_df = _get_fund_history_akshare(code)
    
    # 关键修复：永远优先使用 Akshare 的历史数据填充基础净值 (dwjz)
    # 官方接口有时 dwjz="0"，必须覆盖它
    last_confirmed_nav = 1.0
    if not history_df.empty:
        # Akshare 返回按日期升序，iloc[-1] 是最新的
        latest = history_df.iloc[-1]
        last_confirmed_nav = float(latest['单位净值'])
        data['dwjz'] = str(latest['单位净值'])
        data['jzrq'] = str(latest['净值日期'])
    elif float(data.get('dwjz', 0)) > 0:
        last_confirmed_nav = float(data['dwjz'])

    # 3. 确定“实时估值” (gsz)
    
    # 逻辑A: 盘前/周末 -> 强制显示静态历史 (即 gsz = dwjz)
    if phase == 'PRE_MARKET' or phase == 'WEEKEND':
        data['gsz'] = data['dwjz']
        # 计算历史涨跌幅 (Latest vs Previous)
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

    # 逻辑B: 盘中 (MARKET)
    if phase == 'MARKET':
        official_gszzl = float(data.get("gszzl", 0))
        official_gsz = float(data.get("gsz", 0))
        
        # 如果官方估值有效且不为0 (或变化率不为0)
        # 有些冷门基金官方不再更新实时估值，此时 official_gsz 可能是昨天收盘价或 0
        if official_gsz > 0 and official_gsz != last_confirmed_nav:
             # 官方数据似乎在动，直接返回
             return data
        else:
             # 官方数据失效 (0 或 没变)，启用重仓股计算
             calc = _calculate_estimate_via_holdings(code, last_confirmed_nav)
             if calc:
                 data['gsz'] = calc['gsz']
                 data['gszzl'] = calc['gszzl']
                 data['source'] = "holdings_calc"
             else:
                 # 计算也失败，兜底显示昨天净值，涨跌0
                 data['gsz'] = str(last_confirmed_nav)
                 data['gszzl'] = "0.00"
             return data

    # 逻辑C: 盘后 (POST_MARKET)
    if phase == 'POST_MARKET':
        # 检查官方是否更新了今日净值 (通过 jzrq 判断)
        # 注意：这里的 data['jzrq'] 已经被 Akshare 覆盖了 (如果 Akshare 更新了)
        # 如果 Akshare 还没更新今日的，但 fundgz 接口里的 jzrq 是今天，说明官方出了今日净值
        
        official_updated = False
        if data.get('jzrq') == today_str:
            official_updated = True
        
        if official_updated:
            # 已更新 -> 显示真实净值
            # 需要计算今日涨跌: Today(last_confirmed_nav) vs Yesterday
            current_nav = float(data.get('dwjz', 0)) # 这是今日的
            
            # 找昨日净值
            prev_nav = 0
            if not history_df.empty:
                # 如果 Akshare 也更新到了今天，history_df[-1] 就是今天，取 [-2]
                if str(history_df.iloc[-1]['净值日期']) == today_str:
                     if len(history_df) >= 2:
                         prev_nav = float(history_df.iloc[-2]['单位净值'])
                else:
                     # Akshare 还没更新，history_df[-1] 是昨天 (也就是我们要找的 prev)
                     prev_nav = float(history_df.iloc[-1]['单位净值'])
            
            if prev_nav > 0 and current_nav > 0:
                change = ((current_nav - prev_nav) / prev_nav) * 100
                data['gsz'] = str(current_nav)
                data['gszzl'] = "{:.2f}".format(change)
                data['source'] = "real_updated"
        else:
            # 未更新 -> 收盘预估 (重仓股计算)
            calc = _calculate_estimate_via_holdings(code, last_confirmed_nav)
            if calc:
                data['gsz'] = calc['gsz']
                data['gszzl'] = calc['gszzl']
                data['source'] = "holdings_close_est"
            else:
                data['gsz'] = str(last_confirmed_nav)
                data['gszzl'] = "0.00"
        
        return data

    return data

@app.get("/api/fund/{code}")
def get_fund_detail(code: str):
    try:
        manager_name = "暂无"
        try:
            manager_df = ak.fund_manager_em(symbol=code)
            if not manager_df.empty: manager_name = manager_df.iloc[-1]['姓名']
        except: pass

        holdings_list = _get_fund_holdings_internal(code)
        
        if holdings_list:
            quotes = _get_stock_realtime_quotes([h['code'] for h in holdings_list])
            for h in holdings_list:
                h['changePercent'] = quotes.get(h['code'], 0)
        
        return {"code": code, "manager": manager_name, "holdings": holdings_list}
    except:
        return {"code": code, "manager": "数据获取失败", "holdings": []}

@app.get("/api/history/{code}")
def get_history(code: str):
    try:
        df = _get_fund_history_akshare(code)
        if df.empty: return []
        
        # Akshare 返回的按日期升序 (旧->新)
        # 获取最近365天
        recent_df = df.tail(365)
        
        result = []
        for _, row in recent_df.iterrows():
            # 增加健壮性转换
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

def _get_current_china_date_str():
    return _get_current_china_time().strftime('%Y-%m-%d')

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
