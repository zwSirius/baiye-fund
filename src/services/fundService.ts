import { Fund, SectorIndex, BacktestResult, BacktestPoint, MarketOverview } from '../types';
import { calculateFundMetrics } from '../utils/finance';

// Robustly access environment variables
let apiBaseUrl = '';
try {
    const env = import.meta.env;
    if (env && env.VITE_API_BASE) {
        apiBaseUrl = env.VITE_API_BASE;
    }
} catch (e) {
    console.warn('Failed to access environment variables:', e);
}

export const API_BASE = apiBaseUrl;

const STORAGE_KEY_FUNDS = 'smartfund_funds_v1';
const STORAGE_KEY_GROUPS = 'smartfund_groups_v1';
const STORAGE_KEY_MARKET_CONFIG = 'smartfund_market_config_v1';

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

export const getStoredMarketCodes = (): string[] => {
    const stored = localStorage.getItem(STORAGE_KEY_MARKET_CONFIG);
    if (stored) {
        return JSON.parse(stored);
    }
    // 默认指数
    return ["1.000001", "0.399001", "0.399006", "1.000688", "100.HSI", "100.NDX"];
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

export const fetchRealTimeEstimate = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/estimate/${fundCode}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        return null;
    }
};

export const fetchBatchEstimates = async (fundCodes: string[]) => {
    try {
        const response = await fetch(`${API_BASE}/api/estimate/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codes: fundCodes })
        });
        if (!response.ok) return [];
        return await response.json();
    } catch (error) {
        console.warn("Batch estimate failed:", error);
        return [];
    }
}

export const fetchFundDetails = async (fund: Fund): Promise<Fund> => {
    try {
        const response = await fetch(`${API_BASE}/api/fund/${fund.code}`);
        if (!response.ok) throw new Error("Backend detail fetch failed");
        
        const data = await response.json();
        
        return {
            ...fund,
            manager: data.manager || fund.manager,
            type: data.type || fund.type,
            start_date: data.start_date || fund.start_date,
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

export const getFundHistoryData = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/history/${fundCode}`);
        if (!response.ok) return [];
        return await response.json();
    } catch (error) {
        console.warn(`History fetch failed for ${fundCode}`, error);
        return [];
    }
};

// Client-side cache for market data
let marketCache = {
    data: null as MarketOverview | null,
    timestamp: 0
};

export const fetchMarketOverview = async (codes?: string[], force: boolean = false): Promise<MarketOverview | null> => {
    // 30 min cache
    if (!force && marketCache.data && (Date.now() - marketCache.timestamp < 30 * 60 * 1000)) {
        return marketCache.data;
    }

    try {
        let url = `${API_BASE}/api/market/overview`;
        if (codes && codes.length > 0) {
            url += `?codes=${codes.join(',')}`;
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error("Market fetch failed");
        const data = await response.json();
        
        // Update cache
        marketCache = { data, timestamp: Date.now() };
        
        return data;
    } catch (e) {
        console.warn("Market overview fetch failed:", e);
        return marketCache.data; // Return stale data if failed
    }
};

export const fetchMarketIndices = async (codes: string[]): Promise<SectorIndex[]> => {
    try {
        const overview = await fetchMarketOverview(codes);
        return overview ? overview.indices : [];
    } catch (e) {
        return [];
    }
};

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

        let estimatedNav = fund.estimatedNav;
        let estimatedChangePercent = fund.estimatedChangePercent;
        let name = fund.name;
        let lastNav = fund.lastNav;
        let lastNavDate = fund.lastNavDate;
        let source = realData.source;
        let estimateTime = "";

        const apiDwjz = parseFloat(realData.dwjz);
        const apiGsz = parseFloat(realData.gsz);
        const apiGszZl = parseFloat(realData.gszzl);

        // 1. 更新昨日净值
        if (!isNaN(apiDwjz) && apiDwjz > 0) {
            lastNav = apiDwjz;
            if (realData.jzrq) lastNavDate = realData.jzrq;
        } else if (lastNav === 0 && !isNaN(apiGsz) && apiGsz > 0) {
            lastNav = apiGsz; 
        }

        // 2. 更新估值
        if (!isNaN(apiGsz) && apiGsz > 0) {
            estimatedNav = apiGsz;
            estimatedChangePercent = isNaN(apiGszZl) ? 0 : apiGszZl;
        } else if (lastNav > 0) {
            estimatedNav = lastNav;
            estimatedChangePercent = 0;
        }

        // 3. 处理时间
        if (realData.gztime) {
            estimateTime = realData.gztime;
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
            source,
            estimateTime
        };
    });
};

export const getNavByDate = async (fundCode: string, dateStr: string): Promise<number> => {
    try {
        const history = await getFundHistoryData(fundCode);
        const exactMatch = history.find((h: any) => h.date === dateStr);
        if (exactMatch) return exactMatch.value;

        const targetDate = new Date(dateStr).getTime();
        const sortedHistory = [...history].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        for (const h of sortedHistory) {
            if (new Date(h.date).getTime() <= targetDate) {
                return h.value;
            }
        }
        
        const realData = await fetchRealTimeEstimate(fundCode);
        if (realData && realData.dwjz && parseFloat(realData.dwjz) > 0) {
            return parseFloat(realData.dwjz);
        }

        return 1.0;
    } catch (e) {
        return 1.0;
    }
};

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