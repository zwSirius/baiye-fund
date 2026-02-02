
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

# --- Smart Proxy Mapping (LV2 Core) ---
# 将场外基金的名称关键词映射到场内流动性最好的 ETF 代码或指数代码
PROXY_MAP = {
    # 宽基指数
    "沪深300": "510300",
    "300联接": "510300",
    "中证500": "510500",
    "500联接": "510500",
    "中证1000": "512100",
    "1000联接": "512100",
    "创业板": "159915",
    "科创50": "588000",
    "上证50": "510050",
    
    # 热门行业
    "白酒": "512690",
    "消费": "512690",
    "食品饮料": "512690",
    "半导体": "512480",
    "芯片": "512480",
    "医疗": "512170",
    "医药": "512010",
    "新能源": "515030",
    "光伏": "515790",
    "军工": "512660",
    "证券": "512880",
    "全指金融": "512880",
    "银行": "512800",
    "人工智能": "515070",
    "游戏": "516010",
    "传媒": "512980",
    
    # 大宗商品 & 跨境 QDII
    "黄金": "518880", # 黄金ETF
    "纳斯达克": "513100", # 纳指ETF
    "标普500": "513500", # 标普500ETF
    "恒生科技": "513130",
    "恒生互联网": "513330",
    "中概互联": "513050",
    
    # 债券 (作为风向标)
    # 纯债基金波动小，且无实时单一标的，这里用 30年国债ETF 或 可转债ETF 做参考不太准
    # 策略：如果名称含"债"，映射到 十年国债期货主连(需期货接口) 或 简单的债市指数
    # 这里暂映射到企债指数 ETF (511260) 或者简单处理
    "可转债": "511380", # 转债ETF
    "短债": "511260", # 十年国债ETF(暂代)
    "中长债": "511260",
}

class AkshareService:
    @staticmethod
    def get_headers():
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://fund.eastmoney.com/"
        }

    @staticmethod
    def get_time_phase():
        """返回当前市场状态"""
        now = datetime.utcnow() + timedelta(hours=8)
        if now.weekday() >= 5: return 'CLOSED' # 周末
        t = now.time()
        if t < time(9, 30): return 'PRE_MARKET'
        elif t >= time(11, 30) and t < time(13, 0): return 'LUNCH_BREAK'
        elif t <= time(15, 0): return 'MARKET' # 15:00 收盘
        else: return 'POST_MARKET'

    @staticmethod
    def fetch_realtime_quotes(codes: List[str]) -> Dict[str, float]:
        """
        获取实时涨跌幅。
        为了速度，这里不直接调用 ak.stock_zh_a_spot_em() (因为那个返回全市场数据太慢)。
        我们模拟 akshare 内部逻辑，请求东财具体接口。
        """
        if not codes: return {}
        secids = []
        for c in codes:
            # 简单判断市场前缀
            if c.startswith(('6', '5', '11', '13')): secids.append(f"1.{c}")
            else: secids.append(f"0.{c}")
            
        url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12&secids={','.join(secids)}"
        quotes = {}
        try:
            resp = requests.get(url, timeout=2.0)
            data = resp.json()
            if data and 'data' in data and 'diff' in data['data']:
                for item in data['data']['diff']:
                    # f3 是涨跌幅
                    quotes[str(item['f12'])] = float(item['f3']) if item['f3'] != '-' else 0.0
        except: pass
        return quotes

    @staticmethod
    def fetch_holdings(code: str) -> List[Dict]:
        """
        获取基金重仓股。
        尝试使用 akshare 逻辑 (其实 akshare 也是爬东财)。
        """
        url = f"https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10"
        try:
            resp = requests.get(url, headers=AkshareService.get_headers(), timeout=3.0)
            codes = re.findall(r'href="https://quote.eastmoney.com/(.*?)\.html">', resp.text)
            percents = re.findall(r'<td class="[^"]*">([\d\.]+)%</td>', resp.text)
            
            holdings = []
            for i in range(min(len(codes), len(percents))):
                raw_code = codes[i].split('.')[-1]
                holdings.append({
                    "code": raw_code,
                    "percent": float(percents[i])
                })
            return holdings
        except: return []

