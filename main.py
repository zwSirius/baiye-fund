import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import akshare as ak
import pandas as pd
import requests
import re
import json
import logging
from datetime import datetime

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

# --- 缓存管理 ---
class FundCache:
    def __init__(self):
        self.all_funds_df = pd.DataFrame()
        self.last_update = None

    def get_funds(self):
        if self.all_funds_df.empty or not self.last_update or (datetime.now() - self.last_update).total_seconds() > 86400:
            logger.info("正在更新全量基金列表 (ak.fund_name_em)...")
            try:
                df = ak.fund_name_em()
                self.all_funds_df = df
                self.last_update = datetime.now()
                logger.info(f"基金列表更新完成，共 {len(df)} 条")
            except Exception as e:
                logger.error(f"更新基金列表失败: {e}")
                if self.all_funds_df.empty:
                    return pd.DataFrame()
        return self.all_funds_df

fund_cache = FundCache()

# --- 内部辅助函数 ---

def _get_fund_holdings_internal(code: str):
    """
    内部函数：获取基金最新季度的重仓股数据
    返回: [{"code": "600519", "name": "贵州茅台", "percent": 9.5}, ...]
    """
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

        if not portfolio_df.empty and '季度' in portfolio_df.columns:
            quarters = portfolio_df['季度'].unique()
            if len(quarters) > 0:
                quarters.sort()
                latest_quarter = quarters[-1]
                
                latest_df = portfolio_df[portfolio_df['季度'] == latest_quarter]
                latest_df['占净值比例'] = pd.to_numeric(latest_df['占净值比例'], errors='coerce').fillna(0)
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
        logger.warning(f"Internal holdings fetch failed for {code}: {e}")
    return []

def _get_stock_realtime_quotes(stock_codes: list):
    """
    批量获取股票实时涨跌幅 (使用东财接口，比 akshare 全量拉取更快)
    """
    if not stock_codes:
        return {}
    
    # 构造东财请求代码 (6开头是沪市1.xxx, 0/3开头是深市0.xxx)
    secids = []
    for code in stock_codes:
        if code.startswith('6') or code.startswith('9') or code.startswith('5'): # 沪市
            secids.append(f"1.{code}")
        else: # 深市/北交
            secids.append(f"0.{code}")
            
    secids_str = ",".join(secids)
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12,f14&secids={secids_str}"
    
    quotes = {} # { "600519": 1.25 }  (code: change_percent)
    try:
        resp = requests.get(url, timeout=2)
        data = resp.json()
        if data and 'data' in data and 'diff' in data['data']:
            for item in data['data']['diff']:
                # f12: code, f14: name, f3: change_percent
                stock_code = item.get('f12')
                change_pct = item.get('f3')
                
                # 转换 '-' 为 0
                if change_pct == '-': change_pct = 0
                
                if stock_code:
                    quotes[stock_code] = float(change_pct)
    except Exception as e:
        logger.warning(f"Stock quote fetch failed: {e}")
        
    return quotes

def _calculate_estimate_via_holdings(code: str, last_nav: float):
    """
    Level 2 核心逻辑：通过重仓股计算估值
    """
    holdings = _get_fund_holdings_internal(code)
    if not holdings:
        return None

    stock_codes = [h['code'] for h in holdings]
    quotes = _get_stock_realtime_quotes(stock_codes)
    
    if not quotes:
        return None

    total_weighted_change = 0
    total_percent_covered = 0
    
    for h in holdings:
        stock_code = h['code']
        weight = h['percent'] # e.g. 9.5
        change = quotes.get(stock_code, 0) # e.g. 1.2
        
        total_weighted_change += (change * weight)
        total_percent_covered += weight
        
    # 计算逻辑：
    # 假设重仓股（如50%仓位）代表了整个股票持仓的走势。
    # 简单估算：估算涨跌幅 = 加权涨跌幅总和 / 100
    # 比如：茅台涨2%，占比10% -> 贡献 0.2% 的基金涨幅
    estimated_change_percent = total_weighted_change / 100.0
    
    # 修正：如果只拿到了前十大（比如占50%），我们假设剩下的持仓走势和前十大类似，或者保守一点，不放大。
    # 通常做法：直接用 Sum(Weight * Change) / 100 即可，因为非重仓股波动通常较小或相互抵消。
    # 也可以做一个简单的线性放大，但风险较大。这里采用保守策略：仅计算重仓股贡献。
    
    # 计算估算净值
    estimated_nav = last_nav * (1 + estimated_change_percent / 100.0)
    
    return {
        "gsz": "{:.4f}".format(estimated_nav),
        "gszzl": "{:.2f}".format(estimated_change_percent),
        "source": "model_calculation" # 标记来源
    }

# --- API 接口 ---

@app.get("/")
def home():
    return {"status": "ok", "message": "SmartFund Backend Running"}

