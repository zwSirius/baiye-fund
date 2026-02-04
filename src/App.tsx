

import React, { useState, useEffect, useMemo } from 'react';
import { TabView, Transaction, TransactionType } from './types';
import { analyzeFund, verifyApiKey } from './services/geminiService';
import { exportData, importData } from './services/fundService';
import { calculateFundMetrics } from './utils/finance';
import { useFund } from './contexts/FundContext';

// Components
import { Dashboard } from './components/Dashboard';
import { AIModal } from './components/AIModal';
import { FundDetail } from './components/FundDetail';
import { FundFormModal } from './components/FundFormModal';
import { TransactionModal } from './components/TransactionModal';
import { AIChat } from './components/AIChat';
import { Watchlist } from './components/Watchlist';
import { MarketConfigModal } from './components/MarketConfigModal';
import { ProfitCalendar } from './components/ProfitCalendar';
import { MarketDashboard } from './components/MarketDashboard';

// Icons
import { LayoutGrid, Settings, Bot, Plus, Moon, Sun, Monitor, Download, Upload, Clipboard, ClipboardPaste, Users, X, Eye, EyeOff, Key, BarChart3, Calendar, Trash2, Check } from 'lucide-react';

const NavBtn = ({ icon, label, isActive, onClick }: any) => (
    <button 
        onClick={onClick} 
        className={`flex flex-col items-center justify-center min-w-[3.5rem] h-full transition-all duration-300 gap-0.5 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 hover:text-slate-600'}`}
    >
        <div className={`transition-transform duration-300 ${isActive ? '-translate-y-1' : 'translate-y-1'}`}>
             {React.cloneElement(icon, { strokeWidth: isActive ? 2.5 : 2, size: 20 })}
        </div>
        <span className={`text-[10px] font-medium transition-all duration-300 ${isActive ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-50'} h-3`}>
            {label}
        </span>
    </button>
);