class FundController:
    @staticmethod
    async def get_estimate(code: str, phase: str):
        loop = asyncio.get_running_loop()
        
        # 基础数据结构
        res = {
            "fundcode": code,
            "name": "",
            "dwjz": "0",    # 昨日净值
            "gsz": "0",     # 估算净值
            "gszzl": "0",   # 估算涨跌幅
            "jzrq": "",     # 净值日期
            "source": "LV4_NONE" # 来源标记
        }

        # --- LV1: 官方实时估值 (Official) ---
        # 即使官方不准，如果有数据更新且不在休市期间，我们先拿来作为底包（获取名称、昨日净值等基础信息）
        official_data = None
        try:
            url = f"http://fundgz.1234567.com.cn/js/gszzl_{code}.js?rt={int(time_module.time())}"
            resp = await loop.run_in_executor(None, requests.get, url, {"timeout": 1.5})
            match = re.search(r'jsonpgz\((.*?)\);', resp.text)
            if match:
                official_data = json.loads(match.group(1))
        except: pass

        if official_data:
            res['name'] = official_data.get('name', '')
            res['dwjz'] = official_data.get('dwjz', '0')
            res['jzrq'] = official_data.get('jzrq', '')
            
            # 判断官方估值是否有效 (非 0，且在交易时段)
            gszzl = float(official_data.get('gszzl', '0'))
            
            # 如果是盘后/周末，直接信任官方（可能是结算后的净值）
            if phase in ['CLOSED', 'POST_MARKET', 'PRE_MARKET']:
                 # 注意：如果是盘后，官方接口可能还没更新今日净值，依然显示昨日估值。
                 # 这里我们主要用 dwjz。
                 res['gsz'] = res['dwjz']
                 res['gszzl'] = '0'
                 res['source'] = 'LV1_OFFICIAL_CLOSE'
                 return res
            
            # 盘中：如果官方有非零波动，暂时信任（权益类通常有）
            # 但如果是 0，或者明显是债基/联接，进入 LV2
            if abs(gszzl) > 0.001:
                res['gszzl'] = str(gszzl)
                res['gsz'] = official_data.get('gsz', res['dwjz'])
                res['source'] = 'LV1_OFFICIAL'
                # 只有当它是普通股票基金时才直接返回，
                # 如果是 "联接" 或 "ETF"，官方可能有延迟，继续检查优化
                if "联接" not in res['name'] and "ETF" not in res['name']:
                    return res

        # 如果没有基础信息（连名字都取不到），尝试 akshare 补充基础信息 (此处略，假设 fundgz 总能返回基础信息)
        if not res['name']: 
             # 兜底：如果完全查不到，返回空
             return res

        # --- LV2: 场内 ETF/指数 智能映射 (Smart Proxy) ---
        # 适用于：场外联接、QDII、商品、由于政策不展示估值的债基
        proxy_code = None
        
        # 1. 直接匹配映射表
        for key, p_code in PROXY_MAP.items():
            if key in res['name']:
                proxy_code = p_code
                break
        
        # 2. 特殊处理：如果是场内基金本身 (5/159开头)，直接用自己
        if code.startswith(('51', '159', '58', '56')):
            proxy_code = code

        if proxy_code:
            try:
                quotes = await loop.run_in_executor(None, AkshareService.fetch_realtime_quotes, [proxy_code])
                if proxy_code in quotes:
                    change = quotes[proxy_code]
                    res['gszzl'] = str(change)
                    res['gsz'] = str(float(res['dwjz']) * (1 + change/100))
                    res['source'] = f'LV2_PROXY_{proxy_code}'
                    return res
            except: 
                pass # Proxy failed, fall through to LV3

        # --- LV3: 重仓股穿透 (Holdings Penetration) ---
        # 适用于：主动权益基金、未在映射表中的混合基金
        holdings = await loop.run_in_executor(None, AkshareService.fetch_holdings, code)
        if holdings:
            stock_codes = [h['code'] for h in holdings]
            # 批量获取重仓股行情
            quotes = await loop.run_in_executor(None, AkshareService.fetch_realtime_quotes, stock_codes)
            
            weighted_change = 0.0
            total_percent = 0.0
            
            for h in holdings:
                c = h['code']
                if c in quotes:
                    # 贡献度 = 持仓占比 * 涨跌幅
                    # 注意：h['percent'] 是百分数 (e.g. 8.5 表示 8.5%)
                    weighted_change += quotes[c] * (h['percent'] / 100)
                    total_percent += h['percent']
            
            # 简单线性外推：假设前十大重仓代表了整体仓位风格
            # 如果前十大占比 50%，涨了 1%，那么假设剩下 50% 也涨了 1% (即整体涨1%)
            # 或者更保守一点：只计算前十大的贡献（如果不满仓）。
            # 通常做法：Result = Sum(Weight * Change) / Sum(Weights) * StockPosRatio
            # 这里简化：直接用前十大加权平均值作为基金整体估值
            if total_percent > 0:
                estimated_change = weighted_change / (total_percent / 100) 
                
                # 修正：通常基金仓位不是 100%，股票型约 85%-90%。
                # 如果是混合型，可能更低。简单打个 0.9 的折扣系数防止高估
                if "股票" in res['name'] or "指数" in res['name']:
                    estimated_change = estimated_change * 0.95
                else: 
                    estimated_change = estimated_change * 0.85 # 混合型保守点

                res['gszzl'] = f"{estimated_change:.2f}"
                res['gsz'] = str(float(res['dwjz']) * (1 + estimated_change/100))
                res['source'] = 'LV3_HOLDINGS'
                return res

        # --- LV4: 无法获取 (Give Up) ---
        # 实在是没辙了 (纯债且名字没匹配到，或者新发基金无持仓)
        # 保持官方的 0 或 昨日净值
        return res

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
router = APIRouter(prefix="/api")

