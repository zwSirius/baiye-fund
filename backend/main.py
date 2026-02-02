
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

# --- Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SmartFund")

# Configure Gemini API
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# --- Constants ---
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

# --- LV2: Proxy Map (场内映射表) ---
# 逻辑：如果基金名称包含 Key，则使用 Value 对应的场内 ETF 涨跌幅进行估值
PROXY_MAP = {
    # === 贵金属 & 商品 ===
    "上海金": "518600", # 上海金ETF
    "黄金": "518880",   # 黄金ETF
    "豆粕": "159985",
    "有色": "512400",
    "能源": "159930",
    
    # === 跨境 & QDII (优先级极高) ===
    "纳斯达克": "513100", "纳指": "513100", 
    "标普500": "513500", "标普": "513500",
    "恒生科技": "513130", "港股通科技": "513130",
    "恒生互联网": "513330", 
    "中概互联": "513050", "海外互联": "513050",
    "恒生医疗": "513060",
    "日经": "513520",
    "东南亚": "513910",
    "沙特": "520830",

    # === 宽基指数 ===
    "沪深300": "510300", 
    "中证500": "510500", 
    "中证1000": "512100", 
    "中证2000": "561370",
    "创业板50": "159949", "创业板": "159915", 
    "科创50": "588000", "科创100": "588190",
    "上证50": "510050", "A50": "560050",
    "科创创业": "588400", "双创": "588400",

    # === 热门行业 ===
    "白酒": "512690", "食品饮料": "512690",
    "半导体": "512480", "芯片": "512480", "集成电路": "512480",
    "医疗": "512170", "医药": "512010", "生物": "512290", "中药": "562390",
    "光伏": "515790", 
    "新能源车": "515030", "新能车": "515030", "电池": "159755",
    "军工": "512660", "国防": "512660",
    "证券": "512880", "券商": "512880", "全指金融": "512880", 
    "银行": "512800",
    "人工智能": "515070", "AI": "515070", 
    "计算机": "512720", "软件": "515290", "信创": "562030",
    "游戏": "516010", "动漫": "516010", "传媒": "512980", 
    "红利": "515080", "高股息": "515080", 
    "煤炭": "515220", 
    "地产": "512200",
    "酒": "512690",

    # === 债券 (作为风向标) ===
    "可转债": "511380", 
    "短债": "511260", 
    "国债": "511010", 
    "政金债": "511520"
}

# --- Core Services ---

class GlobalSession:
    _session = None
    @classmethod
    def get(cls):
        if cls._session is None:
            cls._session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20)
            cls._session.mount('http://', adapter)
            cls._session.mount('https://', adapter)
        return cls._session

class CacheService:
    def __init__(self):
        self._estimate_cache = {}
        self._holdings_cache = {}
        self._funds_list_cache = []
        self._funds_list_time = None

    def get_estimate(self, code: str):
        entry = self._estimate_cache.get(code)
        if entry and time_module.time() < entry['expire']:
            return entry['data']
        return None

    def set_estimate(self, code: str, data: dict, ttl: int = 60):
        if data:
            self._estimate_cache[code] = {'data': data, 'expire': time_module.time() + ttl}

    def get_holdings(self, code: str):
        entry = self._holdings_cache.get(code)
        if entry and (datetime.now() - entry['time']).total_seconds() < 86400 * 3: # 延长持仓缓存时间
            return entry['data']
        return None

    def set_holdings(self, code: str, data: list):
        self._holdings_cache[code] = {"data": data, "time": datetime.now()}

    def get_funds_list(self):
        if self._funds_list_cache and self._funds_list_time and \
           (datetime.now() - self._funds_list_time).total_seconds() < 86400:
            return self._funds_list_cache
        return None
        
    def set_funds_list(self, data):
        self._funds_list_cache = data
        self._funds_list_time = datetime.now()

cache_service = CacheService()

