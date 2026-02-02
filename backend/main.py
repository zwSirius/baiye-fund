
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
PROXY_MAP = {
    # 宽基
    "沪深300": "510300", "300联接": "510300",
    "中证500": "510500", "500联接": "510500",
    "中证1000": "512100", "1000联接": "512100",
    "创业板": "159915", "科创50": "588000", "上证50": "510050",
    "A50": "560050", "2000": "561370",
    # 行业
    "白酒": "512690", "消费": "512690", "食品": "512690",
    "半导体": "512480", "芯片": "512480",
    "医疗": "512170", "医药": "512010", "药": "512010",
    "新能源": "515030", "光伏": "515790", "电池": "159755",
    "军工": "512660", "国防": "512660",
    "证券": "512880", "全指金融": "512880", "银行": "512800",
    "人工智能": "515070", "AI": "515070", "计算机": "512720",
    "游戏": "516010", "传媒": "512980", "红利": "515080", "煤炭": "515220",
    # 大宗 & QDII
    "黄金": "518880", "金": "518880", 
    "纳斯达克": "513100", "纳指": "513100", "标普": "513500",
    "恒生科技": "513130", "港股通科技": "513130",
    "恒生互联网": "513330", "中概": "513050", "互联网": "513050",
    # 债基 (LV2 债基映射到国债/短融ETF作为风向标)
    "可转债": "511380", "转债": "511380",
    "短债": "511260", "中长债": "511260", "纯债": "511260", "信用债": "511260"
}

# --- Core Services ---

class GlobalSession:
    """Singleton session for HTTP requests"""
    _session = None

    @classmethod
    def get(cls):
        if cls._session is None:
            cls._session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20)
            cls._session.mount('http://', adapter)
            cls._session.mount('https://', adapter)
            # Add default headers to session
            cls._session.headers.update({
                "User-Agent": random.choice(USER_AGENTS),
                "Referer": "http://fund.eastmoney.com/",
                "Connection": "keep-alive"
            })
        return cls._session

class CacheService:
    """Simple in-memory cache"""
    def __init__(self):
        self._estimate_cache = {}
        self._funds_list_cache = []
        self._funds_list_time = None
        self._holdings_cache = {}

    def get_estimate(self, code: str):
        entry = self._estimate_cache.get(code)
        if entry and time_module.time() < entry['expire']:
            return entry['data']
        return None

    def set_estimate(self, code: str, data: dict, ttl: int = 60):
        # Only cache if valid data
        if data:
            self._estimate_cache[code] = {
                'data': data,
                'expire': time_module.time() + ttl
            }

    def get_holdings(self, code: str):
        entry = self._holdings_cache.get(code)
        if entry and (datetime.now() - entry['time']).total_seconds() < 86400:
            return entry['data']
        return None

    def set_holdings(self, code: str, data: list):
        self._holdings_cache[code] = {"data": data, "time": datetime.now()}

    async def get_funds_list(self):
        if not self._funds_list_cache or not self._funds_list_time or \
           (datetime.now() - self._funds_list_time).total_seconds() > 86400:
            return None
        return self._funds_list_cache

    def set_funds_list(self, data: list):
        self._funds_list_cache = data
        self._funds_list_time = datetime.now()

cache_service = CacheService()

