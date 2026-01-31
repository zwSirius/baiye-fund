import React, { useState, useEffect, useCallback } from 'react';
import { Fund, TabView, Transaction, TransactionType, Group, SectorIndex } from './types';
import { getInitialFunds, updateFundEstimates, getSectorIndices, saveFundsToLocal, saveGroupsToLocal, getStoredGroups, exportData, importData } from './services/fundService';
import { analyzeFund } from './services/geminiService';
import { Dashboard } from './components/Dashboard';
import { MarketSentiment } from './components/MarketSentiment';
import { BacktestDashboard } from './components/BacktestDashboard';
import { AIModal } from './components/AIModal';
import { FundDetail } from './components/FundDetail';
import { FundFormModal } from './components/FundFormModal';
import { TransactionModal } from './components/TransactionModal';
import { AIChat } from './components/AIChat';
import { LayoutGrid, PieChart, Settings, Bot, Plus, LineChart, Loader2, Users, X, Check, Moon, Sun, Monitor, Download, Upload, Copy } from 'lucide-react';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabView>(TabView.DASHBOARD);
  
  // Theme State
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

  // Data State
  const [funds, setFunds] = useState<Fund[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [currentGroupId, setCurrentGroupId] = useState<string>('all'); 
  const [sectorIndices, setSectorIndices] = useState<SectorIndex[]>([]);
  
  // Computed State
  const [totalProfit, setTotalProfit] = useState(0);
  const [totalMarketValue, setTotalMarketValue] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  
  // Refresh State
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Modals
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [editingFund, setEditingFund] = useState<Fund | null>(null); 
  const [isManageGroupsOpen, setIsManageGroupsOpen] = useState(false);
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

  // Filter funds based on current group selection
  const visibleFunds = currentGroupId === 'all' 
      ? funds 
      : funds.filter(f => f.groupId === currentGroupId);

  const calculateTotals = useCallback((currentFunds: Fund[]) => {
    let profit = 0;
    let value = 0;
    currentFunds.forEach(f => {
      profit += f.estimatedProfit;
      value += (f.estimatedNav * f.holdingShares);
    });
    setTotalProfit(profit);
    setTotalMarketValue(value);
  }, []);

  // Handle Refresh (Manual)
  const handleRefresh = useCallback(async (currentFunds = funds) => {
    if (currentFunds.length === 0) return;
    
    setIsRefreshing(true);
    try {
        const updated = await updateFundEstimates(currentFunds);
        setFunds(prev => {
             // 这里简单替换，实际生产中可能需要合并状态防止覆盖正在编辑的字段
             return updated;
        });
        setLastUpdate(new Date());
    } catch (e) {
        console.error("Refresh failed", e);
    } finally {
        setIsRefreshing(false);
    }
  }, [funds]);

  // Initialize Data
  useEffect(() => {
    const initialFunds = getInitialFunds();
    const initialGroups = getStoredGroups();
    setFunds(initialFunds);
    setGroups(initialGroups);
    setSectorIndices(getSectorIndices());
    
    // Initial fetch on load
    if (initialFunds.length > 0) {
        handleRefresh(initialFunds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // Persistence: Save data whenever funds or groups change
  useEffect(() => {
    if (funds.length > 0 || groups.length > 0) {
        saveFundsToLocal(funds);
        saveGroupsToLocal(groups);
    }
  }, [funds, groups]);

  // Watch for changes to update totals based on visible funds
  useEffect(() => {
      calculateTotals(visibleFunds);
  }, [visibleFunds, calculateTotals]);

  // Removed setInterval polling to prevent IP Ban. 
  // User must manually click refresh in Dashboard.

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
      let nextFunds;
      if (exists >= 0) {
        nextFunds = [...prev];
        nextFunds[exists] = newFund;
      } else {
        nextFunds = [...prev, newFund];
      }
      return nextFunds;
    });
    
    // Immediately fetch latest data for the new fund
    // Note: We create a temp array because 'setFunds' is async
    setTimeout(() => handleRefresh([newFund]), 100); 
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
                  
                  return {
                      ...f,
                      holdingShares: newShares,
                      holdingCost: newCost,
                      transactions: newTransactions
                  };
              }
              return f;
          });
      });
      setTransactionModal({ isOpen: false, fund: null, type: 'BUY' });
  };

  const openAddModal = () => {
      setEditingFund(null);
      setAddModalOpen(true);
  };

  const openEditModal = (fund: Fund) => {
      setEditingFund(fund);
      setAddModalOpen(true);
  };

  // Dummy Sentiment
  const sentimentScore = 65; 
  const sentimentData = [
    { name: '恐慌', value: 30, color: '#22c55e' }, 
    { name: '中性', value: 40, color: '#fbbf24' }, 
    { name: '贪婪', value: 30, color: '#ef4444' }, 
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-20 max-w-md mx-auto shadow-2xl relative overflow-hidden transition-colors">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 px-6 pt-12 pb-4 sticky top-0 z-10 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center transition-colors">
        <div>
           <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">
             Smart<span className="text-primary">Fund</span>
           </h1>
           <p className="text-xs text-slate-400 font-medium tracking-wide">多账户智能养基</p>
        </div>
        <button 
            onClick={openAddModal}
            className="bg-slate-100 dark:bg-slate-800 p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition text-slate-600 dark:text-slate-300"
        >
           <Plus size={24} />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="pt-2">
        {activeTab === TabView.DASHBOARD && (
            <Dashboard 
                funds={visibleFunds}
                groups={groups}
                currentGroupId={currentGroupId}
                totalProfit={totalProfit}
                totalMarketValue={totalMarketValue}
                lastUpdate={lastUpdate}
                isRefreshing={isRefreshing}
                onRefresh={() => handleRefresh(visibleFunds)}
                onAnalyze={handleAnalyze}
                onFundClick={(fund) => setSelectedFund(fund)}
                onGroupChange={setCurrentGroupId}
                onManageGroups={() => setIsManageGroupsOpen(true)}
            />
        )}

        {activeTab === TabView.MARKET && (
            <div className="space-y-6 mt-6">
                <MarketSentiment data={sentimentData} score={sentimentScore} />
                
                <div className="px-4">
                     <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-3">今日板块追踪</h3>
                     <div className="grid grid-cols-2 gap-3">
                         {sectorIndices.map((sector) => (
                             <div key={sector.name} className="bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                 <div>
                                     <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{sector.name}</div>
                                     <div className="text-[10px] text-slate-400 mt-1">领涨: {sector.leadingStock}</div>
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
                <p className="text-xs text-slate-400 mt-4 text-center">Version 4.1.0 (Manual Refresh Mode)</p>
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
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 pb-safe pt-2 px-6 flex justify-between items-end h-[80px] z-40 max-w-md mx-auto transition-colors">
        <button 
            onClick={() => setActiveTab(TabView.DASHBOARD)}
            className={`flex flex-col items-center w-14 pb-4 transition ${activeTab === TabView.DASHBOARD ? 'text-primary' : 'text-slate-400 dark:text-slate-600'}`}
        >
            <LayoutGrid size={24} strokeWidth={activeTab === TabView.DASHBOARD ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">资产</span>
        </button>
        
        <button 
            onClick={() => setActiveTab(TabView.MARKET)}
            className={`flex flex-col items-center w-14 pb-4 transition ${activeTab === TabView.MARKET ? 'text-primary' : 'text-slate-400 dark:text-slate-600'}`}
        >
            <PieChart size={24} strokeWidth={activeTab === TabView.MARKET ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">市场</span>
        </button>

        <button 
            onClick={() => setActiveTab(TabView.BACKTEST)}
            className={`flex flex-col items-center w-14 pb-4 transition ${activeTab === TabView.BACKTEST ? 'text-primary' : 'text-slate-400 dark:text-slate-600'}`}
        >
            <LineChart size={24} strokeWidth={activeTab === TabView.BACKTEST ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">回测</span>
        </button>

        <button 
            onClick={() => setActiveTab(TabView.AI_INSIGHTS)}
            className={`flex flex-col items-center w-14 pb-4 transition ${activeTab === TabView.AI_INSIGHTS ? 'text-indigo-600' : 'text-slate-400 dark:text-slate-600'}`}
        >
             <div className={`p-1 rounded-lg ${activeTab === TabView.AI_INSIGHTS ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''}`}>
                 <Bot size={24} strokeWidth={activeTab === TabView.AI_INSIGHTS ? 2.5 : 2} />
             </div>
            <span className="text-[10px] font-medium mt-1">AI</span>
        </button>

        <button 
             onClick={() => setActiveTab(TabView.SETTINGS)}
             className={`flex flex-col items-center w-14 pb-4 transition ${activeTab === TabView.SETTINGS ? 'text-primary' : 'text-slate-400 dark:text-slate-600'}`}
        >
            <Settings size={24} strokeWidth={activeTab === TabView.SETTINGS ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">设置</span>
        </button>
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

export default App;