class AkshareService:
    @staticmethod
    def get_headers():
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Referer": "http://fund.eastmoney.com/",
            "Connection": "keep-alive"
        }

    @staticmethod
    def get_time_phase():
        now = datetime.utcnow() + timedelta(hours=8)
        if now.weekday() >= 5: return 'CLOSED'
        t = now.time()
        if t < time(9, 25): return 'PRE_MARKET'
        elif t >= time(11, 30) and t < time(13, 0): return 'LUNCH_BREAK'
        elif t <= time(15, 0): return 'MARKET'
        else: return 'POST_MARKET'

    @staticmethod
    def fetch_realtime_estimate_sync(code: str):
        """LV1: Fetch Official Estimate from fundgz"""
        cached = cache_service.get_estimate(code)
        if cached: return cached

        data = { "gsz": "0", "gszzl": "0", "dwjz": "0", "jzrq": "", "name": "", "source": "LV4_NONE" }
        try:
            ts = int(time_module.time() * 1000)
            url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={ts}"
            resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=2.0)
            match = re.search(r'jsonpgz\((.*?)\);', resp.text)
            if match:
                fetched = json.loads(match.group(1))
                if fetched:
                    data.update(fetched)
                    data['source'] = 'LV1_OFFICIAL'
                    cache_service.set_estimate(code, data)
        except: pass
        return data

    @staticmethod
    def fetch_quotes_sync(codes: List[str]) -> Dict[str, float]:
        """Fetch quotes for Stocks AND ETFs"""
        if not codes: return {}
        unique = list(set(codes))
        quotes = {}
        batch_size = 40
        
        for i in range(0, len(unique), batch_size):
            batch = unique[i:i+batch_size]
            secids = []
            for c in batch:
                # 关键：正确处理 ETF 代码前缀
                if c.startswith('51') or c.startswith('56') or c.startswith('58') or c.startswith('6'): 
                    secids.append(f"1.{c}") # SH
                elif c.startswith('15') or c.startswith('30') or c.startswith('0'): 
                    secids.append(f"0.{c}") # SZ
                elif c.startswith('11') or c.startswith('12'):
                     secids.append(f"1.{c}") if c.startswith('11') else secids.append(f"0.{c}")
                else: 
                    secids.append(f"0.{c}") # Default fallthrough
            
            url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12&secids={','.join(secids)}"
            try:
                resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=3.0)
                data = resp.json()
                if data and 'data' in data and 'diff' in data['data']:
                    for item in data['data']['diff']:
                        quotes[str(item['f12'])] = float(item['f3']) if item['f3'] != '-' else 0.0
            except: pass
        return quotes

