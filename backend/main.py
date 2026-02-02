import uvicorn
from fastapi import FastAPI, Query, Body, APIRouter, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
import akshare as ak
import pandas as pd
import requests
import re
import json
import logging
import asyncio
import random
import time as time_module
import os
import google.generativeai as genai
from datetime import datetime, timedelta, time
from typing import List, Dict, Any, Optional

# --- 配置 ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SmartFund")

# 配置 Gemini API
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# --- 常量 ---
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

# --- 核心服务 ---

class GlobalSession:
    """全局 HTTP 会话"""
    _session = None

    @classmethod
    def get(cls):
        if cls._session is None:
            cls._session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(pool_connections=50, pool_maxsize=100)
            cls._session.mount('http://', adapter)
            cls._session.mount('https://', adapter)
        return cls._session

class CacheService:
    """内存缓存服务"""
    def __init__(self):
        self._funds_list_cache = {"data": [], "time": 0}
        self._market_cache = {"data": [], "time": 0}
        self._holdings_cache = {} # code -> {data, time}

    def get_funds_list(self):
        if time_module.time() - self._funds_list_cache['time'] < 86400: # 24h
            return self._funds_list_cache['data']
        return None

    def set_funds_list(self, data: list):
        self._funds_list_cache = {"data": data, "time": time_module.time()}

    def get_holdings(self, code: str):
        entry = self._holdings_cache.get(code)
        if entry and (time_module.time() - entry['time'] < 86400): # 24h
            return entry['data']
        return None

    def set_holdings(self, code: str, data: list):
        self._holdings_cache[code] = {"data": data, "time": time_module.time()}
    
    def get_market_indices(self):
        if time_module.time() - self._market_cache['time'] < 60: # 60s
            return self._market_cache['data']
        return None
    
    def set_market_indices(self, data: list):
        self._market_cache = {"data": data, "time": time_module.time()}

cache_service = CacheService()

