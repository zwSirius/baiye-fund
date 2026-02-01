import { Fund, SectorIndex } from '../types';
import { calculateFundMetrics } from '../utils/finance';

// --- 配置后端地址 ---
let isProd = false;
try {
    // @ts-ignore
    isProd = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.PROD;
} catch (e) {
    isProd = false;
}

const API_BASE = isProd ? '' : 'http://127.0.0.1:7860';

// --- Local Storage Keys ---
const STORAGE_KEY_FUNDS = 'smartfund_funds_v1';
const STORAGE_KEY_GROUPS = 'smartfund_groups_v1';
const STORAGE_KEY_MARKET_CONFIG = 'smartfund_market_config_v1';

// --- Storage Utils ---

export const saveFundsToLocal = (funds: Fund[]) => localStorage.setItem(STORAGE_KEY_FUNDS, JSON.stringify(funds));
export const saveGroupsToLocal = (groups: any[]) => localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(groups));
export const saveMarketCodes = (codes: string[]) => localStorage.setItem(STORAGE_KEY_MARKET_CONFIG, JSON.stringify(codes));

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

// --- Import/Export ---

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

// --- API Interactions ---

// 1. Search
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
        console.warn("Search failed:", error);
        return [];
    }
};

// 2. Fetch Single Estimate
export const fetchRealTimeEstimate = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/estimate/${fundCode}`);
        return response.ok ? await response.json() : null;
    } catch (error) {
        return null;
    }
};

// 3. Batch Estimates
export const fetchBatchEstimates = async (fundCodes: string[]) => {
    try {
        const response = await fetch(`${API_BASE}/api/estimate/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codes: fundCodes })
        });
        return response.ok ? await response.json() : [];
    } catch (error) {
        console.warn("Batch estimate failed:", error);
        return [];
    }
};

// 4. Fund Details
export const fetchFundDetails = async (fund: Fund): Promise<Fund> => {
    try {
        const response = await fetch(`${API_BASE}/api/fund/${fund.code}`);
        if (!response.ok) return fund;
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
    } catch {
        return fund;
    }
};

// 5. History
export const getFundHistoryData = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/history/${fundCode}`);
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data.map((item: any) => ({ date: item.date, value: parseFloat(item.value) })) : [];
    } catch {
        return [];
    }
};

// 6. Market Indices
export const fetchMarketIndices = async (codes?: string[]): Promise<SectorIndex[]> => {
    try {
        const targetCodes = codes || getStoredMarketCodes();
        const response = await fetch(`${API_BASE}/api/market?codes=${targetCodes.join(',')}`);
        return response.ok ? await response.json() : [];
    } catch (e) {
        console.warn("Market fetch failed:", e);
        return [];
    }
};

// 7. Batch Update Fund Estimates (The Core Logic)
export const updateFundEstimates = async (currentFunds: Fund[]): Promise<Fund[]> => {
    if (currentFunds.length === 0) return [];

    const codes = Array.from(new Set(currentFunds.map(f => f.code)));
    let estimatesMap: Record<string, any> = {};

    try {
        const estimates = await fetchBatchEstimates(codes);
        estimates.forEach((item: any) => estimatesMap[item.fundcode] = item);
    } catch (e) {
        console.error("Update failed", e);
        return currentFunds;
    }

    return currentFunds.map(fund => {
        const realData = estimatesMap[fund.code];
        if (!realData) return fund;

        let { 
            dwjz: apiDwjzStr, 
            gsz: apiGszStr, 
            gszzl: apiGszzlStr, 
            jzrq: apiJzrq, 
            name: apiName, 
            source: apiSource 
        } = realData;

        const apiDwjz = parseFloat(apiDwjzStr);
        const apiGsz = parseFloat(apiGszStr);
        const apiGszzl = parseFloat(apiGszzlStr || "0");

        let lastNav = fund.lastNav;
        let lastNavDate = fund.lastNavDate;
        let estimatedNav = fund.estimatedNav;
        let estimatedChangePercent = 0;
        let name = apiName && apiName.length > 0 ? apiName : fund.name;
        let source = apiSource || fund.source;

        // Update Last NAV (DWJZ)
        if (!isNaN(apiDwjz) && apiDwjz > 0) {
            lastNav = apiDwjz;
            lastNavDate = apiJzrq;
        } else if (lastNav === 0) {
            lastNav = !isNaN(apiGsz) ? apiGsz : 1.0;
        }

        // Update Estimated NAV (GSZ)
        if (!isNaN(apiGsz) && apiGsz > 0) {
            estimatedNav = apiGsz;
            estimatedChangePercent = apiGszzl;
        } else if (!isNaN(apiDwjz) && apiDwjz > 0) {
            estimatedNav = apiDwjz;
            estimatedChangePercent = 0;
        } else {
            estimatedNav = fund.estimatedNav > 0 ? fund.estimatedNav : 1.0;
        }

        // Calculate Profit using centralized utility
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

// 8. Get NAV by date (Fallback logic)
export const getNavByDate = async (fundCode: string, dateStr: string): Promise<number> => {
    try {
        const history = await getFundHistoryData(fundCode);
        const exactMatch = history.find((h: any) => h.date === dateStr);
        if (exactMatch) return exactMatch.value;

        // Find nearest previous date
        const targetDate = new Date(dateStr).getTime();
        const sorted = [...history].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        for (const h of sorted) {
            if (new Date(h.date).getTime() <= targetDate) return h.value;
        }
        
        // Fallback to real-time
        const real = await fetchRealTimeEstimate(fundCode);
        return (real && parseFloat(real.dwjz) > 0) ? parseFloat(real.dwjz) : 1.0;
    } catch {
        return 1.0;
    }
};

// 9. Simple Backtest Mock
export const runBacktest = (portfolio: { code: string, amount: number }[], durationYears: number) => {
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
