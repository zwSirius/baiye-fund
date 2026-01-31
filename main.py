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
    
    # 如果没取到权重或行情，返回 None
    if total_weight == 0: return None

    # 简易修正系数 1.0 (重仓股通常占50%-70%仓位，这里仅计算重仓股的加权涨跌作为基金整体涨跌的近似)
    # 为了更准确，可以假设剩余仓位涨跌为0或跟随大盘，这里简单处理：
    # 假设重仓股代表了基金的波动方向。
    # 归一化权重：如果前十大只占50%，那么这50%的波动贡献了多少？
    # 简单模型：(Sum(Weight * Change)) / 100
    estimated_change_percent = (total_weighted_change / 100.0)
    
    # 某些基金波动大，可能需要乘系数，比如 0.9 或 1.1，这里暂用 1.0
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
    """
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
    核心估值接口：严格按照时间段逻辑返回数据
    """
    # 基础结构
    data = {
        "fundcode": code, 
        "gsz": "0", "gszzl": "0", 
        "dwjz": "0", "jzrq": "", 
        "name": "", 
        "source": "official"
    }
    
    phase = _get_time_phase()
    today_str = _get_current_china_date_str()
    
    # 1. 无论什么阶段，先获取官方实时/收盘数据 (轻量级)
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

    # 2. 获取历史净值 (Akshare) 用于计算真实涨跌和兜底
    #    注意：akshare 返回的是已确认的净值，通常T日的净值在T+1日能查到，或者T日晚间
    history_df = pd.DataFrame()
    try:
        history_df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
    except: pass

    # --- 辅助函数：从历史计算真实涨跌 ---
    def set_real_data_from_history():
        if not history_df.empty:
            latest = history_df.iloc[-1]
            data['dwjz'] = str(latest['单位净值'])
            data['jzrq'] = str(latest['净值日期'])
            
            # 计算真实涨跌幅: (Latest - Prev) / Prev
            if len(history_df) >= 2:
                prev = history_df.iloc[-2]
                last_nav = float(latest['单位净值'])
                prev_nav = float(prev['单位净值'])
                if prev_nav > 0:
                    change = ((last_nav - prev_nav) / prev_nav) * 100
                    data['gsz'] = str(last_nav) # 显示真实净值
                    data['gszzl'] = "{:.2f}".format(change) # 显示真实涨跌
                    data['source'] = 'real_history' # 标记源
            else:
                data['gsz'] = str(latest['单位净值'])
                data['gszzl'] = "0.00"

    # --- 阶段逻辑 ---

    # A. 盘前 / 周末 / 节假日
    if phase == 'PRE_MARKET' or phase == 'WEEKEND':
        # 逻辑：显示上一个交易日的真实净值及涨跌幅
        set_real_data_from_history()
        return data

    # B. 盘中 (09:30 - 15:00)
    if phase == 'MARKET':
        # 逻辑：优先官方估值 -> 官方失效则重仓股估值
        official_gszzl = float(data.get("gszzl", 0))
        
        if official_gszzl != 0:
            # 官方数据有效，直接返回 (已在步骤1获取)
            return data
        else:
            # 官方失效 (0.00)，启用重仓股实时计算
            # 基准净值：取历史最新的净值 (昨日收盘)
            last_nav = 1.0
            if not history_df.empty:
                last_nav = float(history_df.iloc[-1]['单位净值'])
            
            calc = _calculate_estimate_via_holdings(code, last_nav)
            if calc:
                data['gsz'] = calc['gsz']
                data['gszzl'] = calc['gszzl']
                data['source'] = "holdings_calc"
            return data

    # C. 盘后 (15:00 - 24:00)
    if phase == 'POST_MARKET':
        # 逻辑：检查今日净值是否更新
        # data['jzrq'] 是官方接口返回的净值日期
        official_jzrq = data.get('jzrq', '')
        
        if official_jzrq == today_str:
            # 官方已更新今日净值 -> 显示今日真实净值及涨跌
            # 需要计算涨跌幅：今日净值 (data['dwjz']) vs 昨日净值 (history_df[-1])
            # 注意：如果akshare还没更新今日的，history_df[-1]就是昨日的
            current_nav = float(data.get('dwjz', 0))
            if not history_df.empty:
                # 假设akshare还没更新，history最后一个是昨日
                # 检查日期：如果history最后一个日期也是今天，那取倒数第二个
                last_hist = history_df.iloc[-1]
                prev_nav = 0
                if str(last_hist['净值日期']) == today_str:
                     if len(history_df) >= 2:
                         prev_nav = float(history_df.iloc[-2]['单位净值'])
                else:
                     prev_nav = float(last_hist['单位净值'])
                
                if prev_nav > 0 and current_nav > 0:
                    change = ((current_nav - prev_nav) / prev_nav) * 100
                    data['gsz'] = str(current_nav)
                    data['gszzl'] = "{:.2f}".format(change)
                    data['source'] = "real_updated"
            return data
        else:
            # 官方尚未更新今日净值 -> 依旧通过重仓股计算 (此时用的是收盘价，相当于收盘预估)
            last_nav = 1.0
            if not history_df.empty:
                last_nav = float(history_df.iloc[-1]['单位净值'])
            
            calc = _calculate_estimate_via_holdings(code, last_nav)
            if calc:
                data['gsz'] = calc['gsz']
                data['gszzl'] = calc['gszzl']
                data['source'] = "holdings_close_est"
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