class AkshareService:
    """AKShare / Eastmoney 接口封装"""
    
    @staticmethod
    def get_headers(referer=None):
        h = {
            "User-Agent": random.choice(USER_AGENTS),
            "Connection": "keep-alive",
            "Accept": "*/*"
        }
        if referer:
            h["Referer"] = referer
        return h

    @staticmethod
    def get_time_phase():
        now = datetime.utcnow() + timedelta(hours=8)
        if now.weekday() >= 5: return 'WEEKEND'
        t = now.time()
        if t < time(9, 15): return 'PRE_MARKET'
        elif t >= time(11, 30) and t < time(13, 0): return 'LUNCH_BREAK'
        elif t <= time(15, 0): return 'MARKET'
        else: return 'POST_MARKET'

    @staticmethod
    def fetch_fund_list_sync():
        """获取所有基金列表 (ak.fund_name_em)"""
        try:
            df = ak.fund_name_em()
            result = []
            for row in df.itertuples():
                result.append({
                    "code": str(row.基金代码),
                    "name": str(row.基金简称),
                    "type": str(row.基金类型),
                    "pinyin": str(row.拼音缩写)
                })
            return result
        except Exception as e:
            logger.error(f"Fetch fund list error: {e}")
            return []

    @staticmethod
    def fetch_realtime_estimate_direct_sync(code: str):
        """
        [关键修复] 直接访问 fundgz 接口获取实时估值
        URL: https://fundgz.1234567.com.cn/js/{code}.js
        """
        data = { 
            "fundcode": code,
            "name": "", 
            "gsz": "0", 
            "gszzl": "0", 
            "dwjz": "0", 
            "jzrq": "", 
            "source": "none" 
        }
        try:
            ts = int(time_module.time() * 1000)
            # 使用 HTTPS，移除 gszzl_ 前缀
            url = f"https://fundgz.1234567.com.cn/js/{code}.js?rt={ts}"
            
            # 使用通用头，避免 referer 问题
            headers = AkshareService.get_headers(referer="https://fund.eastmoney.com/")
            
            resp = GlobalSession.get().get(url, headers=headers, timeout=2.0)
            
            if resp.status_code == 200:
                # 返回格式: jsonpgz({"fundcode":"001186", ...});
                # 非贪婪匹配
                match = re.search(r'jsonpgz\s*\((.*?)\)', resp.text, re.S)
                if match:
                    json_str = match.group(1)
                    json_str = json_str.strip().rstrip(';')
                    try:
                        fetched = json.loads(json_str)
                        if fetched:
                            data.update(fetched)
                            data['source'] = 'official_realtime'
                    except json.JSONDecodeError:
                        pass
        except Exception as e:
            logger.warning(f"Estimate fetch failed for {code}: {e}")
            pass 
        return data

    @staticmethod
    def fetch_fund_history_sync(code: str) -> pd.DataFrame:
        """获取基金历史净值"""
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not df.empty:
                if '净值日期' in df.columns: df['净值日期'] = df['净值日期'].astype(str)
                if '单位净值' in df.columns: df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce')
                return df
        except Exception as e:
            logger.warning(f"Fetch history error {code}: {e}")
        return pd.DataFrame()

    @staticmethod
    def fetch_holdings_sync(code: str) -> List[Dict]:
        """获取基金持仓"""
        try:
            year = datetime.now().year
            all_dfs = []
            for y in [year, year - 1]:
                try:
                    df = ak.fund_portfolio_hold_em(symbol=code, date=str(y))
                    if not df.empty and '季度' in df.columns: 
                        all_dfs.append(df)
                except: continue
            
            if not all_dfs: return []
            combined = pd.concat(all_dfs)
            
            def parse_rank(q):
                try:
                    if '年报' in q: return int(re.search(r'(\d{4})', q).group(1)) * 100 + 5 
                    q_match = re.search(r'(\d)季度', q)
                    year_match = re.search(r'(\d{4})', q)
                    if q_match and year_match:
                        return int(year_match.group(1)) * 100 + int(q_match.group(1))
                    return 0
                except: return 0

            combined['rank'] = combined['季度'].apply(parse_rank)
            combined['占净值比例'] = pd.to_numeric(combined['占净值比例'], errors='coerce').fillna(0)
            sorted_df = combined.sort_values(by=['rank', '占净值比例'], ascending=[False, False])
            
            if sorted_df.empty: return []
            latest_rank = sorted_df.iloc[0]['rank']
            top10 = sorted_df[sorted_df['rank'] == latest_rank].head(10)
            
            result = []
            for _, r in top10.iterrows():
                result.append({
                    "code": str(r['股票代码']), 
                    "name": str(r['股票名称']), 
                    "percent": float(r['占净值比例'])
                })
            return result
        except Exception as e:
            logger.error(f"Fetch holdings error {code}: {e}")
            return []

    @staticmethod
    def fetch_fund_basic_info_sync(code: str):
        try:
            df = ak.fund_individual_basic_info_xq(symbol=code)
            info = {}
            if not df.empty:
                for _, row in df.iterrows():
                    info[row['item']] = row['value']
            return info
        except Exception as e:
            logger.warning(f"Basic info error {code}: {e}")
            return {}

    @staticmethod
    def fetch_market_indices_sync():
        try:
            df = ak.stock_zh_index_spot_em(symbol="沪深重要指数")
            if df.empty: return []
            
            result = []
            for _, row in df.iterrows():
                raw_code = str(row['代码'])
                name = str(row['名称'])
                
                std_code = raw_code
                if raw_code.startswith('000'): std_code = f"1.{raw_code}"
                elif raw_code.startswith('399'): std_code = f"0.{raw_code}"
                
                result.append({
                    "name": name, 
                    "code": std_code,
                    "raw_code": raw_code,
                    "changePercent": float(row['涨跌幅']), 
                    "value": float(row['最新价']),
                    "score": int(max(0, min(100, 50 + float(row['涨跌幅']) * 10))),
                    "leadingStock": "--"
                })
            return result
        except Exception as e:
            logger.error(f"Fetch market indices error: {e}")
            return []
            
    @staticmethod
    def fetch_stock_quotes_direct_sync(codes: List[str]) -> Dict[str, Dict[str, float]]:
        """
        [关键修复] 批量获取股票实时行情
        """
        if not codes: return {}
        unique_codes = list(set(codes))
        quotes = {}
        batch_size = 40
        
        for i in range(0, len(unique_codes), batch_size):
            batch = unique_codes[i:i+batch_size]
            secids = []
            for c in batch:
                # 构造 Eastmoney secid
                # 港股 (5位) -> 116.xxxxx
                # A股 (6位) -> 1.6xxxxx (沪), 0.0xxxxx (深), 0.3xxxxx (创), 0.8/0.4/0.92 (北)
                if len(c) == 5 and c.isdigit():
                    secids.append(f"116.{c}")
                elif len(c) == 6 and c.isdigit():
                    if c.startswith('6') or c.startswith('9'):
                        secids.append(f"1.{c}")
                    else:
                        # 0, 3, 8, 4, 2
                        secids.append(f"0.{c}")
                else:
                    # 尝试默认 0 (如 8xxxxx 北交所)
                    if c.isdigit():
                        secids.append(f"0.{c}")

            if not secids: continue

            # 使用 http 协议，避免 potential SSL/CORS issues with push2
            url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f14&secids={','.join(secids)}"
            try:
                # 移除 Referer，使用简单 Headers 防止被反爬策略拦截
                headers = AkshareService.get_headers(referer=None)
                resp = GlobalSession.get().get(url, headers=headers, timeout=3.0)
                data = resp.json()
                if data and 'data' in data and 'diff' in data['data']:
                    # diff 可能是 list 也可能是 dict，取决于 invt/fltt 参数，但在 secids 模式下通常是 dict (index -> obj) 或 list
                    diff_data = data['data']['diff']
                    
                    # 统一处理 diff
                    items = []
                    if isinstance(diff_data, list):
                        items = diff_data
                    elif isinstance(diff_data, dict):
                        items = diff_data.values()

                    for item in items:
                        code_val = str(item['f12'])
                        quotes[code_val] = {
                            "price": float(item['f2']) if item['f2'] != '-' else 0.0,
                            "change": float(item['f3']) if item['f3'] != '-' else 0.0,
                            "name": item['f14']
                        }
            except Exception as e: 
                logger.warning(f"Stock quote fetch error: {e}")
                pass
        return quotes

