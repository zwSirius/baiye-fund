import uvicorn
from fastapi import FastAPI, Query, Body, APIRouter, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
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

# --- Pydantic Models (数据校验) ---

class AnalyzeRequest(BaseModel):
    prompt: str
    # 兼容前端传来的 apiKey 字段
    api_key: Optional[str] = Field(None, alias="apiKey")

class EstimateRequest(BaseModel):
    codes: List[str]

# --- 工具类 ---

class SafeUtils:
    """数据清洗工具，防止NaN或格式错误导致前端崩溃"""
    
    @staticmethod
    def clean_num(val: Any, default=0.0) -> float:
        if pd.isna(val) or val is None or val == "" or val == "-":
            return default
        
        if isinstance(val, (float, int)):
            return float(val)
            
        if isinstance(val, str):
            # 移除百分号和逗号
            val = val.replace('%', '').replace(',', '')
            try:
                return float(val)
            except:
                pass
        return default

    @staticmethod
    def clean_str(val: Any) -> str:
        if pd.isna(val) or val is None:
            return ""
        return str(val).strip()

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
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CacheService, cls).__new__(cls)
            cls._instance._cache = {}
        return cls._instance

    def get(self, key: str, ttl: int = 60):
        entry = self._cache.get(key)
        if entry:
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
    def get_headers():
        user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ]
        return {
            "User-Agent": random.choice(user_agents),
            "Referer": "https://quote.eastmoney.com/"
        }

    @staticmethod
    def get_time_phase():
        """简单判断市场状态"""
        now = datetime.utcnow() + timedelta(hours=8)
        if now.weekday() >= 5: return 'WEEKEND'
        t = now.time()
        if t < time(9, 15): return 'PRE_MARKET'
        elif t >= time(11, 30) and t < time(13, 0): return 'LUNCH_BREAK'
        elif t <= time(15, 0): return 'MARKET'
        else: return 'POST_MARKET'

    # --- 核心: 全市场个股/指数/ETF 统一映射 ---
    @staticmethod
    def fetch_market_spot_data_cached():
        """
        获取 A股、港股、美股、指数 的实时数据并建立映射表
        """
        key = "market_spot_full_map"
        cached = cache_service.get(key, 60) # 1分钟缓存
        if cached: return cached
        
        result_map = {} # Key: Code/Name, Value: {price, change, name}

        # 1. A股实时 (stock_zh_a_spot_em)
        try:
            df = ak.stock_zh_a_spot_em()
            if not df.empty:
                # 优化：批量处理，避免 iterrows
                # 假设列名: 代码, 名称, 最新价, 涨跌幅
                for row in df.to_dict('records'):
                    code = str(row.get('代码'))
                    result_map[code] = {
                        "price": SafeUtils.clean_num(row.get('最新价')),
                        "change": SafeUtils.clean_num(row.get('涨跌幅')),
                        "name": str(row.get('名称'))
                    }
        except Exception as e:
            logger.error(f"A-Share spot fetch failed: {e}")

        # 2. 港股实时 (stock_hk_spot_em - 修复旧接口失效)
        try:
            df = ak.stock_hk_spot_em()
            if not df.empty:
                for row in df.to_dict('records'):
                    code = str(row.get('代码')) # 00700
                    result_map[code] = {
                        "price": SafeUtils.clean_num(row.get('最新价')),
                        "change": SafeUtils.clean_num(row.get('涨跌幅')),
                        "name": str(row.get('名称'))
                    }
        except Exception as e:
            logger.error(f"HK-Share spot fetch failed: {e}")

        # 3. 全球指数 & 核心指数 (A股指数/美股指数)
        try:
            # 3.1 A股指数 (包含行业指数)
            for sym in ["沪深重要指数", "上证系列指数", "深证系列指数", "中证系列指数"]:
                try:
                    df = ak.stock_zh_index_spot_em(symbol=sym)
                    if not df.empty:
                        for row in df.to_dict('records'):
                            code = str(row.get('代码'))
                            name = str(row.get('名称'))
                            data = {
                                "price": SafeUtils.clean_num(row.get('最新价')),
                                "change": SafeUtils.clean_num(row.get('涨跌幅')),
                                "name": name
                            }
                            result_map[code] = data
                            result_map[name] = data # 支持按名称查找
                except: pass
            
            # 3.2 美股指数
            us_targets = {".IXIC": "纳斯达克", ".DJI": "道琼斯", ".INX": "标普500", ".NDX": "纳斯达克100"}
            for sym, name in us_targets.items():
                try:
                    df_us = ak.index_us_stock_sina(symbol=sym)
                    if not df_us.empty:
                        last = df_us.iloc[-1]
                        prev = df_us.iloc[-2] if len(df_us) > 1 else last
                        price = float(last['close'])
                        prev_close = float(prev['close'])
                        change = ((price - prev_close) / prev_close) * 100
                        
                        data = {
                            "price": price,
                            "change": round(change, 2),
                            "name": name
                        }
                        result_map[sym.replace('.', '')] = data # IXIC
                        result_map[name] = data
                except: pass

            # 3.3 全球指数 (index_global_spot_em - 修复缺失)
            try:
                df_g = ak.index_global_spot_em()
                if not df_g.empty:
                    for row in df_g.to_dict('records'):
                        name = str(row.get('名称'))
                        # 映射中文名称到前端常用Key (如纳斯达克)
                        if name == "纳斯达克": result_map["NDX"] = {"price": SafeUtils.clean_num(row.get('最新价')), "change": SafeUtils.clean_num(row.get('涨跌幅')), "name": name}
                        
                        data = {
                            "price": SafeUtils.clean_num(row.get('最新价')),
                            "change": SafeUtils.clean_num(row.get('涨跌幅')),
                            "name": name
                        }
                        result_map[name] = data
            except: pass

        except Exception as e:
            logger.error(f"Index fetch failed: {e}")

        # 4. ETF/LOF
        try:
            df_etf = ak.fund_etf_spot_em()
            for row in df_etf.to_dict('records'):
                result_map[str(row.get('代码'))] = {
                    "price": SafeUtils.clean_num(row.get('最新价')),
                    "change": SafeUtils.clean_num(row.get('涨跌幅')),
                    "name": str(row.get('名称')),
                    "type": "ETF"
                }
        except: pass

        cache_service.set(key, result_map)
        return result_map

    # --- 基金排行 (修复语法错误) ---
    @staticmethod
    def fetch_fund_rankings_sync():
        """
        获取基金实时估值排行
        修复：不使用 row.属性 访问带减号的列
        """
        phase = AkshareService.get_time_phase()
        
        # 1. 尝试实时估值 (盘中)
        if phase in ['PRE_MARKET', 'MARKET', 'LUNCH_BREAK']:
            try:
                df = ak.fund_value_estimation_em(symbol="全部")
                if not df.empty:
                    # 重命名列以方便操作
                    df = df.rename(columns={
                        '基金代码': 'code',
                        '基金名称': 'name',
                        '交易日-估算数据-估算增长率': 'est_change',
                        '交易日-公布数据-单位净值': 'nav'
                    })
                    
                    # 清洗数据
                    df['est_change'] = df['est_change'].apply(SafeUtils.clean_num)
                    df['nav'] = df['nav'].apply(SafeUtils.clean_num)
                    
                    # 排序
                    df = df.sort_values(by='est_change', ascending=False)
                    
                    def extract(sub_df):
                        return [{
                            "code": str(r['code']),
                            "name": str(r['name']),
                            "changePercent": float(r['est_change']),
                            "nav": float(r['nav']),
                            "isRealtime": True
                        } for r in sub_df.to_dict('records')]

                    return {
                        "gainers": extract(df.head(20)),
                        "losers": extract(df.tail(20).iloc[::-1])
                    }
            except Exception as e:
                logger.warning(f"Realtime rank fetch failed: {e}")

        # 2. 兜底：使用历史净值排行
        try:
            df = ak.fund_open_fund_rank_em(symbol="全部")
            if df.empty: return {"gainers": [], "losers": []}
            
            # 同样使用字典访问
            df['day_change'] = df['日增长率'].apply(SafeUtils.clean_num)
            df = df.sort_values(by='day_change', ascending=False)
            
            def extract_daily(sub_df):
                return [{
                    "code": str(r['基金代码']),
                    "name": str(r['基金简称']),
                    "changePercent": float(r['day_change']),
                    "nav": SafeUtils.clean_num(r.get('单位净值')),
                    "isRealtime": False
                } for r in sub_df.to_dict('records')]

            return {
                "gainers": extract_daily(df.head(20)),
                "losers": extract_daily(df.tail(20).iloc[::-1])
            }
        except Exception as e:
            logger.error(f"Fund rank fallback failed: {e}")
            return {"gainers": [], "losers": []}

    # --- 板块与资金流 (修复排序与列名) ---
    @staticmethod
    def fetch_market_fund_flow_data():
        """获取大盘与板块资金流"""
        fund_flow = {"market": None, "sectorFlow": {"inflow": [], "outflow": []}}
        
        # 1. 大盘资金流
        try:
            df = ak.stock_market_fund_flow()
            if not df.empty:
                last = df.iloc[-1]
                fund_flow["market"] = {
                    "date": str(last['日期']),
                    "sh_close": SafeUtils.clean_num(last['上证-收盘价']),
                    "sh_change": SafeUtils.clean_num(last['上证-涨跌幅']),
                    "sz_close": SafeUtils.clean_num(last['深证-收盘价']),
                    "sz_change": SafeUtils.clean_num(last['深证-涨跌幅']),
                    "main_net_inflow": SafeUtils.clean_num(last['主力净流入-净额']),
                    "main_net_ratio": SafeUtils.clean_num(last['主力净流入-净占比'])
                }
        except: pass

        # 2. 行业板块资金流 (stock_sector_fund_flow_rank)
        try:
            df = ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="行业资金流")
            if not df.empty:
                # 确保按净流入降序
                col_flow = '主力净流入-净额'
                col_change = '今日涨跌幅'
                
                df[col_flow] = df[col_flow].apply(SafeUtils.clean_num)
                df[col_change] = df[col_change].apply(SafeUtils.clean_num)
                
                df = df.sort_values(by=col_flow, ascending=False)
                
                def extract(sub):
                    return [{
                        "name": str(r['名称']),
                        "change": float(r[col_change]),
                        "netInflow": float(r[col_flow])
                    } for r in sub.to_dict('records')]

                fund_flow["sectorFlow"]["inflow"] = extract(df.head(5))
                fund_flow["sectorFlow"]["outflow"] = extract(df.tail(5).iloc[::-1])
        except Exception as e:
            logger.error(f"Sector flow fetch failed: {e}")

        return fund_flow

    @staticmethod
    def fetch_sector_rankings_sync():
        """板块涨跌幅排行"""
        try:
            df = ak.stock_board_industry_name_em()
            if not df.empty:
                df['change'] = df['涨跌幅'].apply(SafeUtils.clean_num)
                df = df.sort_values(by='change', ascending=False)
                
                def extract(sub):
                    return [{
                        "name": str(r['板块名称']),
                        "changePercent": float(r['change']),
                        "leadingStock": str(r['领涨股票'])
                    } for r in sub.to_dict('records')]
                
                return {"top": extract(df.head(5)), "bottom": extract(df.tail(5))}
        except: pass
        return {"top": [], "bottom": []}

    # --- 基础数据 ---
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
    def fetch_industry_allocation_sync(code: str):
        try:
            current_year = datetime.now().year
            for year in [str(current_year), str(current_year - 1)]:
                try:
                    df = ak.fund_portfolio_industry_allocation_em(symbol=code, date=year)
                    if not df.empty:
                        df['percent'] = df['占净值比例'].apply(SafeUtils.clean_num)
                        df = df.sort_values(by='percent', ascending=False)
                        return [{"name": str(r['行业类别']), "percent": float(r['percent'])} for r in df.head(5).to_dict('records')]
                except: continue
        except: pass
        return []

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

            # 简单处理：取第一行季度作为最新的
            # 实际上应该解析季度字符串，但在实战中直接由排序决定
            # 这里简化逻辑，假设 Akshare 返回顺序
            # 更好的做法是解析 '2023年4季度'
            
            combined_df['percent'] = combined_df['占净值比例'].apply(SafeUtils.clean_num)
            
            # 取最新的10条 (假设数据按时间倒序或只返回了最新)
            # 如果包含多个季度，取第一个出现的季度
            if '季度' in combined_df.columns:
                latest_q = combined_df.iloc[0]['季度']
                combined_df = combined_df[combined_df['季度'] == latest_q]
            
            combined_df = combined_df.sort_values(by='percent', ascending=False).head(10)
            
            return [{
                "code": str(r['股票代码']), 
                "name": str(r['股票名称']), 
                "percent": float(r['percent'])
            } for r in combined_df.to_dict('records')]
        except: return []

    @staticmethod
    def fetch_realtime_estimate_direct_sync(code: str):
        """天天基金 JS 接口 (轻量级)"""
        data = { "fundcode": code, "name": "", "gsz": "0", "gszzl": "0", "dwjz": "0", "jzrq": "", "source": "none", "gztime": "" }
        try:
            ts = int(time_module.time() * 1000)
            url = f"https://fundgz.1234567.com.cn/js/{code}.js?rt={ts}"
            headers = AkshareService.get_headers()
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
                if '单位净值' in df.columns: df['单位净值'] = df['单位净值'].apply(SafeUtils.clean_num)
                return df
        except: pass
        return pd.DataFrame()

