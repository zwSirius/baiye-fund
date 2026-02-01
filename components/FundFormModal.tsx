import React, { useState, useEffect } from 'react';
import { Fund, Group, Transaction } from '../types';
import { searchFunds, fetchRealTimeEstimate } from '../services/fundService';
import { X, Search, Loader2, Plus, Check, Users, DollarSign, PieChart, Eye } from 'lucide-react';

interface FundFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (fund: Fund) => void;
  initialFund?: Fund | null;
  groups: Group[];
  currentGroupId: string;
  isWatchlistMode?: boolean; 
}

export const FundFormModal: React.FC<FundFormModalProps> = ({ isOpen, onClose, onSave, initialFund, groups, currentGroupId, isWatchlistMode = false }) => {
  const [step, setStep] = useState<'search' | 'input'>('search');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Fund[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Form State
  const [selectedFund, setSelectedFund] = useState<Fund | null>(null);
  const [shares, setShares] = useState<string>('');
  const [cost, setCost] = useState<string>('');
  const [realizedProfit, setRealizedProfit] = useState<string>('0');
  const [selectedGroup, setSelectedGroup] = useState<string>(currentGroupId === 'all' ? (groups[0]?.id || 'default') : currentGroupId);
  
  // Loading details
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setIsSubmitting(false);
      setIsLoadingDetails(false);
      
      if (initialFund) {
        setStep('input');
        setSelectedFund(initialFund);
        setShares(initialFund.holdingShares.toString());
        setCost(initialFund.holdingCost.toString());
        setRealizedProfit(initialFund.realizedProfit ? initialFund.realizedProfit.toString() : '0');
        setSelectedGroup(initialFund.groupId);
      } else {
        setStep('search');
        setQuery('');
        setSearchResults([]);
        setShares('');
        setCost('');
        setRealizedProfit('0');
        setSelectedFund(null);
        setSelectedGroup(currentGroupId === 'all' ? (groups[0]?.id || 'default') : currentGroupId);
      }
    }
  }, [isOpen, initialFund, currentGroupId, groups]);

  // Debounce search
  useEffect(() => {
    if (step !== 'search') return;
    const timer = setTimeout(async () => {
      if (query.trim().length > 1) {
        setIsSearching(true);
        const results = await searchFunds(query);
        setSearchResults(results);
        setIsSearching(false);
      } else {
        setSearchResults([]);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [query, step]);

  const handleSelect = async (fund: Fund) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setIsLoadingDetails(true);

    try {
        // 1. Fetch latest data (Nav, Estimate, Name)
        // Optimization: Use fetchRealTimeEstimate to get the latest name and NAV immediately
        const realData = await fetchRealTimeEstimate(fund.code);
        
        let finalName = fund.name;
        let lastNav = 0;
        let estimatedNav = 0;
        let estimatedChangePercent = 0;
        let lastNavDate = "";

        if (realData) {
             lastNav = parseFloat(realData.dwjz);
             // If dwjz is 0 or invalid, fallback to 1.0 safely
             if (isNaN(lastNav) || lastNav <= 0) lastNav = 1.0;

             estimatedNav = parseFloat(realData.gsz || realData.dwjz);
             if (isNaN(estimatedNav) || estimatedNav <= 0) estimatedNav = lastNav;
             
             estimatedChangePercent = parseFloat(realData.gszzl || "0");
             if (realData.name) finalName = realData.name;
             lastNavDate = realData.jzrq;
        }

        // --- WATCHLIST LOGIC ---
        if (isWatchlistMode) {
            const id = `${fund.code}_watchlist_${Date.now()}`;
            const newFund: Fund = {
                ...fund,
                id,
                name: finalName,
                lastNav,
                lastNavDate,
                estimatedNav,
                estimatedChangePercent,
                groupId: 'watchlist', // Virtual ID
                holdingShares: 0,
                holdingCost: 0,
                realizedProfit: 0,
                isWatchlist: true,
                transactions: []
            };
            
            onSave(newFund);
            onClose();
            return; // STRICT RETURN: Do not proceed to input step
        }

        // --- PORTFOLIO LOGIC ---
        const updatedFund = {
            ...fund,
            name: finalName,
            lastNav,
            estimatedNav,
            lastNavDate
        };
        
        setSelectedFund(updatedFund);
        // Auto-fill cost with current NAV for convenience
        setCost(lastNav > 0 ? lastNav.toString() : ''); 
        setStep('input');

    } catch (e) {
        console.error("Failed to fetch details", e);
        // Fallback if fetch fails
        if (isWatchlistMode) {
             onSave({ ...fund, id: `${fund.code}_wl_${Date.now()}`, isWatchlist: true, holdingShares: 0 });
             onClose();
        } else {
            setSelectedFund(fund);
            setStep('input');
        }
    } finally {
        setIsLoadingDetails(false);
        setIsSubmitting(false);
    }
  };

  const handleConfirm = () => {
    if (!selectedFund) return;
    
    const groupId = selectedGroup;
    const fundCode = selectedFund.code;
    const id = initialFund ? initialFund.id : `${fundCode}_${groupId}_${Date.now()}`;
    
    const holdingShares = parseFloat(shares) || 0;
    const holdingCost = parseFloat(cost) || 0;

    // Generate initial transaction record if new
    let transactions = initialFund?.transactions || [];
    if (!initialFund && holdingShares > 0) {
        const initialTx: Transaction = {
            id: `init_${Date.now()}`,
            type: 'BUY',
            date: new Date().toISOString().split('T')[0],
            amount: holdingShares * holdingCost,
            shares: holdingShares,
            nav: holdingCost, 
            fee: 0 
        };
        transactions = [initialTx];
    }

    const newFund: Fund = {
      ...selectedFund,
      id: id,
      groupId: groupId,
      holdingShares: holdingShares,
      holdingCost: holdingCost,
      realizedProfit: parseFloat(realizedProfit) || 0,
      isWatchlist: false,
      transactions: transactions
    };
    onSave(newFund);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white dark:bg-slate-900 w-full max-w-md h-[90vh] sm:h-auto sm:rounded-2xl rounded-t-2xl shadow-xl z-10 flex flex-col overflow-hidden animate-slide-up sm:animate-fade-in transition-all">
        
        <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            {isWatchlistMode ? <Eye className="text-blue-500" size={20}/> : null}
            {isWatchlistMode ? '添加自选基金' : (initialFund ? '编辑持仓' : (step === 'search' ? '添加持仓' : '配置持仓'))}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 relative">
          {isLoadingDetails && (
              <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 z-20 flex flex-col items-center justify-center backdrop-blur-sm">
                  <Loader2 className="animate-spin text-blue-500 mb-2" size={32} />
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                      {isWatchlistMode ? '正在添加到自选...' : '正在获取数据...'}
                  </span>
              </div>
          )}

          {step === 'search' && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 text-slate-400" size={20} />
                <input
                  type="text"
                  placeholder="输入代码或名称搜索"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-900 dark:text-slate-100"
                  autoFocus
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-3 text-blue-500 animate-spin" size={20} />
                )}
              </div>

              <div className="space-y-2">
                {searchResults.map(fund => (
                  <div 
                    key={fund.id} 
                    onClick={() => handleSelect(fund)}
                    className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex justify-between items-center active:scale-[0.98] transition cursor-pointer hover:border-blue-400"
                  >
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-100">{fund.name}</div>
                      <div className="text-xs text-slate-400 mt-1 flex gap-2">
                        <span className="bg-slate-100 dark:bg-slate-800 px-1 rounded font-mono">{fund.code}</span>
                        <span>{fund.tags.join(' ')}</span>
                      </div>
                    </div>
                    <div className={`p-2 rounded-full ${isWatchlistMode ? 'bg-blue-50 text-blue-500' : 'bg-slate-100 text-slate-400'}`}>
                        {isWatchlistMode ? <Eye size={20} /> : <Plus size={20} />}
                    </div>
                  </div>
                ))}
                {!isSearching && query.length > 1 && searchResults.length === 0 && (
                   <div className="text-center text-slate-400 py-10">未找到相关基金，请尝试输入基金代码</div>
                )}
              </div>
            </div>
          )}

          {step === 'input' && selectedFund && !isWatchlistMode && (
             <div className="space-y-4 animate-fade-in">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-blue-100 dark:border-blue-900 shadow-sm">
                   <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">当前基金</div>
                   <div className="font-bold text-lg text-slate-800 dark:text-slate-100">{selectedFund.name}</div>
                   <div className="text-xs text-blue-500 font-mono mt-0.5">{selectedFund.code}</div>
                   <div className="text-xs text-slate-400 mt-2 bg-slate-50 dark:bg-slate-800 inline-block px-2 py-1 rounded">
                       最新净值: <span className="text-slate-700 dark:text-slate-300 font-bold">{selectedFund.lastNav}</span> ({selectedFund.lastNavDate})
                   </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
                   {/* Group Selection */}
                   <div>
                     <label className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1">
                        <Users size={14} /> 所属分组
                     </label>
                     <div className="flex flex-wrap gap-2">
                        {groups.map(g => (
                            <button
                                key={g.id}
                                onClick={() => setSelectedGroup(g.id)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                                    selectedGroup === g.id 
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-md' 
                                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }`}
                            >
                                {g.name}
                            </button>
                        ))}
                     </div>
                   </div>

                   <hr className="border-slate-100 dark:border-slate-800" />

                   <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">持有份额 (份)</label>
                         <div className="relative">
                            <PieChart size={14} className="absolute left-3 top-3.5 text-slate-400" />
                            <input
                                type="number"
                                value={shares}
                                onChange={e => setShares(e.target.value)}
                                placeholder="0.00"
                                className="w-full pl-8 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 dark:text-white"
                            />
                         </div>
                       </div>
                       
                       <div>
                         <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">持仓成本 (元)</label>
                         <div className="relative">
                            <DollarSign size={14} className="absolute left-3 top-3.5 text-slate-400" />
                            <input
                                type="number"
                                value={cost}
                                onChange={e => setCost(e.target.value)}
                                placeholder="0.0000"
                                className="w-full pl-8 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 dark:text-white"
                            />
                         </div>
                       </div>
                   </div>

                   <div>
                     <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">已落袋收益 (元)</label>
                     <div className="relative">
                        <DollarSign size={14} className="absolute left-3 top-3.5 text-slate-400" />
                        <input
                            type="number"
                            value={realizedProfit}
                            onChange={e => setRealizedProfit(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-8 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 dark:text-white"
                        />
                     </div>
                   </div>
                </div>
             </div>
          )}
        </div>

        {step === 'input' && !isWatchlistMode && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
            <button 
              onClick={handleConfirm}
              className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl shadow-lg hover:bg-blue-700 active:scale-[0.98] transition flex items-center justify-center gap-2"
            >
              <Check size={20} />
              确认{initialFund ? '修改' : '添加'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};