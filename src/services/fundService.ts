import { Fund, SectorIndex, BacktestResult, BacktestPoint } from '../types';
import { calculateFundMetrics } from '../utils/finance';

// --- 配置后端地址 ---
export const API_BASE = import.meta.env.VITE_API_BASE || '';

// --- Local Storage Keys ---
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
    // 默认指数: 上证, 深证, 创业板, 科创50, 沪深300
    return ["1.000001", "0.399001", "0.399006", "1.000688", "0.000300"];
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
            // 后端现在返回 type 字段
            tags: [item.type || "混合型"], 
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
    console.warn("Search failed:", error);
    return [];
  }
};

// 2. 获取实时估值 (单个)
export const fetchRealTimeEstimate = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/estimate/${fundCode}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        return null;
    }
};

// 2.1 批量获取实时估值
export const fetchBatchEstimates = async (fundCodes: string[]) => {
    try {
        const response = await fetch(`${API_BASE}/api/estimate/batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ codes: fundCodes })
        });
        if (!response.ok) return [];
        return await response.json();
    } catch (error) {
        console.warn("Batch estimate failed:", error);
        return [];
    }
}

// 3. 获取基金详情 (含重仓股)
export const fetchFundDetails = async (fund: Fund): Promise<Fund> => {
    try {
        const response = await fetch(`${API_BASE}/api/fund/${fund.code}`);
        if (!response.ok) throw new Error("Backend detail fetch failed");
        
        const data = await response.json();
        
        return {
            ...fund,
            manager: data.manager || fund.manager,
            // 后端返回的 holdings 包含 changePercent
            holdings: Array.isArray(data.holdings) ? data.holdings.map((h: any) => ({
                code: h.code,
                name: h.name,
                percent: parseFloat(h.percent || 0),
                currentPrice: parseFloat(h.currentPrice || 0),
                changePercent: parseFloat(h.changePercent || 0)
            })) : fund.holdings
        };
    } catch (error) {
        console.warn(`Detail fetch failed for ${fund.code}`, error);
        return fund;
    }
};

// 4. 获取历史净值
export const getFundHistoryData = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/history/${fundCode}`);
        if (!response.ok) return [];
        
        const data = await response.json();
        // 后端返回格式: [{"date": "2023-01-01", "value": 1.23}, ...]
        return data;
    } catch (error) {
        console.warn(`History fetch failed for ${fundCode}`, error);
        return [];
    }
};

