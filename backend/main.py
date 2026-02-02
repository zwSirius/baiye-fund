
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
import time as time_module
import os
from datetime import datetime, timedelta, time
from typing import List, Dict, Any, Optional

# --- Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SmartFund")

# --- Constants ---
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://fund.eastmoney.com/",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
}

# --- Smart Proxy Mapping (LV2 Core) ---
PROXY_MAP = {
    # 宽基指数
    "沪深300": "510300", "300联接": "510300",
    "中证500": "510500", "500联接": "510500",
    "中证1000": "512100", "1000联接": "512100",
    "创业板": "159915", "科创50": "588000", "上证50": "510050",
    "A50": "560050", "2000": "561370",
    
    # 热门行业
    "白酒": "512690", "消费": "512690", "食品": "512690",
    "半导体": "512480", "芯片": "512480", "集成电路": "512480",
    "医疗": "512170", "医药": "512010", "药": "512010",
    "新能源": "515030", "光伏": "515790", "电池": "159755",
    "军工": "512660", "国防": "512660",
    "证券": "512880", "全指金融": "512880", "银行": "512800",
    "人工智能": "515070", "AI": "515070", "计算机": "512720",
    "游戏": "516010", "动漫": "516010", "传媒": "512980",
    "红利": "515080", "煤炭": "515220",
    
    # 大宗商品 & 跨境 QDII
    "黄金": "518880", "金": "518880", 
    "纳斯达克": "513100", "纳指": "513100", "标普": "513500",
    "恒生科技": "513130", "港股通科技": "513130",
    "恒生互联网": "513330", "中概": "513050", "互联网": "513050",
    
    # 债券 (LV2 债基映射)
    "可转债": "511380", "转债": "511380",
    "国债": "511260", "政金债": "511520",
    "短债": "511260", "中长债": "511260", "纯债": "511260", "信用债": "511260"
}

class AkshareService:
    @staticmethod
    def get_time_phase():
        """返回当前市场状态"""
        now = datetime.utcnow() + timedelta(hours=8)
        if now.weekday() >= 5: return 'CLOSED' # 周末
        t = now.time()
        if t < time(9, 25): return 'PRE_MARKET'
        elif t >= time(11, 30) and t < time(13, 0): return 'LUNCH_BREAK'
        elif t <= time(15, 0): return 'MARKET'
        else: return 'POST_MARKET'

    @staticmethod
    def fetch_realtime_quotes(codes: List[str]) -> Dict[str, float]:
        """
        获取实时涨跌幅。
        注：Akshare 的 realtime 接口通常是全量获取(慢)，这里使用带 Headers 的轻量 API。
        """
        if not codes: return {}
        secids = []
        for c in codes:
            # 简单判断市场前缀 (东财 secid 规则)
            if c.startswith(('6', '5', '11', '13')): secids.append(f"1.{c}")
            else: secids.append(f"0.{c}")
            
        url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12&secids={','.join(secids)}"
        quotes = {}
        try:
            resp = requests.get(url, headers=HEADERS, timeout=2.0)
            data = resp.json()
            if data and 'data' in data and 'diff' in data['data']:
                for item in data['data']['diff']:
                    quotes[str(item['f12'])] = float(item['f3']) if item['f3'] != '-' else 0.0
        except Exception as e:
            logger.error(f"Quote fetch error: {e}")
        return quotes

    @staticmethod
    def fetch_holdings_ak(code: str) -> List[Dict]:
        """
        使用 akshare 获取重仓股数据。
        ak.fund_portfolio_hold_em 需要指定年份，我们自动尝试今年和去年。
        """
        try:
            current_year = datetime.now().year
            # 尝试获取今年的持仓
            df = ak.fund_portfolio_hold_em(symbol=code, date=str(current_year))
            # 如果今年还没出年报/季报，取去年的
            if df is None or df.empty:
                df = ak.fund_portfolio_hold_em(symbol=code, date=str(current_year - 1))
            
            if df is None or df.empty:
                return []
                
            # akshare 返回列名：['序号', '股票代码', '股票名称', '占净值比例', '持股数', '持仓市值', '季度']
            # 需要转换为标准格式
            holdings = []
            for _, row in df.iterrows():
                if len(holdings) >= 10: break # 只取前十
                try:
                    percent = float(row['占净值比例'])
                    holdings.append({
                        "code": str(row['股票代码']),
                        "name": str(row['股票名称']),
                        "percent": percent
                    })
                except: continue
            return holdings
        except Exception as e:
            logger.error(f"Akshare holdings error for {code}: {e}")
            return []