@app.get("/api/search")
def search_funds(key: str = Query(..., min_length=1)):
    try:
        df = fund_cache.get_funds()
        if df.empty:
            return []
        key = key.upper()
        mask = (df['基金代码'].str.contains(key, na=False) | df['基金简称'].str.contains(key, na=False) | df['拼音缩写'].str.contains(key, na=False))
        result = df[mask].head(20)
        response_list = []
        for _, row in result.iterrows():
            response_list.append({"code": str(row['基金代码']),"name": str(row['基金简称']),"type": str(row['基金类型'])})
        return response_list
    except Exception as e:
        logger.error(f"Search error: {e}")
        return []

@app.get("/api/estimate/{code}")
def get_estimate(code: str):
    """
    获取实时估值 (三级策略)
    Level 1: 官方实时接口
    Level 2: 重仓股穿透计算 (当官方接口失效/为0时)
    Level 3: 历史净值兜底 (当休市且无实时数据时)
    """
    # 初始化返回结构
    data = {"fundcode": code, "gsz": "0", "gszzl": "0", "dwjz": "0", "name": "", "jzrq": ""}
    
    # --- Level 1: 尝试官方接口 ---
    official_success = False
    try:
        url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js"
        headers = {"User-Agent": "Mozilla/5.0", "Referer": "http://fund.eastmoney.com/"}
        response = requests.get(url, headers=headers, timeout=2)
        match = re.search(r'jsonpgz\((.*?)\);', response.text)
        if match:
            fetched_data = json.loads(match.group(1))
            if fetched_data and str(fetched_data.get("gsz")) != "0":
                data.update(fetched_data)
                official_success = True
            # 即使 gsz 为 0，dwjz 也可能有用，先更新进去
            elif fetched_data:
                data.update(fetched_data)
    except Exception as e:
        logger.warning(f"Level 1 (Official API) failed for {code}: {e}")

    # 获取 dwjz (单位净值) 用于后续计算，如果 Level 1 没拿到，先查一下历史
    current_dwjz = 0.0
    if str(data.get("dwjz")) != "0":
        current_dwjz = float(data.get("dwjz"))
    else:
        # 查历史获取最新 dwjz
        try:
            history_df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not history_df.empty:
                latest = history_df.iloc[-1]
                current_dwjz = float(latest['单位净值'])
                data['dwjz'] = str(current_dwjz)
                data['jzrq'] = str(latest['净值日期'])
        except:
            pass

    # --- Level 2: 如果 Level 1 失败(gsz=0)，尝试 Level 2 (自算) ---
    # 条件：官方接口挂了(official_success=False) 或者 官方返回估值为0 (可能是休市，但如果现在是交易时间，我们希望能算出来)
    # 简单判断：如果 gsz 还是 "0"，且 dwjz 有值，尝试自算
    if str(data.get("gsz")) == "0" and current_dwjz > 0:
        try:
            logger.info(f"Level 2: Calculating estimate via holdings for {code}")
            calc_result = _calculate_estimate_via_holdings(code, current_dwjz)
            if calc_result:
                data['gsz'] = calc_result['gsz']
                data['gszzl'] = calc_result['gszzl']
                # jzrq 保持为昨日，因为这是基于昨日净值算的
        except Exception as e:
            logger.error(f"Level 2 calculation failed: {e}")

    # --- Level 3: 兜底 ---
    # 如果 Level 1 和 Level 2 都没搞定 (gsz 还是 0)，让 gsz = dwjz
    if str(data.get("gsz")) == "0" and str(data.get("dwjz")) != "0":
         data['gsz'] = data['dwjz']
         data['gszzl'] = "0.00"

    return data

@app.get("/api/fund/{code}")
def get_fund_detail(code: str):
    """
    获取详情：基金经理 + 十大重仓
    """
    try:
        manager_name = "暂无"
        try:
            manager_df = ak.fund_manager_em(symbol=code)
            if not manager_df.empty:
                manager_name = manager_df.iloc[-1]['姓名']
        except: pass

        # 复用内部函数获取持仓，保证逻辑一致
        holdings_list = _get_fund_holdings_internal(code)
        
        # 补充：详情页也想要展示重仓股的实时股价和涨跌幅？
        # 为了详情页体验，顺便把当前股价取一下
        if holdings_list:
            stock_codes = [h['code'] for h in holdings_list]
            quotes = _get_stock_realtime_quotes(stock_codes)
            for h in holdings_list:
                h['changePercent'] = quotes.get(h['code'], 0)
                # 暂时不获取绝对股价，因为 api/qt/ulist 接口里 f2 是股价，这里简单处理
                # 如果需要股价，可以在 _get_stock_realtime_quotes 增加 f2 字段
        
        return {
            "code": code,
            "manager": manager_name,
            "holdings": holdings_list
        }
    except Exception as e:
        logger.error(f"Detail error {code}: {e}")
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
