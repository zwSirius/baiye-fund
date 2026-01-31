import { Fund, Stock, BacktestResult, BacktestPoint, SectorIndex } from '../types';

// --- 本地存储键名 ---
const STORAGE_KEY_FUNDS = 'smartfund_funds_v1';
const STORAGE_KEY_GROUPS = 'smartfund_groups_v1';

// --- Helper: Load Script Safely ---
const loadScript = (url: string, cleanupVar?: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => {
            if (script.parentNode) script.parentNode.removeChild(script);
            resolve(true);
        };
        script.onerror = () => {
            if (script.parentNode) script.parentNode.removeChild(script);
            // Don't reject, just resolve false so Promise.all doesn't fail entire batch
            console.warn(`Failed to load script: ${url}`);
            resolve(false);
        };
        document.body.appendChild(script);
    });
};

// --- Helper: Fetch Sina Stock Data (Batch) ---
// 获取股票实时行情: https://hq.sinajs.cn/list=sh600519,sz000858
const fetchStockDetails = async (stockCodes: string[]): Promise<Map<string, { price: number, change: number, name: string }>> => {
    if (stockCodes.length === 0) return new Map();

    // Convert codes: 600519 -> sh600519, 000858 -> sz000858
    // Pingzhong returns codes like "600519", need to prefix
    const sinaCodes = stockCodes.map(c => {
        if (c.startsWith('6') || c.startsWith('9')) return `sh${c}`;
        return `sz${c}`; // 00, 30 start
    });

    const url = `https://hq.sinajs.cn/list=${sinaCodes.join(',')}`;
    
    // Sina API defines variables like: var hq_str_sh600519="Moutai,..."
    await loadScript(url);

    const result = new Map();
    sinaCodes.forEach((fullCode, idx) => {
        const rawCode = stockCodes[idx];
        const varName = `hq_str_${fullCode}`;
        const dataStr = (window as any)[varName];
        
        if (dataStr) {
            const parts = dataStr.split(',');
            // Sina format: name, open, prev_close, current, high, low, buy, sell, ...
            if (parts.length > 3) {
                const name = parts[0];
                const current = parseFloat(parts[3]);
                const prevClose = parseFloat(parts[2]);
                const change = prevClose > 0 ? ((current - prevClose) / prevClose) * 100 : 0;
                
                result.set(rawCode, {
                    name: name,
                    price: current,
                    change: parseFloat(change.toFixed(2))
                });
            }
        }
        // Cleanup global var
        try { delete (window as any)[varName]; } catch(e) {}
    });

    return result;
};


// --- JSONP Helper for Search ---
const fetchJsonp = (url: string, callbackName: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const uniqueCallback = `${callbackName}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // @ts-ignore
    window[uniqueCallback] = (data: any) => {
      delete (window as any)[uniqueCallback];
      if (script.parentNode) {
          script.parentNode.removeChild(script);
      }
      resolve(data);
    };

    const separator = url.includes('?') ? '&' : '?';
    script.src = `${url}${separator}callback=${uniqueCallback}`;
    
    script.onerror = () => {
      delete (window as any)[uniqueCallback];
      if (script.parentNode) {
          script.parentNode.removeChild(script);
      }
      reject(new Error(`JSONP request failed for ${url}`));
    };

    document.body.appendChild(script);
  });
};

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

// --- 真实 API 接口 (Core) ---

// 1. 搜索基金 (Using JSONP direct to Eastmoney)
export const searchFunds = async (query: string): Promise<Fund[]> => {
  if (!query) return [];
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(query)}`;
  try {
    const data = await fetchJsonp(url, 'fundSearchCallback');
    if (!data || !data.Datas) return [];

    return data.Datas.map((item: any) => ({
        id: `temp_${item.CODE}`,
        code: item.CODE,
        name: item.NAME,
        manager: "暂无",
        lastNav: 0,
        lastNavDate: "",
        holdings: [],
        tags: [item.FundType || "混合型"], 
        estimatedNav: 0,
        estimatedChangePercent: 0,
        estimatedProfit: 0,
        groupId: '',
        holdingShares: 0,
        holdingCost: 0,
        realizedProfit: 0,
        transactions: []
    }));
  } catch (error) {
    console.error("Search failed:", error);
    return [];
  }
};

// 2. 获取实时估值 (Using HF Proxy Backend)
export const fetchRealTimeEstimate = async (fundCode: string) => {
    const url = `https://baiye1997-baiye-fund-api.hf.space/api/estimate/${fundCode}`;
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (error) {
        console.error("后端请求失败:", error);
        return null;
    }
};