@router.get("/search")
async def search(key: str):
    """搜索接口：保持直接调用东财，Akshare本地库太大不适合实时搜索"""
    url = f"http://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key={key}"
    try:
        resp = requests.get(url, timeout=2.0)
        data = resp.json()
        results = []
        if 'Datas' in data:
            for item in data['Datas']:
                if item['CATEGORY'] in ['基金', '混合型', '股票型', '债券型', '指数型', 'QDII']:
                    results.append({
                        "code": item['CODE'],
                        "name": item['NAME'],
                        "type": item['CATEGORY']
                    })
        return results
    except: return []

@router.post("/estimate/batch")
async def estimate_batch(payload: dict = Body(...)):
    codes = payload.get('codes', [])
    phase = AkshareService.get_time_phase()
    # 并发处理
    tasks = [FundController.get_estimate(c, phase) for c in codes]
    return await asyncio.gather(*tasks)

@router.get("/fund/{code}")
async def fund_detail(code: str):
    loop = asyncio.get_running_loop()
    holdings = await loop.run_in_executor(None, AkshareService.fetch_holdings, code)
    if not holdings: return {"holdings": []}
    
    stock_codes = [h['code'] for h in holdings]
    quotes = await loop.run_in_executor(None, AkshareService.fetch_realtime_quotes, stock_codes)
    
    detailed_holdings = []
    # 如果找不到名字，尝试批量补全名字（为了速度略过，前端已有名字或不显示）
    # 这里简单处理，Detailed 需要名字，Akshare 接口其实在 fetch_holdings 里可以解析出来，这里为了简化没写解析名字的正则
    # 实际项目中应完善 regex
    
    for h in holdings:
        q_change = quotes.get(h['code'], 0.0)
        detailed_holdings.append({
            "code": h['code'],
            "name": f"Stock-{h['code']}", # 暂无名字，如需名字需升级 fetch_holdings 正则
            "percent": h['percent'],
            "currentPrice": 0, # 简化
            "changePercent": q_change
        })
    return {"holdings": detailed_holdings, "manager": "Fund Manager"}

@router.get("/history/{code}")
async def fund_history(code: str):
    """历史净值：Akshare 标准接口"""
    try:
        df = await run_in_threadpool(ak.fund_open_fund_info_em, fund=code, indicator="单位净值走势")
        if df.empty: return []
        recent = df.tail(200)
        return [{"date": row['净值日期'].strftime('%Y-%m-%d'), "value": row['单位净值']} for _, row in recent.iterrows()]
    except: return []

@router.get("/market")
async def market(codes: str = Query(None)):
    target_codes = codes.split(',') if codes else ["1.000001", "0.399001", "0.399006"]
    # 复用 realtime quotes 逻辑，但 market 接口通常需要 value，AkshareService.fetch_realtime_quotes 只返回了 change
    # 这里为了完整性，还是走专门的 market quotes 逻辑
    quotes = {}
    secids = []
    for c in target_codes:
        if c.startswith(('1.','0.')): secids.append(c)
        elif c.startswith(('6','5')): secids.append(f"1.{c}")
        else: secids.append(f"0.{c}")
    
    url = f"http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f14&secids={','.join(secids)}"
    try:
        resp = requests.get(url, timeout=2.0)
        data = resp.json()
        if data and 'data' in data:
            return [{"name": i['f14'], "code": str(i['f12']), "changePercent": float(i['f3']), "value": float(i['f2'])} for i in data['data']['diff']]
    except: pass
    return []

app.include_router(router)
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
