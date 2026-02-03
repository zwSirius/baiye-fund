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

# --- 配置 ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SmartFund")

# --- 常量定义 ---

# 核心指数代码映射 (中文名称/Akshare名称 -> 统一Key)
# 这些 Key 必须与 indices_map 中的 Key 一致
INDEX_SYMBOL_MAP = {
    "纳斯达克100": ".NDX", 
    "纳斯达克": ".IXIC",
    "道琼斯": ".DJI",
    "标普500": ".INX",
    "恒生指数": "HSI",   # Akshare 港股指数通常直接返回英文代码或中文
    "日经225": "N225",
    "英国富时": "FTSE",
    "法国CAC": "FCHI",
    "德国DAX": "GDAXI"
}

# 影子定价映射 (Shadow Pricing): 基金代码 -> 市场指数/ETF代码
# 即使逻辑中移除，保留定义以防未来需要
SPECIAL_MAPPING = {
    "000218": "518660",   # 黄金 -> 黄金ETF (场内)
    "001186": "000300",   # 华夏沪深300联接 -> 沪深300指数 (A股指数代码通常为 000300)
    "006479": ".NDX",     # 广发纳指 -> 纳斯达克100
    "000614": "GDAXI",    # 华安德国 -> 德国DAX
    "000071": ".IXIC",    # 纳斯达克 -> .IXIC
}

# --- Pydantic Models ---

class AnalyzeRequest(BaseModel):
    prompt: str
    # 允许前端传 "apiKey" (驼峰)，自动映射为 api_key
    api_key: Optional[str] = Field(None, alias="apiKey")

class EstimateRequest(BaseModel):
    codes: List[str]

# --- 工具类 ---

class SafeUtils:
    """数据清洗与类型安全工具"""
    
    @staticmethod
    def clean_num(val: Any, default=0.0) -> float:
        """安全转浮点数，处理 %, NaN, -, None"""
        if pd.isna(val) or val is None or val == "" or str(val).strip() == "-":
            return default
        
        s_val = str(val).strip()
        if s_val.endswith('%'):
            s_val = s_val[:-1]
        
        try:
            return float(s_val.replace(',', ''))
        except:
            return default

class GlobalSession:
    """全局 HTTP 会话复用"""
    _session = None

    @classmethod
    def get(cls):
        if cls._session is None:
            cls._session = requests.Session()
            adapter = requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=50, max_retries=3)
            cls._session.mount('http://', adapter)
            cls._session.mount('https://', adapter)
        return cls._session

class CacheService:
    """轻量级内存缓存"""
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

cache_service = CacheService()