const App: React.FC = () => {
  const { 
    funds, groups, marketCodes, isRefreshing, lastUpdate,
    refreshData, addOrUpdateFund, removeFund, addGroup, removeGroup, updateMarketCodes,
    getFundsByGroup
  } = useFund();

  const [activeTab, setActiveTab] = useState<TabView>(TabView.DASHBOARD);
  
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [isPrivacyMode, setIsPrivacyMode] = useState(false);
  const [currentGroupId, setCurrentGroupId] = useState<string>('all'); 
  
  const [customApiKey, setCustomApiKey] = useState('');
  const [apiConnectionStatus, setApiConnectionStatus] = useState<'connected' | 'failed' | 'unknown'>('unknown');
  
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

  const visibleDashboardFunds = getFundsByGroup(currentGroupId);
  
  const currentGroupTotals = useMemo(() => {
    let totalProfit = 0;
    let totalMarketValue = 0;
    let totalReturn = 0;
    visibleDashboardFunds.forEach(f => {
         totalProfit += f.estimatedProfit;
         totalMarketValue += (f.estimatedNav * f.holdingShares);
         const costValue = f.holdingCost * f.holdingShares;
         totalReturn += ((f.estimatedNav * f.holdingShares) - costValue + (f.realizedProfit || 0));
    });
    return { totalProfit, totalMarketValue, totalReturn };
  }, [visibleDashboardFunds]);

  const watchlistFunds = funds.filter(f => f.isWatchlist || f.holdingShares === 0);
  
  const editingFund = useMemo(() => funds.find(f => f.id === editingFundId) || null, [funds, editingFundId]);
  const selectedFund = useMemo(() => funds.find(f => f.id === selectedFundId) || null, [funds, selectedFundId]);
  const txFund = useMemo(() => funds.find(f => f.id === txModal.fundId) || null, [funds, txModal.fundId]);

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
    
    const storedKey = localStorage.getItem('smartfund_custom_key');
    if (storedKey) {
        setCustomApiKey(storedKey);
        verifyApiKey(storedKey).then(ok => setApiConnectionStatus(ok ? 'connected' : 'failed'));
    }
  }, []);

  const togglePrivacy = () => {
      const newVal = !isPrivacyMode;
      setIsPrivacyMode(newVal);
      localStorage.setItem('smartfund_privacy_mode', String(newVal));
  };

  const saveCustomApiKey = async () => {
      if (!customApiKey.trim()) return;
      
      const success = await verifyApiKey(customApiKey.trim());
      
      if (success) {
          localStorage.setItem('smartfund_custom_key', customApiKey.trim());
          setApiConnectionStatus('connected');
          window.dispatchEvent(new Event('storage'));
          alert('API Key 已验证并保存');
      } else {
          setApiConnectionStatus('failed');
          alert('API Key 验证失败，请检查是否正确或网络连接');
      }
  };

  const clearApiKey = () => {
      setCustomApiKey('');
      localStorage.removeItem('smartfund_custom_key');
      setApiConnectionStatus('unknown');
      window.dispatchEvent(new Event('storage'));
  };

  const handleAnalyze = async (fund: any) => {
    setCurrentAnalyzingFund(fund.name);
    setAIModalOpen(true);
    setAiLoading(true);
    setAiReport("");
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans max-w-md mx-auto shadow-2xl relative overflow-hidden transition-colors pb-24">
      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-5 pb-3 sticky top-0 z-20 flex justify-between items-center transition-colors border-b border-transparent dark:border-slate-800 pt-safe-header">
        <div className="flex items-center gap-2">
            <div>
                <h1 className="text-xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-1">
                    Smart<span className="text-blue-600">Fund</span>
                </h1>
                <p className="text-[10px] text-slate-400 font-bold tracking-wide uppercase">AI Wealth Assistant</p>
            </div>
        </div>
        {activeTab === TabView.DASHBOARD && (
            <div className="flex gap-2">
                <button onClick={togglePrivacy} className="text-slate-400 hover:text-slate-600 p-2 bg-slate-100 dark:bg-slate-800 rounded-full">
                    {isPrivacyMode ? <EyeOff size={18}/> : <Eye size={18}/>}
                </button>
            </div>
        )}
      </header>

      {/* Main */}
      <main className="pt-2">
        {activeTab === TabView.DASHBOARD && (
            <Dashboard 
                funds={visibleDashboardFunds}
                groups={groups}
                currentGroupId={currentGroupId}
                totalProfit={currentGroupTotals.totalProfit}
                totalMarketValue={currentGroupTotals.totalMarketValue}
                lastUpdate={lastUpdate}
                isRefreshing={isRefreshing}
                isPrivacyMode={isPrivacyMode}
                onRefresh={refreshData}
                onAnalyze={handleAnalyze}
                onFundClick={(f) => setSelectedFundId(f.id)}
                onGroupChange={setCurrentGroupId}
                onManageGroups={() => setIsManageGroupsOpen(true)}
                onAdd={() => { setEditingFundId(null); setIsWatchlistMode(false); setAddModalOpen(true); }}
            />
        )}
        
        {activeTab === TabView.CALENDAR && (
            <ProfitCalendar funds={funds} />
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
            <MarketDashboard marketCodes={marketCodes} onConfigMarket={() => setIsMarketConfigOpen(true)} />
        )}
        
        {activeTab === TabView.AI_INSIGHTS && (
            <AIChat onGoToSettings={goToSettings} connectionStatus={apiConnectionStatus} />
        )}
        
        {activeTab === TabView.SETTINGS && (
            <div className="p-6 pb-24 animate-fade-in">
                <h2 className="text-xl font-bold mb-6 dark:text-white">设置</h2>
                <div className="space-y-6">
                    
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-5 flex justify-between items-center">
                        <span className="font-bold text-sm">外观模式</span>
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                            <button onClick={() => setTheme('light')} className={`p-2 rounded-md transition ${theme === 'light' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}><Sun size={18} /></button>
                            <button onClick={() => setTheme('system')} className={`p-2 rounded-md transition ${theme === 'system' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}><Monitor size={18} /></button>
                            <button onClick={() => setTheme('dark')} className={`p-2 rounded-md transition ${theme === 'dark' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}><Moon size={18} /></button>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-5">
                        <div className="flex items-center gap-2 font-bold mb-3 text-slate-800 dark:text-white">
                            <Key size={18} className="text-indigo-500" /> API Key 配置
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed bg-slate-50 dark:bg-slate-800 p-3 rounded-lg">
                            配置 Google Gemini API Key 以解锁智能分析功能。Key 仅保存在本地。
                        </div>
                        <div className="flex gap-2">
                            <input 
                                type="password" 
                                value={customApiKey}
                                onChange={(e) => setCustomApiKey(e.target.value)}
                                placeholder="sk-..."
                                className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            {customApiKey && (
                                <button onClick={clearApiKey} className="p-2.5 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 active:scale-95 transition">
                                    <Trash2 size={18}/>
                                </button>
                            )}
                            <button 
                                onClick={saveCustomApiKey}
                                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold active:scale-95 transition whitespace-nowrap"
                            >
                                保存并测试
                            </button>
                        </div>
                        {apiConnectionStatus === 'connected' && (
                            <div className="mt-2 text-xs text-green-500 flex items-center gap-1 font-bold">
                                <Check size={12}/> 连接成功
                            </div>
                        )}
                        {apiConnectionStatus === 'failed' && (
                            <div className="mt-2 text-xs text-red-500 flex items-center gap-1 font-bold">
                                <X size={12}/> 连接失败，请检查Key
                            </div>
                        )}
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 p-5">
                        <div className="font-bold mb-4">数据管理</div>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <button onClick={handleDownloadBackup} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-700 transition"><Download size={16}/> 导出备份</button>
                            <label className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition"><Upload size={16}/> 恢复备份 <input type="file" accept=".json" onChange={(e) => { const f = e.target.files?.[0]; if(f) { const r = new FileReader(); r.onload = (ev) => handleImport(ev.target?.result as string); r.readAsText(f); } }} className="hidden" /></label>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => { navigator.clipboard.writeText(exportData()); alert("已复制"); }} className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2"><Clipboard size={16}/> 复制数据</button>
                            <button onClick={() => setIsImportTextOpen(true)} className="bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2"><ClipboardPaste size={16}/> 粘贴导入</button>
                        </div>
                    </div>

                    <div className="bg-red-50 dark:bg-red-900/10 rounded-2xl p-5 flex justify-between items-center">
                        <span className="text-red-500 font-bold text-sm">重置所有数据</span>
                        <button onClick={() => { if(confirm("确定清空所有本地数据？此操作无法撤销。")) { localStorage.clear(); window.location.reload(); } }} className="text-xs bg-white dark:bg-red-900/30 text-red-500 border border-red-200 dark:border-red-800 px-4 py-2 rounded-full font-bold">清空</button>
                    </div>
                </div>
            </div>
        )}
      </main>

      {/* Nav - Scrollable for 6 items - Enhanced blur */}
      <nav className="fixed bottom-6 left-1/2 transform -translate-x-1/2 w-[90%] max-w-[380px] bg-white/70 backdrop-blur-2xl dark:bg-slate-800/70 border border-white/20 dark:border-slate-700 rounded-full h-[64px] flex items-center px-1 z-40 shadow-2xl shadow-slate-200/50 dark:shadow-black/50 overflow-x-auto no-scrollbar">
        <div className="flex w-full justify-between px-2">
            <NavBtn icon={<LayoutGrid />} label="资产" isActive={activeTab === TabView.DASHBOARD} onClick={() => setActiveTab(TabView.DASHBOARD)} />
            <NavBtn icon={<Eye />} label="自选" isActive={activeTab === TabView.WATCHLIST} onClick={() => setActiveTab(TabView.WATCHLIST)} />
            <NavBtn icon={<Calendar />} label="日历" isActive={activeTab === TabView.CALENDAR} onClick={() => setActiveTab(TabView.CALENDAR)} />
            <NavBtn icon={<BarChart3 />} label="市场" isActive={activeTab === TabView.MARKET} onClick={() => setActiveTab(TabView.MARKET)} />
            <NavBtn icon={<Bot />} label="AI" isActive={activeTab === TabView.AI_INSIGHTS} onClick={() => setActiveTab(TabView.AI_INSIGHTS)} />
            <NavBtn icon={<Settings />} label="设置" isActive={activeTab === TabView.SETTINGS} onClick={() => setActiveTab(TabView.SETTINGS)} />
        </div>
      </nav>

      {/* Import Modal */}
      {isImportTextOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setIsImportTextOpen(false)}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
                <h3 className="font-bold mb-4">粘贴数据 JSON</h3>
                <textarea value={importTextContent} onChange={(e) => setImportTextContent(e.target.value)} placeholder="在此粘贴..." className="w-full h-32 p-3 text-xs border rounded-xl mb-4 bg-slate-50 dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                <button onClick={() => handleImport(importTextContent)} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl">导入</button>
            </div>
          </div>
      )}

      {/* Other Modals */}
      <AIModal isOpen={isAIModalOpen} onClose={() => setAIModalOpen(false)} fundName={currentAnalyzingFund} report={aiReport} isLoading={aiLoading} onGoToSettings={goToSettings} />
      <FundFormModal isOpen={isAddModalOpen} onClose={() => setAddModalOpen(false)} onSave={addOrUpdateFund} initialFund={editingFund} groups={groups} currentGroupId={currentGroupId} isWatchlistMode={isWatchlistMode} />
      <MarketConfigModal isOpen={isMarketConfigOpen} onClose={() => setIsMarketConfigOpen(false)} currentCodes={marketCodes} onSave={updateMarketCodes} />
      
      {txModal.isOpen && txFund && (
          <TransactionModal isOpen={txModal.isOpen} onClose={() => setTxModal({ ...txModal, isOpen: false })} fund={txFund} type={txModal.type} onConfirm={handleConfirmTransaction} />
      )}
      
      {isManageGroupsOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setIsManageGroupsOpen(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-xs p-6 shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Users size={20} className="text-blue-600"/> 分组管理</h3>
                <div className="space-y-3 mb-6 max-h-60 overflow-y-auto">
                    {groups.map(g => (
                        <div key={g.id} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                            <span className="font-medium text-sm dark:text-slate-200">{g.name}</span>
                            {!g.isDefault && <button onClick={() => removeGroup(g.id)} className="text-slate-400 hover:text-red-500 p-1"><X size={16}/></button>}
                        </div>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="新分组名..." className="flex-1 border rounded-xl px-3 py-2 text-sm dark:bg-slate-800 focus:outline-none focus:border-blue-500" />
                    <button onClick={() => { if(newGroupName) { addGroup(newGroupName); setNewGroupName(''); }}} className="bg-blue-600 text-white rounded-xl px-4 py-2 font-bold text-sm">添加</button>
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
             isPrivacyMode={isPrivacyMode}
             onTogglePrivacy={togglePrivacy}
          />
      )}
    </div>
  );
};
export default App;
