import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Fund, TabView, Transaction, TransactionType, Group, SectorIndex } from './types';
import { getInitialFunds, updateFundEstimates, fetchMarketIndices, saveFundsToLocal, saveGroupsToLocal, getStoredGroups, exportData, importData, getStoredMarketCodes, saveMarketCodes } from './services/fundService';
import { analyzeFund } from './services/geminiService';
import { Dashboard } from './components/Dashboard';
import { MarketSentiment } from './components/MarketSentiment';
import { BacktestDashboard } from './components/BacktestDashboard';
import { ToolsDashboard } from './components/ToolsDashboard';
import { AIModal } from './components/AIModal';
import { FundDetail } from './components/FundDetail';
import { FundFormModal } from './components/FundFormModal';
import { TransactionModal } from './components/TransactionModal';
import { AIChat } from './components/AIChat';
import { Watchlist } from './components/Watchlist';
import { MarketConfigModal } from './components/MarketConfigModal';
import { LayoutGrid, PieChart, Settings, Bot, Plus, LineChart, Loader2, Users, X, Check, Moon, Sun, Monitor, Download, Upload, Copy, PenTool, Eye } from 'lucide-react';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabView>(TabView.DASHBOARD);
  
  // Theme State
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

  // Data State
  const [funds, setFunds] = useState<Fund[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [currentGroupId, setCurrentGroupId] = useState<string>('all'); 
  const [sectorIndices, setSectorIndices] = useState<SectorIndex[]>([]);
  const [marketCodes, setMarketCodes] = useState<string[]>([]);
  
  // Computed State
  const [totalProfit, setTotalProfit] = useState(0);
  const [totalMarketValue, setTotalMarketValue] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  
  // Refresh State
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Modals
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [isWatchlistMode, setIsWatchlistMode] = useState(false); // New: Watchlist addition mode
  const [editingFund, setEditingFund] = useState<Fund | null>(null); 
  const [isManageGroupsOpen, setIsManageGroupsOpen] = useState(false);
  const [isMarketConfigOpen, setIsMarketConfigOpen] = useState(false); // New: Market Config
  const [newGroupName, setNewGroupName] = useState('');
  
  // Backup UI State
  const [showExport, setShowExport] = useState(false);
  const [exportString, setExportString] = useState('');
  const [importString, setImportString] = useState('');

  // Transaction Modal State
  const [transactionModal, setTransactionModal] = useState<{ isOpen: boolean, fund: Fund | null, type: TransactionType }>({
      isOpen: false,
      fund: null,
      type: 'BUY'
  });
  
  // Fund Detail State
  const [selectedFund, setSelectedFund] = useState<Fund | null>(null);
  
  // AI Analysis Modal
  const [isAIModalOpen, setAIModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState("");
  const [currentAnalyzingFund, setCurrentAnalyzingFund] = useState<string>("");

  // --- Logic ---

  // Handle Theme Change
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        root.classList.add(systemTheme);
    } else {
        root.classList.add(theme);
    }
  }, [theme]);

  // Memoized Filters
  // Performance: Only recalculate when funds or currentGroupId changes
  const visibleDashboardFunds = useMemo(() => {
      const holdingFunds = funds.filter(f => !f.isWatchlist && f.holdingShares > 0);
      if (currentGroupId === 'all') {
          return holdingFunds;
      }
      return holdingFunds.filter(f => f.groupId === currentGroupId);
  }, [funds, currentGroupId]);

  const watchlistFunds = useMemo(() => {
      return funds.filter(f => f.isWatchlist || f.holdingShares === 0);
  }, [funds]);

  // Calculate Totals using useMemo instead of useEffect to avoid one render cycle
  useEffect(() => {
    let profit = 0;
    let value = 0;
    visibleDashboardFunds.forEach(f => {
      profit += f.estimatedProfit;
      value += (f.estimatedNav * f.holdingShares);
    });
    setTotalProfit(profit);
    setTotalMarketValue(value);
  }, [visibleDashboardFunds]);

  // Handle Refresh (Manual)
  // Optimization: Use functional state update or refs if needed, but here simple async is fine
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
        const updatedIndices = await fetchMarketIndices(marketCodes);
        setSectorIndices(updatedIndices);

        // Fetch fresh data based on current state
        if (funds.length > 0) {
             const updatedFunds = await updateFundEstimates(funds);
             setFunds(updatedFunds);
        }
        setLastUpdate(new Date());
    } catch (e) {
        console.error("Refresh failed", e);
    } finally {
        setIsRefreshing(false);
    }
  }, [funds, marketCodes]); // Dependencies are necessary here

  // Initialize Data
  useEffect(() => {
    const initialFunds = getInitialFunds();
    const initialGroups = getStoredGroups();
    const storedMarketCodes = getStoredMarketCodes();
    
    setFunds(initialFunds);
    setGroups(initialGroups);
    setMarketCodes(storedMarketCodes);
    
    // Initial fetch on load (background)
    if (initialFunds.length > 0) {
        updateFundEstimates(initialFunds).then(setFunds);
    }
    fetchMarketIndices(storedMarketCodes).then(setSectorIndices);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  // Persistence
  useEffect(() => {
    saveFundsToLocal(funds);
    saveGroupsToLocal(groups);
  }, [funds, groups]);

  // AI Analysis
  const handleAnalyze = async (fund: Fund) => {
    setCurrentAnalyzingFund(fund.name);
    setAIModalOpen(true);
    setAiLoading(true);
    setAiReport("");
    const report = await analyzeFund(fund);
    setAiReport(report);
    setAiLoading(false);
  };

  // --- Fund CRUD ---
  const handleSaveFund = async (newFund: Fund) => {
    setFunds(prev => {
      const exists = prev.findIndex(f => f.id === newFund.id);
      if (exists >= 0) {
        const next = [...prev];
        next[exists] = newFund;
        return next;
      }
      return [...prev, newFund];
    });
  };

  const handleDeleteFund = (fundToDelete: Fund) => {
      setFunds(prev => prev.filter(f => f.id !== fundToDelete.id));
      if (selectedFund?.id === fundToDelete.id) {
          setSelectedFund(null);
      }
  };

  // --- Group Management ---
  const handleAddGroup = () => {
      if (!newGroupName.trim()) return;
      const newGroup: Group = {
          id: `group_${Date.now()}`,
          name: newGroupName,
          isDefault: false
      };
      setGroups(prev => [...prev, newGroup]);
      setNewGroupName('');
  };

  const handleDeleteGroup = (groupId: string) => {
      setGroups(prev => prev.filter(g => g.id !== groupId));
      if (currentGroupId === groupId) setCurrentGroupId('all');
      setFunds(prev => prev.filter(f => f.groupId !== groupId));
  };

  // --- Market Config ---
  const handleSaveMarketConfig = (codes: string[]) => {
      setMarketCodes(codes);
      saveMarketCodes(codes);
      fetchMarketIndices(codes).then(setSectorIndices);
  };

  // --- Backup Handlers ---
  const handleGenerateBackup = () => {
      const str = exportData();
      setExportString(str);
      setShowExport(true);
  };

  const handleImportBackup = () => {
      if (!importString) return;
      const success = importData(importString);
      if (success) {
          alert("数据导入成功！页面将刷新。");
          window.location.reload();
      } else {
          alert("数据格式错误，导入失败。");
      }
  };

  // --- Transactions ---
  const openTransactionModal = (fund: Fund, type: TransactionType) => {
      setTransactionModal({ isOpen: true, fund, type });
  };

  const handleConfirmTransaction = (t: Transaction) => {
      if (!transactionModal.fund) return;
      const targetId = transactionModal.fund.id;
      setFunds(prev => {
          return prev.map(f => {
              if (f.id === targetId) {
                  let newShares = f.holdingShares;
                  let newCost = f.holdingCost;
                  const newTransactions = [...(f.transactions || []), t];
                  
                  if (t.type === 'BUY') {
                      const oldTotalCost = f.holdingShares * f.holdingCost;
                      const newTotalCost = oldTotalCost + t.amount; 
                      newShares = f.holdingShares + t.shares;
                      newCost = newShares > 0 ? newTotalCost / newShares : 0;
                  } else {
                      newShares = Math.max(0, f.holdingShares - t.shares);
                      if (newShares <= 0) newCost = 0;
                      const profit = (t.nav - f.holdingCost) * t.shares - t.fee;
                      f.realizedProfit = (f.realizedProfit || 0) + profit;
                  }
                  
                  const isWatchlist = newShares === 0;

                  return {
                      ...f,
                      holdingShares: newShares,
                      holdingCost: newCost,
                      transactions: newTransactions,
                      isWatchlist: isWatchlist
                  };
              }
              return f;
          });
      });
      setTransactionModal({ isOpen: false, fund: null, type: 'BUY' });
  };

  const openAddModal = () => {
      setEditingFund(null);
      setIsWatchlistMode(false);
      setAddModalOpen(true);
  };
  
  const openWatchlistAddModal = () => {
      setEditingFund(null);
      setIsWatchlistMode(true);
      setAddModalOpen(true);
  }

  const openEditModal = (fund: Fund) => {
      setEditingFund(fund);
      setIsWatchlistMode(false);
      setAddModalOpen(true);
  };

  const marketAvgChange = sectorIndices.length > 0 
     ? sectorIndices.reduce((acc, s) => acc + s.changePercent, 0) / sectorIndices.length 
     : 0;
  const sentimentScore = Math.min(100, Math.max(0, 50 + marketAvgChange * 20));
  const sentimentData = [
    { name: '恐慌', value: 30, color: '#22c55e' }, 
    { name: '中性', value: 40, color: '#fbbf24' }, 
    { name: '贪婪', value: 30, color: '#ef4444' }, 
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-20 max-w-md mx-auto shadow-2xl relative overflow-hidden transition-colors">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 px-4 pt-10 pb-3 sticky top-0 z-10 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center transition-colors">
        <div>
           <h1 className="text-xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-1">
             Smart<span className="text-blue-600">Fund</span>
           </h1>
           <p className="text-[10px] text-slate-400 font-medium tracking-wide">AI 驱动的智能养基助手</p>
        </div>
        <button 
            onClick={openAddModal}
            className="bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 shadow-lg shadow-blue-200 dark:shadow-blue-900/30 transition active:scale-95"
        >
           <Plus size={18} />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="pt-2">
        {activeTab === TabView.DASHBOARD && (
            <Dashboard 
                funds={visibleDashboardFunds}
                groups={groups}
                currentGroupId={currentGroupId}
                totalProfit={totalProfit}
                totalMarketValue={totalMarketValue}
                lastUpdate={lastUpdate}
                isRefreshing={isRefreshing}
                onRefresh={handleRefresh}
                onAnalyze={handleAnalyze}
                onFundClick={(fund) => setSelectedFund(fund)}
                onGroupChange={setCurrentGroupId}
                onManageGroups={() => setIsManageGroupsOpen(true)}
            />
        )}
        
        {activeTab === TabView.WATCHLIST && (
            <Watchlist 
                funds={watchlistFunds}
                onAdd={openWatchlistAddModal}
                onRemove={handleDeleteFund}
                onRefresh={handleRefresh}
                onFundClick={(fund) => setSelectedFund(fund)}
                isRefreshing={isRefreshing}
            />
        )}

        {activeTab === TabView.MARKET && (
            <div className="space-y-6 mt-6 pb-24">
                <MarketSentiment data={sentimentData} score={Math.round(sentimentScore)} />
                
                <div className="px-4">
                     <div className="flex justify-between items-center mb-3">
                         <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                             <span>市场核心指数</span>
                             <span className="text-xs font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">实时数据</span>
                         </h3>
                         <button 
                            onClick={() => setIsMarketConfigOpen(true)}
                            className="text-xs text-blue-500 font-bold flex items-center gap-1"
                         >
                            <Settings size={12} /> 自定义
                         </button>
                     </div>
                     <div className="grid grid-cols-2 gap-3">
                         {sectorIndices.map((sector) => (
                             <div key={sector.name} className="bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                 <div>
                                     <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{sector.name}</div>
                                     <div className="text-[10px] text-slate-400 mt-1">热度: {sector.score}</div>
                                 </div>
                                 <div className={`text-base font-bold ${sector.changePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                     {sector.changePercent > 0 ? '+' : ''}{sector.changePercent}%
                                 </div>
                             </div>
                         ))}
                     </div>
                </div>
            </div>
        )}

        {activeTab === TabView.TOOLS && (
           <ToolsDashboard funds={funds} />
        )}

        {activeTab === TabView.BACKTEST && (
           <BacktestDashboard availableFunds={funds} />
        )}

        {activeTab === TabView.AI_INSIGHTS && (
             <AIChat apiKey={process.env.API_KEY} />
        )}
        
        {activeTab === TabView.SETTINGS && (
            <div className="p-6">
                <h2 className="text-xl font-bold mb-4 dark:text-white">设置</h2>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 divide-y divide-slate-50 dark:divide-slate-800">
                    <div className="p-4 flex justify-between items-center">
                        <span>外观模式</span>
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                            <button 
                                onClick={() => setTheme('light')}
                                className={`p-1.5 rounded-md transition ${theme === 'light' ? 'bg-white dark:bg-slate-600 shadow text-blue-600' : 'text-slate-400'}`}
                            >
                                <Sun size={16} />
                            </button>
                            <button 
                                onClick={() => setTheme('system')}
                                className={`p-1.5 rounded-md transition ${theme === 'system' ? 'bg-white dark:bg-slate-600 shadow text-blue-600' : 'text-slate-400'}`}
                            >
                                <Monitor size={16} />
                            </button>
                            <button 
                                onClick={() => setTheme('dark')}
                                className={`p-1.5 rounded-md transition ${theme === 'dark' ? 'bg-white dark:bg-slate-600 shadow text-blue-600' : 'text-slate-400'}`}
                            >
                                <Moon size={16} />
                            </button>
                        </div>
                    </div>
                    
                    {/* Backup Section */}
                    <div className="p-4">
                        <div className="flex justify-between items-center mb-2">
                             <span>数据备份与还原</span>
                             <span className="text-xs text-orange-500 font-bold bg-orange-50 dark:bg-orange-900/20 px-2 py-0.5 rounded">手动同步</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-3">
                            <button 
                                onClick={handleGenerateBackup}
                                className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2"
                            >
                                <Download size={16}/> 导出数据
                            </button>
                            <button 
                                onClick={() => setShowExport(true)}
                                className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2"
                            >
                                <Upload size={16}/> 导入数据
                            </button>
                        </div>
                    </div>

                    <div className="p-4 flex justify-between items-center">
                        <span className="text-red-500">重置所有数据</span>
                        <button 
                            onClick={() => {
                                if(confirm("确定要清空所有本地数据吗？此操作不可恢复。")) {
                                    localStorage.clear();
                                    window.location.reload();
                                }
                            }}
                            className="text-xs border border-red-200 text-red-500 px-3 py-1 rounded-full hover:bg-red-50"
                        >
                            清空
                        </button>
                    </div>
                </div>
                <p className="text-xs text-slate-400 mt-4 text-center">SmartFund Pro v2.3</p>
            </div>
        )}
      </main>

      {/* Backup Modal */}
      {showExport && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowExport(false)}></div>
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl p-6 z-10 shadow-2xl animate-scale-in">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-lg dark:text-white">{exportString ? '导出数据' : '导入数据'}</h3>
                      <button onClick={() => {setShowExport(false); setExportString(''); setImportString('');}}><X size={20} className="text-slate-400"/></button>
                  </div>
                  
                  {exportString ? (
                      <>
                        <p className="text-sm text-slate-500 mb-3">复制下方代码，发送到微信或保存为文本文件。在另一台设备上粘贴即可恢复数据。</p>
                        <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded-lg break-all text-xs font-mono h-32 overflow-y-auto mb-3 select-all dark:text-slate-300">
                            {exportString}
                        </div>
                        <button 
                            onClick={() => {navigator.clipboard.writeText(exportString); alert('已复制到剪贴板');}}
                            className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                        >
                            <Copy size={18} /> 复制备份码
                        </button>
                      </>
                  ) : (
                      <>
                        <p className="text-sm text-slate-500 mb-3">请将之前的备份码粘贴到下方：</p>
                        <textarea
                            value={importString}
                            onChange={e => setImportString(e.target.value)}
                            className="w-full h-32 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                            placeholder='{"funds": [...]}'
                        ></textarea>
                        <button 
                            onClick={handleImportBackup}
                            disabled={!importString}
                            className="w-full py-3 bg-green-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            <Check size={18} /> 确认导入
                        </button>
                      </>
                  )}
              </div>
          </div>
      )}

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 pb-safe pt-2 px-2 flex justify-between items-end h-[80px] z-40 max-w-md mx-auto transition-colors">
        <NavBtn icon={<LayoutGrid size={22}/>} label="资产" isActive={activeTab === TabView.DASHBOARD} onClick={() => setActiveTab(TabView.DASHBOARD)} />
        <NavBtn icon={<Eye size={22}/>} label="自选" isActive={activeTab === TabView.WATCHLIST} onClick={() => setActiveTab(TabView.WATCHLIST)} />
        <NavBtn icon={<PieChart size={22}/>} label="市场" isActive={activeTab === TabView.MARKET} onClick={() => setActiveTab(TabView.MARKET)} />
        <NavBtn icon={<PenTool size={22}/>} label="工具" isActive={activeTab === TabView.TOOLS} onClick={() => setActiveTab(TabView.TOOLS)} />
        
        {/* AI Button Highlighted */}
        <button 
            onClick={() => setActiveTab(TabView.AI_INSIGHTS)}
            className={`flex flex-col items-center w-14 pb-4 transition group`}
        >
             <div className={`p-2 rounded-xl mb-1 transition-all duration-300 ${activeTab === TabView.AI_INSIGHTS ? 'bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-lg -translate-y-2' : 'text-slate-400 dark:text-slate-500'}`}>
                 <Bot size={24} />
             </div>
            <span className={`text-[10px] font-medium ${activeTab === TabView.AI_INSIGHTS ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>AI</span>
        </button>

        <NavBtn icon={<Settings size={22}/>} label="设置" isActive={activeTab === TabView.SETTINGS} onClick={() => setActiveTab(TabView.SETTINGS)} />
      </nav>

      {/* Modals */}
      <AIModal 
        isOpen={isAIModalOpen} 
        onClose={() => setAIModalOpen(false)}
        fundName={currentAnalyzingFund}
        report={aiReport}
        isLoading={aiLoading}
      />

      <FundFormModal 
        isOpen={isAddModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSave={handleSaveFund}
        initialFund={editingFund}
        groups={groups}
        currentGroupId={currentGroupId}
        isWatchlistMode={isWatchlistMode}
      />
      
      <MarketConfigModal 
        isOpen={isMarketConfigOpen}
        onClose={() => setIsMarketConfigOpen(false)}
        currentCodes={marketCodes}
        onSave={handleSaveMarketConfig}
      />

      {transactionModal.isOpen && transactionModal.fund && (
          <TransactionModal
            isOpen={transactionModal.isOpen}
            onClose={() => setTransactionModal({ ...transactionModal, isOpen: false })}
            fund={transactionModal.fund}
            type={transactionModal.type}
            onConfirm={handleConfirmTransaction}
          />
      )}
      
      {/* Group Management Modal */}
      {isManageGroupsOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsManageGroupsOpen(false)}></div>
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-xs shadow-2xl z-10 overflow-hidden animate-scale-in p-6">
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2 dark:text-white">
                    <Users size={20} className="text-blue-600"/> 分组管理
                </h3>
                
                <div className="space-y-3 mb-6">
                    {groups.map(g => (
                        <div key={g.id} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                            <span className="font-medium text-slate-700 dark:text-slate-200">{g.name}</span>
                            {!g.isDefault && (
                                <button onClick={() => handleDeleteGroup(g.id)} className="text-slate-400 hover:text-red-500">
                                    <X size={18}/>
                                </button>
                            )}
                            {g.isDefault && <span className="text-xs text-slate-400 bg-slate-200 dark:bg-slate-600 px-2 py-0.5 rounded">默认</span>}
                        </div>
                    ))}
                </div>

                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        placeholder="新分组名称..."
                        className="flex-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button 
                        onClick={handleAddGroup}
                        disabled={!newGroupName.trim()}
                        className="bg-blue-600 text-white rounded-lg px-4 py-2 font-bold text-sm disabled:opacity-50"
                    >
                        添加
                    </button>
                </div>
                
                <button 
                    onClick={() => setIsManageGroupsOpen(false)}
                    className="w-full mt-4 py-2 text-slate-500 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
                >
                    关闭
                </button>
            </div>
          </div>
      )}

      {/* Fund Detail View */}
      {selectedFund && (
          <FundDetail 
             fund={selectedFund} 
             onBack={() => setSelectedFund(null)}
             onEdit={openEditModal}
             onDelete={handleDeleteFund}
             onBuy={(f) => openTransactionModal(f, 'BUY')}
             onSell={(f) => openTransactionModal(f, 'SELL')}
          />
      )}
    </div>
  );
};

const NavBtn = ({ icon, label, isActive, onClick }: any) => (
    <button 
        onClick={onClick}
        className={`flex flex-col items-center w-14 pb-4 transition ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-600'}`}
    >
        {React.cloneElement(icon, { strokeWidth: isActive ? 2.5 : 2 })}
        <span className="text-[10px] font-medium mt-1">{label}</span>
    </button>
);

export default App;