class AkshareService:
    
    @staticmethod
    def get_headers():
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://quote.eastmoney.com/"
        }

    @staticmethod
    def get_time_phase():
        """获取当前市场状态 (北京时间)"""
        now = datetime.utcnow() + timedelta(hours=8)
        if now.weekday() >= 5: return 'WEEKEND'
        t = now.time()
        # 09:15 - 15:00 视为盘中相关时间
        if t < time(9, 15): return 'PRE_MARKET'
        elif t > time(15, 0): return 'POST_MARKET'
        else: return 'MARKET'

    # --- 核心行情获取 (字段必须对齐 changePercent) ---

    @staticmethod
    def fetch_stock_map_cached():
        """获取全市场个股行情 (A/HK/US)"""
        key = "full_market_spot_map"
        # 实时行情缓存 30s
        cached = cache_service.get(key, 30)
        if cached: return cached
        
        res = {}
        
        # 1. A股
        try:
            # 东方财富网-沪深京 A 股-实时行情数据
            df = ak.stock_zh_a_spot_em()
            for r in df.to_dict('records'):
                code = str(r.get('代码'))
                res[code] = {
                    "price": SafeUtils.clean_num(r.get('最新价')),
                    "changePercent": SafeUtils.clean_num(r.get('涨跌幅')), # 对齐前端
                    "name": str(r.get('名称'))
                }
        except Exception as e: 
            logger.warning(f"A Share Fetch Error: {e}")

        # 2. 港股 (stock_hk_spot_em)
        try:
            df = ak.stock_hk_spot_em()
            for r in df.to_dict('records'):
                code = str(r.get('代码'))
                res[code] = {
                    "price": SafeUtils.clean_num(r.get('最新价')),
                    "changePercent": SafeUtils.clean_num(r.get('涨跌幅')),
                    "name": str(r.get('名称'))
                }
        except: pass

        cache_service.set(key, res)
        return res

    @staticmethod
    def fetch_global_indices_cached():
        """获取全球主要指数 (含大盘)"""
        key = "global_indices_map"
        cached = cache_service.get(key, 120)
        if cached: return cached
        
        res = {}
        
        # 1. A股重要指数
        for sym in ["上证系列指数", "深证系列指数", "沪深重要指数"]:
            try:
                df = ak.stock_zh_index_spot_em(symbol=sym)
                for r in df.to_dict('records'):
                    code = str(r.get('代码'))
                    name = str(r.get('名称'))
                    data = {
                        "price": SafeUtils.clean_num(r.get('最新价')),
                        "changePercent": SafeUtils.clean_num(r.get('涨跌幅')),
                        "name": name
                    }
                    res[code] = data
                    res[name] = data
            except Exception as e: 
                pass
            
        # 2. 外盘指数 (index_global_spot_em)
        try:
            df = ak.index_global_spot_em()
            for r in df.to_dict('records'):
                name = str(r.get('名称')) # e.g., "纳斯达克100"
                code = str(r.get('代码')) # e.g., "100.NDX" (东方财富代码)
                
                data = {
                    "price": SafeUtils.clean_num(r.get('最新价')),
                    "changePercent": SafeUtils.clean_num(r.get('涨跌幅')),
                    "name": name
                }
                
                # 存入原始代码
                res[code] = data
                # 存入名称
                res[name] = data
                
                # 映射到标准 Key (e.g., .NDX) 以便 SPECIAL_MAPPING 使用
                if name in INDEX_SYMBOL_MAP:
                    target_key = INDEX_SYMBOL_MAP[name]
                    res[target_key] = data
                    
        except Exception as e:
            logger.error(f"Global Indices Fetch Error: {e}")
        
        cache_service.set(key, res)
        return res

    @staticmethod
    def fetch_etf_spot_cached():
        """获取ETF实时行情 (用于场内ETF映射)"""
        key = "etf_spot_map"
        cached = cache_service.get(key, 60)
        if cached: return cached
        res = {}
        try:
            df = ak.fund_etf_spot_em()
            for r in df.to_dict('records'):
                code = str(r.get('代码'))
                res[code] = {
                    "price": SafeUtils.clean_num(r.get('最新价')),
                    "changePercent": SafeUtils.clean_num(r.get('涨跌幅')),
                    "name": str(r.get('名称'))
                }
        except: pass
        cache_service.set(key, res)
        return res

    @staticmethod
    def fetch_sector_rankings_cached():
        """获取行业板块排行"""
        key = "sector_rankings"
        cached = cache_service.get(key, 180) # 3分钟缓存
        if cached: return cached
        
        try:
            df = ak.stock_board_industry_name_em()
            
            # 兼容不同的列名 (akshare 接口变动频繁)
            change_col = '涨跌幅'
            if '最新涨跌幅' in df.columns:
                change_col = '最新涨跌幅'
            elif '涨跌幅' in df.columns:
                change_col = '涨跌幅'
            else:
                logger.error(f"Sector ranking: Column '{change_col}' not found. Columns: {df.columns.tolist()}")
                return {"top": [], "bottom": []}

            # 确保列名正确并排序
            df['sort_val'] = pd.to_numeric(df[change_col], errors='coerce')
            df.sort_values('sort_val', ascending=False, inplace=True)
            
            top = df.head(6).to_dict('records')
            bottom = df.tail(6).to_dict('records')
            
            def fmt(rows):
                return [{
                    "name": str(r.get('板块名称', r.get('名称', ''))),
                    "changePercent": SafeUtils.clean_num(r.get(change_col)),
                    "leadingStock": str(r.get('领涨股票', ''))
                } for r in rows]

            res = {"top": fmt(top), "bottom": fmt(bottom)[::-1]} 
            cache_service.set(key, res)
            return res
        except Exception as e:
            logger.error(f"Sector ranking error: {e}")
            return {"top": [], "bottom": []}

    @staticmethod
    def fetch_fund_flow_cached():
        """获取资金流向 (大盘 + 行业)"""
        key = "market_fund_flow"
        cached = cache_service.get(key, 300)
        if cached: return cached
        
        res = {"market": None, "sectorFlow": {"inflow": [], "outflow": []}}
        
        # 1. 大盘资金流
        try:
            df = ak.stock_market_fund_flow()
            if not df.empty:
                # 转化为字典以便安全访问
                last = df.iloc[-1].to_dict()
                res["market"] = {
                    "date": str(last.get('日期', '')),
                    "main_net_inflow": SafeUtils.clean_num(last.get('主力净流入-净额')),
                    "main_net_ratio": SafeUtils.clean_num(last.get('主力净流入-净占比')),
                    "sh_close": SafeUtils.clean_num(last.get('上证-收盘价')),
                    "sh_change": SafeUtils.clean_num(last.get('上证-涨跌幅')),
                    "sz_close": SafeUtils.clean_num(last.get('深证-收盘价')),
                    "sz_change": SafeUtils.clean_num(last.get('深证-涨跌幅')),
                }
        except Exception as e:
            logger.error(f"Market fund flow error: {e}")

        # 2. 行业资金流
        try:
            df_sec = ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="行业资金流")
            if not df_sec.empty:
                chg_col = '今日涨跌幅' if '今日涨跌幅' in df_sec.columns else '涨跌幅'
                net_col = '主力净流入-净额'
                
                if net_col in df_sec.columns:
                    df_sec['net'] = pd.to_numeric(df_sec[net_col], errors='coerce')
                    df_sec.sort_values('net', ascending=False, inplace=True)
                    
                    def fmt(rows):
                        return [{
                            "name": str(r.get('名称', '')),
                            "change": SafeUtils.clean_num(r.get(chg_col)),
                            "netInflow": SafeUtils.clean_num(r.get('net'))
                        } for r in rows]
                    
                    res["sectorFlow"]["inflow"] = fmt(df_sec.head(5).to_dict('records'))
                    res["sectorFlow"]["outflow"] = fmt(df_sec.tail(5).to_dict('records')[::-1])
                else:
                    logger.warning(f"Sector flow: Column '{net_col}' not found.")
        except Exception as e:
             logger.error(f"Sector fund flow error: {e}")
        
        cache_service.set(key, res)
        return res

    # --- 四级火箭核心组件 ---

    @staticmethod
    def fetch_js_estimate_direct(code: str):
        """Level 1: 天天基金 JS 接口 (极速，仅盘中有效)"""
        try:
            ts = int(time_module.time() * 1000)
            url = f"https://fundgz.1234567.com.cn/js/{code}.js?rt={ts}"
            resp = GlobalSession.get().get(url, headers=AkshareService.get_headers(), timeout=1.5)
            if resp.status_code == 200:
                match = re.search(r'jsonpgz\s*=?\s*\((.*?)\)', resp.text, re.S)
                if match:
                    return json.loads(match.group(1))
        except: pass
        return None

    @staticmethod
    def fetch_batch_estimate_cached():
        """Level 2: 官方批量估值接口 (盘后权威)"""
        key = "batch_estimate_em"
        # 盘中缓存 5 分钟，盘后缓存 30 分钟
        ttl = 300 if AkshareService.get_time_phase() == 'MARKET' else 1800
        cached = cache_service.get(key, ttl)
        if cached: return cached
        
        res = {}
        try:
            # 获取全部基金估值
            df = ak.fund_value_estimation_em(symbol="全部")
            if not df.empty:
                # 必须使用 .get() 避免列名带减号导致的 AttributeError
                for r in df.to_dict('records'):
                    code = str(r.get('基金代码'))
                    res[code] = {
                        "gsz": str(r.get('交易日-估算数据-估算值')),
                        "gszzl": str(SafeUtils.clean_num(r.get('交易日-估算数据-估算增长率'))),
                        "dwjz": str(r.get('交易日-公布数据-单位净值')),
                        "jzrq": str(r.get('交易日-估算数据-估算时间'))[:10], # 取日期部分
                        "gztime": str(r.get('交易日-估算数据-估算时间'))[-8:] # 取时间部分
                    }
        except Exception as e:
            logger.warning(f"Batch estimate fetch failed: {e}")
        
        cache_service.set(key, res)
        return res

    @staticmethod
    def fetch_holdings_sync(code: str):
        """Level 4: 获取重仓股权重"""
        try:
            current_year = datetime.now().year
            combined_df = pd.DataFrame()
            # 尝试今明两年，防止年初无数据
            for y in [current_year, current_year - 1]:
                try:
                    df = ak.fund_portfolio_hold_em(symbol=code, date=str(y))
                    if not df.empty and '季度' in df.columns: 
                        combined_df = pd.concat([combined_df, df])
                except: continue
            
            if combined_df.empty: return []
            
            # 取最新季度
            latest_q = combined_df.iloc[0]['季度']
            combined_df = combined_df[combined_df['季度'] == latest_q]
            
            # 排序取前10
            combined_df['percent'] = combined_df['占净值比例'].apply(SafeUtils.clean_num)
            combined_df = combined_df.sort_values(by='percent', ascending=False).head(10)
            
            return [{
                "code": str(r['股票代码']),
                "name": str(r['股票名称']),
                "percent": float(r['percent'])
            } for r in combined_df.to_dict('records')]
        except: return []

    @staticmethod
    def fetch_history_cached(code: str):
        """获取历史净值 (确认昨日净值)"""
        key = f"hist_{code}"
        cached = cache_service.get(key, 3600) # 1小时缓存
        if cached is not None: return cached
        
        try:
            df = ak.fund_open_fund_info_em(symbol=code, indicator="单位净值走势")
            if not df.empty:
                last_row = df.iloc[-1]
                data = {
                    "date": str(last_row['净值日期']),
                    "nav": SafeUtils.clean_num(last_row['单位净值'])
                }
                cache_service.set(key, data)
                return data
        except: pass
        return None