class FundController:
    @staticmethod
    async def get_estimate(code: str, phase: str):
        loop = asyncio.get_running_loop()
        
        res = {
            "fundcode": code,
            "name": "",
            "dwjz": "0",
            "gsz": "0",
            "gszzl": "0",
            "jzrq": "",
            "source": "LV4_NONE"
        }

        # --- LV1: Official (官方估值) ---
        official_data = None
        try:
            url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={int(time_module.time())}"
            resp = await loop.run_in_executor(None, requests.get, url, {"headers": HEADERS, "timeout": 2.0})
            match = re.search(r'jsonpgz\((.*?)\);', resp.text)
            if match:
                official_data = json.loads(match.group(1))
        except: pass

        if official_data:
            res['name'] = official_data.get('name', '')
            res['dwjz'] = official_data.get('dwjz', '0')
            res['jzrq'] = official_data.get('jzrq', '')
            gszzl = float(official_data.get('gszzl', '0'))
            
            # 盘后/盘前：信任官方昨日净值
            if phase in ['CLOSED', 'PRE_MARKET']:
                 res['gsz'] = res['dwjz']
                 res['gszzl'] = '0'
                 res['source'] = 'LV1_OFFICIAL_CLOSE'
                 return res
            
            # 盘中：如果官方数据有波动(>0.001)，且不是 0，则采信
            # (排除掉 0 的情况，因为很多债基/QDII/联接基金 盘中官方估值一直是 0)
            if abs(gszzl) > 0.001:
                res['gszzl'] = str(gszzl)
                res['gsz'] = official_data.get('gsz', res['dwjz'])
                res['source'] = 'LV1_OFFICIAL'
                return res
        
        # 如果官方无数据（连名字都没有），尝试从本地数据库或 Akshare 补全信息过于耗时，这里假设 fundgz 至少能给个基础信息。
        # 如果 fundgz 彻底失败（API挂了），此处 res['name'] 为空，前端会显示 Code。

        # --- LV2: Smart Proxy (场内映射) ---
        # 针对：场外联接、QDII、债券、黄金等官方估值失效(0%)的情况
        target_name = res['name']
        proxy_code = None
        
        # 自身就是 ETF/LOF
        if code.startswith(('51', '159', '58', '56')):
            proxy_code = code
        else:
            # 查找映射表
            for k, v in PROXY_MAP.items():
                if k in target_name:
                    proxy_code = v
                    break
        
        if proxy_code:
            try:
                quotes = await loop.run_in_executor(None, AkshareService.fetch_realtime_quotes, [proxy_code])
                if proxy_code in quotes:
                    change = quotes[proxy_code]
                    res['gszzl'] = f"{change:.2f}"
                    res['gsz'] = str(float(res['dwjz']) * (1 + change/100))
                    res['source'] = f'LV2_PROXY_{proxy_code}'
                    return res
            except: pass

        # --- LV3: Holdings Penetration (重仓穿透) ---
        # 针对：主动权益基金（官方估值不准或滞后）
        try:
            # 使用 Akshare 获取持仓 (运行在线程池以免阻塞)
            holdings = await loop.run_in_executor(None, AkshareService.fetch_holdings_ak, code)
            
            if holdings:
                stock_codes = [h['code'] for h in holdings]
                quotes = await loop.run_in_executor(None, AkshareService.fetch_realtime_quotes, stock_codes)
                
                weighted_change = 0.0
                total_percent = 0.0
                
                for h in holdings:
                    c = h['code']
                    q_change = quotes.get(c, 0.0)
                    weighted_change += q_change * (h['percent'] / 100)
                    total_percent += h['percent']
                
                if total_percent > 0:
                    # 线性外推：(加权涨跌 / 监控仓位占比) * 修正系数
                    # 混合/股票型 仓位一般 85-90%
                    estimated_change = (weighted_change / (total_percent / 100)) * 0.9
                    
                    res['gszzl'] = f"{estimated_change:.2f}"
                    res['gsz'] = str(float(res['dwjz']) * (1 + estimated_change/100))
                    res['source'] = 'LV3_HOLDINGS'
                    return res
        except Exception as e:
            logger.error(f"LV3 error: {e}")

        # --- LV4: Give Up ---
        return res

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
router = APIRouter(prefix="/api")

