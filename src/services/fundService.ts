

import { Fund, MarketOverview, SectorIndex } from '../types';
import { calculateFundMetrics } from '../utils/finance';

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
const STORAGE_KEY_MARKET_CODES = 'smartfund_market_codes_v1';

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

export const getStoredMarketCodes = (): string[] => {
    const stored = localStorage.getItem(STORAGE_KEY_MARKET_CODES);
    if (stored) {
        return JSON.parse(stored);
    }
    return ['1.000001', '0.399001', '0.399006']; // Default: 上证, 深证, 创业板
};

export const saveMarketCodes = (codes: string[]) => {
    localStorage.setItem(STORAGE_KEY_MARKET_CODES, JSON.stringify(codes));
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
        marketCodes: getStoredMarketCodes(),
        timestamp: Date.now(),
        version: '1.0'
    };
    return JSON.stringify(data, null, 2);
};

export const importData = (jsonString: string): boolean => {
    try {
        let parsed = JSON.parse(jsonString);
        if (parsed.data) parsed = parsed.data;
        if (!Array.isArray(parsed.funds)) return false;
        saveFundsToLocal(parsed.funds);
        saveGroupsToLocal(parsed.groups || []);
        if (parsed.marketCodes) saveMarketCodes(parsed.marketCodes);
        return true;
    } catch (e) {
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
            industryDistribution: data.industryDistribution || [],
            holdings: Array.isArray(data.holdings) ? data.holdings.map((h: any) => ({
                code: h.code,
                name: h.name,
                percent: parseFloat(h.percent || 0),
                changePercent: parseFloat(h.changePercent || 0)
            })) : fund.holdings
        };
    } catch (error) {
        return fund;
    }
};

export const getFundHistoryData = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/history/${fundCode}`);
        if (!response.ok) return [];
        return await response.json();
    } catch (error) {
        return [];
    }
};

let marketCache = { data: null as MarketOverview | null, timestamp: 0 };

export const fetchMarketOverview = async (codes?: string[], force: boolean = false): Promise<MarketOverview | null> => {
    if (!force && marketCache.data && (Date.now() - marketCache.timestamp < 30 * 60 * 1000)) {
        return marketCache.data;
    }
    try {
        const response = await fetch(`${API_BASE}/api/market/overview`);
        if (!response.ok) throw new Error("Market fetch failed");
        const data = await response.json();
        marketCache = { data, timestamp: Date.now() };
        return data;
    } catch (e) {
        return marketCache.data;
    }
};

export const fetchMarketIndices = async (codes: string[]): Promise<SectorIndex[]> => {
    if (!codes || codes.length === 0) return [];
    try {
        const response = await fetch(`${API_BASE}/api/market/indices?codes=${codes.join(',')}`);
        if (!response.ok) return [];
        return await response.json();
    } catch (e) {
        console.error("Fetch indices failed", e);
        return [];
    }
};

export const updateFundEstimates = async (currentFunds: Fund[]): Promise<Fund[]> => {
    if (currentFunds.length === 0) return [];
    const codes = Array.from(new Set(currentFunds.map(f => f.code)));
    
    let estimatesMap: Record<string, any> = {};
    try {
        const estimates = await fetchBatchEstimates(codes);
        estimates.forEach((item: any) => estimatesMap[item.fundcode] = item);
    } catch (e) {
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

        // 逻辑修正：
        // 1. 如果有 dwjz (单位净值)，则更新 lastNav。
        // 2. 如果是 official_published (盘后)，则 estimatedNav = dwjz, estimatedChangePercent = gszzl (日增长率)。
        // 3. 如果是盘中 (official_data_1/2, holdings_calc)，则更新 estimatedNav 和 estimatedChangePercent。

        if (!isNaN(apiDwjz) && apiDwjz > 0) {
            lastNav = apiDwjz;
        }

        if (source === 'official_published') {
             if (lastNav > 0) estimatedNav = lastNav;
             estimatedChangePercent = parseFloat(realData.gszzl || "0"); // 日增长率
        } else {
             // 盘中估值
             if (!isNaN(apiGsz) && apiGsz > 0) estimatedNav = apiGsz;
             if (!isNaN(apiGszZl)) estimatedChangePercent = apiGszZl;
             
             // 如果 LV3 (holdings_calc) 只返回了涨幅，我们需要根据 lastNav 算出估值
             if (source === 'holdings_calc' && lastNav > 0 && !isNaN(estimatedChangePercent)) {
                 estimatedNav = lastNav * (1 + estimatedChangePercent / 100);
             }
        }

        if (realData.gztime) estimateTime = realData.gztime;
        if (realData.name && realData.name.length > 0) name = realData.name;
        if (realData.jzrq) lastNavDate = realData.jzrq; // 净值日期

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
            estimateTime,
            fee: realData.fee
        };
    });
};

export const getNavByDate = async (fundCode: string, dateStr: string): Promise<number> => {
    try {
        const history = await getFundHistoryData(fundCode);
        const exactMatch = history.find((h: any) => h.date === dateStr);
        if (exactMatch) return exactMatch.value;
        return 1.0;
    } catch (e) {
        return 1.0;
    }
};
