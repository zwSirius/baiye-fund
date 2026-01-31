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

# --- CORS 设置 (允许所有来源，解决跨域问题) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 缓存管理 (避免频繁拉取全量列表) ---
class FundCache:
    def __init__(self):
        self.all_funds_df = pd.DataFrame()
        self.last_update = None

    def get_funds(self):
        # 缓存 24 小时
        if self.all_funds_df.empty or not self.last_update or (datetime.now() - self.last_update).total_seconds() > 86400:
            logger.info("正在更新全量基金列表 (ak.fund_name_em)...")
            try:
                # Akshare 获取全量列表
                df = ak.fund_name_em()
                self.all_funds_df = df
                self.last_update = datetime.now()
                logger.info(f"基金列表更新完成，共 {len(df)} 条")
            except Exception as e:
                logger.error(f"更新基金列表失败: {e}")
                # 失败时尝试读取旧缓存，或返回空
                if self.all_funds_df.empty:
                    return pd.DataFrame()
        return self.all_funds_df

fund_cache = FundCache()

# --- API 接口 ---

@app.get("/")
def home():
    return {"status": "ok", "message": "SmartFund Backend Running"}

@app.get("/api/search")
def search_funds(key: str = Query(..., min_length=1)):
    """
    搜索基金
    对应前端: fetch(`${API_BASE}/api/search?key=...`)
    """
    try:
        df = fund_cache.get_funds()
        if df.empty:
            return []

        key = key.upper()
        # 模糊匹配：代码、简称、拼音
        mask = (
            df['基金代码'].str.contains(key, na=False) | 
            df['基金简称'].str.contains(key, na=False) | 
            df['拼音缩写'].str.contains(key, na=False)
        )
        
        result = df[mask].head(20)
        
        response_list = []
        for _, row in result.iterrows():
            response_list.append({
                "code": str(row['基金代码']),
                "name": str(row['基金简称']),
                "type": str(row['基金类型'])
            })
        
        return response_list
    except Exception as e:
        logger.error(f"Search error: {e}")
        return []

@app.get("/api/estimate/{code}")
def get_estimate(code: str):
    """
    获取实时估值
    策略：
    1. 优先请求天天基金实时接口 (速度快)。
    2. 如果实时接口返回的 dwjz (单位净值) 为 "0" 或空 (常见于周末/节假日)，
       则启动 Plan B: 调用 Akshare 获取历史净值，取最新一天的数据作为兜底。
    """
    # Plan A: 实时接口
    url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js"
    data = {"fundcode": code, "gsz": "0", "gszzl": "0", "dwjz": "0", "name": "", "jzrq": ""}
    
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Referer": "http://fund.eastmoney.com/"
        }
        response = requests.get(url, headers=headers, timeout=3)
        text = response.text
        
        match = re.search(r'jsonpgz\((.*?)\);', text)
        if match:
            json_str = match.group(1)
            fetched_data = json.loads(json_str)
            # 只有当获取到的数据有效时才覆盖默认值
            if fetched_data:
                data.update(fetched_data)
    except Exception as e:
        logger.warning(f"Realtime estimate failed for {code}, trying fallback. Error: {e}")

    # Plan B: 兜底检查
    # 如果 dwjz 是 0，说明实时接口没数据（休市或接口异常），我们需要查历史数据
    if str(data.get("dwjz")) == "0" or not data.get("dwjz"):
        try:
            logger.info(f"Fetching history fallback for {code}")
            # ak.fund_open_fund_info_em 获取历史净值
            history_df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not history_df.empty:
                # 取最后一行（最近交易日）
                latest = history_df.iloc[-1]
                latest_nav = str(latest['单位净值'])
                latest_date = str(latest['净值日期'])
                
                data['dwjz'] = latest_nav
                data['jzrq'] = latest_date
                
                # 如果估算值(gsz)也是0，说明处于非交易时段，估值 = 最新净值
                if str(data.get("gsz")) == "0":
                    data['gsz'] = latest_nav
                    data['gszzl'] = "0.00" # 涨跌幅设为0
                    
        except Exception as e:
             logger.error(f"Fallback history fetch failed for {code}: {e}")

    return data

@app.get("/api/fund/{code}")
def get_fund_detail(code: str):
    """
    获取详情：基金经理 + 十大重仓
    """
    try:
        # 1. 基金经理
        manager_name = "暂无"
        try:
            manager_df = ak.fund_manager_em(symbol=code)
            if not manager_df.empty:
                manager_name = manager_df.iloc[-1]['姓名']
        except Exception as e:
            logger.warning(f"Manager fetch failed: {e}")

        # 2. 十大重仓
        holdings_data = []
        try:
            current_year = datetime.now().year
            # 优先查今年
            portfolio_df = ak.fund_portfolio_hold_em(symbol=code, date=current_year)
            if portfolio_df.empty:
                portfolio_df = ak.fund_portfolio_hold_em(symbol=code, date=current_year - 1)
            
            if not portfolio_df.empty:
                top10 = portfolio_df.head(10)
                for _, row in top10.iterrows():
                    percent = row['占净值比例'] if pd.notna(row['占净值比例']) else 0
                    holdings_data.append({
                        "code": str(row['股票代码']),
                        "name": str(row['股票名称']),
                        "percent": float(percent),
                        "currentPrice": 0, 
                        "changePercent": 0
                    })
        except Exception as e:
            logger.warning(f"Holdings fetch failed: {e}")

        return {
            "code": code,
            "manager": manager_name,
            "holdings": holdings_data
        }

    except Exception as e:
        logger.error(f"Detail error {code}: {e}")
        return {"code": code, "manager": "数据获取失败", "holdings": []}

@app.get("/api/history/{code}")
def get_history(code: str):
    """
    获取历史净值 (最近365天)
    """
    try:
        history_df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
        
        if history_df.empty:
            return []

        recent_df = history_df.tail(365)
        
        result = []
        for _, row in recent_df.iterrows():
            result.append({
                "date": str(row['净值日期']),
                "value": float(row['单位净值'])
            })
            
        return result
    except Exception as e:
        logger.error(f"History error {code}: {e}")
        return []

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
