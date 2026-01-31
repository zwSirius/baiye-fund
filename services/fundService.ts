import { Fund, Stock, BacktestResult, BacktestPoint, SectorIndex } from '../types';

// --- 配置你的后端地址 ---
const API_BASE = 'https://baiye1997-baiye-fund-api.hf.space';

// --- 本地存储键名 ---
const STORAGE_KEY_FUNDS = 'smartfund_funds_v1';
const STORAGE_KEY_GROUPS = 'smartfund_groups_v1';

// --- Storage & Data Management (保持不变) ---

export const saveFundsToLocal = (funds: Fund[]) => {
    localStorage.setItem(STORAGE_KEY_FUNDS, JSON.stringify(funds));
};

export const saveGroupsToLocal = (groups: any[]) => {
    localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(groups));
};

export const getStoredGroups = () => {
    const stored = localStorage.getItem(STORAGE_KEY_GROUPS);
    if (stored) {
        return JSON.parse(stored);
    }
    return [
        { id: 'default', name: '我的账户', isDefault: true },
        { id: 'wife', name: '老婆账户', isDefault: false }
    ];
};

export const getInitialFunds = (): Fund[] => {
  const stored = localStorage.getItem(STORAGE_KEY_FUNDS);
  if (stored) {
      return JSON.parse(stored) as Fund[];
  }
  return [];
};

export const exportData = () => {
    const data = {
        funds: getInitialFunds(),
        groups: getStoredGroups(),
        timestamp: Date.now(),
        version: '1.0'
    };
    return JSON.stringify(data, null, 2);
};

export const importData = (jsonString: string): boolean => {
    try {
        const data = JSON.parse(jsonString);
        if (data.funds && data.groups) {
            saveFundsToLocal(data.funds);
            saveGroupsToLocal(data.groups);
            return true;
        }
        return false;
    } catch (e) {
        console.error("Import failed", e);
        return false;
    }
};

// --- 全新纯后端 API 接口 ---

// 1. 搜索基金 (Backend)
export const searchFunds = async (query: string): Promise<Fund[]> => {
  if (!query) return [];
  try {
    const response = await fetch(`${API_BASE}/api/search?key=${encodeURIComponent(query)}`);
    const data = await response.json();
    
    // 适配后端返回格式 (假设后端透传或标准化了数据)
    // 如果后端返回 [{ "基金代码": "...", "基金简称": "..." }]
    if (Array.isArray(data)) {
        return data.map((item: any) => ({
            id: `temp_${item.CODE || item['基金代码']}`,
            code: item.CODE || item['基金代码'],
            name: item.NAME || item['基金简称'],
            manager: "暂无",
            lastNav: 0,
            lastNavDate: "",
            holdings: [],
            tags: [item.FundType || item['基金类型'] || "混合型"], 
            estimatedNav: 0,
            estimatedChangePercent: 0,
            estimatedProfit: 0,
            groupId: '',
            holdingShares: 0,
            holdingCost: 0,
            realizedProfit: 0,
            transactions: []
        }));
    }
    return [];
  } catch (error) {
    console.error("Search failed:", error);
    return [];
  }
};

// 2. 获取实时估值 (Backend)
export const fetchRealTimeEstimate = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/estimate/${fundCode}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error("Estimate request failed:", error);
        return null;
    }
};

// 3. 获取基金详情：持仓、经理等 (Backend)
// 前端不再进行任何爬虫操作，直接等待后端返回
export const fetchFundDetails = async (fund: Fund): Promise<Fund> => {
    try {
        // 假设后端新增了详情接口 /api/fund/{code}
        const response = await fetch(`${API_BASE}/api/fund/${fund.code}`);
        if (!response.ok) throw new Error("Backend detail fetch failed");
        
        const data = await response.json();
        
        // 期望后端返回: { manager: string, holdings: Stock[], ... }
        return {
            ...fund,
            manager: data.manager || fund.manager,
            // 如果后端返回了持仓数组，直接使用
            holdings: Array.isArray(data.holdings) ? data.holdings.map((h: any) => ({
                code: h.code,
                name: h.name,
                percent: parseFloat(h.percent || 0), // 后端解决持仓占比获取问题
                currentPrice: parseFloat(h.currentPrice || 0),
                changePercent: parseFloat(h.changePercent || 0)
            })) : fund.holdings
        };
    } catch (error) {
        console.warn(`Detail fetch failed for ${fund.code}, using fallback.`, error);
        return fund;
    }
};

