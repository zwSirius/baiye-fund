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
from functools import lru_cache

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
            adapter = requests.adapters.HTTPAdapter(pool_connections=50, pool_maxsize=100, max_retries=3)
            cls._session.mount('http://', adapter)
            cls._session.mount('https://', adapter)
        return cls._session

class CacheService:
    """内存缓存服务"""
    def __init__(self):
        self._cache = {}

    def get(self, key: str, ttl: int = 60):
        entry = self._cache.get(key)
        if entry and (time_module.time() - entry['time'] < ttl):
            return entry['data']
        return None

    def set(self, key: str, data: any):
        self._cache[key] = {"data": data, "time": time_module.time()}

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
        """智能生成 Eastmoney SecID"""
        code = str(code).strip()
        if '.' in code: return code # 已经带市场前缀
        
        # 常见指数/ETF处理
        if code in ['000001', '000300', '000688']: return f"1.{code}" # 上证
        if code in ['399001', '399006']: return f"0.{code}" # 深证
        
        # 港股
        if len(code) == 5 and code.isdigit(): return f"116.{code}"
        
        # A股逻辑
        if len(code) == 6 and code.isdigit():
            if code.startswith(('6', '9', '5', '11')): return f"1.{code}"
            return f"0.{code}"
            
        return f"0.{code}"

    @staticmethod
    def fetch_quotes_by_secids(secids: List[str]) -> Dict[str, Dict]:
        """批量获取 SecID 的行情"""
        if not secids: return {}
        
        quotes = {}
        batch_size = 30
        unique_secids = list(set(secids))
        
        for i in range(0, len(unique_secids), batch_size):
            batch = unique_secids[i:i+batch_size]
            url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f4,f12,f13,f14&secids={','.join(batch)}"
            
            try:
                headers = AkshareService.get_headers()
                resp = GlobalSession.get().get(url, headers=headers, timeout=4.0)
                data = resp.json()
                
                if data and 'data' in data and data['data']:
                    diff_data = data['data'].get('diff', [])
                    items = diff_data if isinstance(diff_data, list) else diff_data.values()

                    for item in items:
                        code_val = str(item['f12'])
                        market_val = str(item.get('f13', ''))
                        price = float(item['f2']) if item['f2'] != '-' else 0.0
                        change_p = float(item['f3']) if item['f3'] != '-' else 0.0
                        name = item['f14']
                        
                        full_secid = f"{market_val}.{code_val}"
                        quote_data = {
                            "price": price,
                            "change": change_p,
                            "name": name,
                            "code": code_val
                        }
                        
                        quotes[full_secid] = quote_data
                        # 同时以纯代码作为 Key 存储，方便查找
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
        except: return []

    @staticmethod
    def fetch_realtime_estimate_direct_sync(code: str):
        data = { "fundcode": code, "name": "", "gsz": "0", "gszzl": "0", "dwjz": "0", "jzrq": "", "source": "none", "gztime": "" }
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
                            if 'gztime' not in data and 'time' in data:
                                data['gztime'] = data['time']
                    except: pass
        except: pass 
        return data

    @staticmethod
    @lru_cache(maxsize=128)
    def fetch_fund_history_sync_cached(code: str, day_str: str) -> pd.DataFrame:
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
        # 默认指数
        default_map = {
            "上证指数": "1.000001", "深证成指": "0.399001", "创业板指": "0.399006", 
            "科创50": "1.000688", "沪深300": "1.000300", "恒生指数": "100.HSI",
            "纳斯达克": "100.NDX", "标普500": "100.SPX"
        }
        
        target_codes = codes_str.split(',') if codes_str else list(default_map.values())
        secids = [AkshareService.get_secid(c) for c in target_codes]
        quotes = AkshareService.fetch_quotes_by_secids(secids)
        
        result = []
        for requested_code in target_codes:
            secid = AkshareService.get_secid(requested_code)
            data = quotes.get(secid) or quotes.get(requested_code) or quotes.get(secid.split('.')[-1])
            
            if data:
                result.append({
                    "name": data['name'], 
                    "code": requested_code,
                    "changePercent": data['change'], 
                    "value": data['price'],
                    "score": int(max(0, min(100, 50 + data['change'] * 10))),
                })
        return result

    @staticmethod
    def fetch_sector_rankings_sync():
        try:
            # 获取行业板块实时行情
            df = ak.stock_board_industry_name_em()
            if df.empty: return {"top": [], "bottom": []}
            
            # 必须字段: 板块名称, 最新价, 涨跌幅, 领涨股票
            df = df[['板块名称', '最新价', '涨跌幅', '领涨股票']]
            df = df.sort_values(by='涨跌幅', ascending=False)
            
            top3 = []
            for _, r in df.head(3).iterrows():
                top3.append({
                    "name": r['板块名称'],
                    "changePercent": float(r['涨跌幅']),
                    "leadingStock": r['领涨股票']
                })
                
            bottom3 = []
            for _, r in df.tail(3).iterrows():
                bottom3.append({
                    "name": r['板块名称'],
                    "changePercent": float(r['涨跌幅']),
                    "leadingStock": r['领涨股票']
                })
                
            return {"top": top3, "bottom": bottom3}
        except Exception as e:
            logger.error(f"Sector rank error: {e}")
            return {"top": [], "bottom": []}

    @staticmethod
    def fetch_fund_rankings_sync():
        try:
            # 获取开放式基金实时行情，按日增长率排序
            # 注意：这个接口数据量较大，必须缓存
            df = ak.fund_open_fund_rank_em(symbol="全部") 
            if df.empty: return {"gainers": [], "losers": []}
            
            # 字段: 基金代码, 基金简称, 日增长率, 单位净值, 累计净值
            df['日增长率'] = pd.to_numeric(df['日增长率'], errors='coerce').fillna(0)
            df = df.sort_values(by='日增长率', ascending=False)
            
            def to_dict(rows):
                res = []
                for _, r in rows.iterrows():
                    res.append({
                        "code": str(r['基金代码']),
                        "name": str(r['基金简称']),
                        "changePercent": float(r['日增长率']),
                        "nav": float(r['单位净值']) if '单位净值' in r else 0
                    })
                return res

            return {
                "gainers": to_dict(df.head(20)),
                "losers": to_dict(df.tail(20).iloc[::-1]) # 倒序，跌幅最大的排前面
            }
        except Exception as e:
            logger.error(f"Fund rank error: {e}")
            return {"gainers": [], "losers": []}


