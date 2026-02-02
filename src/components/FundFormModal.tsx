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

        // Identify ETF/Market funds to avoid forced look-through
        const isETF = fund.tags.some(t => t.includes('ETF') || t.includes('场内')) || finalName.includes('ETF') || finalName.includes('场内');

        const fundBase = {
            ...fund,
            name: finalName,
            lastNav,
            lastNavDate,
            estimatedNav,
            estimatedChangePercent,
            source: isETF ? 'official' : source, // Trust API for ETFs
            groupId: targetIsWatchlist ? 'watchlist' : selectedGroup,
            holdingShares: 0,
            holdingCost: 0,
            realizedProfit: 0,
            transactions: []
        };

        if (targetIsWatchlist) {
            const id = `${fund.code}_watchlist_${Date.now()}`;
            const newFund: Fund = { ...fundBase, id, isWatchlist: true };
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
        if (targetIsWatchlist) {
             onSave({ ...fund, id: `${fund.code}_wl_${Date.now()}`, isWatchlist: true, groupId: 'watchlist' });
             onClose();
        } else {
            setSelectedFund({ ...fund, groupId: selectedGroup });
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
        transactions = [{ id: `init_${Date.now()}`, type: 'BUY', date: new Date().toISOString().split('T')[0], amount: holdingShares * holdingCost, shares: holdingShares, nav: holdingCost, fee: 0 }];
    }

    const profitToday = calculateFundMetrics(holdingShares, selectedFund.lastNav, selectedFund.estimatedNav, selectedFund.estimatedChangePercent);
    const newFund: Fund = { ...selectedFund, id, groupId, holdingShares, holdingCost, estimatedProfit: profitToday, realizedProfit: parseFloat(realizedProfit) || 0, isWatchlist: false, transactions };
    onSave(newFund);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white dark:bg-slate-900 w-full max-w-md h-[90vh] sm:h-auto sm:rounded-2xl rounded-t-2xl shadow-2xl z-10 flex flex-col overflow-hidden animate-slide-up">
        
        <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            {isWatchlistMode ? <Eye className="text-blue-500" size={20}/> : null}
            {isWatchlistMode ? '添加自选基金' : (initialFund ? '编辑持仓' : '添加持仓')}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500"><X size={24} /></button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 pb-safe modal-scroll-area no-scrollbar">
          {isLoadingDetails && (
              <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 z-20 flex flex-col items-center justify-center">
                  <Loader2 className="animate-spin text-blue-500 mb-2" size={32} />
                  <span className="text-sm font-bold">同步最新估值...</span>
              </div>
          )}

          {step === 'search' && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 text-slate-400" size={20} />
                <input
                  type="text"
                  placeholder="搜索名称或代码 (如 000001)"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                {searchResults.map(fund => (
                  <div key={fund.id} onClick={() => handleSelect(fund, false)} className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center hover:border-blue-400 cursor-pointer active:scale-[0.98] transition">
                    <div className="flex-1">
                      <div className="font-bold text-slate-800 dark:text-slate-100">{fund.name}</div>
                      <div className="text-xs text-slate-400 mt-1 flex gap-2">
                        <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">{fund.code}</span>
                        <span>{fund.tags[0]}</span>
                      </div>
                    </div>
                    <ArrowRight size={18} className="text-slate-300" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'input' && selectedFund && (
             <div className="space-y-4 animate-fade-in">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-blue-50 dark:border-blue-900">
                   <div className="font-bold text-lg text-slate-800 dark:text-slate-100">{selectedFund.name}</div>
                   <div className="text-xs text-slate-400 font-mono mt-1">{selectedFund.code}</div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl space-y-5">
                   <div>
                     <label className="text-xs font-bold text-slate-400 mb-2 block uppercase">选择分组</label>
                     <div className="flex flex-wrap gap-2">
                        {groups.map(g => (
                            <button key={g.id} onClick={() => setSelectedGroup(g.id)} className={`px-4 py-2 rounded-xl text-xs font-bold transition border ${selectedGroup === g.id ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-500'}`}>{g.name}</button>
                        ))}
                     </div>
                   </div>

                   <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase">持有份额</label>
                         <input type="number" value={shares} onChange={e => setShares(e.target.value)} placeholder="0.00" className="w-full px-3 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl border-none outline-none font-bold text-lg" />
                       </div>
                       <div>
                         <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase">持仓成本</label>
                         <input type="number" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.0000" className="w-full px-3 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl border-none outline-none font-bold text-lg" />
                       </div>
                   </div>

                   <div>
                     <label className="block text-xs font-bold text-slate-400 mb-1.5 uppercase">已落袋收益 (元)</label>
                     <input type="number" value={realizedProfit} onChange={e => setRealizedProfit(e.target.value)} className="w-full px-3 py-3 bg-slate-50 dark:bg-slate-800 rounded-xl border-none outline-none font-bold" />
                   </div>
                </div>
                {/* Visual buffer to ensure scrolling on small screens with keyboard */}
                <div className="h-20 sm:hidden"></div>
             </div>
          )}
        </div>

        {step === 'input' && !isWatchlistMode && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 pb-safe">
            <button onClick={handleConfirm} className="w-full bg-blue-600 text-white font-black py-4 rounded-xl shadow-xl active:scale-[0.98] transition">确认配置</button>
          </div>
        )}
      </div>
    </div>
  );
};