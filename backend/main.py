
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
]

class GlobalSession:
    _session = None
    @classmethod
    def get(cls):
        if cls._session is None:
            cls._session = requests.Session()
        return cls._session

class CacheService:
    def __init__(self):
        self._estimate_cache = {}
        self._funds_list_cache = []
        self._funds_list_time = None
        self._holdings_cache = {}

    def get_estimate(self, code: str):
        entry = self._estimate_cache.get(code)
        if entry and time_module.time() < entry['expire']: return entry['data']
        return None

    def set_estimate(self, code: str, data: dict, ttl: int = 60):
        self._estimate_cache[code] = {'data': data, 'expire': time_module.time() + ttl}

    def get_holdings(self, code: str):
        entry = self._holdings_cache.get(code)
        if entry and (datetime.now() - entry['time']).total_seconds() < 86400: return entry['data']
        return None

    def set_holdings(self, code: str, data: list):
        self._holdings_cache[code] = {"data": data, "time": datetime.now()}

cache_service = CacheService()

class AkshareService:
    @staticmethod
    def get_headers():
        return {"User-Agent": random.choice(USER_AGENTS), "Referer": "http://fund.eastmoney.com/"}

    @staticmethod
    def get_time_phase():
        now = datetime.utcnow() + timedelta(hours=8)
        if now.weekday() >= 5: return 'WEEKEND'
        t = now.time()
        if t < time(9, 30): return 'PRE_MARKET'
        elif t >= time(11, 30) and t < time(13, 0): return 'LUNCH_BREAK'
        elif t <= time(15, 0): return 'MARKET'
        else: return 'POST_MARKET'

    @staticmethod
    def fetch_fund_history_sync(code: str) -> pd.DataFrame:
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not df.empty:
                df['净值日期'] = df['净值日期'].astype(str)
                df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce')
                return df
        except: pass
        return pd.DataFrame()

    @staticmethod
    def fetch_realtime_estimate_sync(code: str):
        cached = cache_service.get_estimate(code)
        if cached: return cached
        data = { "gsz": "0", "gszzl": "0", "dwjz": "0", "jzrq": "", "name": "", "source": "official" }
        try:
            url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={int(time_module.time())}"
            resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=2.0)
            match = re.search(r'jsonpgz\((.*?)\);', resp.text)
            if match:
                fetched = json.loads(match.group(1))
                data.update(fetched)
                cache_service.set_estimate(code, data)
        except: pass
        return data

    @staticmethod
    def fetch_holdings_sync(code: str) -> List[Dict]:
        try:
            df = ak.fund_portfolio_hold_em(symbol=code, date=datetime.now().year)
            if df.empty: return []
            df['占净值比例'] = pd.to_numeric(df['占净值比例'], errors='coerce').fillna(0)
            return [{"code": str(r['股票代码']), "name": str(r['股票名称']), "percent": float(r['占净值比例'])} 
                    for _, r in df.sort_values(by='占净值比例', ascending=False).head(10).iterrows()]
        except: return []

    @staticmethod
    def fetch_stock_quotes_sync(codes: List[str]) -> Dict[str, Dict[str, float]]:
        if not codes: return {}
        quotes = {}
        unique = list(set(codes))
        for i in range(0, len(unique), 40):
            batch = unique[i:i+40]
            secids = []
            for c in batch:
                prefix = "1." if c.startswith('6') or c.startswith('5') else "0."
                secids.append(f"{prefix}{c}")
            url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12&secids={','.join(secids)}"
            try:
                resp = GlobalSession.get().get(url, timeout=3.0)
                data = resp.json()
                if data and 'data' in data and 'diff' in data['data']:
                    for item in data['data']['diff']:
                        quotes[str(item['f12'])] = {
                            "price": float(item['f2']) if item['f2'] != '-' else 0.0,
                            "change": float(item['f3']) if item['f3'] != '-' else 0.0
                        }
            except: pass
        return quotes

