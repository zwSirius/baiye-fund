import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import akshare as ak
import pandas as pd
import requests
import re
import json
import logging
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

def _is_trading_time():
    """判断当前是否为交易时间（简单判断：周末不交易）"""
    now = _get_current_china_time()
    # 0=Mon, 5=Sat, 6=Sun
    if now.weekday() >= 5:
        return False
    # 这里可以进一步判断 9:30-15:00，但用户主要关注周末问题，且盘后也需要显示估值（虽然不动）
    # 如果是周末，绝对不进行实时计算
    return True

def _get_current_china_date_str():
    """获取当前中国日期的字符串 (YYYY-MM-DD)"""
    return _get_current_china_time().strftime("%Y-%m-%d")

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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Referer": "http://quote.eastmoney.com/"
    }
    try:
        resp = requests.get(url, headers=headers, timeout=5)
        data = resp.json()
        if data and 'data' in data and 'diff' in data['data']:
            for item in data['data']['diff']:
                stock_code = item.get('f12')
                change_pct = item.get('f3')
                # 处理停牌或无数据的情况 "-"
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
    # 周末不计算，直接返回 None，让外层使用兜底逻辑 (gszzl=0)
    if not _is_trading_time():
        return None

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
        
    # 简易修正系数 1.1 (经验值)
    estimated_change_percent = (total_weighted_change / 100.0) * 1.1
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
    """
    获取市场指数/板块
    codes: 逗号分隔的 secid，例如 "1.000001,0.399006"
    """
    # 默认值
    default_codes = ["1.000001", "0.399001", "0.399006", "0.399997", "0.399976"]
    
    if codes:
        target_codes = codes.split(',')
    else:
        target_codes = default_codes

    if not target_codes: return []

    secids = ",".join(target_codes)
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12,f14,f2&secids={secids}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
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
                
                # 简单的极值归一化作为热度 score
                score = 50 + change * 10 
                score = max(0, min(100, score))
                
                # 添加原始代码 (secid 格式的一部分) 以便前端识别
                # 这里我们假设前端知道对应的 secid 前缀，或者我们直接返回带前缀的 secid 比较麻烦
                # 简单处理：返回 f12 (代码)
                
                # 重新构建 secid 用于标识
                market = "1" if str(item['f12']).startswith("000001") and item['f14']=="上证指数" else "0"
                # 实际上这个逻辑不严谨，但对于展示够了
                
                # 为了保持简单，我们不在 response 里强行构造 secid，只返回 code (f12)
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
    data = {"fundcode": code, "gsz": "0", "gszzl": "0", "dwjz": "0", "name": "", "jzrq": ""}
    
    try:
        timestamp = int(datetime.now().timestamp() * 1000)
        url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={timestamp}"
        headers = {"User-Agent": "Mozilla/5.0", "Referer": "http://fund.eastmoney.com/"}
        response = requests.get(url, headers=headers, timeout=2)
        match = re.search(r'jsonpgz\((.*?)\);', response.text)
        if match:
            fetched = json.loads(match.group(1))
            if fetched: data.update(fetched)
    except: pass

    current_dwjz = 0.0
    latest_jzrq = ""
    if str(data.get("dwjz")) != "0":
        current_dwjz = float(data.get("dwjz"))
        latest_jzrq = data.get("jzrq")
    else:
        try:
            history_df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not history_df.empty:
                latest = history_df.iloc[-1]
                current_dwjz = float(latest['单位净值'])
                latest_jzrq = str(latest['净值日期'])
                data['dwjz'] = str(current_dwjz)
                data['jzrq'] = latest_jzrq
        except: pass

    now = _get_current_china_time()
    today_str = now.strftime("%Y-%m-%d")
    
    # 决策 A: 真实净值已经是今天的 -> 完美
    if latest_jzrq == today_str and current_dwjz > 0:
        data['gsz'] = str(current_dwjz)
        # 如果是真实净值，估值涨跌应该是0（因为已经结账了），或者保持当日的变动幅度
        # 但通常估值接口在晚上会更新为真实净值，此时估值=真实值
        return data
    
    # 决策 Weekend: 如果是周末，强制不进行估算，使用 dwjz 作为 gsz
    if not _is_trading_time():
         data['gsz'] = str(current_dwjz)
         data['gszzl'] = "0.00"
         return data

    has_valid_official_est = (str(data.get("gsz")) != "0" and data.get("gszzl") != "0")
    
    # 决策 B: 官方估值失效或不存在，启动自主计算
    if not has_valid_official_est and current_dwjz > 0:
        try:
            calc = _calculate_estimate_via_holdings(code, current_dwjz)
            if calc:
                data['gsz'] = calc['gsz']
                data['gszzl'] = calc['gszzl']
                data['source'] = "holdings_calc"
        except Exception as e:
            logger.error(f"Holdings calc failed for {code}: {e}")

    # 决策 C: 兜底
    if str(data.get("gsz")) == "0" and current_dwjz > 0:
         data['gsz'] = str(current_dwjz)
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
