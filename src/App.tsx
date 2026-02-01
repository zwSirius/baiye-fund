import React, { useState, useEffect, useMemo } from 'react';
import { TabView, Transaction, TransactionType } from './types';
import { analyzeFund } from './services/geminiService';
import { exportData, importData } from './services/fundService';
import { calculateFundMetrics } from './utils/finance';
import { useFund } from './contexts/FundContext';

// Components
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

// Icons
import { LayoutGrid, PieChart, Settings, Bot, Plus, Moon, Sun, Monitor, Download, Upload, Clipboard, ClipboardPaste, Users, X, Eye, EyeOff, PenTool } from 'lucide-react';

const NavBtn = ({ icon, label, isActive, onClick }: any) => (
    <button onClick={onClick} className={`flex flex-col items-center w-14 pb-4 transition ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`}>
        {React.cloneElement(icon, { strokeWidth: isActive ? 2.5 : 2 })}
        <span className="text-[10px] font-medium mt-1">{label}</span>
    </button>
);

const App: React.FC = () => {
  const { 
    funds, groups, marketCodes, sectorIndices, isRefreshing, lastUpdate,
    refreshData, addOrUpdateFund, removeFund, addGroup, removeGroup, updateMarketCodes,
    getFundsByGroup, getTotalAssets 
  } = useFund();

  const [activeTab, setActiveTab] = useState<TabView>(TabView.DASHBOARD);
  
  // UI State
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  const [currentGroupId, setCurrentGroupId] = useState<string>('all'); 
  
  // Modal State
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [isWatchlistMode, setIsWatchlistMode] = useState(false);
  const [editingFundId, setEditingFundId] = useState<string | null>(null);
  const [selectedFundId, setSelectedFundId] = useState<string | null>(null);
  
  const [isManageGroupsOpen, setIsManageGroupsOpen] = useState(false);
  const [isMarketConfigOpen, setIsMarketConfigOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  
  // Import State
  const [isImportTextOpen, setIsImportTextOpen] = useState(false);
  const [importTextContent, setImportTextContent] = useState('');

  // Transaction State
  const [txModal, setTxModal] = useState<{ isOpen: boolean, fundId: string | null, type: TransactionType }>({
      isOpen: false, fundId: null, type: 'BUY'
  });
  
  // AI State
  const [isAIModalOpen, setAIModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState("");
  const [currentAnalyzingFund, setCurrentAnalyzingFund] = useState<string>("");

  // Derived Values
  const totals = getTotalAssets();
  const visibleDashboardFunds = getFundsByGroup(currentGroupId);
  const watchlistFunds = funds.filter(f => f.isWatchlist || f.holdingShares === 0);
  
  const editingFund = useMemo(() => funds.find(f => f.id === editingFundId) || null, [funds, editingFundId]);
  const selectedFund = useMemo(() => funds.find(f => f.id === selectedFundId) || null, [funds, selectedFundId]);
  const txFund = useMemo(() => funds.find(f => f.id === txModal.fundId) || null, [funds, txModal.fundId]);

  // --- Effects ---
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

  useEffect(() => {
    const storedPrivacy = localStorage.getItem('smartfund_privacy_mode');
    if (storedPrivacy === 'true') setIsPrivacyMode(true);
  }, []);

  // --- Handlers ---

  const togglePrivacy = () => {
      const newVal = !isPrivacyMode;
      setIsPrivacyMode(newVal);
      localStorage.setItem('smartfund_privacy_mode', String(newVal));
  };

  // AI
  const handleAnalyze = async (fund: any) => {
    setCurrentAnalyzingFund(fund.name);
    setAIModalOpen(true);
    setAiLoading(true);
    setAiReport("");
    const report = await analyzeFund(fund);
    setAiReport(report);
    setAiLoading(false);
  };

  // Fund Operations
  const handleConfirmTransaction = (t: Transaction) => {
      if (!txFund) return;
      
      let newShares = txFund.holdingShares;
      let newCost = txFund.holdingCost;
      const newTransactions = [...(txFund.transactions || []), t];
      let realized = txFund.realizedProfit || 0;

      if (t.type === 'BUY') {
          const oldTotalCost = txFund.holdingShares * txFund.holdingCost;
          const newTotalCost = oldTotalCost + t.amount; 
          newShares = txFund.holdingShares + t.shares;
          newCost = newShares > 0 ? newTotalCost / newShares : 0;
      } else {
          newShares = Math.max(0, txFund.holdingShares - t.shares);
          if (newShares <= 0) newCost = 0;
          const profit = (t.nav - txFund.holdingCost) * t.shares - t.fee;
          realized += profit;
      }
      
      const isWatchlist = newShares === 0;
      
      const newProfit = calculateFundMetrics(newShares, txFund.lastNav, txFund.estimatedNav, txFund.estimatedChangePercent);

      addOrUpdateFund({
          ...txFund,
          holdingShares: newShares,
          holdingCost: newCost,
          estimatedProfit: newProfit,
          realizedProfit: realized,
          transactions: newTransactions,
          isWatchlist: isWatchlist
      });
      setTxModal({ ...txModal, isOpen: false });
  };

  // Import/Export
  const handleDownloadBackup = () => {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smartfund_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleImport = (content: string) => {
      if (importData(content)) {
          alert('数据导入成功，页面将刷新');
          window.location.reload();
      } else {
          alert('数据格式无效');
      }
  };

  const marketAvgChange = sectorIndices.length > 0 
     ? sectorIndices.reduce((acc, s) => acc + s.changePercent, 0) / sectorIndices.length 
     : 0;
  const sentimentScore = Math.min(100, Math.max(0, 50 + marketAvgChange * 20));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-20 max-w-md mx-auto shadow-2xl relative overflow-hidden transition-colors">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 px-4 pt-10 pb-3 sticky top-0 z-10 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center transition-colors">
        <div className="flex items-center gap-2">
            <div>
                <h1 className="text-xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-1">
                    Smart<span className="text-blue-600">Fund</span>
                </h1>
                <p className="text-[10px] text-slate-400 font-medium tracking-wide">AI 驱动的智能养基助手</p>
            </div>
            <button onClick={togglePrivacy} className="text-slate-400 hover:text-slate-600 ml-2">
                {isPrivacyMode ? <EyeOff size={16}/> : <Eye size={16}/>}
            </button>
        </div>
        <button 
            onClick={() => { setEditingFundId(null); setIsWatchlistMode(false); setAddModalOpen(true); }}
            className="bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 shadow-lg shadow-blue-200 dark:shadow-blue-900/30 transition active:scale-95"
        >
           <Plus size={18} />
        </button>
      </header>

      {/* Main */}
      <main className="pt-2">
        {activeTab === TabView.DASHBOARD && (
            <Dashboard 
                funds={visibleDashboardFunds}
                groups={groups}
                currentGroupId={currentGroupId}
                totalProfit={totals.totalProfit}
                totalMarketValue={totals.totalMarketValue}
                lastUpdate={lastUpdate}
                isRefreshing={isRefreshing}
                isPrivacyMode={isPrivacyMode}
                onRefresh={refreshData}
                onAnalyze={handleAnalyze}
                onFundClick={(f) => setSelectedFundId(f.id)}
                onGroupChange={setCurrentGroupId}
                onManageGroups={() => setIsManageGroupsOpen(true)}
            />
        )}
        
        {activeTab === TabView.WATCHLIST && (
            <Watchlist 
                funds={watchlistFunds}
                onAdd={() => { setEditingFundId(null); setIsWatchlistMode(true); setAddModalOpen(true); }}
                onRemove={(f) => removeFund(f.id)}
                onRefresh={refreshData}
                onFundClick={(f) => setSelectedFundId(f.id)}
                isRefreshing={isRefreshing}
            />
        )}

        {activeTab === TabView.MARKET && (
            <div className="space-y-6 mt-6 pb-24">
                <MarketSentiment data={[
                    { name: '恐慌', value: 30, color: '#22c55e' }, 
                    { name: '中性', value: 40, color: '#fbbf24' }, 
                    { name: '贪婪', value: 30, color: '#ef4444' }, 
                ]} score={Math.round(sentimentScore)} />
                
                <div className="px-4">
                     <div className="flex justify-between items-center mb-3">
                         <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                             <span>市场核心指数</span>
                             <span className="text-xs font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">实时数据</span>
                         </h3>
                         <button onClick={() => setIsMarketConfigOpen(true)} className="text-xs text-blue-500 font-bold flex items-center gap-1">
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

        {activeTab === TabView.TOOLS && <ToolsDashboard funds={funds} />}
        {activeTab === TabView.BACKTEST && <BacktestDashboard availableFunds={funds} />}
        {activeTab === TabView.AI_INSIGHTS && <AIChat />}
        
        {activeTab === TabView.SETTINGS && (
            <div className="p-6">
                <h2 className="text-xl font-bold mb-4 dark:text-white">设置</h2>
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 divide-y divide-slate-50 dark:divide-slate-800">
                    <div className="p-4 flex justify-between items-center">
                        <span>外观模式</span>
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                            <button onClick={() => setTheme('light')} className={`p-1.5 rounded-md ${theme === 'light' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}><Sun size={16} /></button>
                            <button onClick={() => setTheme('system')} className={`p-1.5 rounded-md ${theme === 'system' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}><Monitor size={16} /></button>
                            <button onClick={() => setTheme('dark')} className={`p-1.5 rounded-md ${theme === 'dark' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}><Moon size={16} /></button>
                        </div>
                    </div>

                    <div className="p-4">
                        <div className="font-bold mb-2">数据备份与恢复</div>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <button onClick={handleDownloadBackup} className="bg-slate-50 border py-2 rounded-lg text-xs font-bold flex justify-center gap-2"><Download size={14}/> 导出文件</button>
                            <label className="bg-slate-50 border py-2 rounded-lg text-xs font-bold flex justify-center gap-2 cursor-pointer"><Upload size={14}/> 导入文件 <input type="file" accept=".json" onChange={(e) => { const f = e.target.files?.[0]; if(f) { const r = new FileReader(); r.onload = (ev) => handleImport(ev.target?.result as string); r.readAsText(f); } }} className="hidden" /></label>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => { navigator.clipboard.writeText(exportData()); alert("已复制"); }} className="bg-blue-50 text-blue-600 py-2 rounded-lg text-xs font-bold flex justify-center gap-2"><Clipboard size={14}/> 复制数据</button>
                            <button onClick={() => setIsImportTextOpen(true)} className="bg-indigo-50 text-indigo-600 py-2 rounded-lg text-xs font-bold flex justify-center gap-2"><ClipboardPaste size={14}/> 粘贴导入</button>
                        </div>
                    </div>

                    <div className="p-4 flex justify-between items-center">
                        <span className="text-red-500">重置所有数据</span>
                        <button onClick={() => { if(confirm("确定清空？")) { localStorage.clear(); window.location.reload(); } }} className="text-xs border border-red-200 text-red-500 px-3 py-1 rounded-full">清空</button>
                    </div>
                </div>
            </div>
        )}
      </main>

      {/* Nav */}
      <nav className="fixed bottom-0 w-full bg-white/90 backdrop-blur-md dark:bg-slate-900/90 border-t h-[80px] flex justify-between items-end pb-safe pt-2 px-2 z-40 max-w-md">
        <NavBtn icon={<LayoutGrid size={22}/>} label="资产" isActive={activeTab === TabView.DASHBOARD} onClick={() => setActiveTab(TabView.DASHBOARD)} />
        <NavBtn icon={<Eye size={22}/>} label="自选" isActive={activeTab === TabView.WATCHLIST} onClick={() => setActiveTab(TabView.WATCHLIST)} />
        <NavBtn icon={<PieChart size={22}/>} label="市场" isActive={activeTab === TabView.MARKET} onClick={() => setActiveTab(TabView.MARKET)} />
        <NavBtn icon={<PenTool size={22}/>} label="工具" isActive={activeTab === TabView.TOOLS} onClick={() => setActiveTab(TabView.TOOLS)} />
        <button onClick={() => setActiveTab(TabView.AI_INSIGHTS)} className="flex flex-col items-center w-14 pb-4">
             <div className={`p-2 rounded-xl mb-1 ${activeTab === TabView.AI_INSIGHTS ? 'bg-gradient-to-tr from-indigo-500 to-purple-500 text-white -translate-y-2 shadow-lg' : 'text-slate-400'}`}><Bot size={24} /></div>
             <span className={`text-[10px] ${activeTab === TabView.AI_INSIGHTS ? 'text-indigo-600' : 'text-slate-400'}`}>AI</span>
        </button>
        <NavBtn icon={<Settings size={22}/>} label="设置" isActive={activeTab === TabView.SETTINGS} onClick={() => setActiveTab(TabView.SETTINGS)} />
      </nav>

      {/* Import Modal */}
      {isImportTextOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setIsImportTextOpen(false)}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl p-6" onClick={e => e.stopPropagation()}>
                <textarea value={importTextContent} onChange={(e) => setImportTextContent(e.target.value)} placeholder="粘贴 JSON..." className="w-full h-32 p-3 text-xs border rounded-xl mb-4 bg-slate-50 dark:bg-slate-800 dark:text-white" />
                <button onClick={() => handleImport(importTextContent)} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl">导入</button>
            </div>
          </div>
      )}

      {/* Other Modals */}
      <AIModal isOpen={isAIModalOpen} onClose={() => setAIModalOpen(false)} fundName={currentAnalyzingFund} report={aiReport} isLoading={aiLoading} />
      <FundFormModal isOpen={isAddModalOpen} onClose={() => setAddModalOpen(false)} onSave={addOrUpdateFund} initialFund={editingFund} groups={groups} currentGroupId={currentGroupId} isWatchlistMode={isWatchlistMode} />
      <MarketConfigModal isOpen={isMarketConfigOpen} onClose={() => setIsMarketConfigOpen(false)} currentCodes={marketCodes} onSave={updateMarketCodes} />
      
      {txModal.isOpen && txFund && (
          <TransactionModal isOpen={txModal.isOpen} onClose={() => setTxModal({ ...txModal, isOpen: false })} fund={txFund} type={txModal.type} onConfirm={handleConfirmTransaction} />
      )}
      
      {isManageGroupsOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setIsManageGroupsOpen(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-xs p-6" onClick={e => e.stopPropagation()}>
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Users size={20} className="text-blue-600"/> 分组管理</h3>
                <div className="space-y-3 mb-6 max-h-60 overflow-y-auto">
                    {groups.map(g => (
                        <div key={g.id} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-100 dark:border-slate-700">
                            <span className="font-medium dark:text-slate-200">{g.name}</span>
                            {!g.isDefault && <button onClick={() => removeGroup(g.id)} className="text-slate-400 hover:text-red-500"><X size={18}/></button>}
                        </div>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="新分组名..." className="flex-1 border rounded-lg px-3 py-2 text-sm dark:bg-slate-800" />
                    <button onClick={() => { if(newGroupName) { addGroup(newGroupName); setNewGroupName(''); }}} className="bg-blue-600 text-white rounded-lg px-4 py-2 font-bold text-sm">添加</button>
                </div>
            </div>
          </div>
      )}

      {selectedFund && (
          <FundDetail 
             fund={selectedFund} 
             onBack={() => setSelectedFundId(null)}
             onEdit={(f) => { setEditingFundId(f.id); setIsWatchlistMode(false); setAddModalOpen(true); }}
             onDelete={(f) => removeFund(f.id)}
             onBuy={(f) => setTxModal({ isOpen: true, fundId: f.id, type: 'BUY' })}
             onSell={(f) => setTxModal({ isOpen: true, fundId: f.id, type: 'SELL' })}
          />
      )}
    </div>
  );
};

export default App;