// 5. 获取市场指数
export const fetchMarketIndices = async (codes?: string[]): Promise<SectorIndex[]> => {
    try {
        // 构造 Query String
        let url = `${API_BASE}/api/market`;
        if (codes && codes.length > 0) {
            url += `?codes=${codes.join(',')}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error("Market fetch failed");
        const data = await response.json();
        return data;
    } catch (e) {
        console.warn("Market indices fetch failed:", e);
        return [];
    }
};

// 6. 批量更新基金估值
export const updateFundEstimates = async (currentFunds: Fund[]): Promise<Fund[]> => {
    if (currentFunds.length === 0) return [];

    const codes = Array.from(new Set(currentFunds.map(f => f.code)));
    
    let estimatesMap: Record<string, any> = {};
    try {
        const estimates = await fetchBatchEstimates(codes);
        estimates.forEach((item: any) => {
            estimatesMap[item.fundcode] = item;
        });
    } catch (e) {
        console.error("Batch update failed", e);
        return currentFunds;
    }

    return currentFunds.map(fund => {
        const realData = estimatesMap[fund.code];
        
        if (!realData) return fund;

        let estimatedNav = fund.lastNav;
        let estimatedChangePercent = 0;
        let name = fund.name;
        let lastNav = fund.lastNav;
        let lastNavDate = fund.lastNavDate;
        let source = fund.source;

        // 后端返回字段: dwjz(昨日净值), gsz(估算净值), gszzl(估算涨跌幅), jzrq(净值日期)
        // 确保数值安全解析
        const apiDwjz = parseFloat(realData.dwjz);
        const apiGsz = parseFloat(realData.gsz);
        const apiGszZl = parseFloat(realData.gszzl);

        // 1. 更新昨日净值 (如果有有效数据)
        if (!isNaN(apiDwjz) && apiDwjz > 0) {
            lastNav = apiDwjz;
            if (realData.jzrq) lastNavDate = realData.jzrq;
        } else if (lastNav === 0 && !isNaN(apiGsz)) {
            // 如果本地初始为0且API没给昨日净值，暂用估值填充作为基准
            lastNav = apiGsz;
        }

        // 2. 更新估算值
        if (!isNaN(apiGsz) && apiGsz > 0) {
            estimatedNav = apiGsz;
            // 如果后端计算失败，gszzl可能为0，但如果有gsz，我们信赖gsz
            estimatedChangePercent = isNaN(apiGszZl) ? 0 : apiGszZl;
            source = realData.source;
        } else if (!isNaN(apiDwjz) && apiDwjz > 0) {
            // 兜底：如果没有估算值，使用昨日净值，涨跌为0
            estimatedNav = apiDwjz;
            estimatedChangePercent = 0;
            source = "fallback_nav";
        }

        if (realData.name && realData.name.length > 0) {
            name = realData.name;
        }

        const profitToday = calculateFundMetrics(
            fund.holdingShares,
            lastNav,
            estimatedNav,
            estimatedChangePercent
        );

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
};

// 辅助：获取某个日期的净值
export const getNavByDate = async (fundCode: string, dateStr: string): Promise<number> => {
    try {
        const history = await getFundHistoryData(fundCode);
        const exactMatch = history.find((h: any) => h.date === dateStr);
        if (exactMatch) return exactMatch.value;

        // 如果找不到精确日期，找最近的一天 (T-1)
        const targetDate = new Date(dateStr).getTime();
        // 倒序排列
        const sortedHistory = [...history].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        for (const h of sortedHistory) {
            if (new Date(h.date).getTime() <= targetDate) {
                return h.value;
            }
        }
        
        // 兜底：用当前净值
        const realData = await fetchRealTimeEstimate(fundCode);
        if (realData && realData.dwjz && parseFloat(realData.dwjz) > 0) {
            return parseFloat(realData.dwjz);
        }

        return 1.0;
    } catch (e) {
        return 1.0;
    }
};

// 回测逻辑
export const runBacktest = async (portfolio: { code: string, amount: number }[], durationYears: number): Promise<BacktestResult> => {
    const today = new Date();
    const startDate = new Date();
    startDate.setFullYear(today.getFullYear() - durationYears);
    const startDateStr = startDate.toISOString().split('T')[0];

    const allHistoryProms = portfolio.map(async (p) => {
        const history = await getFundHistoryData(p.code);
        const filtered = history.filter((h: any) => h.date >= startDateStr).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        return {
            code: p.code,
            amount: p.amount,
            history: filtered
        };
    });

    const fundsData = await Promise.all(allHistoryProms);

    const allDatesSet = new Set<string>();
    fundsData.forEach(fd => {
        fd.history.forEach((h: any) => allDatesSet.add(h.date));
    });
    
    const sortedDates = Array.from(allDatesSet).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const fundSharesMap: Map<string, number> = new Map();
    const fundLastNavMap: Map<string, number> = new Map();

    fundsData.forEach(fd => {
        if (fd.history.length > 0) {
            const firstNav = fd.history[0].value;
            if (firstNav > 0) {
                const shares = fd.amount / firstNav;
                fundSharesMap.set(fd.code, shares);
            }
        }
    });

    const chartData: BacktestPoint[] = [];

    for (const date of sortedDates) {
        let dailyTotal = 0;
        fundsData.forEach(fd => {
            const point = fd.history.find((h: any) => h.date === date);
            if (point) {
                fundLastNavMap.set(fd.code, point.value);
            }
            const nav = point ? point.value : (fundLastNavMap.get(fd.code) || 0);
            const shares = fundSharesMap.get(fd.code) || 0;
            dailyTotal += shares * nav;
        });

        if (dailyTotal > 0) {
            chartData.push({ date, value: dailyTotal });
        }
    }

    if (chartData.length < 2) {
        return {
            totalReturn: 0,
            annualizedReturn: 0,
            maxDrawdown: 0,
            finalValue: portfolio.reduce((sum, p) => sum + p.amount, 0),
            chartData: []
        };
    }

    const startValue = chartData[0].value;
    const finalValue = chartData[chartData.length - 1].value;
    const totalReturn = ((finalValue - startValue) / startValue) * 100;
    
    const dayDiff = (new Date(sortedDates[sortedDates.length-1]).getTime() - new Date(sortedDates[0]).getTime()) / (1000 * 3600 * 24);
    const exactYears = dayDiff / 365;
    const annualizedReturn = (Math.pow(finalValue / startValue, 1 / (exactYears || 1)) - 1) * 100;

    let maxDD = 0;
    let peak = -Infinity;
    
    chartData.forEach(p => {
        if (p.value > peak) peak = p.value;
        const dd = (peak - p.value) / peak;
        if (dd > maxDD) maxDD = dd;
    });

    return {
        totalReturn: parseFloat(totalReturn.toFixed(2)),
        annualizedReturn: parseFloat(annualizedReturn.toFixed(2)),
        maxDrawdown: parseFloat((maxDD * 100).toFixed(2)),
        finalValue: parseFloat(finalValue.toFixed(2)),
        chartData
    };
};