class FundController:
    @staticmethod
    def search_funds_sync(key: str):
        # 1. Cache
        cached = cache_service.get_funds_list()
        
        # 2. Fetch Full List if empty
        if not cached:
            try:
                df = ak.fund_name_em()
                df = df.rename(columns={'基金代码': 'code', '基金简称': 'name', '基金类型': 'type', '拼音缩写': 'pinyin'})
                cached = df[['code', 'name', 'type', 'pinyin']].to_dict('records')
                for r in cached:
                    r['code'] = str(r['code'])
                    r['name'] = str(r['name'])
                    r['type'] = str(r['type'])
                    r['pinyin'] = str(r['pinyin']) if r['pinyin'] else ''
                cache_service.set_funds_list(cached)
            except: return []
        
        # 3. Search in Memory
        if cached:
            key = key.upper()
            res = []
            count = 0
            for f in cached:
                if key in f['code'] or key in f['name'] or key in f.get('pinyin', ''):
                    res.append(f)
                    count += 1
                    if count >= 30: break
            return res
        return []

    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        loop = asyncio.get_running_loop()
        phase = AkshareService.get_time_phase()

        async def fetch_base(c):
            official = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_sync, c)
            history = pd.DataFrame()
            try:
                # 仅当官方数据不佳时，我们可能需要历史净值来修正 lastNav，但为了性能这里设为可选
                # 这里为了保证 LV2/3 计算基础准确，还是拉取一次历史
                history = await loop.run_in_executor(None, lambda: ak.fund_open_fund_info_em(symbol=c, indicator="单位净值走势"))
            except: pass
            return c, official, history

        base_results = await asyncio.gather(*[fetch_base(c) for c in codes])
        
        results_map = {}
        lv2_candidates = [] # 待进行场内映射的
        lv3_candidates = [] # 待进行重仓穿透的

        for code, official, history in base_results:
            res = { "fundcode": code, **official }
            
            last_nav = 1.0
            if not history.empty:
                if '单位净值' in history.columns:
                     history['单位净值'] = pd.to_numeric(history['单位净值'], errors='coerce')
                     latest = history.iloc[-1]
                     last_nav = float(latest['单位净值'])
                     res['dwjz'] = str(latest['单位净值'])
                     if '净值日期' in history.columns: res['jzrq'] = str(latest['净值日期'])
            elif float(res.get('dwjz', 0)) > 0:
                 last_nav = float(res['dwjz'])
            
            res['_last_nav'] = last_nav

            # --- LV1: Official Check ---
            # 闭市或盘前直接用官方(通常是昨收)
            if phase in ['CLOSED', 'PRE_MARKET']:
                res['gsz'] = res['dwjz']
                res['gszzl'] = '0'
                res['source'] = 'LV1_OFFICIAL_CLOSE'
                results_map[code] = res
                continue

            # 盘中：如果官方有有效波动(非0)，采信官方
            gszzl = float(res.get('gszzl', '0'))
            if abs(gszzl) > 0.001:
                res['source'] = 'LV1_OFFICIAL'
                results_map[code] = res
                continue
            
            # 官方无效 (0 或未更新)，进入 LV2 检查
            lv2_candidates.append(code)
            results_map[code] = res

        # --- LV2: Smart Proxy (场内映射) ---
        # 逻辑：只要名字里匹配到 Proxy Map，就认为是 ETF 联接或 QDII，直接用 Proxy 估值，跳过 LV3
        if lv2_candidates:
            proxy_queries = {} # {fund_code: proxy_etf_code}
            
            for c in lv2_candidates:
                name = results_map[c].get('name', '')
                
                # Case A: 本身就是场内基金 (ETF/LOF)
                if c.startswith(('51', '159', '56', '58')):
                    proxy_queries[c] = c
                    continue
                
                # Case B: 场外联接/QDII 查表
                # 遍历 Map，找到最长匹配的 Key (例如 "纳斯达克" 优于 "纳")
                best_match_key = ""
                best_match_code = ""
                
                for key, p_code in PROXY_MAP.items():
                    if key in name:
                        if len(key) > len(best_match_key):
                            best_match_key = key
                            best_match_code = p_code
                
                if best_match_code:
                    proxy_queries[c] = best_match_code
            
            if proxy_queries:
                unique_proxies = list(set(proxy_queries.values()))
                p_quotes = await loop.run_in_executor(None, AkshareService.fetch_quotes_sync, unique_proxies)
                
                for c in lv2_candidates:
                    if c in proxy_queries:
                        p_code = proxy_queries[c]
                        if p_code in p_quotes:
                            change = p_quotes[p_code]
                            data = results_map[c]
                            data['gszzl'] = f"{change:.2f}"
                            data['gsz'] = str(data['_last_nav'] * (1 + change/100.0))
                            data['source'] = f"LV2_PROXY_{p_code}" # 标记源
                            # 关键：成功匹配了 LV2，从 LV2 列表移除，也不进入 LV3
                            lv2_candidates = [x for x in lv2_candidates if x != c]

        # --- LV3: Holdings Penetration (重仓股穿透) ---
        # 剩下的通常是：官方没数据，且不是 ETF 联接的主动权益基金
        lv3_candidates = lv2_candidates
        
        if lv3_candidates:
             # Fetch Holdings
             missing = [c for c in lv3_candidates if not cache_service.get_holdings(c)]
             if missing:
                 def fetch_holdings_task(c):
                     try:
                         y = datetime.now().year
                         df = ak.fund_portfolio_hold_em(symbol=c, date=y)
                         if df is None or df.empty: df = ak.fund_portfolio_hold_em(symbol=c, date=y-1)
                         if df is None or df.empty: return []
                         res = []
                         for _, row in df.head(10).iterrows():
                              res.append({"code": str(row['股票代码']), "percent": float(row['占净值比例'])})
                         return res
                     except: return []

                 h_results = await asyncio.gather(*[loop.run_in_executor(None, fetch_holdings_task, c) for c in missing])
                 for i, c in enumerate(missing):
                     cache_service.set_holdings(c, h_results[i])
            
             # Fetch Quotes for Stocks
             all_stocks = []
             fund_map = {}
             for c in lv3_candidates:
                 h = cache_service.get_holdings(c) or []
                 fund_map[c] = h
                 all_stocks.extend([x['code'] for x in h])
            
             if all_stocks:
                 s_quotes = await loop.run_in_executor(None, AkshareService.fetch_quotes_sync, all_stocks)
                 
                 for c in lv3_candidates:
                     h = fund_map.get(c, [])
                     if not h: continue
                     
                     w_change = 0
                     total_w = 0
                     for item in h:
                         pct = item['percent']
                         chg = s_quotes.get(item['code'], 0.0)
                         w_change += chg * pct
                         total_w += pct
                     
                     if total_w > 0:
                         # 0.95 修正系数，假设剩余仓位波动较小
                         est = (w_change / total_w) * 0.95 
                         data = results_map[c]
                         data['gszzl'] = f"{est:.2f}"
                         data['gsz'] = str(data['_last_nav'] * (1 + est/100.0))
                         data['source'] = 'LV3_HOLDINGS'

        return [results_map[c] for c in codes]

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
router = APIRouter(prefix="/api")

