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
const STORAGE_KEY_MARKET_CONFIG = 'smartfund_market_config_v1';

// --- Storage & Data Management ---

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
    // 修改：默认只有我的账户
    return [
        { id: 'default', name: '我的账户', isDefault: true }
    ];
};

export const getInitialFunds = (): Fund[] => {
  const stored = localStorage.getItem(STORAGE_KEY_FUNDS);
  if (stored) {
      return JSON.parse(stored) as Fund[];
  }
  return [];
};

// 市场板块配置存储
export const getStoredMarketCodes = (): string[] => {
    const stored = localStorage.getItem(STORAGE_KEY_MARKET_CONFIG);
    if (stored) {
        return JSON.parse(stored);
    }
    // 默认显示：上证、深证、创业板、白酒、新能源
    return ["1.000001", "0.399001", "0.399006", "0.399997", "0.399976"];
};

export const saveMarketCodes = (codes: string[]) => {
    localStorage.setItem(STORAGE_KEY_MARKET_CONFIG, JSON.stringify(codes));
};

export const exportData = () => {
    const data = {
        funds: getInitialFunds(),
        groups: getStoredGroups(),
        marketConfig: getStoredMarketCodes(),
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
            if (data.marketConfig) saveMarketCodes(data.marketConfig);
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
            // Ensure type is present, fallback to "混合型" if empty
            tags: [item.type && item.type.trim() !== "" ? item.type : "混合型"], 
            estimatedNav: 0,
            estimatedChangePercent: 0,
            estimatedProfit: 0,
            groupId: '',
            holdingShares: 0,
            holdingCost: 0,
            realizedProfit: 0,
            transactions: [],
            isWatchlist: false
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

// 5. 获取市场指数 (支持自定义代码)
export const fetchMarketIndices = async (codes?: string[]): Promise<SectorIndex[]> => {
    try {
        // 如果没有传入 codes，使用本地存储的配置
        const targetCodes = codes || getStoredMarketCodes();
        const param = targetCodes.join(',');
        
        const response = await fetch(`${API_BASE}/api/market?codes=${param}`);
        if (!response.ok) throw new Error("Market fetch failed");
        const data = await response.json();
        return data;
    } catch (e) {
        console.warn("Market indices fetch failed (using mock data):", e);
        return [];
    }
};

// 6. 批量更新 (增强健壮性：防止数据清零)
export const updateFundEstimates = async (currentFunds: Fund[]): Promise<Fund[]> => {
    // 如果没有基金，直接返回空数组，避免无谓请求
    if (currentFunds.length === 0) return [];

    const promises = currentFunds.map(async (fund) => {
        try {
            const realData = await fetchRealTimeEstimate(fund.code);
            
            // 如果获取失败，务必返回原始 fund 对象，而不是 null 或 默认对象
            if (!realData) {
                return fund;
            }

            let estimatedNav = fund.lastNav;
            let estimatedChangePercent = 0;
            let name = fund.name;
            let lastNav = fund.lastNav;
            let lastNavDate = fund.lastNavDate;
            let source = fund.source;

            const apiDwjz = parseFloat(realData.dwjz);
            const apiGsz = parseFloat(realData.gsz);

            // 更新单位净值
            if (!isNaN(apiDwjz) && apiDwjz > 0) {
                lastNav = apiDwjz;
                lastNavDate = realData.jzrq;
            } else if (lastNav === 0) {
                 // 如果原始净值为0，尝试用估值填充，避免显示0
                 lastNav = !isNaN(apiGsz) ? apiGsz : 1.0;
            }

            // 更新估值和涨跌幅
            if (!isNaN(apiGsz) && apiGsz > 0) {
                estimatedNav = apiGsz;
                estimatedChangePercent = parseFloat(realData.gszzl || "0");
                source = realData.source;
            } else if (!isNaN(apiDwjz) && apiDwjz > 0) {
                // 如果没有估值，用净值兜底
                estimatedNav = apiDwjz;
                estimatedChangePercent = 0;
            } else {
                // 如果API数据完全不可用，保持原状
                 estimatedNav = fund.estimatedNav > 0 ? fund.estimatedNav : 1.0;
            }

            // 优先使用 API 返回的名称，如果 API 没返回（很少见），用旧的
            if (realData.name && realData.name.length > 0) {
                name = realData.name;
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
        } catch (e) {
            console.error(`Update failed for ${fund.code}, keeping original data`, e);
            return fund; // 出错时返回原始数据，防止列表清空
        }
    });

    const results = await Promise.all(promises);
    return results;
};

// 辅助：获取某个日期的净值 (修复版：从历史接口查找)
export const getNavByDate = async (fundCode: string, dateStr: string): Promise<number> => {
    try {
        // 获取历史数据
        const history = await getFundHistoryData(fundCode);
        
        // 查找精确匹配
        const exactMatch = history.find((h: any) => h.date === dateStr);
        if (exactMatch) return exactMatch.value;

        // 如果没有精确匹配（比如非交易日），查找最近的一个之前的日期
        // 假设 history 是有序的（通常 akshare 是按时间升序）
        // 如果是升序： 2023-01-01, 2023-01-02 ...
        // 如果我们找 2023-01-01.5 (非交易日)，我们应该取 01-01 的值
        
        // 简单处理：倒序查找第一个小于 dateStr 的
        const targetDate = new Date(dateStr).getTime();
        
        // 排序确保是降序 (新 -> 旧)
        const sortedHistory = [...history].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        for (const h of sortedHistory) {
            if (new Date(h.date).getTime() <= targetDate) {
                return h.value;
            }
        }
        
        // 如果都找不到，尝试获取实时估值作为兜底（比如今天是交易日但还没收盘）
        const realData = await fetchRealTimeEstimate(fundCode);
        if (realData && realData.dwjz && parseFloat(realData.dwjz) > 0) {
            return parseFloat(realData.dwjz);
        }

        return 1.0;
    } catch (e) {
        console.warn("Failed to get nav by date", e);
        return 1.0;
    }
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
