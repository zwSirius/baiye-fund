
import React, { useState, useEffect, useMemo } from 'react';
import { TabView, Transaction, TransactionType, Fund } from './types';
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
import { LayoutGrid, PieChart, Settings, Bot, Plus, Moon, Sun, Monitor, Download, Upload, Clipboard, ClipboardPaste, Users, X, Eye, EyeOff, PenTool, Key } from 'lucide-react';

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
    getFundsByGroup 
  } = useFund();

  const [activeTab, setActiveTab] = useState<TabView>(TabView.DASHBOARD);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  const [currentGroupId, setCurrentGroupId] = useState<string>('all'); 
  const [customApiKey, setCustomApiKey] = useState('');
  
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [isWatchlistMode, setIsWatchlistMode] = useState(false);
  const [editingFundId, setEditingFundId] = useState<string | null>(null);
  const [selectedFundId, setSelectedFundId] = useState<string | null>(null);
  const [isManageGroupsOpen, setIsManageGroupsOpen] = useState(false);
  const [isMarketConfigOpen, setIsMarketConfigOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  
  const [isImportTextOpen, setIsImportTextOpen] = useState(false);
  const [importTextContent, setImportTextContent] = useState('');

  const [txModal, setTxModal] = useState<{ isOpen: boolean, fundId: string | null, type: TransactionType }>({
      isOpen: false, fundId: null, type: 'BUY'
  });
  
  const [isAIModalOpen, setAIModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState("");
  const [currentAnalyzingFund, setCurrentAnalyzingFund] = useState<string>("");

  // Fix: Explicitly calculate totals based on current group
  const totals = useMemo(() => {
      const targetFunds = currentGroupId === 'all' 
          ? funds.filter(f => !f.isWatchlist && f.holdingShares > 0)
          : funds.filter(f => !f.isWatchlist && f.holdingShares > 0 && f.groupId === currentGroupId);
      
      let totalProfit = 0;
      let totalMarketValue = 0;
      let totalReturn = 0;

      targetFunds.forEach(f => {
          totalProfit += f.estimatedProfit;
          totalMarketValue += (f.estimatedNav * f.holdingShares);
          const costValue = f.holdingCost * f.holdingShares;
          const unrealized = (f.estimatedNav * f.holdingShares) - costValue;
          totalReturn += (unrealized + (f.realizedProfit || 0));
      });

      return { totalProfit, totalMarketValue, totalReturn };
  }, [funds, currentGroupId]);

  const visibleDashboardFunds = getFundsByGroup(currentGroupId);
  const watchlistFunds = funds.filter(f => f.isWatchlist || f.holdingShares === 0);
  
  const editingFund = useMemo(() => funds.find(f => f.id === editingFundId) || null, [funds, editingFundId]);
  const selectedFund = useMemo(() => funds.find(f => f.id === selectedFundId) || null, [funds, selectedFundId]);
  const txFund = useMemo(() => funds.find(f => f.id === txModal.fundId) || null, [funds, txModal.fundId]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.classList.add(theme === 'system' ? systemTheme : theme);
  }, [theme]);

  useEffect(() => {
    const storedPrivacy = localStorage.getItem('smartfund_privacy_mode');
    if (storedPrivacy === 'true') setIsPrivacyMode(true);
    const storedKey = localStorage.getItem('smartfund_custom_key');
    if (storedKey) setCustomApiKey(storedKey);
  }, []);

  const togglePrivacy = () => {
      const newVal = !isPrivacyMode;
      setIsPrivacyMode(newVal);
      localStorage.setItem('smartfund_privacy_mode', String(newVal));
  };

  const saveCustomApiKey = () => {
      localStorage.setItem('smartfund_custom_key', customApiKey.trim());
      window.dispatchEvent(new Event('storage'));
      alert('API Key 已保存');
  };

  const handleAnalyze = async (fund: any) => {
    setCurrentAnalyzingFund(fund.name);
    setAIModalOpen(true);
    setAiLoading(true);
    const report = await analyzeFund(fund);
    setAiReport(report);
    setAiLoading(false);
  };

  const goToSettings = () => {
      setActiveTab(TabView.SETTINGS);
      setAIModalOpen(false);
  };

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
          realized += (t.nav - txFund.holdingCost) * t.shares - t.fee;
      }
      const isWatchlist = newShares === 0;
      const newProfit = calculateFundMetrics(newShares, txFund.lastNav, txFund.estimatedNav, txFund.estimatedChangePercent);
      addOrUpdateFund({ ...txFund, holdingShares: newShares, holdingCost: newCost, estimatedProfit: newProfit, realizedProfit: realized, transactions: newTransactions, isWatchlist: isWatchlist });
      setTxModal({ ...txModal, isOpen: false });
  };

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

  const marketAvgChange = sectorIndices.length > 0 ? sectorIndices.reduce((acc, s) => acc + s.changePercent, 0) / sectorIndices.length : 0;
  const sentimentScore = Math.min(100, Math.max(0, 50 + marketAvgChange * 20));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-24 max-w-md mx-auto shadow-2xl relative transition-colors">
      <header className="bg-white/80 backdrop-blur-md dark:bg-slate-900/80 px-4 pt-safe sticky top-0 z-40 border-b border-slate-100 dark:border-slate-800 transition-colors">
        <div className="py-3 flex justify-between items-center">
            <div className="flex items-center gap-2">
                <div>
                    <h1 className="text-xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-1">Smart<span className="text-blue-600">Fund</span></h1>
                    <p className="text-[10px] text-slate-400 font-medium tracking-wide uppercase">AI Wealth Assistant</p>
                </div>
                <button onClick={togglePrivacy} className="text-slate-400 hover:text-slate-600 ml-2 p-1 active:scale-90">
                    {isPrivacyMode ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
            </div>
            <button onClick={() => { setEditingFundId(null); setIsWatchlistMode(false); setAddModalOpen(true); }} className="bg-blue-600 text-white p-2 rounded-full shadow-lg active:scale-95"><Plus size={18} /></button>
        </div>
      </header>

      <main>
        {activeTab === TabView.DASHBOARD && (
            <Dashboard funds={visibleDashboardFunds} groups={groups} currentGroupId={currentGroupId} totalProfit={totals.totalProfit} totalMarketValue={totals.totalMarketValue} lastUpdate={lastUpdate} isRefreshing={isRefreshing} isPrivacyMode={isPrivacyMode} onRefresh={refreshData} onAnalyze={handleAnalyze} onFundClick={(f) => setSelectedFundId(f.id)} onGroupChange={setCurrentGroupId} onManageGroups={() => setIsManageGroupsOpen(true)} />
        )}
        
        {activeTab === TabView.WATCHLIST && (
            <Watchlist funds={watchlistFunds} onAdd={() => { setEditingFundId(null); setIsWatchlistMode(true); setAddModalOpen(true); }} onRemove={(f) => removeFund(f.id)} onRefresh={refreshData} onFundClick={(f) => setSelectedFundId(f.id)} isRefreshing={isRefreshing} />
        )}

        {activeTab === TabView.MARKET && (
            <div className="space-y-6 mt-4 pb-12 px-4">
                <MarketSentiment data={[{ name: '恐慌', value: 30, color: '#22c55e' }, { name: '中性', value: 40, color: '#fbbf24' }, { name: '贪婪', value: 30, color: '#ef4444' }]} score={Math.round(sentimentScore)} />
                <div>
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-bold text-slate-800 dark:text-slate-100">核心指数</h3>
                        <button onClick={() => setIsMarketConfigOpen(true)} className="text-xs text-blue-500 font-bold">自定义</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        {sectorIndices.map((sector) => (
                            <div key={sector.name} className="bg-white dark:bg-slate-900 p-3 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                <div>
                                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{sector.name}</div>
                                    <div className="text-[13px] font-mono text-slate-400 mt-0.5">{sector.value || '--'}</div>
                                </div>
                                <div className={`text-base font-black ${sector.changePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>{sector.changePercent > 0 ? '+' : ''}{sector.changePercent}%</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {activeTab === TabView.TOOLS && <ToolsDashboard funds={funds} />}
        {activeTab === TabView.BACKTEST && <BacktestDashboard availableFunds={funds} />}
        {activeTab === TabView.AI_INSIGHTS && <AIChat onGoToSettings={goToSettings} />}
        {activeTab === TabView.SETTINGS && (
            <div className="p-6 space-y-4 animate-fade-in">
                <h2 className="text-xl font-bold mb-4">设置</h2>
                
                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 flex justify-between items-center shadow-sm">
                    <span className="font-medium text-sm">外观模式</span>
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                        <button onClick={() => setTheme('light')} className={`p-1.5 rounded-md ${theme === 'light' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}><Sun size={16} /></button>
                        <button onClick={() => setTheme('system')} className={`p-1.5 rounded-md ${theme === 'system' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}><Monitor size={16} /></button>
                        <button onClick={() => setTheme('dark')} className={`p-1.5 rounded-md ${theme === 'dark' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}><Moon size={16} /></button>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm">
                    <div className="font-bold mb-3 flex items-center gap-2 text-sm"><Key size={16}/> Gemini API Key</div>
                    <input type="password" value={customApiKey} onChange={(e) => setCustomApiKey(e.target.value)} placeholder="粘贴您的 Google API Key..." className="w-full bg-slate-50 dark:bg-slate-800 border dark:border-slate-700 rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-blue-500" />
                    <button onClick={saveCustomApiKey} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-bold active:scale-95 transition">保存配置</button>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm">
                    <div className="font-bold mb-3 text-sm flex items-center gap-2"><Upload size={16}/> 数据备份</div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <button onClick={handleDownloadBackup} className="bg-slate-50 dark:bg-slate-800 border dark:border-slate-700 py-2 rounded-lg text-xs font-bold flex justify-center gap-2"><Download size={14}/> 导出文件</button>
                        <label className="bg-slate-50 dark:bg-slate-800 border dark:border-slate-700 py-2 rounded-lg text-xs font-bold flex justify-center gap-2 cursor-pointer"><Upload size={14}/> 导入文件 <input type="file" accept=".json" onChange={(e) => { const f = e.target.files?.[0]; if(f) { const r = new FileReader(); r.onload = (ev) => handleImport(ev.target?.result as string); r.readAsText(f); } }} className="hidden" /></label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                         <button onClick={() => { navigator.clipboard.writeText(exportData()); alert("已复制"); }} className="bg-slate-50 dark:bg-slate-800 border dark:border-slate-700 py-2 rounded-lg text-xs font-bold flex justify-center gap-2"><Clipboard size={14}/> 复制文本</button>
                         <button onClick={() => setIsImportTextOpen(true)} className="bg-slate-50 dark:bg-slate-800 border dark:border-slate-700 py-2 rounded-lg text-xs font-bold flex justify-center gap-2"><ClipboardPaste size={14}/> 粘贴文本</button>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 flex justify-between items-center border border-red-50 dark:border-red-900/30">
                    <span className="text-red-500 font-medium text-sm">重置所有数据</span>
                    <button onClick={() => { if(confirm("确定清空？")) { localStorage.clear(); window.location.reload(); } }} className="text-xs border border-red-200 text-red-500 px-3 py-1 rounded-full">清空</button>
                </div>
            </div>
        )}
      </main>

      <nav className="fixed bottom-0 w-full bg-white/95 backdrop-blur-lg dark:bg-slate-900/95 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center pb-safe z-40 max-w-md">
        <NavBtn icon={<LayoutGrid size={22}/>} label="资产" isActive={activeTab === TabView.DASHBOARD} onClick={() => setActiveTab(TabView.DASHBOARD)} />
        <NavBtn icon={<Eye size={22}/>} label="自选" isActive={activeTab === TabView.WATCHLIST} onClick={() => setActiveTab(TabView.WATCHLIST)} />
        <NavBtn icon={<PieChart size={22}/>} label="市场" isActive={activeTab === TabView.MARKET} onClick={() => setActiveTab(TabView.MARKET)} />
        <NavBtn icon={<PenTool size={22}/>} label="工具" isActive={activeTab === TabView.TOOLS} onClick={() => setActiveTab(TabView.TOOLS)} />
        <button onClick={() => setActiveTab(TabView.AI_INSIGHTS)} className="flex flex-col items-center w-14 pb-4 active:scale-95 transition">
             <div className={`p-1.5 rounded-xl mb-0.5 ${activeTab === TabView.AI_INSIGHTS ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400'}`}><Bot size={20} /></div>
             <span className={`text-[10px] font-medium ${activeTab === TabView.AI_INSIGHTS ? 'text-indigo-600' : 'text-slate-400'}`}>AI</span>
        </button>
        <NavBtn icon={<Settings size={22}/>} label="设置" isActive={activeTab === TabView.SETTINGS} onClick={() => setActiveTab(TabView.SETTINGS)} />
      </nav>

      {isImportTextOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setIsImportTextOpen(false)}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl p-6" onClick={e => e.stopPropagation()}>
                <textarea value={importTextContent} onChange={(e) => setImportTextContent(e.target.value)} placeholder="粘贴 JSON..." className="w-full h-32 p-3 text-xs border rounded-xl mb-4 bg-slate-50 dark:bg-slate-800 dark:text-white" />
                <button onClick={() => handleImport(importTextContent)} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl">导入</button>
            </div>
          </div>
      )}

      <AIModal isOpen={isAIModalOpen} onClose={() => setAIModalOpen(false)} fundName={currentAnalyzingFund} report={aiReport} isLoading={aiLoading} onGoToSettings={goToSettings} />
      <FundFormModal isOpen={isAddModalOpen} onClose={() => setAddModalOpen(false)} onSave={addOrUpdateFund} initialFund={editingFund} groups={groups} currentGroupId={currentGroupId} isWatchlistMode={isWatchlistMode} />
      <MarketConfigModal isOpen={isMarketConfigOpen} onClose={() => setIsMarketConfigOpen(false)} currentCodes={marketCodes} onSave={updateMarketCodes} />
      
      {txModal.isOpen && txFund && <TransactionModal isOpen={txModal.isOpen} onClose={() => setTxModal({ ...txModal, isOpen: false })} fund={txFund} type={txModal.type} onConfirm={handleConfirmTransaction} />}
      
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

      {selectedFund && <FundDetail fund={selectedFund} onBack={() => setSelectedFundId(null)} onEdit={(f) => { setEditingFundId(f.id); setIsWatchlistMode(false); setAddModalOpen(true); }} onDelete={(f) => removeFund(f.id)} onBuy={(f) => setTxModal({ isOpen: true, fundId: f.id, type: 'BUY' })} onSell={(f) => setTxModal({ isOpen: true, fundId: f.id, type: 'SELL' })} />}
    </div>
  );
};
export default App;
