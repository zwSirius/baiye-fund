import { Fund, Stock, BacktestResult, BacktestPoint, SectorIndex } from '../types';

// --- 配置后端地址 ---
// 更加安全的检测方式：即使 import.meta.env 未定义也不会报错
let isProd = false;
try {
    // @ts-ignore
    isProd = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.PROD;
} catch (e) {
    isProd = false;
}

const API_BASE = isProd ? '' : 'http://127.0.0.1:7860';

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

// --- API 接口 ---

// 1. 搜索基金
export const searchFunds = async (query: string): Promise<Fund[]> => {
  if (!query) return [];
  try {
    const response = await fetch(`${API_BASE}/api/search?key=${encodeURIComponent(query)}`);
    const data = await response.json();
    
    if (Array.isArray(data)) {
        return data.map((item: any) => ({
            id: `temp_${item.code}`,
            code: item.code,
            name: item.name,
            manager: "暂无",
            lastNav: 0,
            lastNavDate: "",
            holdings: [],
            tags: [item.type || "混合型"], 
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
    console.warn("Search failed (Backend might be offline):", error);
    return [];
  }
};

// 2. 获取实时估值
export const fetchRealTimeEstimate = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/estimate/${fundCode}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        // console.warn("Estimate request failed:", error);
        return null;
    }
};

// 3. 获取基金详情
export const fetchFundDetails = async (fund: Fund): Promise<Fund> => {
    try {
        const response = await fetch(`${API_BASE}/api/fund/${fund.code}`);
        if (!response.ok) throw new Error("Backend detail fetch failed");
        
        const data = await response.json();
        
        return {
            ...fund,
            manager: data.manager || fund.manager,
            holdings: Array.isArray(data.holdings) ? data.holdings.map((h: any) => ({
                code: h.code,
                name: h.name,
                percent: parseFloat(h.percent || 0),
                currentPrice: parseFloat(h.currentPrice || 0),
                changePercent: parseFloat(h.changePercent || 0)
            })) : fund.holdings
        };
    } catch (error) {
        console.warn(`Detail fetch failed for ${fund.code}. Backend down?`, error);
        return fund;
    }
};

// 4. 获取历史净值
export const getFundHistoryData = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/history/${fundCode}`);
        if (!response.ok) return [];
        
        const data = await response.json();
        if (Array.isArray(data)) {
            return data.map((item: any) => ({
                date: item.date,
                value: parseFloat(item.value),
                change: 0 
            }));
        }
        return [];
    } catch (error) {
        console.warn(`History fetch failed for ${fundCode}`, error);
        return [];
    }
};

// 5. 获取市场指数 (Real)
export const fetchMarketIndices = async (): Promise<SectorIndex[]> => {
    try {
        const response = await fetch(`${API_BASE}/api/market`);
        if (!response.ok) throw new Error("Market fetch failed");
        const data = await response.json();
        return data;
    } catch (e) {
        console.warn("Market indices fetch failed (using mock data):", e);
        // Fallback Mock
        return [
            { name: '上证指数', changePercent: 0, score: 50, leadingStock: '--' },
            { name: '创业板指', changePercent: 0, score: 50, leadingStock: '--' },
            { name: '中证白酒', changePercent: 0, score: 50, leadingStock: '--' },
            { name: '新能源车', changePercent: 0, score: 50, leadingStock: '--' },
            { name: '半导体', changePercent: 0, score: 50, leadingStock: '--' }
        ];
    }
};

// 6. 批量更新
export const updateFundEstimates = async (currentFunds: Fund[]): Promise<Fund[]> => {
    const promises = currentFunds.map(async (fund) => {
        const realData = await fetchRealTimeEstimate(fund.code);
        
        let estimatedNav = fund.lastNav;
        let estimatedChangePercent = 0;
        let name = fund.name;
        let lastNav = fund.lastNav;
        let lastNavDate = fund.lastNavDate;
        let source = fund.source;

        if (realData) {
            const apiDwjz = parseFloat(realData.dwjz);
            const apiGsz = parseFloat(realData.gsz);

            if (apiDwjz > 0) {
                lastNav = apiDwjz;
                lastNavDate = realData.jzrq;
            }

            // 如果后端返回了估值（后端已经处理了夜间用真值、日间用估值的逻辑）
            if (apiGsz > 0) {
                estimatedNav = apiGsz;
                estimatedChangePercent = parseFloat(realData.gszzl || "0");
                source = realData.source; // 标记数据来源
            } else if (apiDwjz > 0) {
                // 兜底
                estimatedNav = apiDwjz;
                estimatedChangePercent = 0;
            }

            if (realData.name) name = realData.name;
        }

        const profitToday = (estimatedNav - lastNav) * fund.holdingShares;

        return {
            ...fund,
            name,
            lastNav,
            lastNavDate,
            estimatedNav,
            estimatedChangePercent,
            estimatedProfit: profitToday,
            source
        };
    });

    return await Promise.all(promises);
};

// 辅助：获取某个日期的净值
export const getNavByDate = async (fundCode: string, dateStr: string): Promise<number> => {
    const realData = await fetchRealTimeEstimate(fundCode);
    if (realData && realData.dwjz && parseFloat(realData.dwjz) > 0) {
        return parseFloat(realData.dwjz);
    }
    return 1.0;
};

// 回测逻辑
export const runBacktest = (portfolio: { code: string, amount: number }[], durationYears: number): BacktestResult => {
    const baseReturn = durationYears * 4; 
    const volatility = Math.random() * 15;
    const finalReturn = baseReturn + (Math.random() > 0.4 ? volatility : -volatility);
    
    return {
        totalReturn: parseFloat(finalReturn.toFixed(2)),
        annualizedReturn: parseFloat((finalReturn / durationYears).toFixed(2)),
        maxDrawdown: parseFloat((Math.random() * 20 + 5).toFixed(2)),
        finalValue: portfolio.reduce((sum, p) => sum + p.amount, 0) * (1 + finalReturn / 100),
        chartData: Array.from({ length: 30 }, (_, i) => ({
            date: `2023-${i + 1}`,
            value: 10000 * (1 + (i * finalReturn / 3000))
        }))
    };
};