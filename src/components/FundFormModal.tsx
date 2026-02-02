import React, { useState, useEffect } from 'react';
import { Fund, Group, Transaction } from '../types';
import { searchFunds, fetchRealTimeEstimate } from '../services/fundService';
import { calculateFundMetrics } from '../utils/finance';
import { X, Search, Loader2, Plus, Check, Users, DollarSign, PieChart, Eye, ArrowRight } from 'lucide-react';

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
  
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSelect = async (fund: Fund, forceWatchlist: boolean = false) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    
    // Determine target mode
    const targetIsWatchlist = isWatchlistMode || forceWatchlist;

    setIsLoadingDetails(true);

    try {
        const realData = await fetchRealTimeEstimate(fund.code);
        
        let finalName = fund.name;
        let lastNav = 0;
        let estimatedNav = 0;
        let estimatedChangePercent = 0;
        let lastNavDate = "";
        let source = "official";

        if (realData) {
             lastNav = parseFloat(realData.dwjz);
             if (isNaN(lastNav) || lastNav <= 0) lastNav = 1.0;
             estimatedNav = parseFloat(realData.gsz || realData.dwjz);
             if (isNaN(estimatedNav) || estimatedNav <= 0) estimatedNav = lastNav;
             estimatedChangePercent = parseFloat(realData.gszzl || "0");
             if (realData.name) finalName = realData.name;
             lastNavDate = realData.jzrq;
             source = realData.source || "official";
        }

        const fundBase = {
            ...fund,
            name: finalName,
            lastNav,
            lastNavDate,
            estimatedNav,
            estimatedChangePercent,
            source,
            groupId: targetIsWatchlist ? 'watchlist' : selectedGroup,
            holdingShares: 0,
            holdingCost: 0,
            realizedProfit: 0,
            transactions: []
        };

        if (targetIsWatchlist) {
            const id = `${fund.code}_watchlist_${Date.now()}`;
            const newFund: Fund = {
                ...fundBase,
                id,
                isWatchlist: true,
            };
            onSave(newFund);
            setIsLoadingDetails(false);
            setIsSubmitting(false);
            onClose();
            return;
        }

        setSelectedFund(fundBase);
        setCost(lastNav > 0 ? lastNav.toString() : ''); 
        setStep('input');
    } catch (e) {
        console.error("Failed to fetch details", e);
        // Fallback for watchlist if API fails
        if (targetIsWatchlist) {
             onSave({ 
                 ...fund, 
                 id: `${fund.code}_wl_${Date.now()}`, 
                 isWatchlist: true, 
                 holdingShares: 0,
                 estimatedNav: 0,
                 lastNav: 0,
                 estimatedChangePercent: 0,
                 estimatedProfit: 0,
                 holdingCost: 0,
                 realizedProfit: 0,
                 groupId: 'watchlist'
             });
             onClose();
        } else {
            // For holding mode, we still need to show input even if fetch fails
            setSelectedFund({
                ...fund,
                estimatedNav: 0,
                lastNav: 0,
                estimatedChangePercent: 0,
                estimatedProfit: 0,
                holdingShares: 0,
                holdingCost: 0,
                realizedProfit: 0,
                groupId: selectedGroup
            });
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

    // 使用统一计算逻辑
    const profitToday = calculateFundMetrics(
        holdingShares,
        selectedFund.lastNav,
        selectedFund.estimatedNav,
        selectedFund.estimatedChangePercent
    );

    const newFund: Fund = {
      ...selectedFund,
      id: id,
      groupId: groupId,
      holdingShares: holdingShares,
      holdingCost: holdingCost,
      estimatedProfit: profitToday,
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
      <div 
        className="bg-white dark:bg-slate-900 w-full max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl z-10 flex flex-col overflow-hidden animate-slide-up sm:animate-fade-in transition-all"
        style={{ height: 'calc(90vh - env(safe-area-inset-bottom))' }} 
      >
        
        <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            {isWatchlistMode ? <Eye className="text-blue-500" size={20}/> : null}
            {isWatchlistMode ? '添加自选基金' : (initialFund ? '编辑持仓' : (step === 'search' ? '添加持仓' : '配置持仓'))}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 relative no-scrollbar">
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
                    className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex justify-between items-center transition hover:border-blue-400"
                  >
                    <div 
                        className="flex-1 cursor-pointer"
                        onClick={() => handleSelect(fund, false)}
                    >
                      <div className="font-bold text-slate-800 dark:text-slate-100">{fund.name}</div>
                      <div className="text-xs text-slate-400 mt-1 flex gap-2">
                        <span className="bg-slate-100 dark:bg-slate-800 px-1 rounded font-mono">{fund.code}</span>
                        <span>{fund.tags.join(' ')}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                         {!isWatchlistMode && (
                             <button 
                                onClick={(e) => { e.stopPropagation(); handleSelect(fund, true); }}
                                className="p-2 rounded-full bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition"
                                title="加入自选"
                             >
                                 <Eye size={18} />
                             </button>
                         )}

                         <button 
                             onClick={() => handleSelect(fund, false)}
                             className={`p-2 rounded-full ${isWatchlistMode ? 'bg-blue-50 text-blue-500' : 'bg-blue-600 text-white shadow-md'}`}
                         >
                             {isWatchlistMode ? <Plus size={20} /> : <ArrowRight size={18} />}
                         </button>
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
             <div className="space-y-4 animate-fade-in pb-20">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-blue-100 dark:border-blue-900 shadow-sm">
                   <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">当前基金</div>
                   <div className="font-bold text-lg text-slate-800 dark:text-slate-100">{selectedFund.name}</div>
                   <div className="flex justify-between items-end mt-2">
                       <div className="flex items-center gap-2">
                          <div className="text-xs text-blue-500 font-mono bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded">{selectedFund.code}</div>
                          {selectedFund.tags && selectedFund.tags.length > 0 && <div className="text-xs text-slate-400">{selectedFund.tags[0]}</div>}
                       </div>
                       <div className="text-right">
                           <div className="text-[10px] text-slate-400">实时估值</div>
                           <div className={`font-bold ${selectedFund.estimatedChangePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                               {selectedFund.estimatedChangePercent > 0 ? '+' : ''}{selectedFund.estimatedChangePercent}%
                           </div>
                       </div>
                   </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
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
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 pb-safe">
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