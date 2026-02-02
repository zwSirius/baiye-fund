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

# --- 工具类 ---

class GlobalSession:
    """全局 HTTP 会话，复用连接池"""
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
    """
    内存缓存服务
    """
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CacheService, cls).__new__(cls)
            cls._instance._cache = {}
        return cls._instance

    def get(self, key: str, ttl: int = 60):
        entry = self._cache.get(key)
        if entry:
            # 0 ttl means infinite (or manual invalidation)
            if ttl == 0 or time_module.time() - entry['time'] < ttl:
                return entry['data']
            else:
                del self._cache[key]
        return None

    def set(self, key: str, data: any):
        self._cache[key] = {"data": data, "time": time_module.time()}
    
    def mget(self, keys: List[str], ttl: int = 60) -> Dict[str, Any]:
        result = {}
        for k in keys:
            val = self.get(k, ttl)
            if val is not None:
                result[k] = val
        return result

cache_service = CacheService()

class AkshareService:
    
    @staticmethod
    def get_headers(referer="https://quote.eastmoney.com/"):
        user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ]
        return {
            "User-Agent": random.choice(user_agents),
            "Referer": referer
        }

    @staticmethod
    def get_time_phase():
        """判断当前市场状态 (北京时间)"""
        now = datetime.utcnow() + timedelta(hours=8)
        if now.weekday() >= 5: return 'WEEKEND'
        t = now.time()
        if t < time(9, 15): return 'PRE_MARKET'
        elif t >= time(11, 30) and t < time(13, 0): return 'LUNCH_BREAK'
        elif t <= time(15, 0): return 'MARKET'
        else: return 'POST_MARKET'

    # --- 核心: 全市场个股行情 ---
    @staticmethod
    def fetch_stock_map_cached(market_type: str):
        cache_key = f"market_spot_{market_type}"
        cached = cache_service.get(cache_key, 60)
        if cached: return cached
        
        result_map = {}
        try:
            if market_type == 'A':
                # stock_zh_a_spot_em: 沪深京 A 股实时行情
                df = ak.stock_zh_a_spot_em()
                if not df.empty:
                    for row in df.itertuples():
                        try:
                            code = str(row.代码)
                            result_map[code] = {
                                "price": float(row.最新价) if row.最新价 != '-' else 0.0,
                                "change": float(row.涨跌幅) if row.涨跌幅 != '-' else 0.0,
                                "name": str(row.名称)
                            }
                        except: pass
            elif market_type == 'HK':
                # stock_hk_spot_em 似乎不稳定，此处尝试用 stock_hk_index_spot_em 或其他替代
                try:
                    df = ak.stock_hk_spot() # 备用接口
                    if not df.empty:
                        for row in df.itertuples():
                            try:
                                code = str(row.symbol)
                                result_map[code] = {
                                    "price": float(row.lasttrade),
                                    "change": float(row.percent) * 100, # 这里的 percent 可能是 0.01
                                    "name": str(row.name)
                                }
                            except: pass
                except: pass

            elif market_type == 'US':
                df = ak.stock_us_spot_em()
                if not df.empty:
                    for row in df.itertuples():
                        try:
                            raw_code = str(row.代码) if hasattr(row, '代码') else "" 
                            name = str(row.名称)
                            ticker = raw_code.split('.')[-1]
                            data = {
                                "price": float(row.最新价) if row.最新价 != '-' else 0.0,
                                "change": float(row.涨跌幅) if row.涨跌幅 != '-' else 0.0,
                                "name": name
                            }
                            result_map[ticker] = data
                            result_map[name] = data 
                        except: pass

        except Exception as e:
            logger.error(f"Fetch {market_type} spot failed: {e}")
            return {} 

        cache_service.set(cache_key, result_map)
        return result_map

    # --- 核心: ETF/LOF 实时行情 ---
    @staticmethod
    def fetch_etf_lof_spot_cached():
        key = "etf_lof_spot_map"
        cached = cache_service.get(key, 60)
        if cached: return cached
        
        result_map = {}
        # fund_etf_spot_em: ETF实时
        try:
            df_etf = ak.fund_etf_spot_em()
            if not df_etf.empty:
                for row in df_etf.itertuples():
                    try:
                        code = str(row.代码)
                        result_map[code] = {"price": float(row.最新价), "change": float(row.涨跌幅), "name": str(row.名称), "type": "ETF"}
                    except: pass
        except Exception as e: logger.warning(f"ETF spot fetch failed: {e}")

        # fund_lof_spot_em: LOF实时
        try:
            df_lof = ak.fund_lof_spot_em()
            if not df_lof.empty:
                for row in df_lof.itertuples():
                    try:
                        code = str(row.代码)
                        if code not in result_map:
                            result_map[code] = {"price": float(row.最新价), "change": float(row.涨跌幅), "name": str(row.名称), "type": "LOF"}
                    except: pass
        except Exception as e: logger.warning(f"LOF spot fetch failed: {e}")

        cache_service.set(key, result_map)
        return result_map

    # --- 核心: 市场指数 (Strict Implementation + Fallback) ---
    @staticmethod
    def fetch_global_indices_data_cached():
        # 缓存时间延长，防止夜间频繁请求失败
        key = "global_indices_spot_map"
        cached = cache_service.get(key, 300) 
        if cached: return cached

        indices_map = {}
        
        # 1. A股指数: stock_zh_index_spot_em
        # 尝试多个 symbol 集合
        zh_symbols = ["沪深重要指数", "上证系列指数", "深证系列指数", "指数成份"]
        has_zh_data = False
        
        for sym in zh_symbols:
            if has_zh_data and len(indices_map) > 5: break 
            try:
                df_zh = ak.stock_zh_index_spot_em(symbol=sym)
                if not df_zh.empty:
                    has_zh_data = True
                    for row in df_zh.itertuples():
                        try:
                            code = str(row.代码)
                            name = str(row.名称)
                            price = float(row.最新价)
                            # 强制保留两位小数
                            change = round(float(row.涨跌幅), 2)
                            
                            item = {"price": price, "change": change, "name": name}
                            indices_map[code] = item
                            indices_map[name] = item
                        except: pass
            except Exception as e: pass

        # 2. 港股指数: stock_hk_index_spot_em
        try:
            df_hk = ak.stock_hk_index_spot_em()
            if not df_hk.empty:
                for row in df_hk.itertuples():
                    try:
                        code = str(row.代码) # e.g. "HSI"
                        name = str(row.名称)
                        price = float(row.最新价)
                        change = round(float(row.涨跌幅), 2)
                        
                        item = {"price": price, "change": change, "name": name}
                        indices_map[code] = item
                        indices_map[name] = item
                    except: pass
        except Exception as e: logger.warning(f"HK index fetch failed: {e}")
        
        # 3. 美股指数: index_us_stock_sina
        us_targets = [".IXIC", ".DJI", ".INX", ".NDX"]
        us_names = {".IXIC": "纳斯达克", ".DJI": "道琼斯", ".INX": "标普500", ".NDX": "纳斯达克100"}
        
        for sym in us_targets:
            try:
                df_us = ak.index_us_stock_sina(symbol=sym)
                if not df_us.empty:
                    last = df_us.iloc[-1]
                    prev_close = df_us.iloc[-2]['close'] if len(df_us) > 1 else last['open']
                    
                    price = float(last['close'])
                    change_raw = ((price - float(prev_close)) / float(prev_close)) * 100
                    change = round(change_raw, 2)
                    
                    name = us_names.get(sym, sym)
                    clean_code = sym.replace('.', '') # NDX
                    
                    item = {"price": price, "change": change, "name": name}
                    indices_map[clean_code] = item
                    indices_map[name] = item
            except Exception as e: pass

        # 4. 全球指数: index_global_spot_em (Backup)
        try:
            df_global = ak.index_global_spot_em()
            if not df_global.empty:
                for row in df_global.itertuples():
                    try:
                        name = str(row.名称)
                        if name not in indices_map:
                            price = float(row.最新价)
                            change = round(float(row.涨跌幅), 2)
                            indices_map[name] = {"price": price, "change": change, "name": name}
                    except: pass
        except: pass

        # 如果获取失败，尝试读取旧缓存（即使过期）作为兜底
        if not indices_map and cache_service._cache.get(key):
             return cache_service._cache.get(key)['data']

        cache_service.set(key, indices_map)
        return indices_map

    @staticmethod
    def fetch_index_daily_fallback(symbol: str):
        """
        休市期间 Spot 接口可能返回空，使用日线数据兜底
        Symbol 格式转换: 
        1.xxxxxx -> shxxxxxx
        0.xxxxxx -> szxxxxxx
        100.HSI -> 港股? 需要 specific mapping
        """
        try:
            ak_symbol = ""
            if symbol.startswith('1.'):
                ak_symbol = "sh" + symbol.split('.')[1]
                df = ak.stock_zh_index_daily_em(symbol=ak_symbol)
            elif symbol.startswith('0.'):
                ak_symbol = "sz" + symbol.split('.')[1]
                df = ak.stock_zh_index_daily_em(symbol=ak_symbol)
            # 港美股暂不通过此接口兜底，因为Spot通常较稳，且API不同
            
            if ak_symbol and not df.empty:
                last = df.iloc[-1]
                prev = df.iloc[-2] if len(df) > 1 else last
                
                price = float(last['close'])
                change = ((price - float(prev['close'])) / float(prev['close'])) * 100
                return {"price": price, "change": round(change, 2)}
        except Exception as e:
            logger.warning(f"Index fallback failed for {symbol}: {e}")
        return None

    # --- 其他基础接口 ---
    @staticmethod
    def fetch_fund_list_sync():
        try:
            df = ak.fund_name_em()
            return [{"code": str(r.基金代码), "name": str(r.基金简称), "type": str(r.基金类型), "pinyin": str(r.拼音缩写)} for r in df.itertuples()]
        except: return []

    @staticmethod
    def fetch_realtime_estimate_direct_sync(code: str):
        data = { "fundcode": code, "name": "", "gsz": "0", "gszzl": "0", "dwjz": "0", "jzrq": "", "source": "none", "gztime": "" }
        try:
            ts = int(time_module.time() * 1000)
            url = f"https://fundgz.1234567.com.cn/js/{code}.js?rt={ts}"
            headers = AkshareService.get_headers(referer="https://fund.eastmoney.com/")
            resp = GlobalSession.get().get(url, headers=headers, timeout=2.0)
            if resp.status_code == 200:
                match = re.search(r'jsonpgz\s*=?\s*\((.*?)\)', resp.text, re.S)
                if match:
                    json_str = match.group(1).strip().rstrip(';')
                    fetched = json.loads(json_str)
                    if fetched:
                        data.update(fetched)
                        data['source'] = 'official_realtime'
                        if 'gztime' not in data and 'time' in data: data['gztime'] = data['time']
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
            current_year = datetime.now().year
            combined_df = pd.DataFrame()
            for y in [current_year, current_year - 1]:
                try:
                    df = ak.fund_portfolio_hold_em(symbol=code, date=str(y))
                    if not df.empty and '季度' in df.columns: combined_df = pd.concat([combined_df, df])
                except: continue
            
            if combined_df.empty: return []

            def parse_rank(q_str):
                try:
                    year_match = re.search(r'(\d{4})', q_str)
                    y_val = int(year_match.group(1)) if year_match else 0
                    if '年报' in q_str: return y_val * 100 + 5 
                    q_match = re.search(r'(\d)季度', q_str)
                    q_val = int(q_match.group(1)) if q_match else 0
                    return y_val * 100 + q_val
                except: return 0

            combined_df['rank'] = combined_df['季度'].apply(parse_rank)
            combined_df['占净值比例'] = pd.to_numeric(combined_df['占净值比例'], errors='coerce').fillna(0)
            sorted_df = combined_df.sort_values(by=['rank', '占净值比例'], ascending=[False, False])
            if sorted_df.empty: return []
            
            latest_rank = sorted_df.iloc[0]['rank']
            latest_holdings = sorted_df[sorted_df['rank'] == latest_rank].head(10) 
            return [{"code": str(r['股票代码']), "name": str(r['股票名称']), "percent": float(r['占净值比例'])} for _, r in latest_holdings.iterrows()]
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
    def fetch_sector_rankings_sync():
        FILE_CACHE = "sectors_fallback.json"
        try:
            df = ak.stock_board_industry_name_em()
            if not df.empty: 
                df['涨跌幅'] = pd.to_numeric(df['涨跌幅'], errors='coerce').fillna(0)
                df_sorted = df.sort_values(by='涨跌幅', ascending=False)
                
                def extract(sub): return [{"name": r['板块名称'], "changePercent": float(r['涨跌幅']), "leadingStock": r['领涨股票']} for _, r in sub.iterrows()]
                
                data = {"top": extract(df_sorted.head(5)), "bottom": extract(df_sorted.tail(5))}
                
                # Save to local file for persistence during restarts/maintenance
                try:
                    with open(FILE_CACHE, 'w', encoding='utf-8') as f:
                        json.dump(data, f, ensure_ascii=False)
                except: pass
                
                return data
        except Exception as e:
            logger.warning(f"Sector fetch error: {e}")
        
        # Fallback to file cache if API fails/empty (common at 1AM)
        try:
            if os.path.exists(FILE_CACHE):
                with open(FILE_CACHE, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except: pass
        
        # Fallback to memory cache
        cached = cache_service._cache.get("market_sectors")
        if cached: return cached['data']
        
        return {"top": [], "bottom": []}

    @staticmethod
    def fetch_fund_rankings_sync():
        phase = AkshareService.get_time_phase()
        try:
            if phase in ['PRE_MARKET', 'MARKET', 'LUNCH_BREAK']:
                df_est = ak.fund_value_estimation_em(symbol="全部")
                if not df_est.empty:
                    df_est['est_change'] = df_est['交易日-估算数据-估算增长率'].str.replace('%', '', regex=False)
                    df_est['est_change'] = pd.to_numeric(df_est['est_change'], errors='coerce').fillna(0)
                    df_est['nav'] = pd.to_numeric(df_est['交易日-公布数据-单位净值'], errors='coerce').fillna(0)
                    df_sorted = df_est.sort_values(by='est_change', ascending=False)
                    def to_dict_est(rows): 
                        return [{
                            "code": str(r.基金代码), "name": str(r.基金名称), "changePercent": float(r.est_change), "nav": float(r.nav), "isRealtime": True
                        } for r in rows.itertuples()]
                    top_change = df_sorted.iloc[0]['est_change']
                    if abs(top_change) > 0.01:
                        return { "gainers": to_dict_est(df_sorted.head(20)), "losers": to_dict_est(df_sorted.tail(20).iloc[::-1]) }
        except Exception as e: logger.warning(f"Realtime ranking fetch failed: {e}")

        try:
            df = ak.fund_open_fund_rank_em(symbol="全部") 
            if df.empty: return {"gainers": [], "losers": []}
            df['日增长率'] = pd.to_numeric(df['日增长率'], errors='coerce').fillna(0)
            df['单位净值'] = pd.to_numeric(df['单位净值'], errors='coerce').fillna(0)
            df_sorted = df.sort_values(by='日增长率', ascending=False)
            def to_dict(rows): return [{"code": str(r['基金代码']), "name": str(r['基金简称']), "changePercent": float(r['日增长率']), "nav": float(r['单位净值']), "isRealtime": False} for _, r in rows.iterrows()]
            return {"gainers": to_dict(df_sorted.head(20)), "losers": to_dict(df_sorted.tail(20).iloc[::-1])}
        except: return {"gainers": [], "losers": []}

# --- 控制器逻辑 ---

class FundController:
    @staticmethod
    async def get_search_results(key: str):
        # 增加缓存时间到 24小时 (86400s)，并由 Startup Event 预热
        cached = cache_service.get("funds_list", 86400) 
        if not cached:
            cached = await run_in_threadpool(AkshareService.fetch_fund_list_sync)
            if cached: cache_service.set("funds_list", cached)
        if not cached: return []
        
        if not key: return [] # Empty key returns nothing
        
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
        cache_key = f"fund_detail_full_{code}"
        cached = cache_service.get(cache_key, 86400)
        if cached: return cached

        loop = asyncio.get_running_loop()
        holdings_task = run_in_threadpool(AkshareService.fetch_holdings_sync, code)
        basic_task = run_in_threadpool(AkshareService.fetch_fund_basic_info_sync, code)
        a_spot_task = run_in_threadpool(AkshareService.fetch_stock_map_cached, 'A')
        
        holdings, basic, a_spot_map = await asyncio.gather(holdings_task, basic_task, a_spot_task)
        
        hk_spot_map = {}
        us_spot_map = {}
        
        has_hk = any(len(h['code']) == 5 for h in holdings)
        has_us = any(not h['code'].isdigit() for h in holdings)
        
        if has_hk: hk_spot_map = await run_in_threadpool(AkshareService.fetch_stock_map_cached, 'HK')
        if has_us: us_spot_map = await run_in_threadpool(AkshareService.fetch_stock_map_cached, 'US')

        if holdings:
            for h in holdings: 
                c = h['code']
                spot_data = None
                if len(c) == 6 and c.isdigit(): spot_data = a_spot_map.get(c)
                elif len(c) == 5 and c.isdigit(): spot_data = hk_spot_map.get(c)
                else: spot_data = us_spot_map.get(c) or us_spot_map.get(h['name'])

                if spot_data:
                    h['changePercent'] = spot_data['change']
                    h['currentPrice'] = spot_data['price']
                    if not h.get('name'): h['name'] = spot_data['name']
                else:
                    h['changePercent'] = 0
                    h['currentPrice'] = 0

        result = {
            "code": code, "manager": basic.get('基金经理', '暂无'), "holdings": holdings,
            "fund_size": basic.get('最新规模', '--'), "start_date": basic.get('成立时间', '--'),
            "type": basic.get('基金类型', '混合型'),
        }
        cache_service.set(cache_key, result)
        return result

    @staticmethod
    async def get_market_overview(codes_str: Optional[str] = None):
        default_map = {
            "上证指数": "1.000001", "深证成指": "0.399001", "创业板指": "0.399006", 
            "科创50": "1.000688", "沪深300": "1.000300", "恒生指数": "100.HSI",
            "纳斯达克": "100.NDX", "标普500": "100.SPX"
        }
        target_codes = codes_str.split(',') if codes_str else list(default_map.values())

        indices_spot_map = await run_in_threadpool(AkshareService.fetch_global_indices_data_cached)
        
        indices = []
        code_to_name_map = {v: k for k, v in default_map.items()}

        for req_c in target_codes:
            found = False
            clean_code = req_c.split('.')[-1]
            
            # 1. Try Spot Map
            if clean_code in indices_spot_map:
                data = indices_spot_map[clean_code]
                indices.append({
                    "name": data['name'], "code": req_c,
                    "changePercent": data['change'], "value": data['price'],
                    "score": int(max(0, min(100, 50 + data['change'] * 10))),
                })
                found = True
            
            if not found:
                 possible_name = code_to_name_map.get(req_c, req_c)
                 if possible_name in indices_spot_map:
                      data = indices_spot_map[possible_name]
                      indices.append({
                        "name": data['name'], "code": req_c,
                        "changePercent": data['change'], "value": data['price'],
                        "score": int(max(0, min(100, 50 + data['change'] * 10))),
                      })
                      found = True
            
            # 2. Last Resort: Try Fetching Daily History (for A-shares mostly)
            if not found and (req_c.startswith('1.') or req_c.startswith('0.')):
                try:
                    fallback_data = await run_in_threadpool(AkshareService.fetch_index_daily_fallback, req_c)
                    if fallback_data:
                        indices.append({
                            "name": code_to_name_map.get(req_c, req_c), 
                            "code": req_c,
                            "changePercent": fallback_data['change'], 
                            "value": fallback_data['price'],
                            "score": 50
                        })
                        found = True
                except: pass

        sectors = cache_service.get("market_sectors", 1800) 
        if not sectors:
            sectors = await run_in_threadpool(AkshareService.fetch_sector_rankings_sync)
            cache_service.set("market_sectors", sectors)
            
        fund_ranks = cache_service.get("fund_ranks", 1800) 
        if not fund_ranks:
            fund_ranks = await run_in_threadpool(AkshareService.fetch_fund_rankings_sync)
            cache_service.set("fund_ranks", fund_ranks)

        return { "indices": indices, "sectors": sectors or {"top": [], "bottom": []}, "fundRankings": fund_ranks or {"gainers": [], "losers": []} }

    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        
        CACHE_TTL = 300 
        results = []
        missing_codes = []
        
        cache_keys = [f"est_result_{c}" for c in codes]
        cached_data = cache_service.mget(cache_keys, CACHE_TTL)
        
        for c in codes:
            key = f"est_result_{c}"
            if key in cached_data:
                results.append(cached_data[key])
            else:
                missing_codes.append(c)
        
        if not missing_codes: return results

        loop = asyncio.get_running_loop()
        today = datetime.utcnow() + timedelta(hours=8)
        today_str = today.strftime('%Y-%m-%d')
        today_cache_key = today_str

        # 优化策略：
        # 不再拉取全量 fund_open_fund_daily_em (太慢)
        # 而是并行拉取每个基金的 History (官方确权) 和 JS Estimate (实时/官方估值)
        # 如果 History 最新日期 >= JS Estimate 日期，说明官方已确权，覆盖 JS 数据。
        
        etf_lof_map_task = loop.run_in_executor(None, AkshareService.fetch_etf_lof_spot_cached)

        async def fetch_one(c):
            est = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_direct_sync, c)
            # Fetch history to get confirmed official NAV
            hist = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync_cached, c, today_cache_key)
            return c, est, hist

        results_data_task = asyncio.gather(*[fetch_one(c) for c in missing_codes])
        
        etf_lof_map, results_data = await asyncio.gather(etf_lof_map_task, results_data_task)
        
        phase = AkshareService.get_time_phase()
        calc_needed = []
        results_map = {}

        for code, est, hist in results_data:
            res = est 
            def safe_float(v, default=0.0):
                try: return float(v)
                except: return default

            # Parse History (Official Confirmed Data)
            official_confirmed_nav = 0.0
            official_confirmed_date = ""
            official_confirmed_change = 0.0
            
            if not hist.empty:
                # hist sorted by date ascending usually? akshare returns df.
                # Assuming last row is latest
                latest = hist.iloc[-1]
                official_confirmed_nav = float(latest['单位净值'])
                official_confirmed_date = str(latest['净值日期'])
                
                # Calculate change if possible
                if len(hist) > 1:
                    prev = hist.iloc[-2]
                    prev_nav = float(prev['单位净值'])
                    if prev_nav > 0:
                        official_confirmed_change = ((official_confirmed_nav - prev_nav) / prev_nav) * 100

            # Parse Estimate (JS Data)
            api_dwjz = safe_float(res.get('dwjz'))
            api_jzrq = res.get('jzrq', '') # Estimate usually returns prev day confirmed date in jzrq, unless official updated?
            # Actually JS `jzrq` is "Value Date". `time` is estimate time.
            api_gsz = safe_float(res.get('gsz'))
            api_gszzl = safe_float(res.get('gszzl'))

            is_official_updated = False
            
            # --- 优先级逻辑 (Smart Overwrite) ---
            
            # Logic: If Official History Date is >= Estimate Date (or if Official Date is "Today" or "Yesterday" and JS is stuck)
            # Crucial: JS interface (fundgz) often keeps 15:00 estimate even after official NAV is out on other endpoints.
            # We rely on History Date.
            
            use_history_as_official = False
            
            if official_confirmed_nav > 0:
                # Case 1: Official History has today's date -> It is finalized.
                if official_confirmed_date == today_str:
                    use_history_as_official = True
                
                # Case 2: Official History date is SAME as JS Estimate date, 
                # AND Official NAV != JS Estimate NAV (implies estimate was wrong and official is out? Or just diff?)
                # Actually, if dates match, History is always "Truth". JS Estimate is just "Estimate".
                # If JS `jzrq` (last nav date) == official date, it means JS hasn't updated to *next* day yet?
                # JS `gsz` is for `gztime`. 
                # Compare `official_confirmed_date` vs `res.get('time')` date?
                # Simplification: If official_confirmed_date is "newer" than what we expect, use it.
                # If official_confirmed_date > api_jzrq (JS last nav date), then History is fresher.
                elif api_jzrq and official_confirmed_date > api_jzrq:
                    use_history_as_official = True
                
                # Case 3: Just check if History is logically the latest possible.
                # If phase is POST_MARKET (late night), and history date == today (or yesterday if after midnight but before open)
                # This is handled by Case 1 & logic below.
            
            if use_history_as_official:
                res['dwjz'] = str(official_confirmed_nav)
                res['gsz'] = str(official_confirmed_nav)
                res['gszzl'] = "{:.2f}".format(official_confirmed_change)
                res['source'] = 'official_history_ak'
                res['gztime'] = "已更新(官方)"
                res['jzrq'] = official_confirmed_date
                
                api_dwjz = official_confirmed_nav
                is_official_updated = True

            # 2. ETF/LOF Realtime (Intraday backup)
            if not is_official_updated and etf_lof_map and code in etf_lof_map:
                 spot_info = etf_lof_map[code]
                 if spot_info['price'] > 0:
                    res['gsz'] = str(spot_info['price'])
                    res['gszzl'] = str(spot_info['change'])
                    res['source'] = f'realtime_{spot_info["type"].lower()}' 
                    res['gztime'] = "实时交易"
            
            # 3. Last resort fallback / Heavy Calculation
            last_nav = official_confirmed_nav if official_confirmed_nav > 0 else api_dwjz
            
            if is_official_updated:
                # If officially updated, GSZ = NAV, Change = Real Change
                pass 
            else:
                res['_last_nav'] = last_nav 
                gsz = safe_float(res.get('gsz'))
                # Calculate if no valid estimate exists
                if gsz <= 0 and phase != 'PRE_MARKET' and 'realtime' not in res.get('source', ''): 
                    calc_needed.append(code)

            results_map[code] = res

        # 重仓股估算逻辑
        if calc_needed:
            codes_to_fetch_h = [c for c in calc_needed if not cache_service.get(f"holdings_{c}", 86400)]
            if codes_to_fetch_h:
                 h_tasks = [run_in_threadpool(AkshareService.fetch_holdings_sync, c) for c in codes_to_fetch_h]
                 fetched_h = await asyncio.gather(*h_tasks)
                 for i, c in enumerate(codes_to_fetch_h): cache_service.set(f"holdings_{c}", fetched_h[i])
            
            all_holdings_flag = set()
            for c in calc_needed:
                h = cache_service.get(f"holdings_{c}", 86400) or []
                for stock in h:
                    if len(stock['code']) == 6 and stock['code'].isdigit(): all_holdings_flag.add('A')
                    elif len(stock['code']) == 5 and stock['code'].isdigit(): all_holdings_flag.add('HK')
                    else: all_holdings_flag.add('US')
            
            a_map = await run_in_threadpool(AkshareService.fetch_stock_map_cached, 'A') if 'A' in all_holdings_flag else {}
            hk_map = await run_in_threadpool(AkshareService.fetch_stock_map_cached, 'HK') if 'HK' in all_holdings_flag else {}
            us_map = await run_in_threadpool(AkshareService.fetch_stock_map_cached, 'US') if 'US' in all_holdings_flag else {}

            for c in calc_needed:
                data = results_map[c]
                holdings = cache_service.get(f"holdings_{c}", 86400) or []
                if not holdings: continue
                
                weighted_chg = 0
                total_w = 0
                for h in holdings:
                    w = h['percent']
                    sc = h['code']
                    sq = None
                    if len(sc) == 6 and sc.isdigit(): sq = a_map.get(sc)
                    elif len(sc) == 5 and sc.isdigit(): sq = hk_map.get(sc)
                    else: sq = us_map.get(sc)
                    
                    if sq:
                        weighted_chg += (sq['change'] * w)
                        total_w += w
                
                est_chg = 0
                if total_w > 0: est_chg = (weighted_chg / total_w) * 0.95 
                last_n = data.get('_last_nav', 0)
                if last_n > 0:
                    est_val = last_n * (1 + est_chg / 100.0)
                    data['gsz'] = "{:.4f}".format(est_val)
                    data['gszzl'] = "{:.2f}".format(est_chg)
                    data['source'] = 'holdings_calc_batch'
                    now = datetime.now()
                    data['gztime'] = f"{now.hour:02}:{now.minute:02}"

        for c in missing_codes:
            if c in results_map:
                final_res = results_map[c]
                cache_service.set(f"est_result_{c}", final_res)
                results.append(final_res)

        return results

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

@app.on_event("startup")
async def startup_event():
    # 预热基金列表缓存，避免第一次搜索卡顿
    logger.info("Prefetching fund list...")
    await FundController.get_search_results("")
    logger.info("Fund list cached.")

@router.get("/status")
def status(): return { "phase": AkshareService.get_time_phase(), "ts": datetime.now().timestamp(), "version": "4.5" }
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
    today = datetime.utcnow() + timedelta(hours=8)
    today_cache_key = today.strftime('%Y-%m-%d')
    df = await run_in_threadpool(AkshareService.fetch_fund_history_sync_cached, code, today_cache_key)
    if df.empty: return []
    return [{"date": str(r['净值日期']), "value": float(r['单位净值'])} for _, r in df.tail(365).iterrows()]
@router.post("/analyze")
async def analyze(payload: dict = Body(...)): return await FundController.analyze_content(payload.get("prompt", ""))

app.include_router(router)
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