// 4. 获取历史净值 (Backend)
export const getFundHistoryData = async (fundCode: string) => {
    try {
        // 假设后端新增了历史接口 /api/history/{code}
        const response = await fetch(`${API_BASE}/api/history/${fundCode}`);
        if (!response.ok) return [];
        
        const data = await response.json();
        // 期望后端返回: [{ date: '2023-01-01', value: 1.2345 }, ...]
        if (Array.isArray(data)) {
            return data.map((item: any) => ({
                date: item.date,
                value: parseFloat(item.value),
                change: 0 // 可选
            }));
        }
        return [];
    } catch (error) {
        console.warn(`History fetch failed for ${fundCode}`, error);
        return [];
    }
};

// 5. 批量更新 (Backend Estimate)
export const updateFundEstimates = async (currentFunds: Fund[]): Promise<Fund[]> => {
    const promises = currentFunds.map(async (fund) => {
        const realData = await fetchRealTimeEstimate(fund.code);
        
        let estimatedNav = fund.lastNav;
        let estimatedChangePercent = 0;
        let name = fund.name;
        let lastNav = fund.lastNav;
        let lastNavDate = fund.lastNavDate;

        if (realData) {
            // gsz: 估算值, dwjz: 昨日净值, gszzl: 估算涨跌幅
            lastNav = parseFloat(realData.dwjz || fund.lastNav);
            lastNavDate = realData.jzrq || fund.lastNavDate;
            estimatedNav = parseFloat(realData.gsz || lastNav);
            estimatedChangePercent = parseFloat(realData.gszzl || "0");
            name = realData.name || fund.name;
        }

        const profitToday = (estimatedNav - lastNav) * fund.holdingShares;

        return {
            ...fund,
            name,
            lastNav,
            lastNavDate,
            estimatedNav,
            estimatedChangePercent,
            estimatedProfit: profitToday
        };
    });

    return await Promise.all(promises);
};

// 辅助：获取某个日期的净值
export const getNavByDate = async (fundCode: string, dateStr: string): Promise<number> => {
    const realData = await fetchRealTimeEstimate(fundCode);
    if (realData && realData.dwjz) return parseFloat(realData.dwjz);
    return 1.0;
};

// 板块指数 (Mock)
export const getSectorIndices = (): SectorIndex[] => {
    return [
        { name: '中证白酒', changePercent: 1.24, score: 85, leadingStock: '贵州茅台' },
        { name: '半导体', changePercent: -0.85, score: 40, leadingStock: '中芯国际' },
        { name: '新能源车', changePercent: 0.33, score: 60, leadingStock: '比亚迪' },
        { name: '生物医药', changePercent: -0.12, score: 45, leadingStock: '恒瑞医药' },
        { name: '人工智能', changePercent: 2.15, score: 95, leadingStock: '科大讯飞' },
    ];
};

// 回测逻辑 (前端计算)
export const runBacktest = (portfolio: { code: string, amount: number }[], durationYears: number): BacktestResult => {
    // 这里暂时保持前端模拟逻辑，如果后端提供了 /api/backtest，可替换为 fetch 调用
    const baseReturn = durationYears * 5; 
    const volatility = Math.random() * 10;
    const finalReturn = baseReturn + (Math.random() > 0.5 ? volatility : -volatility);
    
    return {
        totalReturn: parseFloat(finalReturn.toFixed(2)),
        annualizedReturn: parseFloat((finalReturn / durationYears).toFixed(2)),
        maxDrawdown: parseFloat((Math.random() * 15 + 5).toFixed(2)),
        finalValue: portfolio.reduce((sum, p) => sum + p.amount, 0) * (1 + finalReturn / 100),
        chartData: Array.from({ length: 20 }, (_, i) => ({
            date: `2023-${i + 1}`,
            value: 10000 * (1 + (i * finalReturn / 2000))
        }))
    };
};
