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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0"
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
        self._market_cache = {} # key -> {data, time}
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
    
    def get_market_data(self, key: str):
        entry = self._market_cache.get(key)
        if entry and (time_module.time() - entry['time'] < 30): # 30s 缓存
            return entry['data']
        return None
    
    def set_market_data(self, key: str, data: list):
        self._market_cache[key] = {"data": data, "time": time_module.time()}

cache_service = CacheService()

class AkshareService:
    """AKShare / Eastmoney 接口封装"""
    
    @staticmethod
    def get_headers(referer="https://quote.eastmoney.com/"):
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Referer": referer,
            "Connection": "keep-alive",
            "Accept": "*/*"
        }

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
    def get_secid(code: str) -> str:
        """
        [核心修复] 智能生成 Eastmoney SecID
        """
        code = str(code).strip()
        
        # 1. 如果自带点号 (如 100.HSI, 1.000001)，直接返回，信任前端/预设
        if '.' in code:
            return code
            
        # 2. 港股 (5位数字) -> 116.xxxxx
        if len(code) == 5 and code.isdigit():
            return f"116.{code}"
        
        # 3. A股 / 行业指数 / ETF (6位数字)
        if len(code) == 6 and code.isdigit():
            # 沪市: 60xxxx, 68xxxx, 90xxxx(B), 5xxxxx(ETF), 000xxx(指数, 通常是沪)
            # 注意: 000xxx 在 A 股指数里通常是上证 (1.000001)，但也可能是深市股票 00xxxx
            # 这里做个特殊判断：如果以 000 开头，且是指数请求，通常是 1.
            # 但为了安全，主要依赖前缀规则：
            if code.startswith(('6', '9', '5')):
                return f"1.{code}"
            # 上证指数特殊处理
            if code == '000001': 
                return f"1.{code}"
            if code == '000300': # 沪深300
                return f"1.{code}"
            if code == '000688': # 科创50
                return f"1.{code}"
            
            # 深市: 00xxxx, 30xxxx, 15xxxx, 399xxx(指数)
            # 北交所: 8xxxxx, 4xxxxx -> 映射到 0.
            return f"0.{code}"
        
        # 默认尝试深市/通用
        return f"0.{code}"

    @staticmethod
    def fetch_quotes_by_secids(secids: List[str]) -> Dict[str, Dict]:
        """
        [通用行情引擎] 批量获取 SecID 的行情
        支持 A股、港股、美股指数、板块指数
        """
        if not secids: return {}
        
        quotes = {}
        # 每次请求最多 40-50 个，防止 URL 过长
        batch_size = 40
        unique_secids = list(set(secids))
        
        for i in range(0, len(unique_secids), batch_size):
            batch = unique_secids[i:i+batch_size]
            
            # 字段说明: f12=code, f14=name, f2=latest_price, f3=change_percent, f4=change_amount
            url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f4,f12,f13,f14&secids={','.join(batch)}"
            
            try:
                headers = AkshareService.get_headers(referer="https://quote.eastmoney.com/")
                resp = GlobalSession.get().get(url, headers=headers, timeout=4.0)
                data = resp.json()
                
                if data and 'data' in data and data['data']:
                    diff_data = data['data'].get('diff', [])
                    
                    # 统一处理 diff
                    items = []
                    if isinstance(diff_data, list):
                        items = diff_data
                    elif isinstance(diff_data, dict):
                        items = diff_data.values()

                    for item in items:
                        # 兼容处理：f12 是纯代码
                        # 我们需要尽量把 key 映射回输入时的格式，或者让调用方通过 code 查找
                        code_val = str(item['f12'])
                        market_val = str(item.get('f13', '')) # 市场 ID
                        
                        # 构造 price, change
                        price = float(item['f2']) if item['f2'] != '-' else 0.0
                        change_p = float(item['f3']) if item['f3'] != '-' else 0.0
                        name = item['f14']
                        
                        # 存入字典。为了防止不同市场代码冲突 (如 A股 000001 和 指数 000001)，
                        # 我们尝试用 secid 作为 key，也用纯 code 作为 key (如果 key 不存在)
                        full_secid = f"{market_val}.{code_val}"
                        
                        quote_data = {
                            "price": price,
                            "change": change_p,
                            "name": name,
                            "secid": full_secid,
                            "code": code_val
                        }
                        
                        quotes[full_secid] = quote_data
                        # 备用：纯代码 Key (如果只有一种市场，这很方便)
                        if code_val not in quotes:
                            quotes[code_val] = quote_data

            except Exception as e:
                logger.warning(f"Batch quote fetch error: {e}")
                pass
                
        return quotes

    @staticmethod
    def fetch_fund_list_sync():
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
        except Exception:
            return []

    @staticmethod
    def fetch_realtime_estimate_direct_sync(code: str):
        data = { "fundcode": code, "name": "", "gsz": "0", "gszzl": "0", "dwjz": "0", "jzrq": "", "source": "none" }
        try:
            ts = int(time_module.time() * 1000)
            url = f"https://fundgz.1234567.com.cn/js/{code}.js?rt={ts}"
            headers = AkshareService.get_headers(referer="https://fund.eastmoney.com/")
            resp = GlobalSession.get().get(url, headers=headers, timeout=2.5)
            if resp.status_code == 200:
                match = re.search(r'jsonpgz\s*=?\s*\((.*?)\)', resp.text, re.S)
                if match:
                    json_str = match.group(1).strip().rstrip(';')
                    try:
                        fetched = json.loads(json_str)
                        if fetched:
                            data.update(fetched)
                            data['source'] = 'official_realtime'
                    except: pass
        except: pass 
        return data

    @staticmethod
    def fetch_fund_history_sync(code: str) -> pd.DataFrame:
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not df.empty:
                if '净值日期' in df.columns: df['净值日期'] = df['净值日期'].astype(str)
                if '单位净值' in df.columns: df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce')
                return df
        except: pass
        return pd.DataFrame()

    @staticmethod
    def fetch_holdings_sync(code: str) -> List[Dict]:
        try:
            year = datetime.now().year
            all_dfs = []
            for y in [year, year - 1]:
                try:
                    df = ak.fund_portfolio_hold_em(symbol=code, date=str(y))
                    if not df.empty and '季度' in df.columns: all_dfs.append(df)
                except: continue
            
            if not all_dfs: return []
            combined = pd.concat(all_dfs)
            
            def parse_rank(q):
                try:
                    if '年报' in q: return int(re.search(r'(\d{4})', q).group(1)) * 100 + 5 
                    q_match = re.search(r'(\d)季度', q)
                    year_match = re.search(r'(\d{4})', q)
                    if q_match and year_match: return int(year_match.group(1)) * 100 + int(q_match.group(1))
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
        except: return []

    @staticmethod
    def fetch_fund_basic_info_sync(code: str):
        try:
            df = ak.fund_individual_basic_info_xq(symbol=code)
            info = {}
            if not df.empty:
                for _, row in df.iterrows(): info[row['item']] = row['value']
            return info
        except: return {}

    @staticmethod
    def fetch_market_indices_sync(codes_str: Optional[str] = None):
        """
        [修复] 真正支持多市场、多类型指数获取
        """
        # 默认指数 (如果前端没传)
        if not codes_str:
            target_codes = ["1.000001", "0.399001", "0.399006", "1.000688", "100.HSI"]
        else:
            target_codes = codes_str.split(',')

        # 1. 构造 secids
        secids = []
        for c in target_codes:
            secids.append(AkshareService.get_secid(c))
            
        # 2. 批量获取
        quotes = AkshareService.fetch_quotes_by_secids(secids)
        
        # 3. 组装结果
        result = []
        for requested_code in target_codes:
            secid = AkshareService.get_secid(requested_code)
            
            # 尝试通过 secid 获取，或者通过纯 code 获取
            data = quotes.get(secid)
            if not data and '.' in secid:
                 # 尝试只用点号后面的代码查找 (容错)
                 data = quotes.get(secid.split('.')[1])
            
            if data:
                change = data['change']
                result.append({
                    "name": data['name'], 
                    "code": requested_code, # 保持前端请求的格式返回
                    "raw_code": data['code'],
                    "changePercent": change, 
                    "value": data['price'],
                    "score": int(max(0, min(100, 50 + change * 10))),
                    "leadingStock": "--"
                })
        
        return result

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
            # 批量获取持仓股票行情
            stock_codes = [h['code'] for h in holdings]
            # 转换成 secids
            secids = [AkshareService.get_secid(c) for c in stock_codes]
            
            quotes = await run_in_threadpool(AkshareService.fetch_quotes_by_secids, secids)
            
            for h in holdings: 
                # 尝试多种 key 匹配
                q = quotes.get(AkshareService.get_secid(h['code']))
                if not q: q = quotes.get(h['code'])
                
                if q:
                    h['changePercent'] = q['change']
                    h['currentPrice'] = q['price']
                    if q['name']: h['name'] = q['name']
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
        cache_key = codes_str if codes_str else "default"
        cached = cache_service.get_market_data(cache_key)
        
        if not cached:
            cached = await run_in_threadpool(AkshareService.fetch_market_indices_sync, codes_str)
            if cached:
                cache_service.set_market_data(cache_key, cached)
        
        return cached if cached else []

    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        loop = asyncio.get_running_loop()
        
        async def fetch_one(c):
            est = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_direct_sync, c)
            hist = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync, c)
            return c, est, hist

        results_data = await asyncio.gather(*[fetch_one(c) for c in codes])
        
        calc_needed = [] 
        phase = AkshareService.get_time_phase()
        today_str = (datetime.utcnow() + timedelta(hours=8)).strftime('%Y-%m-%d')
        results_map = {} 

        for code, est, hist in results_data:
            res = est 
            def safe_float(v, default=0.0):
                try: return float(v)
                except: return default

            last_nav = 0.0
            last_date = ""
            if res.get('dwjz') and safe_float(res['dwjz']) > 0:
                last_nav = safe_float(res['dwjz'])
                last_date = res.get('jzrq', '')
            
            if (last_nav <= 0 or not last_date) and not hist.empty:
                latest = hist.iloc[-1]
                last_nav = float(latest['单位净值'])
                last_date = str(latest['净值日期'])
                res['dwjz'] = str(last_nav)
                res['jzrq'] = last_date
            
            res['_last_nav'] = last_nav
            gsz = safe_float(res.get('gsz'))
            gszzl = safe_float(res.get('gszzl'))
            source = res.get('source', 'none')
            
            need_manual = False
            if source == 'official_realtime':
                if gsz > 0: pass
                elif gszzl != 0 and last_nav > 0:
                     new_gsz = last_nav * (1 + gszzl / 100.0)
                     res['gsz'] = "{:.4f}".format(new_gsz)
                else:
                    if phase in ['MARKET', 'PRE_MARKET', 'LUNCH_BREAK']: need_manual = True
                    elif phase == 'POST_MARKET' and res.get('jzrq') != today_str: need_manual = True
            else:
                need_manual = True
            
            if need_manual: calc_needed.append(code)
            results_map[code] = res

        if calc_needed:
            codes_to_fetch_h = [c for c in calc_needed if not cache_service.get_holdings(c)]
            if codes_to_fetch_h:
                 h_tasks = [run_in_threadpool(AkshareService.fetch_holdings_sync, c) for c in codes_to_fetch_h]
                 fetched_h = await asyncio.gather(*h_tasks)
                 for i, c in enumerate(codes_to_fetch_h): cache_service.set_holdings(c, fetched_h[i])
            
            all_stocks = set()
            fund_holdings = {}
            for c in calc_needed:
                h = cache_service.get_holdings(c) or []
                fund_holdings[c] = h
                for stock in h: all_stocks.add(stock['code'])
            
            # 使用新的通用行情接口
            secids = [AkshareService.get_secid(c) for c in all_stocks]
            stock_quotes = await run_in_threadpool(AkshareService.fetch_quotes_by_secids, secids)
            
            for c in calc_needed:
                data = results_map[c]
                holdings = fund_holdings.get(c, [])
                if not holdings: continue
                
                weighted_chg = 0
                total_w = 0
                for h in holdings:
                    w = h['percent']
                    # 尝试匹配行情
                    q = stock_quotes.get(AkshareService.get_secid(h['code']))
                    if not q: q = stock_quotes.get(h['code'])
                    
                    if q and q['price'] > 0:
                        weighted_chg += (q['change'] * w)
                        total_w += w
                
                est_chg = 0
                if total_w > 0: est_chg = (weighted_chg / total_w) * 0.95 
                
                last_n = data['_last_nav']
                if last_n > 0:
                    est_val = last_n * (1 + est_chg / 100.0)
                    data['gsz'] = "{:.4f}".format(est_val)
                    data['gszzl'] = "{:.2f}".format(est_chg)
                    data['source'] = 'holdings_calc_batch'

        return [results_map[c] for c in codes]

    @staticmethod
    async def analyze_content(prompt: str):
        if not GEMINI_API_KEY: raise HTTPException(status_code=500, detail="Server Gemini Key not configured")
        try:
            model = genai.GenerativeModel("gemini-1.5-flash") 
            response = await run_in_threadpool(model.generate_content, prompt)
            return {"text": response.text}
        except Exception as e: raise HTTPException(status_code=500, detail=str(e))

