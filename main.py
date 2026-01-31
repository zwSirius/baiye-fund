import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import akshare as ak
import pandas as pd
import requests
import re
import json
import logging
from datetime import datetime, timedelta

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
        # 持仓缓存 24 小时 (因为季度报告很久才更新一次)
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

def _get_current_china_date():
    """获取当前中国日期的字符串 (YYYY-MM-DD)"""
    # UTC+8
    china_time = datetime.utcnow() + timedelta(hours=8)
    return china_time.strftime("%Y-%m-%d")

def _get_fund_holdings_internal(code: str):
    """
    获取持仓 (带缓存)
    """
    # 1. 查缓存
    cached = data_cache.get_holdings(code)
    if cached is not None:
        return cached

    # 2. 没缓存，去获取
    try:
        current_year = datetime.now().year
        years_to_try = [current_year, current_year - 1]
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
                quarters.sort()
                latest_quarter = quarters[-1]
                latest_df = portfolio_df[portfolio_df['季度'] == latest_quarter]
                latest_df['占净值比例'] = pd.to_numeric(latest_df['占净值比例'], errors='coerce').fillna(0)
                latest_df = latest_df.sort_values(by='占净值比例', ascending=False).head(10)
                
                for _, row in latest_df.iterrows():
                    holdings.append({
                        "code": str(row['股票代码']),
                        "name": str(row['股票名称']),
                        "percent": float(row['占净值比例'])
                    })
        
        # 3. 存缓存 (即使为空也存，防止反复请求失败接口)
        data_cache.set_holdings(code, holdings)
        return holdings

    except Exception as e:
        logger.warning(f"Holdings fetch failed for {code}: {e}")
        return []

def _get_stock_realtime_quotes(stock_codes: list):
    if not stock_codes: return {}
    secids = []
    for code in stock_codes:
        if code.startswith('6') or code.startswith('9') or code.startswith('5'): secids.append(f"1.{code}")
        else: secids.append(f"0.{code}")
    
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12&secids={','.join(secids)}"
    quotes = {}
    try:
        resp = requests.get(url, timeout=2)
        data = resp.json()
        if data and 'data' in data and 'diff' in data['data']:
            for item in data['data']['diff']:
                stock_code = item.get('f12')
                change_pct = item.get('f3')
                if change_pct == '-': change_pct = 0
                if stock_code: quotes[stock_code] = float(change_pct)
    except: pass
    return quotes

def _calculate_estimate_via_holdings(code: str, last_nav: float):
    holdings = _get_fund_holdings_internal(code)
    if not holdings: return None
    stock_codes = [h['code'] for h in holdings]
    quotes = _get_stock_realtime_quotes(stock_codes)
    if not quotes: return None

    total_weighted_change = 0
    
    for h in holdings:
        stock_code = h['code']
        weight = h['percent'] 
        change = quotes.get(stock_code, 0)
        total_weighted_change += (change * weight)
        
    estimated_change_percent = total_weighted_change / 100.0
    estimated_nav = last_nav * (1 + estimated_change_percent / 100.0)
    
    return {
        "gsz": "{:.4f}".format(estimated_nav),
        "gszzl": "{:.2f}".format(estimated_change_percent),
    }

# --- API ---

@app.get("/")
def home():
    return {"status": "ok"}

@app.get("/api/search")
def search_funds(key: str = Query(..., min_length=1)):
    try:
        df = data_cache.get_funds()
        if df.empty: return []
        key = key.upper()
        mask = (df['基金代码'].str.contains(key, na=False) | df['基金简称'].str.contains(key, na=False) | df['拼音缩写'].str.contains(key, na=False))
        result = df[mask].head(20)
        response_list = []
        for _, row in result.iterrows():
            response_list.append({"code": str(row['基金代码']),"name": str(row['基金简称']),"type": str(row['基金类型'])})
        return response_list
    except: return []

@app.get("/api/estimate/{code}")
def get_estimate(code: str):
    # 默认结构
    data = {"fundcode": code, "gsz": "0", "gszzl": "0", "dwjz": "0", "name": "", "jzrq": ""}
    
    # 1. 获取官方接口数据
    try:
        url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js"
        headers = {"User-Agent": "Mozilla/5.0", "Referer": "http://fund.eastmoney.com/"}
        response = requests.get(url, headers=headers, timeout=2)
        match = re.search(r'jsonpgz\((.*?)\);', response.text)
        if match:
            fetched = json.loads(match.group(1))
            if fetched: data.update(fetched)
    except: pass

    # 2. 检查 dwjz 是否为空，如果为空查历史兜底
    current_dwjz = 0.0
    if str(data.get("dwjz")) != "0":
        current_dwjz = float(data.get("dwjz"))
    else:
        try:
            history_df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not history_df.empty:
                latest = history_df.iloc[-1]
                current_dwjz = float(latest['单位净值'])
                data['dwjz'] = str(current_dwjz)
                data['jzrq'] = str(latest['净值日期'])
        except: pass

    # --- 核心判断逻辑 ---
    
    today_str = _get_current_china_date()
    nav_date = data.get("jzrq") # 净值日期
    
    # 情况 A: 真实净值(dwjz) 已经是今天的了 -> 晚上更新了
    if nav_date == today_str and current_dwjz > 0:
        # 强制使用真实净值作为估值
        data['gsz'] = data['dwjz']
        data['gszzl'] = data.get("gszzl", "0.00") # 如果官方给了日涨幅就用，没给就没办法(通常会有)
        # 如果官方此时 gszzl 也是 0 (有时候会这样)，可以尝试根据昨日算，但太复杂，暂且信任官方
        return data

    # 情况 B: 官方估值无效 (gsz=0)，且真实净值还没更新到今天 -> 盘中或盘前
    # 或者是周末/节假日 (Level 2 算出来的涨跌幅也会是 0，因为股市不交易，所以逻辑通用)
    if str(data.get("gsz")) == "0" and current_dwjz > 0:
        try:
            calc = _calculate_estimate_via_holdings(code, current_dwjz)
            if calc:
                data['gsz'] = calc['gsz']
                data['gszzl'] = calc['gszzl']
        except Exception as e:
            logger.error(f"Level 2 failed for {code}: {e}")

    # 情况 C: Level 2 也失败了，或者本来就有官方估值 -> 保持原样 (如果 gsz 还是 0，最后兜底)
    if str(data.get("gsz")) == "0" and str(data.get("dwjz")) != "0":
         data['gsz'] = data['dwjz']
         data['gszzl'] = "0.00"

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
        
        # 详情页实时股价
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
        history_df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
        if history_df.empty: return []
        recent_df = history_df.tail(365)
        result = []
        for _, row in recent_df.iterrows():
            result.append({"date": str(row['净值日期']),"value": float(row['单位净值'])})
        return result
    except: return []

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
