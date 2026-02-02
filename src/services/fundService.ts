import { Fund, SectorIndex, BacktestResult, BacktestPoint } from '../types';
import { calculateFundMetrics } from '../utils/finance';

// --- 配置后端地址 ---
// 1. 生产环境 (Zeabur): 请在 Zeabur 环境变量中设置 VITE_API_BASE 为后端服务的完整 URL (如 https://api.xxx.zeabur.app)
// 2. 本地开发 (Dev): 默认为空字符串，请求会通过 Vite 代理转发到 http://127.0.0.1:7860
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

// 2. 获取实时估值 (单个) - 兼容旧逻辑
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

// 2.1 批量获取实时估值 (优化版)
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

// 6. 批量更新 (优化：使用 Batch API)
export const updateFundEstimates = async (currentFunds: Fund[]): Promise<Fund[]> => {
    if (currentFunds.length === 0) return [];

    // 提取所有 Code
    const codes = Array.from(new Set(currentFunds.map(f => f.code)));
    
    // 调用批量接口
    let estimatesMap: Record<string, any> = {};
    try {
        const estimates = await fetchBatchEstimates(codes);
        estimates.forEach((item: any) => {
            estimatesMap[item.fundcode] = item;
        });
    } catch (e) {
        console.error("Batch update failed, falling back to original data", e);
        return currentFunds;
    }

    // 映射结果
    return currentFunds.map(fund => {
        const realData = estimatesMap[fund.code];
        
        if (!realData) return fund; // 如果该基金数据缺失，保持原状

        let estimatedNav = fund.lastNav;
        let estimatedChangePercent = 0;
        let name = fund.name;
        let lastNav = fund.lastNav;
        let lastNavDate = fund.lastNavDate;
        let source = fund.source;

        const apiDwjz = parseFloat(realData.dwjz);
        const apiGsz = parseFloat(realData.gsz);

        // 更新单位净值 (逻辑同之前，确保不为0)
        if (!isNaN(apiDwjz) && apiDwjz > 0) {
            lastNav = apiDwjz;
            lastNavDate = realData.jzrq;
        } else if (lastNav === 0) {
            lastNav = !isNaN(apiGsz) ? apiGsz : 1.0;
        }

        // 更新估值和涨跌幅
        if (!isNaN(apiGsz) && apiGsz > 0) {
            estimatedNav = apiGsz;
            estimatedChangePercent = parseFloat(realData.gszzl || "0");
            source = realData.source;
        } else if (!isNaN(apiDwjz) && apiDwjz > 0) {
            estimatedNav = apiDwjz;
            estimatedChangePercent = 0;
        } else {
             estimatedNav = fund.estimatedNav > 0 ? fund.estimatedNav : 1.0;
        }

        if (realData.name && realData.name.length > 0) {
            name = realData.name;
        }

        // --- 核心修复：当日盈亏计算逻辑 ---
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

// 辅助：获取某个日期的净值 (修复版：从历史接口查找)
export const getNavByDate = async (fundCode: string, dateStr: string): Promise<number> => {
    try {
        // 获取历史数据
        const history = await getFundHistoryData(fundCode);
        
        // 查找精确匹配
        const exactMatch = history.find((h: any) => h.date === dateStr);
        if (exactMatch) return exactMatch.value;

        // 如果没有精确匹配，查找最近的一个之前的日期
        const targetDate = new Date(dateStr).getTime();
        const sortedHistory = [...history].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        for (const h of sortedHistory) {
            if (new Date(h.date).getTime() <= targetDate) {
                return h.value;
            }
        }
        
        // 如果都找不到，尝试获取实时估值作为兜底
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

// 回测逻辑 (Real Data Implementation)
export const runBacktest = async (portfolio: { code: string, amount: number }[], durationYears: number): Promise<BacktestResult> => {
    // 1. Determine Start Date
    const today = new Date();
    const startDate = new Date();
    startDate.setFullYear(today.getFullYear() - durationYears);
    const startDateStr = startDate.toISOString().split('T')[0];

    // 2. Fetch History for all funds
    const allHistoryProms = portfolio.map(async (p) => {
        const history = await getFundHistoryData(p.code);
        // Filter history within range
        const filtered = history.filter((h: any) => h.date >= startDateStr).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        return {
            code: p.code,
            amount: p.amount,
            history: filtered
        };
    });

    const fundsData = await Promise.all(allHistoryProms);

    // 3. Normalize Data (Find common timeline)
    // Create a map of Date -> Total Value
    const dateValueMap: Map<string, number> = new Map();
    const allDatesSet = new Set<string>();
    
    // To handle missing data (e.g. holidays differ for QDII), we need a continuous timeline or union of all dates
    fundsData.forEach(fd => {
        fd.history.forEach((h: any) => allDatesSet.add(h.date));
    });
    
    const sortedDates = Array.from(allDatesSet).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    // Calculate Initial Shares for each fund at their first available date in range
    // Note: If a fund started later than the backtest start date, we assume cash holds until fund starts? 
    // Simplified: We assume buy-in at the first available data point for that fund within the period.
    
    const fundSharesMap: Map<string, number> = new Map();
    const fundLastNavMap: Map<string, number> = new Map(); // For forward filling

    // Calculate shares based on the first available NAV in the period
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

    // Iterate through time
    for (const date of sortedDates) {
        let dailyTotal = 0;
        
        fundsData.forEach(fd => {
            // Find NAV for this date
            const point = fd.history.find((h: any) => h.date === date);
            
            if (point) {
                fundLastNavMap.set(fd.code, point.value);
            }
            
            // Use current or last known NAV
            const nav = point ? point.value : (fundLastNavMap.get(fd.code) || 0);
            const shares = fundSharesMap.get(fd.code) || 0;
            
            dailyTotal += shares * nav;
        });

        // Only add data point if we have valid value (to skip initial gaps if any)
        if (dailyTotal > 0) {
            chartData.push({ date, value: dailyTotal });
        }
    }

    if (chartData.length < 2) {
        // Fallback or Error state
        return {
            totalReturn: 0,
            annualizedReturn: 0,
            maxDrawdown: 0,
            finalValue: portfolio.reduce((sum, p) => sum + p.amount, 0),
            chartData: []
        };
    }

    // 4. Calculate Metrics
    const startValue = chartData[0].value;
    const finalValue = chartData[chartData.length - 1].value;
    
    const totalReturn = ((finalValue - startValue) / startValue) * 100;
    
    // Annualized: (1 + total_ret)^(1/years) - 1
    // Use actual days difference for precision
    const dayDiff = (new Date(sortedDates[sortedDates.length-1]).getTime() - new Date(sortedDates[0]).getTime()) / (1000 * 3600 * 24);
    const exactYears = dayDiff / 365;
    const annualizedReturn = (Math.pow(finalValue / startValue, 1 / (exactYears || 1)) - 1) * 100;

    // Max Drawdown
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