// 3. 深度数据获取 (PINGZHONGDATA - The "No Backend" Magic)
// 获取真实历史净值、股票代码列表
export const fetchFundDetailsFromPingzhong = async (fund: Fund): Promise<Fund> => {
    const url = `https://fund.eastmoney.com/pingzhongdata/${fund.code}.js?v=${Date.now()}`;
    
    await loadScript(url);

    // Pingzhong defines global vars:
    // fS_name, fS_code, Data_netWorthTrend (History), Data_ACWorthTrend, stockCodesNew (Holdings)

    const w = window as any;
    const historyData = w.Data_netWorthTrend; // Array of {x: timestamp, y: nav, equityReturn: change}
    const stockCodes = w.stockCodesNew; // Array of "600519"
    
    // Clean up globals to save memory
    // try { delete w.Data_netWorthTrend; delete w.stockCodesNew; } catch(e) {}

    let updatedFund = { ...fund };

    // Update History & Latest NAV from "Truth" (History)
    if (historyData && Array.isArray(historyData) && historyData.length > 0) {
        const lastPoint = historyData[historyData.length - 1];
        // Pingzhong history is usually T-1 (Yesterday). 
        // We use this as the base "lastNav".
        updatedFund.lastNav = parseFloat(lastPoint.y);
        
        // Convert timestamp to date string
        const date = new Date(lastPoint.x);
        updatedFund.lastNavDate = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
        
        // If we have history, we can generate the real chart data later
        // For now, we store the full history implies getting it on demand in the detail view
        // to avoid storing huge JSON in localStorage.
    }

    // Update Holdings (Stocks)
    // NOTE: Without backend, we CANNOT get the % weight from pingzhongdata.
    // We only get the codes. We will assume equal weight or just list them.
    if (stockCodes && Array.isArray(stockCodes)) {
        // Fetch Real-time Stock Data for these codes via Sina
        const stockMap = await fetchStockDetails(stockCodes.slice(0, 10)); // Top 10
        
        const holdings: Stock[] = stockCodes.slice(0, 10).map((code: string) => {
            const info = stockMap.get(code);
            return {
                code: code,
                name: info?.name || code,
                percent: 0, // Unknown without backend HTML scraping
                currentPrice: info?.price || 0,
                changePercent: info?.change || 0
            };
        });
        
        updatedFund.holdings = holdings;
    }

    return updatedFund;
};

// 4. 批量更新 (Combined Estimate + Detail Check)
export const updateFundEstimates = async (currentFunds: Fund[]): Promise<Fund[]> => {
    // 1. Get Lightweight Estimates first (Fast)
    const promises = currentFunds.map(async (fund) => {
        const realData = await fetchRealTimeEstimate(fund.code);
        
        let estimatedNav = fund.lastNav;
        let estimatedChangePercent = 0;
        let name = fund.name;
        let lastNav = fund.lastNav;
        let lastNavDate = fund.lastNavDate;

        if (realData) {
            // fundgz gives 'dwjz' (Yesterday NAV) and 'gsz' (Realtime Estimate)
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

// 5. 获取详细历史数据 (For Detail View)
export const getFundHistoryData = async (fundCode: string) => {
    const url = `https://fund.eastmoney.com/pingzhongdata/${fundCode}.js?v=${Date.now()}`;
    await loadScript(url);
    const w = window as any;
    
    // Data_netWorthTrend: [{x: timestamp, y: nav, equityReturn: change}, ...]
    // Data_ACWorthTrend: [{x: timestamp, y: nav}, ...] (Cumulative)
    
    const rawHistory = w.Data_netWorthTrend;
    if (rawHistory && Array.isArray(rawHistory)) {
        return rawHistory.map((item: any) => ({
            date: new Date(item.x).toISOString().split('T')[0],
            value: parseFloat(item.y),
            change: parseFloat(item.equityReturn)
        }));
    }
    return [];
};

// 辅助：获取某个日期的净值
export const getNavByDate = async (fundCode: string, dateStr: string): Promise<number> => {
    const realData = await fetchRealTimeEstimate(fundCode);
    if (realData) return parseFloat(realData.dwjz);
    return 1.0;
};

// Mock 模拟获取板块指数
export const getSectorIndices = (): SectorIndex[] => {
    return [
        { name: '中证白酒', changePercent: 1.24, score: 85, leadingStock: '贵州茅台' },
        { name: '半导体', changePercent: -0.85, score: 40, leadingStock: '中芯国际' },
        { name: '新能源车', changePercent: 0.33, score: 60, leadingStock: '比亚迪' },
        { name: '生物医药', changePercent: -0.12, score: 45, leadingStock: '恒瑞医药' },
        { name: '人工智能', changePercent: 2.15, score: 95, leadingStock: '科大讯飞' },
    ];
};

export const runBacktest = (portfolio: { code: string, amount: number }[], durationYears: number): BacktestResult => {
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

// Legacy generator (replaced by getFundHistoryData)
export const generateHistory = (fundCode: string, days: number): number[] => {
    return [];
};