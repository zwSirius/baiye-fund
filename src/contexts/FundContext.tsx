import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Fund, Group, SectorIndex } from '../types';
import { 
    getInitialFunds, saveFundsToLocal, 
    getStoredGroups, saveGroupsToLocal, 
    getStoredMarketCodes, saveMarketCodes,
    updateFundEstimates, fetchMarketIndices 
} from '../services/fundService';
import { calculateFundMetrics } from '../utils/finance';

interface FundContextType {
    funds: Fund[];
    groups: Group[];
    sectorIndices: SectorIndex[];
    marketCodes: string[];
    isRefreshing: boolean;
    lastUpdate: Date;
    
    // Actions
    refreshData: () => Promise<void>;
    addOrUpdateFund: (fund: Fund) => void;
    removeFund: (id: string) => void;
    addGroup: (name: string) => void;
    removeGroup: (id: string) => void;
    updateMarketCodes: (codes: string[]) => void;
    
    // Computed (Helpers)
    getFundsByGroup: (groupId: string) => Fund[];
    getTotalAssets: () => { totalProfit: number; totalMarketValue: number; totalReturn: number };
}

const FundContext = createContext<FundContextType | null>(null);

export const useFund = () => {
    const context = useContext(FundContext);
    if (!context) throw new Error('useFund must be used within a FundProvider');
    return context;
};

export const FundProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [funds, setFunds] = useState<Fund[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [marketCodes, setMarketCodes] = useState<string[]>([]);
    const [sectorIndices, setSectorIndices] = useState<SectorIndex[]>([]);
    
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastUpdate, setLastUpdate] = useState(new Date());

    // --- Initialization ---
    useEffect(() => {
        const initialFunds = getInitialFunds();
        const initialGroups = getStoredGroups();
        const storedMarketCodes = getStoredMarketCodes();

        setFunds(initialFunds);
        setGroups(initialGroups);
        setMarketCodes(storedMarketCodes);

        // Silent fetch on load
        if (initialFunds.length > 0) {
            updateFundEstimates(initialFunds).then(setFunds);
        }
        fetchMarketIndices(storedMarketCodes).then(setSectorIndices);
    }, []);

    // --- Persistence ---
    useEffect(() => { saveFundsToLocal(funds); }, [funds]);
    useEffect(() => { saveGroupsToLocal(groups); }, [groups]);
    useEffect(() => { saveMarketCodes(marketCodes); }, [marketCodes]);

    // --- Actions ---

    const refreshData = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const [updatedFunds, updatedIndices] = await Promise.all([
                funds.length > 0 ? updateFundEstimates(funds) : Promise.resolve(funds),
                fetchMarketIndices(marketCodes)
            ]);
            
            setFunds(updatedFunds);
            setSectorIndices(updatedIndices);
            setLastUpdate(new Date());
        } catch (e) {
            console.error("Refresh failed", e);
        } finally {
            setIsRefreshing(false);
        }
    }, [funds, marketCodes]);

    const addOrUpdateFund = useCallback((newFund: Fund) => {
        setFunds(prev => {
            const existsIndex = prev.findIndex(f => f.id === newFund.id);
            if (existsIndex >= 0) {
                const next = [...prev];
                next[existsIndex] = newFund;
                return next;
            }
            return [...prev, newFund];
        });
    }, []);

    const removeFund = useCallback((id: string) => {
        setFunds(prev => prev.filter(f => f.id !== id));
    }, []);

    const addGroup = useCallback((name: string) => {
        const newGroup: Group = { id: `group_${Date.now()}`, name, isDefault: false };
        setGroups(prev => [...prev, newGroup]);
    }, []);

    const removeGroup = useCallback((id: string) => {
        setGroups(prev => prev.filter(g => g.id !== id));
        // Reset funds in this group to default? Or remove? 
        // Logic: Usually we might want to move them to default, but here we just delete the group tag?
        // Let's implement logic: Delete group, funds stay but groupId needs handling? 
        // For simplicity based on previous App.tsx logic: it removed funds too or set to empty.
        // Let's safe-guard: funds in deleted group move to default or are hidden? 
        // Original logic: setFunds(prev => prev.filter(f => f.groupId !== groupId));
        // We will keep original destructive logic for consistency.
        setFunds(prev => prev.filter(f => f.groupId !== id));
    }, []);

    const updateMarketCodes = useCallback((codes: string[]) => {
        setMarketCodes(codes);
        fetchMarketIndices(codes).then(setSectorIndices);
    }, []);

    // --- Computed Helpers ---
    
    const getFundsByGroup = useCallback((groupId: string) => {
        const holdingFunds = funds.filter(f => !f.isWatchlist && f.holdingShares > 0);
        if (groupId === 'all') return holdingFunds;
        return holdingFunds.filter(f => f.groupId === groupId);
    }, [funds]);

    const getTotalAssets = useCallback(() => {
        let totalProfit = 0;
        let totalMarketValue = 0;
        let totalReturn = 0;

        const visibleFunds = funds.filter(f => !f.isWatchlist && f.holdingShares > 0);
        
        visibleFunds.forEach(f => {
            // Re-verify profit calculation using utility to be safe, though fund.estimatedProfit should be up to date
            // But relying on stored state is faster for rendering.
            totalProfit += f.estimatedProfit;
            const mv = f.estimatedNav * f.holdingShares;
            totalMarketValue += mv;
            
            const costValue = f.holdingCost * f.holdingShares;
            totalReturn += (mv - costValue + (f.realizedProfit || 0));
        });

        return { totalProfit, totalMarketValue, totalReturn };
    }, [funds]);

    const value = useMemo(() => ({
        funds, groups, sectorIndices, marketCodes, isRefreshing, lastUpdate,
        refreshData, addOrUpdateFund, removeFund, addGroup, removeGroup, updateMarketCodes,
        getFundsByGroup, getTotalAssets
    }), [
        funds, groups, sectorIndices, marketCodes, isRefreshing, lastUpdate,
        refreshData, addOrUpdateFund, removeFund, addGroup, removeGroup, updateMarketCodes,
        getFundsByGroup, getTotalAssets
    ]);

    return <FundContext.Provider value={value}>{children}</FundContext.Provider>;
};