# --- 业务逻辑 ---

class FundController:
    
    @staticmethod
    async def get_search_results(key: str):
        cached = cache_service.get("funds_list", 86400)
        if not cached:
            cached = await run_in_threadpool(AkshareService.fetch_fund_list_sync)
            if cached: cache_service.set("funds_list", cached)
        
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
        # 并行获取
        holdings_task = run_in_threadpool(AkshareService.fetch_holdings_sync, code)
        basic_task = run_in_threadpool(AkshareService.fetch_fund_basic_info_sync, code)
        
        holdings, basic = await asyncio.gather(holdings_task, basic_task)
        
        # 获取持仓股票的实时行情
        if holdings:
            stock_codes = [h['code'] for h in holdings]
            secids = [AkshareService.get_secid(c) for c in stock_codes]
            quotes = await run_in_threadpool(AkshareService.fetch_quotes_by_secids, secids)
            
            for h in holdings: 
                # 尝试通过 SecID 匹配，或者直接代码匹配
                secid = AkshareService.get_secid(h['code'])
                q = quotes.get(secid) or quotes.get(h['code'])
                
                if q:
                    h['changePercent'] = q['change']
                    h['currentPrice'] = q['price']
                    if q['name']: h['name'] = q['name']
                else:
                    h['changePercent'] = 0
                    h['currentPrice'] = 0

        return {
            "code": code, 
            "manager": basic.get('基金经理', '暂无'), 
            "holdings": holdings,
            "fund_size": basic.get('最新规模', '--'),
            "start_date": basic.get('成立时间', '--'),
            "type": basic.get('基金类型', '混合型'), # 支持显示基金类型
        }

    @staticmethod
    async def get_market_overview(codes_str: Optional[str] = None):
        # 指数
        cache_key_idx = f"market_idx_{codes_str or 'def'}"
        indices = cache_service.get(cache_key_idx, 30) # 30s cache
        if not indices:
            indices = await run_in_threadpool(AkshareService.fetch_market_indices_sync, codes_str)
            cache_service.set(cache_key_idx, indices)
            
        # 板块 (Top/Bottom 3)
        sectors = cache_service.get("market_sectors", 300) # 5min cache
        if not sectors:
            sectors = await run_in_threadpool(AkshareService.fetch_sector_rankings_sync)
            cache_service.set("market_sectors", sectors)
            
        # 基金榜单 (Top/Bottom 20)
        fund_ranks = cache_service.get("fund_ranks", 600) # 10min cache
        if not fund_ranks:
            fund_ranks = await run_in_threadpool(AkshareService.fetch_fund_rankings_sync)
            cache_service.set("fund_ranks", fund_ranks)

        return {
            "indices": indices or [],
            "sectors": sectors or {"top": [], "bottom": []},
            "fundRankings": fund_ranks or {"gainers": [], "losers": []}
        }

    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        loop = asyncio.get_running_loop()
        
        today_str = (datetime.utcnow() + timedelta(hours=8)).strftime('%Y-%m-%d')
        today_cache_key = today_str

        async def fetch_one(c):
            est = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_direct_sync, c)
            hist = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync_cached, c, today_cache_key)
            return c, est, hist

        results_data = await asyncio.gather(*[fetch_one(c) for c in codes])
        
        calc_needed = [] 
        phase = AkshareService.get_time_phase()
        results_map = {} 

        for code, est, hist in results_data:
            res = est 
            def safe_float(v, default=0.0):
                try: return float(v)
                except: return default

            # 获取历史最新的净值
            hist_last_nav = 0.0
            hist_last_date = ""
            if not hist.empty:
                latest = hist.iloc[-1]
                hist_last_nav = float(latest['单位净值'])
                hist_last_date = str(latest['净值日期'])

            # API 返回的 DWJZ (单位净值)
            api_dwjz = safe_float(res.get('dwjz'))
            api_jzrq = res.get('jzrq', '')

            # 核心逻辑修复 5: 真实净值判断
            # 如果 API 返回的净值日期是今天，或者比历史数据的日期更新，说明官方净值已出
            # 特别是在 10:00 PM 以后，API 可能返回了今日的净值
            is_official_updated = False
            
            if api_jzrq == today_str and api_dwjz > 0:
                is_official_updated = True
            elif api_jzrq > hist_last_date and api_dwjz > 0:
                is_official_updated = True
            
            # 基础赋值
            last_nav = hist_last_nav if hist_last_nav > 0 else api_dwjz
            last_date = hist_last_date if hist_last_date > "" else api_jzrq

            # 如果官方净值已更新，强制覆盖估值
            if is_official_updated:
                res['gsz'] = str(api_dwjz)
                # 计算实际涨幅: (今日净值 - 昨日净值) / 昨日净值
                # 注意：这里的 last_nav 可能是前天的，如果 api_jzrq > hist_last_date
                if hist_last_nav > 0:
                     change = ((api_dwjz - hist_last_nav) / hist_last_nav) * 100
                     res['gszzl'] = "{:.2f}".format(change)
                else:
                     res['gszzl'] = "0.00"
                
                res['dwjz'] = str(api_dwjz) # 确保返回最新
                res['jzrq'] = api_jzrq
                res['source'] = 'official_final'
                res['gztime'] = "已更新"
            else:
                # 常规盘中/盘前逻辑
                res['_last_nav'] = last_nav # 暂存用于计算
                
                # 如果 API 估值无效，标记需要手动计算
                gsz = safe_float(res.get('gsz'))
                if gsz <= 0 and phase != 'PRE_MARKET': # 盘前允许为0
                    calc_needed.append(code)

            results_map[code] = res

        # ... (后续的手动估值计算逻辑保持不变，依赖 fetch_quotes_by_secids) ...
        # 为节省篇幅，这里复用原有的重仓股估值逻辑，但确保使用新的 fetch_quotes
        
        if calc_needed:
            codes_to_fetch_h = [c for c in calc_needed if not cache_service.get(f"holdings_{c}", 3600)]
            if codes_to_fetch_h:
                 h_tasks = [run_in_threadpool(AkshareService.fetch_holdings_sync, c) for c in codes_to_fetch_h]
                 fetched_h = await asyncio.gather(*h_tasks)
                 for i, c in enumerate(codes_to_fetch_h): cache_service.set(f"holdings_{c}", fetched_h[i])
            
            all_stocks = set()
            fund_holdings = {}
            for c in calc_needed:
                h = cache_service.get(f"holdings_{c}", 3600) or []
                fund_holdings[c] = h
                for stock in h: all_stocks.add(stock['code'])
            
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
                    q = stock_quotes.get(AkshareService.get_secid(h['code'])) or stock_quotes.get(h['code'])
                    
                    if q:
                        weighted_chg += (q['change'] * w)
                        total_w += w
                
                est_chg = 0
                if total_w > 0: est_chg = (weighted_chg / total_w) * 0.95 # 0.95 修正系数
                
                last_n = data.get('_last_nav', 0)
                if last_n > 0:
                    est_val = last_n * (1 + est_chg / 100.0)
                    data['gsz'] = "{:.4f}".format(est_val)
                    data['gszzl'] = "{:.2f}".format(est_chg)
                    data['source'] = 'holdings_calc_batch'
                    now = datetime.now()
                    data['gztime'] = f"{now.hour:02}:{now.minute:02}"

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
def status(): return { "phase": AkshareService.get_time_phase(), "ts": datetime.now().timestamp(), "version": "2.0" }

@router.get("/search")
async def search(key: str = Query(..., min_length=1)): return await FundController.get_search_results(key)

@router.get("/market/overview")
async def market_overview(codes: Optional[str] = Query(None)): return await FundController.get_market_overview(codes)

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
    today_cache_key = datetime.now().strftime('%Y-%m-%d')
    df = await run_in_threadpool(AkshareService.fetch_fund_history_sync_cached, code, today_cache_key)
    if df.empty: return []
    return [{"date": str(r['净值日期']), "value": float(r['单位净值'])} for _, r in df.tail(365).iterrows()]

@router.post("/analyze")
async def analyze(payload: dict = Body(...)): return await FundController.analyze_content(payload.get("prompt", ""))

app.include_router(router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