# --- 业务逻辑 ---

class FundController:
    
    @staticmethod
    async def get_search_results(key: str):
        cached = cache_service.get_funds_list()
        if not cached:
            cached = await run_in_threadpool(AkshareService.fetch_fund_list_sync)
            if cached:
                cache_service.set_funds_list(cached)
        
        if not cached: return []
        
        key = key.upper()
        res = []
        count = 0
        for f in cached:
            if key in f['code'] or key in f['name'] or key in f['pinyin']:
                res.append(f)
                count += 1
                if count >= 30: break 
        return res

    @staticmethod
    async def get_fund_detail(code: str):
        holdings_task = run_in_threadpool(AkshareService.fetch_holdings_sync, code)
        basic_task = run_in_threadpool(AkshareService.fetch_fund_basic_info_sync, code)
        
        holdings, basic = await asyncio.gather(holdings_task, basic_task)
        
        if holdings:
            stock_codes = [h['code'] for h in holdings]
            quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_direct_sync, stock_codes)
            
            for h in holdings: 
                q = quotes.get(h['code'])
                if q:
                    h['changePercent'] = q['change']
                    h['currentPrice'] = q['price']
                    if q['name'] and len(q['name']) > 0:
                        h['name'] = q['name']
                else:
                    h['changePercent'] = 0
                    h['currentPrice'] = 0

        manager = basic.get('基金经理', '暂无')
        return {
            "code": code, 
            "manager": manager, 
            "holdings": holdings,
            "fund_size": basic.get('最新规模', '--'),
            "start_date": basic.get('成立时间', '--'),
            "type": basic.get('基金类型', '未分类')
        }

    @staticmethod
    async def get_market_status(codes_str: Optional[str] = None):
        cached = cache_service.get_market_indices()
        if not cached:
            cached = await run_in_threadpool(AkshareService.fetch_market_indices_sync)
            if cached:
                cache_service.set_market_indices(cached)
        
        if not cached: return []

        target_codes = ["1.000001", "0.399001", "0.399006", "1.000688", "0.000300"]
        if codes_str:
            target_codes = codes_str.split(',')

        result = []
        for item in cached:
            if item['code'] in target_codes or item['raw_code'] in target_codes:
                result.append(item)
                
        return result

    @staticmethod
    async def batch_estimate(codes: List[str]):
        """
        批量估值核心逻辑 (修复版)
        """
        if not codes: return []
        
        loop = asyncio.get_running_loop()
        
        # 1. 尝试获取实时估值 (并行)
        async def fetch_one(c):
            # 优先查 fundgz 接口
            est = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_direct_sync, c)
            # 获取历史数据备用
            hist = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync, c)
            return c, est, hist

        results_data = await asyncio.gather(*[fetch_one(c) for c in codes])
        
        calc_needed = [] # 真正需要手动计算的
        
        phase = AkshareService.get_time_phase()
        today_str = (datetime.utcnow() + timedelta(hours=8)).strftime('%Y-%m-%d')

        results_map = {} 

        for code, est, hist in results_data:
            res = est # 包含 gsz, gszzl, dwjz 等
            
            # 修正昨日净值 (dwjz)
            last_nav = 0.0
            last_date = ""
            
            # 安全转换 float
            def safe_float(v, default=0.0):
                try:
                    return float(v)
                except:
                    return default

            if res.get('dwjz') and safe_float(res['dwjz']) > 0:
                last_nav = safe_float(res['dwjz'])
                last_date = res.get('jzrq', '')
            
            # 如果接口没给昨日净值，从历史数据找
            if (last_nav <= 0 or not last_date) and not hist.empty:
                latest = hist.iloc[-1]
                last_nav = float(latest['单位净值'])
                last_date = str(latest['净值日期'])
                res['dwjz'] = str(last_nav)
                res['jzrq'] = last_date
            
            res['_last_nav'] = last_nav
            
            # --- 关键修复：判断逻辑 ---
            gsz = safe_float(res.get('gsz'))
            gszzl = safe_float(res.get('gszzl'))
            source = res.get('source', 'none')
            
            need_manual = False
            
            # 策略：
            if source == 'official_realtime':
                if gsz > 0:
                    pass
                elif gszzl != 0 and last_nav > 0:
                     # 反推
                     new_gsz = last_nav * (1 + gszzl / 100.0)
                     res['gsz'] = "{:.4f}".format(new_gsz)
                else:
                    # gsz=0, gszzl=0
                    if phase == 'MARKET' or phase == 'PRE_MARKET' or phase == 'LUNCH_BREAK':
                         need_manual = True
                    elif phase == 'POST_MARKET':
                         # 如果日期不对，或者数据确实是0，尝试计算
                         if res.get('jzrq') != today_str:
                             need_manual = True
            else:
                need_manual = True
            
            if need_manual:
                calc_needed.append(code)
            
            results_map[code] = res

        # 2. 批量手动计算 (仅针对无官方数据的基金)
        if calc_needed:
            # A. 获取持仓
            codes_to_fetch_h = [c for c in calc_needed if not cache_service.get_holdings(c)]
            if codes_to_fetch_h:
                 h_tasks = [run_in_threadpool(AkshareService.fetch_holdings_sync, c) for c in codes_to_fetch_h]
                 fetched_h = await asyncio.gather(*h_tasks)
                 for i, c in enumerate(codes_to_fetch_h):
                     cache_service.set_holdings(c, fetched_h[i])
            
            # B. 汇总股票
            all_stocks = set()
            fund_holdings = {}
            for c in calc_needed:
                h = cache_service.get_holdings(c) or []
                fund_holdings[c] = h
                for stock in h:
                    all_stocks.add(stock['code'])
            
            # C. 获取股价
            stock_quotes = await run_in_threadpool(AkshareService.fetch_stock_quotes_direct_sync, list(all_stocks))
            
            # D. 计算
            for c in calc_needed:
                data = results_map[c]
                holdings = fund_holdings.get(c, [])
                if not holdings: continue
                
                weighted_chg = 0
                total_w = 0
                for h in holdings:
                    w = h['percent']
                    q = stock_quotes.get(h['code'])
                    if q:
                        weighted_chg += (q['change'] * w)
                        total_w += w
                
                est_chg = 0
                if total_w > 0:
                    est_chg = (weighted_chg / total_w) * 0.95 # 0.95 修正系数
                
                last_n = data['_last_nav']
                if last_n > 0:
                    est_val = last_n * (1 + est_chg / 100.0)
                    data['gsz'] = "{:.4f}".format(est_val)
                    data['gszzl'] = "{:.2f}".format(est_chg)
                    data['source'] = 'holdings_calc_batch'

        return [results_map[c] for c in codes]

    @staticmethod
    async def analyze_content(prompt: str):
        if not GEMINI_API_KEY:
            raise HTTPException(status_code=500, detail="Server Gemini Key not configured")
        try:
            model = genai.GenerativeModel("gemini-1.5-flash") 
            response = await run_in_threadpool(model.generate_content, prompt)
            return {"text": response.text}
        except Exception as e:
            logger.error(f"Gemini Error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

# --- FastAPI App ---

app = FastAPI(title="SmartFund API", description="Based on AKShare/Eastmoney Interfaces")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter(prefix="/api")

@router.get("/status")
def status():
    return {
        "phase": AkshareService.get_time_phase(), 
        "ts": datetime.now().timestamp(),
        "backend": "akshare_fix_v8"
    }

@router.get("/search")
async def search(key: str = Query(..., min_length=1)):
    return await FundController.get_search_results(key)

@router.get("/market")
async def market(codes: Optional[str] = Query(None)):
    return await FundController.get_market_status(codes)

@router.get("/estimate/{code}")
async def estimate_one(code: str):
    res = await FundController.batch_estimate([code])
    return res[0] if res else {}

@router.post("/estimate/batch")
async def estimate_batch(payload: dict = Body(...)):
    return await FundController.batch_estimate(payload.get('codes', []))

@router.get("/fund/{code}")
async def detail(code: str):
    return await FundController.get_fund_detail(code)

@router.get("/history/{code}")
async def history(code: str):
    df = await run_in_threadpool(AkshareService.fetch_fund_history_sync, code)
    if df.empty: return []
    return [{"date": str(r['净值日期']), "value": float(r['单位净值'])} for _, r in df.tail(365).iterrows()]

@router.post("/analyze")
async def analyze(payload: dict = Body(...)):
    prompt = payload.get("prompt", "")
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    return await FundController.analyze_content(prompt)

app.include_router(router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