class AkshareService:
    """Encapsulates Akshare and Data Fetching Logic"""
    
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
    def fetch_fund_history_sync(code: str) -> pd.DataFrame:
        try:
            # 使用 Akshare 官方接口获取历史净值
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not df.empty:
                if '净值日期' in df.columns: df['净值日期'] = df['净值日期'].astype(str)
                if '单位净值' in df.columns: df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce')
                return df
        except Exception as e:
            logger.warning(f"Akshare history error {code}: {e}")
        return pd.DataFrame()

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
        except Exception: pass
        return data

    @staticmethod
    def fetch_holdings_sync(code: str) -> List[Dict]:
        try:
            year = datetime.now().year
            all_dfs = []
            for y in [year, year - 1]:
                try:
                    df = ak.fund_portfolio_hold_em(symbol=code, date=y)
                    if not df.empty and '季度' in df.columns: all_dfs.append(df)
                except: continue
            
            if not all_dfs: return []
            combined = pd.concat(all_dfs)
            
            def parse_rank(q):
                try:
                    if '年报' in q: return int(re.search(r'(\d{4})', q).group(1)) * 100 + 4
                    return int(re.search(r'(\d{4})', q).group(1)) * 100 + int(re.search(r'(\d)季度', q).group(1))
                except: return 0

            combined['rank'] = combined['季度'].apply(parse_rank)
            combined['占净值比例'] = pd.to_numeric(combined['占净值比例'], errors='coerce').fillna(0)
            sorted_df = combined.sort_values(by=['rank', '占净值比例'], ascending=[False, False])
            
            if sorted_df.empty: return []
            latest_rank = sorted_df.iloc[0]['rank']
            return [
                {"code": str(r['股票代码']), "name": str(r['股票名称']), "percent": float(r['占净值比例'])}
                for _, r in sorted_df[sorted_df['rank'] == latest_rank].head(10).iterrows()
            ]
        except Exception as e:
            logger.error(f"Holdings error {code}: {e}")
            return []

    @staticmethod
    def fetch_quotes_sync(codes: List[str]) -> Dict[str, float]:
        """Fetch quotes for Stocks AND ETFs"""
        if not codes: return {}
        unique = list(set(codes))
        quotes = {}
        batch_size = 40 # Eastmoney batch size limit
        
        for i in range(0, len(unique), batch_size):
            batch = unique[i:i+batch_size]
            secids = []
            for c in batch:
                if c.startswith('6') or c.startswith('5') or c.startswith('11'): secids.append(f"1.{c}")
                elif c.startswith('0') or c.startswith('3'): secids.append(f"0.{c}")
                elif c.startswith('15') or c.startswith('12'): secids.append(f"0.{c}") # SZ ETF
                else: secids.append(f"0.{c}") # Fallback
            
            url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12&secids={','.join(secids)}"
            try:
                resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=3.0)
                data = resp.json()
                if data and 'data' in data and 'diff' in data['data']:
                    for item in data['data']['diff']:
                        quotes[str(item['f12'])] = float(item['f3']) if item['f3'] != '-' else 0.0
            except: pass
        return quotes

    @staticmethod
    def fetch_fund_list_sync():
        try:
            # Akshare 全量列表获取，可能较慢，建议只在启动或缓存过期时调用
            df = ak.fund_name_em()
            df = df.rename(columns={'基金代码': 'code', '基金简称': 'name', '基金类型': 'type', '拼音缩写': 'pinyin'})
            result = df[['code', 'name', 'type', 'pinyin']].to_dict('records')
            for r in result:
                r['code'] = str(r['code'])
                r['name'] = str(r['name'])
                r['type'] = str(r['type'])
                r['pinyin'] = str(r['pinyin'])
            return result
        except Exception as e:
            logger.error(f"Fetch fund list error: {e}")
            return []

# --- Business Logic Controller ---