@router.get("/search")
async def search(key: str):
    """
    搜索接口。
    Akshare 的 fund_name_em() 数据量太大，无法用于实时搜索。
    保留使用 Eastmoney API，但增加 Headers 防止被拦截。
    """
    if not key: return []
    url = f"https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key={key}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=3.0)
        data = resp.json()
        results = []
        if 'Datas' in data:
            for item in data['Datas']:
                # 过滤掉非基金代码
                if item['CATEGORY'] in ['基金', '混合型', '股票型', '债券型', '指数型', 'QDII', 'ETF', 'LOF']:
                    results.append({
                        "code": item['CODE'],
                        "name": item['NAME'],
                        "type": item['CATEGORY']
                    })
        return results
    except Exception as e:
        logger.error(f"Search error: {e}")
        return []

@router.post("/estimate/batch")
async def estimate_batch(payload: dict = Body(...)):
    codes = payload.get('codes', [])
    phase = AkshareService.get_time_phase()
    tasks = [FundController.get_estimate(c, phase) for c in codes]
    return await asyncio.gather(*tasks)

@router.get("/fund/{code}")
async def fund_detail(code: str):
    loop = asyncio.get_running_loop()
    # 使用 Akshare 获取持仓
    holdings = await loop.run_in_executor(None, AkshareService.fetch_holdings_ak, code)
    
    if not holdings: return {"holdings": []}
    
    stock_codes = [h['code'] for h in holdings]
    quotes = await loop.run_in_executor(None, AkshareService.fetch_realtime_quotes, stock_codes)
    
    detailed_holdings = []
    for h in holdings:
        q_change = quotes.get(h['code'], 0.0)
        # 估算股价：由于 realtime 接口只返回 change，没有 price (为了速度)，这里暂时用 0 或 mock
        # 如果需要 Price，需换用更重的 API，但用户更关注涨跌幅贡献
        detailed_holdings.append({
            "code": h['code'],
            "name": h['name'],
            "percent": h['percent'],
            "currentPrice": 0, 
            "changePercent": q_change
        })
    return {"holdings": detailed_holdings, "manager": "Fund Manager"}

@router.get("/history/{code}")
async def fund_history(code: str):
    """
    历史净值：使用 Akshare 的标准接口
    """
    try:
        # ak.fund_open_fund_info_em 是获取历史净值的标准接口
        df = await run_in_threadpool(ak.fund_open_fund_info_em, fund=code, indicator="单位净值走势")
        if df.empty: return []
        # 只要最近 365 天
        recent = df.tail(365)
        # 格式化
        return [{"date": row['净值日期'].strftime('%Y-%m-%d'), "value": row['单位净值']} for _, row in recent.iterrows()]
    except Exception as e:
        logger.error(f"History error: {e}")
        return []

@router.get("/market")
async def market(codes: str = Query(None)):
    target_codes = codes.split(',') if codes else ["1.000001", "0.399001", "0.399006"]
    # 复用 realtime quotes 的逻辑，但市场指数需要具体的点位(value)
    # 我们调用一个稍微全一点的接口
    secids = []
    for c in target_codes:
        if c.startswith(('1.','0.')): secids.append(c) # 已有前缀
        elif c.startswith(('6','5')): secids.append(f"1.{c}")
        else: secids.append(f"0.{c}")
    
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f14&secids={','.join(secids)}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=2.0)
        data = resp.json()
        if data and 'data' in data:
            return [{"name": i['f14'], "code": str(i['f12']), "changePercent": float(i['f3']), "value": float(i['f2'])} for i in data['data']['diff']]
    except: pass
    return []

app.include_router(router)
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