@router.get("/status")
def status():
    return {"phase": AkshareService.get_time_phase(), "ts": datetime.now().timestamp()}

@router.get("/search")
async def search(key: str = Query(..., min_length=1)):
    return await run_in_threadpool(FundController.search_funds_sync, key)

@router.post("/estimate/batch")
async def estimate_batch(payload: dict = Body(...)):
    return await FundController.batch_estimate(payload.get('codes', []))

@router.get("/fund/{code}")
async def detail(code: str):
    try:
        holdings = await run_in_threadpool(lambda: cache_service.get_holdings(code))
        if not holdings:
             # Just trigger fetch, controller will use cache next time or returns empty now
             pass
        return {"code": code, "holdings": holdings or []}
    except: return {}

@router.get("/history/{code}")
async def history(code: str):
    try:
        df = await run_in_threadpool(lambda: ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势"))
        if df.empty: return []
        if '净值日期' in df.columns: df['净值日期'] = df['净值日期'].astype(str)
        return [{"date": str(r['净值日期']), "value": float(r['单位净值'])} for _, r in df.tail(365).iterrows()]
    except: return []

@router.post("/analyze")
async def analyze(payload: dict = Body(...)):
    prompt = payload.get("prompt", "")
    if not prompt or not GEMINI_API_KEY:
        raise HTTPException(status_code=400, detail="Config Error")
    try:
        model = genai.GenerativeModel("gemini-3-flash-preview")
        res = await run_in_threadpool(model.generate_content, prompt)
        return {"text": res.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/market")
async def market(codes: str = Query(None)):
    target_codes = codes.split(',') if codes else ["1.000001", "0.399001"]
    def format_secid(c):
        if '.' in c: return c 
        if c.startswith(('6','5','1')): return f"1.{c}"
        return f"0.{c}"
    secids = [format_secid(c) for c in target_codes] 
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12,f14,f2&secids={','.join(secids)}"
    try:
        resp = await run_in_threadpool(lambda: requests.get(url, headers=AkshareService.get_headers(), timeout=3))
        data = resp.json()
        result = []
        if data and 'data' in data and 'diff' in data['data']:
            for item in data['data']['diff']:
                change = float(item['f3']) if item['f3'] != '-' else 0.0
                result.append({
                    "name": item['f14'], "code": str(item['f12']), 
                    "changePercent": change, "score": 50, "leadingStock": "--", "value": item['f2']
                })
        return result
    except: return []

app.include_router(router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