# --- 控制器逻辑 ---

class FundController:
    @staticmethod
    async def get_search_results(key: str):
        cached = cache_service.get("funds_list", 86400) 
        if not cached:
            # ak.fund_name_em() 返回所有基金列表
            try:
                df = await run_in_threadpool(ak.fund_name_em)
                cached = [{"code": str(r.基金代码), "name": str(r.基金简称), "type": str(r.基金类型), "pinyin": str(r.拼音缩写)} for r in df.itertuples()]
                cache_service.set("funds_list", cached)
            except: cached = []
        
        if not cached or not key: return []
        
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
        cache_key = f"fund_detail_v2_{code}"
        cached = cache_service.get(cache_key, 600) # 10 min cache
        if cached: return cached

        loop = asyncio.get_running_loop()
        
        # Parallel fetch
        t1 = run_in_threadpool(AkshareService.fetch_holdings_sync, code)
        t2 = run_in_threadpool(AkshareService.fetch_fund_basic_info_sync, code)
        t3 = run_in_threadpool(AkshareService.fetch_industry_allocation_sync, code)
        t4 = run_in_threadpool(AkshareService.fetch_market_spot_data_cached) # Get full market map
        
        holdings, basic, industry, market_map = await asyncio.gather(t1, t2, t3, t4)
        
        # Map Holdings to Realtime Price
        if holdings:
            for h in holdings:
                c = h['code']
                n = h['name']
                spot = market_map.get(c) or market_map.get(n)
                
                if spot:
                    h['currentPrice'] = spot['price']
                    h['changePercent'] = spot['change']
                else:
                    h['currentPrice'] = 0.0
                    h['changePercent'] = 0.0

        result = {
            "code": code, 
            "manager": basic.get('基金经理', '暂无'), 
            "holdings": holdings,
            "industryDistribution": industry, 
            "fund_size": basic.get('最新规模', '--'), 
            "start_date": basic.get('成立时间', '--'),
            "type": basic.get('基金类型', '混合型'),
        }
        cache_service.set(cache_key, result)
        return result

    @staticmethod
    async def get_market_overview(codes_str: Optional[str] = None):
        # 默认指数代码映射
        default_map = {
            "上证指数": "1.000001", "深证成指": "0.399001", "创业板指": "0.399006", 
            "科创50": "1.000688", "沪深300": "1.000300", "恒生指数": "100.HSI",
            "纳斯达克": "100.NDX", "标普500": "100.SPX"
        }
        target_codes = codes_str.split(',') if codes_str else list(default_map.values())
        
        # 1. 获取行情字典
        market_map = await run_in_threadpool(AkshareService.fetch_market_spot_data_cached)
        
        indices = []
        name_reverse_map = {v: k for k, v in default_map.items()}

        for req_c in target_codes:
            # 处理 "1.000001" -> "000001" 这种可能的 key
            # 或者直接匹配 name
            
            clean_code = req_c.split('.')[-1] # HSI, 000001
            found_data = None
            
            # Strategy 1: Clean Code Match
            if clean_code in market_map:
                found_data = market_map[clean_code]
            
            # Strategy 2: Full Code Match (if map keys have prefixes)
            elif req_c in market_map:
                found_data = market_map[req_c]
            
            # Strategy 3: Name Match
            elif req_c in name_reverse_map:
                name = name_reverse_map[req_c]
                if name in market_map:
                    found_data = market_map[name]

            if found_data:
                indices.append({
                    "name": found_data['name'],
                    "code": req_c,
                    "value": found_data['price'],
                    "changePercent": found_data['change'],
                    "score": 50 + found_data['change'] # Simple score
                })
            else:
                # Fallback empty
                indices.append({
                    "name": name_reverse_map.get(req_c, req_c),
                    "code": req_c,
                    "value": 0.0,
                    "changePercent": 0.0,
                    "score": 50
                })

        # 2. 板块与资金流
        t_sectors = run_in_threadpool(AkshareService.fetch_sector_rankings_sync)
        t_flow = run_in_threadpool(AkshareService.fetch_market_fund_flow_data)
        t_ranks = run_in_threadpool(AkshareService.fetch_fund_rankings_sync)
        
        sectors, fund_flow, fund_ranks = await asyncio.gather(t_sectors, t_flow, t_ranks)

        return {
            "indices": indices,
            "sectors": sectors,
            "fundFlow": fund_flow,
            "fundRankings": fund_ranks
        }

    @staticmethod
    async def batch_estimate(codes: List[str]):
        if not codes: return []
        
        # Use cache for frequently requested funds
        results = []
        missing_codes = []
        for c in codes:
            cached = cache_service.get(f"est_final_{c}", 60)
            if cached: results.append(cached)
            else: missing_codes.append(c)
            
        if not missing_codes: return results

        loop = asyncio.get_running_loop()
        today_str = datetime.now().strftime('%Y-%m-%d')
        
        # 获取 ETF/LOF 实时价格兜底
        market_map = await run_in_threadpool(AkshareService.fetch_market_spot_data_cached)

        async def process_one(c):
            # 1. 天天基金 JS 接口 (最快，最准的QDII/LOF参考)
            est = await loop.run_in_executor(None, AkshareService.fetch_realtime_estimate_direct_sync, c)
            
            # 2. 历史数据 (用于确认昨日净值)
            hist_df = await loop.run_in_executor(None, AkshareService.fetch_fund_history_sync_cached, c, today_str)
            
            res = est
            last_nav = 0.0
            last_date = ""
            
            if not hist_df.empty:
                last_row = hist_df.iloc[-1]
                last_nav = float(last_row['单位净值'])
                last_date = str(last_row['净值日期'])
                
                # Check if official history is already updated today (Evening update)
                if last_date == today_str:
                    res['gsz'] = str(last_nav)
                    res['dwjz'] = str(last_nav)
                    res['gszzl'] = "0.00"
                    if len(hist_df) > 1:
                        prev = hist_df.iloc[-2]['单位净值']
                        if prev > 0:
                            chg = (last_nav - prev) / prev * 100
                            res['gszzl'] = f"{chg:.2f}"
                    res['source'] = 'official_history_ak'
                    res['gztime'] = '已更新(官方)'
                    return res

            # 如果没有官方更新，检查 JS 估值
            gsz = SafeUtils.clean_num(res.get('gsz'))
            
            # 如果 JS 估值无效 (0)，尝试用 ETF 实时价格
            if gsz <= 0:
                if c in market_map:
                    m_data = market_map[c]
                    if m_data['price'] > 0:
                        res['gsz'] = str(m_data['price'])
                        res['gszzl'] = str(m_data['change'])
                        res['source'] = 'realtime_etf'
                        res['gztime'] = '实时交易'
                        gsz = m_data['price']

            # 如果还是无效，尝试重仓股计算 (Backend calculation fallback)
            # 这里简化：如果不做后端计算，前端有备用逻辑。
            # 为了保持 main.py 简洁，我们这里暂不重复 heavy calculation，依赖前端或上面的 ETF/JS。
            # 除非明确要求后端计算。Prompt 提到 "后端字段不匹配"，我们确保字段对齐。
            
            # 确保字段存在
            if 'dwjz' not in res or float(res['dwjz']) <= 0:
                res['dwjz'] = str(last_nav)
            if 'jzrq' not in res or not res['jzrq']:
                res['jzrq'] = last_date
                
            return res

        futures = [process_one(c) for c in missing_codes]
        new_results = await asyncio.gather(*futures)
        
        for r in new_results:
            cache_service.set(f"est_final_{r['fundcode']}", r)
            results.append(r)
            
        return results

    @staticmethod
    async def chat_with_ai(request: AnalyzeRequest):
        """AI Chat with enforced client-side key"""
        if not request.api_key:
            raise HTTPException(status_code=400, detail="Missing API Key. Please configure it in settings.")
        
        try:
            genai.configure(api_key=request.api_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            
            # 简单的非流式响应
            response = await run_in_threadpool(model.generate_content, request.prompt)
            return {"text": response.text}
        except Exception as e:
            logger.error(f"AI Error: {e}")
            raise HTTPException(status_code=500, detail=str(e))

# --- FastAPI App ---
app = FastAPI(title="SmartFund API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
router = APIRouter(prefix="/api")

@app.on_event("startup")
async def startup_event():
    logger.info("Initializing SmartFund API...")
    # 预热
    await FundController.get_search_results("")

@router.get("/status")
def status(): 
    return { 
        "phase": AkshareService.get_time_phase(), 
        "ts": datetime.now().timestamp(), 
        "version": "5.0-Refactored" 
    }

@router.get("/search")
async def search(key: str = Query(..., min_length=1)): 
    return await FundController.get_search_results(key)

@router.get("/market/overview")
async def market_overview(codes: Optional[str] = Query(None)): 
    return await FundController.get_market_overview(codes)

@router.post("/estimate/batch")
async def estimate_batch(payload: EstimateRequest): 
    return await FundController.batch_estimate(payload.codes)

@router.get("/estimate/{code}")
async def estimate_one(code: str):
    res = await FundController.batch_estimate([code])
    return res[0] if res else {}

@router.get("/fund/{code}")
async def detail(code: str): 
    return await FundController.get_fund_detail(code)

@router.get("/history/{code}")
async def history(code: str):
    today_str = datetime.now().strftime('%Y-%m-%d')
    df = await run_in_threadpool(AkshareService.fetch_fund_history_sync_cached, code, today_str)
    if df.empty: return []
    # 统一字段
    return [{"date": str(r['净值日期']), "value": float(r['单位净值'])} for r in df.to_dict('records')]

@router.post("/analyze")
async def analyze(request: AnalyzeRequest): 
    return await FundController.chat_with_ai(request)

app.include_router(router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