# --- FastAPI App ---

app = FastAPI(title="SmartFund API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
router = APIRouter(prefix="/api")

@router.get("/status")
def status(): return { "phase": AkshareService.get_time_phase(), "ts": datetime.now().timestamp(), "backend": "universal_quotes_v1" }

@router.get("/search")
async def search(key: str = Query(..., min_length=1)): return await FundController.get_search_results(key)

@router.get("/market")
async def market(codes: Optional[str] = Query(None)): return await FundController.get_market_status(codes)

@router.get("/estimate/{code}")
async def estimate_one(code: str):
    res = await FundController.batch_estimate([code])
    return res[0] if res else {}

@router.post("/estimate/batch")
async def estimate_batch(payload: dict = Body(...)): return await FundController.batch_estimate(payload.get('codes', []))

@router.get("/fund/{code}")
async def detail(code: str): return await FundController.get_fund_detail(code)

@router.get("/history/{code}")
async def history(code: str):
    df = await run_in_threadpool(AkshareService.fetch_fund_history_sync, code)
    if df.empty: return []
    return [{"date": str(r['净值日期']), "value": float(r['单位净值'])} for _, r in df.tail(365).iterrows()]

@router.post("/analyze")
async def analyze(payload: dict = Body(...)): return await FundController.analyze_content(payload.get("prompt", ""))

app.include_router(router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
