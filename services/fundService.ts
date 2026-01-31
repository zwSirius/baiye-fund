import { Fund, Stock, SectorIndex } from '../types';

// --- 配置你的后端地址 ---
const API_BASE = 'https://baiye1997-baiye-fund-api.hf.space';

// --- 本地存储键名 (保持不变) ---
const STORAGE_KEY_FUNDS = 'smartfund_funds_v1';
const STORAGE_KEY_GROUPS = 'smartfund_groups_v1';

// --- 核心 API 接口 ---

// 1. 搜索基金 (改用你的 HF 后端)
export const searchFunds = async (query: string): Promise<Fund[]> => {
  if (!query) return [];
  try {
    const response = await fetch(`${API_BASE}/api/search?key=${encodeURIComponent(query)}`);
    const data = await response.json();
    
    // 映射后端数据到前端 Fund 类型
    return data.map((item: any) => ({
        id: item['基金代码'],
        code: item['基金代码'],
        name: item['基金简称'],
        manager: "查询中",
        lastNav: 0,
        lastNavDate: "",
        holdings: [],
        tags: [item['基金类型'] || "混合型"], 
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
    console.error("搜索失败:", error);
    return [];
  }
};

// 2. 获取实时估值 (改用你的 HF 后端)
export const fetchRealTimeEstimate = async (fundCode: string) => {
    try {
        const response = await fetch(`${API_BASE}/api/estimate/${fundCode}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error("后端估值请求失败:", error);
        return null;
    }
};

// 3. 批量更新资产数据
export const updateFundEstimates = async (currentFunds: Fund[]): Promise<Fund[]> => {
    const promises = currentFunds.map(async (fund) => {
        const realData = await fetchRealTimeEstimate(fund.code);
        
        let estimatedNav = fund.lastNav;
        let estimatedChangePercent = 0;
        let lastNav = fund.lastNav;

        if (realData) {
            // 对接后端返回的 gsz 和 gszzl 字段
            lastNav = fund.lastNav || parseFloat(realData.gsz); 
            estimatedNav = parseFloat(realData.gsz || "0");
            estimatedChangePercent = parseFloat(realData.gszzl || "0");
        }

        const profitToday = (estimatedNav - lastNav) * fund.holdingShares;

        return {
            ...fund,
            lastNav,
            estimatedNav,
            estimatedChangePercent,
            estimatedProfit: profitToday
        };
    });

    return await Promise.all(promises);
};

// --- 本地存储逻辑 (保持不变) ---
export const saveFundsToLocal = (funds: Fund[]) => localStorage.setItem(STORAGE_KEY_FUNDS, JSON.stringify(funds));
export const saveGroupsToLocal = (groups: any[]) => localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(groups));
export const getInitialFunds = (): Fund[] => JSON.parse(localStorage.getItem(STORAGE_KEY_FUNDS) || '[]');
export const getStoredGroups = () => {
    const stored = localStorage.getItem(STORAGE_KEY_GROUPS);
    return stored ? JSON.parse(stored) : [
        { id: 'default', name: '我的账户', isDefault: true },
        { id: 'wife', name: '老婆账户', isDefault: false }
    ];
};

// --- 导出/导入 (保持不变) ---
export const exportData = () => JSON.stringify({ funds: getInitialFunds(), groups: getStoredGroups() }, null, 2);
export const importData = (jsonString: string): boolean => {
    try {
        const data = JSON.parse(jsonString);
        if (data.funds && data.groups) {
            saveFundsToLocal(data.funds);
            saveGroupsToLocal(data.groups);
            return true;
        }
        return false;
    } catch { return false; }
};

// 板块指数 (Mock数据，后续可扩展后端接口)
export const getSectorIndices = (): SectorIndex[] => [
    { name: '中证500', changePercent: 1.5, score: 80, leadingStock: '成长股' },
    { name: '中证A500', changePercent: 0.8, score: 70, leadingStock: '核心资产' }
];