class FundController:
    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        loop = asyncio.get_running_loop()
        
        async def fetch_one(c):
            official = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_sync, c)
            history = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync, c)
            return c, official, history

        base_results = await asyncio.gather(*[fetch_one(c) for c in codes])
        results_map = {}
        calc_needed = []
        phase = AkshareService.get_time_phase()

        for code, official, history in base_results:
            res = { "fundcode": code, **official }
            last_nav = 1.0
            if not history.empty:
                latest = history.iloc[-1]
                last_nav = float(latest['单位净值'])
                res['dwjz'] = str(latest['单位净值'])
                res['jzrq'] = str(latest['净值日期'])
            elif float(res.get('dwjz', 0)) > 0:
                last_nav = float(res['dwjz'])
            res['_last_nav'] = last_nav
            
            # --- 优化：识别不适合穿透的基金 ---
            name = res.get('name', '')
            # 债券、黄金、ETF、货币、联接(通常看对应ETF) 
            is_special = any(kw in name for kw in ['债', '金', 'ETF', '货币', '联接'])
            
            # 如果是特殊基金且官方有估值，直接信任
            if is_special and float(res.get('gsz', 0)) > 0 and float(res.get('gsz',0)) != last_nav:
                res['source'] = 'official_special'
            elif phase in ['MARKET', 'POST_MARKET']:
                # 如果官方估值失效（等于昨日或为0），且不是特殊基金，才尝试穿透
                if not is_special:
                    calc_needed.append(code)
                else:
                    # 如果是ETF但没估值，尝试获取该代码本身的实时行情(场内)
                    quotes = await loop.run_in_executor(None, AkshareService.fetch_stock_quotes_sync, [code])
                    if code in quotes:
                        q = quotes[code]
                        res['gszzl'] = str(q['change'])
                        res['gsz'] = str(last_nav * (1 + q['change']/100))
                        res['source'] = 'market_quote'
            
            results_map[code] = res

        if calc_needed:
            all_stocks = []
            fund_holdings_map = {}
            for c in calc_needed:
                h = cache_service.get_holdings(c)
                if not h: h = await loop.run_in_executor(None, AkshareService.fetch_holdings_sync, c)
                cache_service.set_holdings(c, h)
                fund_holdings_map[c] = h
                all_stocks.extend([x['code'] for x in h])
            
            quotes = await loop.run_in_executor(None, AkshareService.fetch_stock_quotes_sync, all_stocks)
            for c in calc_needed:
                data = results_map[c]
                holdings = fund_holdings_map.get(c, [])
                if not holdings: continue
                weighted_change = sum(q['change'] * h['percent'] for h in holdings if (q := quotes.get(h['code'])))
                total_weight = sum(h['percent'] for h in holdings if h['code'] in quotes)
                if total_weight > 0:
                    est_change = (weighted_change / total_weight) * 0.98
                    data['gsz'] = "{:.4f}".format(data['_last_nav'] * (1 + est_change / 100))
                    data['gszzl'] = "{:.4f}".format(est_change)
                    data['source'] = "holdings_calc_batch"
        return [results_map[c] for c in codes]

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
router = APIRouter(prefix="/api")

@router.get("/search")
async def search(key: str): return await FundController.get_search_results(key)

@router.get("/market")
async def market(codes: str = Query(None)):
    target_codes = codes.split(',') if codes else ["1.000001", "0.399001", "0.399006"]
    secids = [f"1.{c}" if c.startswith(('6','5','1')) else f"0.{c}" for c in target_codes]
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f14&secids={','.join(secids)}"
    try:
        resp = requests.get(url, timeout=3)
        data = resp.json()
        return [{"name": i['f14'], "code": i['f12'], "changePercent": i['f3'], "value": i['f2']} for i in data['data']['diff']]
    except: return []

@router.post("/estimate/batch")
async def estimate_batch(payload: dict = Body(...)): return await FundController.batch_estimate(payload.get('codes', []))

@router.get("/fund/{code}")
async def detail(code: str): return await FundController.get_fund_detail(code)

@router.get("/history/{code}")
async def history(code: str):
    df = await run_in_threadpool(AkshareService.fetch_fund_history_sync, code)
    return [{"date": str(r['净值日期']), "value": float(r['单位净值'])} for _, r in df.tail(100).iterrows()]

app.include_router(router)
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