class FundController:
    
    @staticmethod
    async def get_search_results(key: str):
        # 1. 尝试直接调用 Eastmoney 搜索 API (速度最快，恢复原始逻辑)
        url = f"http://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key={key}"
        try:
            resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=2.0)
            data = resp.json()
            results = []
            if 'Datas' in data:
                for item in data['Datas']:
                    if item['CATEGORY'] in ['基金', '混合型', '股票型', '债券型', '指数型', 'QDII', 'ETF', 'LOF']:
                        results.append({
                            "code": item['CODE'],
                            "name": item['NAME'],
                            "type": item['CATEGORY'],
                            "pinyin": ""
                        })
            return results
        except Exception:
            # 2. Fallback to cache if online search fails
            pass

        cached = await cache_service.get_funds_list()
        if not cached:
            # If really needed, fetch full list (slow)
            return []
        
        key = key.upper()
        res = []
        for f in cached:
            if key in f['code'] or key in f['name'] or key in f['pinyin']:
                res.append(f)
                if len(res) >= 20: break
        return res

    @staticmethod
    async def get_fund_detail(code: str):
        manager_task = run_in_threadpool(ak.fund_manager_em, symbol=code)
        
        cached_holdings = cache_service.get_holdings(code)
        if cached_holdings:
            holdings = cached_holdings
        else:
            holdings = await run_in_threadpool(AkshareService.fetch_holdings_sync, code)
            cache_service.set_holdings(code, holdings)

        manager_name = "暂无"
        try:
            m_df = await manager_task
            if not m_df.empty: manager_name = m_df.iloc[-1]['姓名']
        except: pass

        if holdings:
            quotes = await run_in_threadpool(AkshareService.fetch_quotes_sync, [h['code'] for h in holdings])
            for h in holdings: 
                h['changePercent'] = quotes.get(h['code'], 0.0)
                # Note: fetch_quotes_sync now only returns change%, not price, to save bandwidth for batch logic
                h['currentPrice'] = 0 

        return {"code": code, "manager": manager_name, "holdings": holdings}

    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        
        loop = asyncio.get_running_loop()
        phase = AkshareService.get_time_phase()
        
        # 1. Fetch Official Data (LV1) & History (Parallel)
        async def fetch_base(c):
            official = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_sync, c)
            history = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync, c)
            return c, official, history

        base_results = await asyncio.gather(*[fetch_base(c) for c in codes])
        
        results_map = {}
        lv2_candidates = [] # 需要尝试 Proxy 的
        lv3_candidates = [] # 需要尝试 Holdings 的

        for code, official, history in base_results:
            res = { "fundcode": code, **official }
            
            # 补全历史净值
            last_nav = 1.0
            if not history.empty:
                latest = history.iloc[-1]
                last_nav = float(latest['单位净值'])
                res['dwjz'] = str(latest['单位净值'])
                res['jzrq'] = str(latest['净值日期'])
            elif float(res.get('dwjz', 0)) > 0:
                last_nav = float(res['dwjz'])
            res['_last_nav'] = last_nav

            # --- LV1 Check ---
            # 如果是闭市状态，直接信任官方（可能是昨日收盘数据）
            if phase in ['CLOSED', 'PRE_MARKET']:
                res['source'] = 'LV1_OFFICIAL_CLOSE'
                res['gsz'] = res['dwjz']
                res['gszzl'] = '0'
                results_map[code] = res
                continue

            # 盘中：如果官方有非0波动，采信
            gszzl = float(res.get('gszzl', '0'))
            if abs(gszzl) > 0.001:
                res['source'] = 'LV1_OFFICIAL'
                results_map[code] = res
                continue
            
            # 如果官方是 0 (或未更新)，进入 LV2/LV3 候选
            lv2_candidates.append(code)
            results_map[code] = res

        # --- LV2: Smart Proxy ---
        if lv2_candidates:
            proxy_queries = {} # {fund_code: proxy_etf_code}
            
            for c in lv2_candidates:
                name = results_map[c].get('name', '')
                # 如果代码本身是 ETF/LOF
                if c.startswith(('51', '159', '56', '58')):
                    proxy_queries[c] = c
                    continue
                # 查表
                for key, p_code in PROXY_MAP.items():
                    if key in name:
                        proxy_queries[c] = p_code
                        break
            
            if proxy_queries:
                unique_proxies = list(set(proxy_queries.values()))
                # 批量获取 Proxy 行情
                proxy_quotes = await loop.run_in_executor(None, AkshareService.fetch_quotes_sync, unique_proxies)
                
                for c in lv2_candidates:
                    if c in proxy_queries:
                        p_code = proxy_queries[c]
                        if p_code in proxy_quotes:
                            change = proxy_quotes[p_code]
                            data = results_map[c]
                            data['gszzl'] = f"{change:.2f}"
                            data['gsz'] = str(data['_last_nav'] * (1 + change/100.0))
                            data['source'] = f"LV2_PROXY_{p_code}"
                            # 成功解决，移出候选列表，不再进行 LV3
                            lv2_candidates = [x for x in lv2_candidates if x != c]

        # --- LV3: Holdings Penetration ---
        # 剩下的就是：官方没数据，也没匹配到 Proxy 的 (通常是主动权益基金)
        lv3_candidates = lv2_candidates 
        
        if lv3_candidates:
            # 1. 确保有持仓数据
            codes_fetching_holdings = [c for c in lv3_candidates if not cache_service.get_holdings(c)]
            if codes_fetching_holdings:
                 h_tasks = [run_in_threadpool(AkshareService.fetch_holdings_sync, c) for c in codes_fetching_holdings]
                 fetched_h = await asyncio.gather(*h_tasks)
                 for i, c in enumerate(codes_fetching_holdings):
                     cache_service.set_holdings(c, fetched_h[i])
            
            # 2. 收集所有股票
            all_stocks = []
            fund_holdings_map = {}
            for c in lv3_candidates:
                h = cache_service.get_holdings(c) or []
                fund_holdings_map[c] = h
                all_stocks.extend([x['code'] for x in h])
            
            # 3. 批量行情
            if all_stocks:
                quotes = await loop.run_in_executor(None, AkshareService.fetch_quotes_sync, all_stocks)
                
                # 4. 计算
                for c in lv3_candidates:
                    data = results_map[c]
                    holdings = fund_holdings_map.get(c, [])
                    if not holdings: continue # LV4: Give up, keep last nav
                    
                    weighted_change = 0
                    total_weight = 0
                    for h in holdings:
                        w = h['percent']
                        change = quotes.get(h['code'], 0.0)
                        weighted_change += (change * w)
                        total_weight += w
                    
                    if total_weight > 0:
                        est_change = (weighted_change / total_weight) * 0.95 # 0.95 修正系数
                        data['gszzl'] = f"{est_change:.2f}"
                        data['gsz'] = str(data['_last_nav'] * (1 + est_change/100.0))
                        data['source'] = "LV3_HOLDINGS"

        return [results_map[c] for c in codes]

    @staticmethod
    async def analyze_content(prompt: str):
        if not GEMINI_API_KEY:
            raise HTTPException(status_code=500, detail="Server Gemini Key not configured")
        try:
            model = genai.GenerativeModel("gemini-3-flash-preview") 
            response = await run_in_threadpool(model.generate_content, prompt)
            return {"text": response.text}
        except Exception as e:
            logger.error(f"Gemini Error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

# --- FastAPI App ---

app = FastAPI(title="SmartFund API", description="Optimized Backend with LV1-LV4 Valuation")

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
    return {"phase": AkshareService.get_time_phase(), "ts": datetime.now().timestamp()}

@router.get("/search")
async def search(key: str = Query(..., min_length=1)):
    return await FundController.get_search_results(key)

@router.get("/market")
async def market(codes: str = Query(None)):
    target_codes = codes.split(',') if codes else ["1.000001", "0.399001"]
    
    def format_secid(c):
        if '.' in c: return c 
        if c.startswith('6') or c.startswith('1') or c.startswith('5'): return f"1.{c}"
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
                    "changePercent": change, "score": int(max(0, min(100, 50 + change * 10))), 
                    "leadingStock": "--", "value": item['f2']
                })
        return result
    except: return []

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