# --- 控制器逻辑 ---

class FundController:
    
    @staticmethod
    async def get_fund_detail(code: str):
        # 并发获取基础信息、持仓、行业
        t_holdings = run_in_threadpool(AkshareService.fetch_holdings_sync, code)
        t_basic = run_in_threadpool(ak.fund_individual_basic_info_xq, symbol=code)
        t_market = run_in_threadpool(AkshareService.fetch_stock_map_cached)
        
        holdings, basic_df, market_map = await asyncio.gather(t_holdings, t_basic, t_market)
        
        basic_info = {}
        if not basic_df.empty:
            for _, r in basic_df.iterrows(): basic_info[r['item']] = r['value']

        # 填充持仓实时行情
        for h in holdings:
            c = h['code']
            # 尝试匹配 A股/港股/美股
            spot = market_map.get(c)
            if not spot and len(c) == 5: spot = market_map.get(c) # HK potential
            
            if spot:
                h['currentPrice'] = spot['price']
                h['changePercent'] = spot['changePercent']
            else:
                h['currentPrice'] = 0.0
                h['changePercent'] = 0.0

        return {
            "code": code,
            "manager": basic_info.get('基金经理', '暂无'),
            "type": basic_info.get('基金类型', '混合型'),
            "start_date": basic_info.get('成立时间', '--'),
            "holdings": holdings,
            "industryDistribution": [] # 简化
        }

    @staticmethod
    async def batch_estimate(codes: List[str]):
        """
        三级火箭估值引擎实现 - 严格遵循 天天基金JS -> 官方批量 -> 重仓股穿透 顺序
        """
        if not codes: return []
        
        phase = AkshareService.get_time_phase()
        today_str = datetime.now().strftime('%Y-%m-%d')
        
        # 预加载全局数据
        # 1. 批量估值表 (Level 2)
        # 无论盘中盘后都尝试加载，作为备用数据源
        batch_map = await run_in_threadpool(AkshareService.fetch_batch_estimate_cached)
        
        async def estimate_one(code):
            res = {
                "fundcode": code, "name": "", 
                "gsz": "0", "gszzl": "0", "dwjz": "0", 
                "jzrq": "", "gztime": "", "source": "none"
            }
            
            # --- Level 0: 历史净值 (保底) ---
            hist = await run_in_threadpool(AkshareService.fetch_history_cached, code)
            if hist:
                res['dwjz'] = str(hist['nav'])
                res['jzrq'] = hist['date']
                # 如果历史净值日期就是今天，说明官方已更新 (Level 0: 终局)
                if hist['date'] == today_str:
                    res['gsz'] = str(hist['nav'])
                    res['gszzl'] = "0.00" 
                    res['source'] = "official_final"
                    return res

            # --- Level 1: JS 接口 (极速 - 盘中首选) ---
            if phase != 'POST_MARKET':
                js_data = await run_in_threadpool(AkshareService.fetch_js_estimate_direct, code)
                if js_data:
                    val = SafeUtils.clean_num(js_data.get('gszzl'))
                    # 条件：获取到的 gszzl 不为 0
                    if abs(val) > 0.0001: 
                        res.update(js_data)
                        res['source'] = "official_realtime_js"
                        return res

            # --- Level 2: 批量接口 (权威 - 盘后首选 / 盘中备用) ---
            if code in batch_map:
                bm = batch_map[code]
                bm_val = SafeUtils.clean_num(bm.get('gszzl'))
                
                # 如果是盘后 (POST_MARKET)，直接使用
                if phase == 'POST_MARKET':
                    res.update(bm)
                    res['source'] = "official_batch_em"
                    return res
                
                # 如果是盘中，且有有效值(Level 1 没拿到)，则作为备用
                if abs(bm_val) > 0.0001:
                    res.update(bm)
                    res['source'] = "official_batch_em"
                    return res

            # --- Level 3: 重仓股穿透 (兜底 - 仅盘中) ---
            # 条件：仅在 phase == 'MARKET' 且以上所有方法都失效时执行
            if phase == 'MARKET':
                holdings = await run_in_threadpool(AkshareService.fetch_holdings_sync, code)
                if holdings:
                    # 获取实时行情 (带缓存)
                    market_map = await run_in_threadpool(AkshareService.fetch_stock_map_cached)
                    
                    total_impact = 0.0
                    total_weight = 0.0
                    
                    for h in holdings:
                        hc = h['code']
                        w = h['percent']
                        stock_info = market_map.get(hc)
                        
                        if stock_info:
                            total_impact += stock_info['changePercent'] * w
                            total_weight += w
                    
                    # 只有当持仓权重覆盖超过 30% 时才认为有效
                    if total_weight > 30: 
                        est_chg = (total_impact / total_weight) * 0.95 # 0.95为仓位修正系数
                        last_nav = float(res['dwjz']) if float(res['dwjz']) > 0 else 1.0
                        est_val = last_nav * (1 + est_chg / 100)
                        
                        res['gsz'] = f"{est_val:.4f}"
                        res['gszzl'] = f"{est_chg:.2f}"
                        res['source'] = "holdings_calc_realtime"
                        res['gztime'] = datetime.now().strftime("%H:%M")
                        return res

            return res

        # 并发执行
        tasks = [estimate_one(c) for c in codes]
        return await asyncio.gather(*tasks)

    @staticmethod
    async def chat_with_ai(request: AnalyzeRequest):
        # 强制 BYOK: 必须传入 api_key
        if not request.api_key:
            raise HTTPException(status_code=400, detail="Missing API Key. Please configure it in settings.")
        
        try:
            genai.configure(api_key=request.api_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            response = await run_in_threadpool(model.generate_content, request.prompt)
            return {"text": response.text}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"AI Service Error: {str(e)}")

