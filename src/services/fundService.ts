
import { Fund, SectorIndex, BacktestResult, BacktestPoint } from '../types';
import { calculateFundMetrics } from '../utils/finance';

// --- 配置后端地址 ---
export const API_BASE = import.meta.env.VITE_API_BASE || '';

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
    return stored ? JSON.parse(stored) : [{ id: 'default', name: '我的账户', isDefault: true }];
};

export const getInitialFunds = (): Fund[] => {
  const stored = localStorage.getItem(STORAGE_KEY_FUNDS);
  return stored ? JSON.parse(stored) : [];
};

export const getStoredMarketCodes = (): string[] => {
    const stored = localStorage.getItem(STORAGE_KEY_MARKET_CONFIG);
    return stored ? JSON.parse(stored) : ["1.000001", "0.399001", "0.399006", "0.399997", "0.399976"];
};

export const saveMarketCodes = (codes: string[]) => {
    localStorage.setItem(STORAGE_KEY_MARKET_CONFIG, JSON.stringify(codes));
};

// --- API 接口 ---

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
            manager: "基金经理",
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
    return [];
  }
};

export const fetchBatchEstimates = async (fundCodes: string[]) => {
    try {
        const response = await fetch(`${API_BASE}/api/estimate/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codes: fundCodes })
        });
        return response.ok ? await response.json() : [];
    } catch (error) {
        return [];
    }
};

export const fetchRealTimeEstimate = async (code: string) => {
    try {
        const results = await fetchBatchEstimates([code]);
        return results.length > 0 ? results[0] : null;
    } catch (e) {
        return null;
    }
};

export const fetchFundDetails = async (fund: Fund): Promise<Fund> => {
    try {
        const response = await fetch(`${API_BASE}/api/fund/${fund.code}`);
        if (!response.ok) return fund;
        const data = await response.json();
        return {
            ...fund,
            manager: data.manager || fund.manager,
            holdings: data.holdings || []
        };
    } catch (error) {
        return fund;
    }
};

export const getFundHistoryData = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/history/${fundCode}`);
        return response.ok ? await response.json() : [];
    } catch (error) {
        return [];
    }
};

export const fetchMarketIndices = async (codes?: string[]): Promise<SectorIndex[]> => {
    try {
        const targetCodes = codes || getStoredMarketCodes();
        const response = await fetch(`${API_BASE}/api/market?codes=${targetCodes.join(',')}`);
        return response.ok ? await response.json() : [];
    } catch (e) {
        return [];
    }
};

export const updateFundEstimates = async (currentFunds: Fund[]): Promise<Fund[]> => {
    if (currentFunds.length === 0) return [];
    const codes = Array.from(new Set(currentFunds.map(f => f.code)));
    const estimates = await fetchBatchEstimates(codes);
    const estimatesMap: Record<string, any> = {};
    estimates.forEach((item: any) => { estimatesMap[item.fundcode] = item; });

    return currentFunds.map(fund => {
        const realData = estimatesMap[fund.code];
        if (!realData) return fund;

        const lastNav = parseFloat(realData.dwjz) || fund.lastNav;
        const estimatedNav = parseFloat(realData.gsz) || fund.estimatedNav;
        const estimatedChangePercent = parseFloat(realData.gszzl) || 0;

        const profitToday = calculateFundMetrics(
            fund.holdingShares,
            lastNav,
            estimatedNav,
            estimatedChangePercent
        );

        return {
            ...fund,
            name: realData.name || fund.name,
            lastNav,
            lastNavDate: realData.jzrq || fund.lastNavDate,
            estimatedNav,
            estimatedChangePercent,
            estimatedProfit: profitToday,
            source: realData.source
        };
    });
};

export const getNavByDate = async (fundCode: string, dateStr: string): Promise<number> => {
    try {
        const history = await getFundHistoryData(fundCode);
        const exactMatch = history.find((h: any) => h.date === dateStr);
        if (exactMatch) return exactMatch.value;
        const targetDate = new Date(dateStr).getTime();
        const sorted = history.sort((a:any,b:any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        for (const h of sorted) {
            if (new Date(h.date).getTime() <= targetDate) return h.value;
        }
    } catch (e) {}
    return 1.0;
};

export const runBacktest = async (portfolio: { code: string, amount: number }[], durationYears: number): Promise<BacktestResult> => {
    const today = new Date();
    const startDate = new Date();
    startDate.setFullYear(today.getFullYear() - durationYears);
    const startDateStr = startDate.toISOString().split('T')[0];

    const fundsData = await Promise.all(portfolio.map(async (p) => {
        const history = await getFundHistoryData(p.code);
        return { code: p.code, amount: p.amount, history: history.filter((h: any) => h.date >= startDateStr) };
    }));

    const allDates = Array.from(new Set(fundsData.flatMap(f => f.history.map((h: any) => h.date)))).sort();
    const fundSharesMap: Map<string, number> = new Map();
    const fundLastNavMap: Map<string, number> = new Map();

    fundsData.forEach(fd => {
        if (fd.history.length > 0) {
            const firstNav = fd.history[0].value;
            if (firstNav > 0) fundSharesMap.set(fd.code, fd.amount / firstNav);
        }
    });

    const chartData: BacktestPoint[] = [];
    for (const date of allDates) {
        let dailyTotal = 0;
        fundsData.forEach(fd => {
            const point = fd.history.find((h: any) => h.date === date);
            if (point) fundLastNavMap.set(fd.code, point.value);
            dailyTotal += (fundSharesMap.get(fd.code) || 0) * (fundLastNavMap.get(fd.code) || 0);
        });
        if (dailyTotal > 0) chartData.push({ date, value: dailyTotal });
    }

    if (chartData.length < 2) return { totalReturn: 0, annualizedReturn: 0, maxDrawdown: 0, finalValue: 0, chartData: [] };

    const start = chartData[0].value;
    const final = chartData[chartData.length - 1].value;
    const totalReturn = ((final - start) / start) * 100;
    
    let maxDD = 0, peak = -Infinity;
    chartData.forEach(p => {
        if (p.value > peak) peak = p.value;
        maxDD = Math.max(maxDD, (peak - p.value) / peak);
    });

    return { totalReturn, annualizedReturn: 0, maxDrawdown: maxDD * 100, finalValue: final, chartData };
};

export const exportData = (): string => {
    const data = {
        funds: getInitialFunds(),
        groups: getStoredGroups(),
        marketCodes: getStoredMarketCodes()
    };
    return JSON.stringify(data, null, 2);
};

export const importData = (jsonStr: string): boolean => {
    try {
        const data = JSON.parse(jsonStr);
        if (data.funds && Array.isArray(data.funds)) saveFundsToLocal(data.funds);
        if (data.groups && Array.isArray(data.groups)) saveGroupsToLocal(data.groups);
        if (data.marketCodes && Array.isArray(data.marketCodes)) saveMarketCodes(data.marketCodes);
        return true;
    } catch (e) {
        console.error("Import failed", e);
        return false;
    }
};
