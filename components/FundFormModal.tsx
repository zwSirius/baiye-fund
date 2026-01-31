import React, { useState, useEffect } from 'react';
import { Fund, Group } from '../types';
import { searchFunds, fetchRealTimeEstimate } from '../services/fundService';
import { X, Search, Loader2, Plus, Check, Users, DollarSign, PieChart } from 'lucide-react';

interface FundFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (fund: Fund) => void;
  initialFund?: Fund | null;
  groups: Group[];
  currentGroupId: string;
}

export const FundFormModal: React.FC<FundFormModalProps> = ({ isOpen, onClose, onSave, initialFund, groups, currentGroupId }) => {
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

  useEffect(() => {
    if (isOpen) {
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
    setIsLoadingDetails(true);
    // Fetch latest NAV before editing
    const realData = await fetchRealTimeEstimate(fund.code);
    setIsLoadingDetails(false);

    if (realData) {
        const updatedFund = {
            ...fund,
            name: realData.name,
            lastNav: parseFloat(realData.dwjz),
            estimatedNav: parseFloat(realData.gsz || realData.dwjz),
            lastNavDate: realData.jzrq
        };
        setSelectedFund(updatedFund);
        setCost(updatedFund.lastNav.toString());
    } else {
        setSelectedFund(fund);
        setCost('1.0000'); // Fallback
    }
    setStep('input');
  };

  const handleConfirm = () => {
    if (!selectedFund) return;
    
    const groupId = selectedGroup;
    const fundCode = selectedFund.code;
    const id = initialFund ? initialFund.id : `${fundCode}_${groupId}_${Date.now()}`;

    const newFund: Fund = {
      ...selectedFund,
      id: id,
      groupId: groupId,
      holdingShares: parseFloat(shares) || 0,
      holdingCost: parseFloat(cost) || 0,
      realizedProfit: parseFloat(realizedProfit) || 0,
    };
    onSave(newFund);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white dark:bg-slate-900 w-full max-w-md h-[90vh] sm:h-auto sm:rounded-2xl rounded-t-2xl shadow-xl z-10 flex flex-col overflow-hidden animate-slide-up sm:animate-fade-in">
        
        <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {initialFund ? '编辑持仓' : (step === 'search' ? '添加基金' : '配置持仓')}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 relative">
          {/* Loading Overlay */}
          {isLoadingDetails && (
              <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 z-20 flex flex-col items-center justify-center">
                  <Loader2 className="animate-spin text-blue-500 mb-2" size={32} />
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300">获取实时净值中...</span>
              </div>
          )}

          {step === 'search' && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 text-slate-400" size={20} />
                <input
                  type="text"
                  placeholder="输入代码或名称 (如: 005827)"
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
                    className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex justify-between items-center active:scale-[0.98] transition cursor-pointer"
                  >
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-100">{fund.name}</div>
                      <div className="text-xs text-slate-400 mt-1 flex gap-2">
                        <span className="bg-slate-100 dark:bg-slate-800 px-1 rounded">{fund.code}</span>
                        <span>{fund.tags.join(' ')}</span>
                      </div>
                    </div>
                    <Plus size={20} className="text-blue-500" />
                  </div>
                ))}
                {!isSearching && query.length > 1 && searchResults.length === 0 && (
                   <div className="text-center text-slate-400 py-10">未找到相关基金，请尝试输入基金代码</div>
                )}
              </div>
            </div>
          )}

          {step === 'input' && selectedFund && (
             <div className="space-y-4">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-blue-100 dark:border-blue-900 shadow-sm">
                   <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">当前基金</div>
                   <div className="font-bold text-lg text-slate-800 dark:text-slate-100">{selectedFund.name}</div>
                   <div className="text-xs text-blue-500">{selectedFund.code}</div>
                   <div className="text-xs text-slate-400 mt-1">最新净值: {selectedFund.lastNav} ({selectedFund.lastNavDate})</div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
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
                                    ? 'bg-blue-600 text-white border-blue-600' 
                                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }`}
                            >
                                {g.name}
                            </button>
                        ))}
                     </div>
                   </div>

                   <hr className="border-slate-100 dark:border-slate-800" />

                   <div>
                     <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">持有份额 (份)</label>
                     <div className="relative">
                        <PieChart size={16} className="absolute left-3 top-3.5 text-slate-400" />
                        <input
                            type="number"
                            value={shares}
                            onChange={e => setShares(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-9 pr-3 py-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 outline-none text-lg font-bold text-slate-900 dark:text-white"
                        />
                     </div>
                   </div>
                   
                   <div>
                     <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">持仓成本 (元)</label>
                     <div className="text-xs text-slate-400 mb-2">默认为最新净值，请修改为你的实际成本</div>
                     <div className="relative">
                        <DollarSign size={16} className="absolute left-3 top-3.5 text-slate-400" />
                        <input
                            type="number"
                            value={cost}
                            onChange={e => setCost(e.target.value)}
                            placeholder="0.0000"
                            className="w-full pl-9 pr-3 py-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 outline-none text-lg font-bold text-slate-900 dark:text-white"
                        />
                     </div>
                   </div>

                   <div>
                     <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">已落袋收益 (元)</label>
                     <div className="relative">
                        <DollarSign size={16} className="absolute left-3 top-3.5 text-slate-400" />
                        <input
                            type="number"
                            value={realizedProfit}
                            onChange={e => setRealizedProfit(e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-9 pr-3 py-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500 outline-none text-lg font-bold text-slate-900 dark:text-white"
                        />
                     </div>
                   </div>
                </div>
             </div>
          )}
        </div>

        {step === 'input' && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
            <button 
              onClick={handleConfirm}
              className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl shadow-lg active:scale-[0.98] transition flex items-center justify-center gap-2"
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