# --- FastAPI App ---
app = FastAPI(title="SmartFund API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
router = APIRouter(prefix="/api")

@app.on_event("startup")
async def startup():
    # 预热缓存
    await run_in_threadpool(AkshareService.fetch_global_indices_cached)

@router.get("/status")
def status():
    return {"status": "ok", "phase": AkshareService.get_time_phase()}

@router.get("/search")
async def search(key: str):
    # Search implementation skipped for brevity
    return [] 

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

@router.get("/market/overview")
async def market(codes: Optional[str] = None):
    # 并发获取: 指数 + 板块 + 资金流
    t_indices = run_in_threadpool(AkshareService.fetch_global_indices_cached)
    t_sectors = run_in_threadpool(AkshareService.fetch_sector_rankings_cached)
    t_flow = run_in_threadpool(AkshareService.fetch_fund_flow_cached)
    
    indices_map, sectors, flow = await asyncio.gather(t_indices, t_sectors, t_flow)
    
    # 市场概览：指数
    target_codes = codes.split(',') if codes else list(INDEX_SYMBOL_MAP.values())
    
    indices = []
    for c in target_codes:
        if c in indices_map:
            val = indices_map[c]
            indices.append({
                "code": c, 
                "name": val['name'], 
                "value": val['price'], 
                "changePercent": val['changePercent']
            })
    
    return {
        "indices": indices,
        "sectors": sectors,
        "fundFlow": flow,
        "fundRankings": {"gainers": [], "losers": []} # 暂未实现基金榜单
    }

@router.get("/history/{code}")
async def history(code: str):
    hist = await run_in_threadpool(AkshareService.fetch_history_cached, code)
    if hist: return [{"date": hist['date'], "value": hist['nav']}]
    return []

@router.post("/analyze")
async def analyze(request: AnalyzeRequest):
    return await FundController.chat_with_ai(request)

app.include_router(router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
