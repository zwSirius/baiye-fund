import React, { useState } from 'react';
import { Fund, BacktestResult } from '../types';
import { runBacktest, searchFunds } from '../services/fundService';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Play, TrendingUp, AlertTriangle, Wallet, X, Plus, Search, Loader2 } from 'lucide-react';

interface BacktestDashboardProps {
  availableFunds: Fund[];
}

interface PortfolioItem {
    code: string;
    name: string;
    amount: number;
}

export const BacktestDashboard: React.FC<BacktestDashboardProps> = ({ availableFunds }) => {
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [duration, setDuration] = useState<number>(1); // 1, 3, 5 years
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Search State
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Fund[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  const handleSearch = async (val: string) => {
      setSearchQuery(val);
      if (val.length > 1) {
          setIsSearching(true);
          const res = await searchFunds(val);
          setSearchResults(res);
          setIsSearching(false);
      } else {
          setSearchResults([]);
      }
  };

  const handleAddFund = (code: string, name: string) => {
      if (portfolio.some(p => p.code === code)) {
          setShowSearch(false);
          setSearchQuery('');
          return;
      }
      setPortfolio(prev => [...prev, { code, name, amount: 10000 }]);
      setShowSearch(false);
      setSearchQuery('');
      setSearchResults([]);
  };

  const handleRemoveFund = (code: string) => {
      setPortfolio(prev => prev.filter(p => p.code !== code));
  };

  const handleAmountChange = (code: string, val: string) => {
      const num = parseFloat(val) || 0;
      setPortfolio(prev => prev.map(p => p.code === code ? { ...p, amount: num } : p));
  };

  const handleRun = async () => {
    if (portfolio.length === 0) return;
    setIsRunning(true);
    try {
        const res = await runBacktest(portfolio.map(p => ({ code: p.code, amount: p.amount })), duration);
        setResult(res);
    } catch (e) {
        console.error("Backtest failed", e);
        alert("回测失败，请检查网络或稍后再试");
    } finally {
        setIsRunning(false);
    }
  };

  const formatMoney = (val: number) => {
    return val.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };
  
  const totalInvest = portfolio.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="pb-24 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 p-6 shadow-sm border-b border-slate-100 dark:border-slate-800 mb-4 sticky top-[72px] z-20">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">组合构建与回测</h2>
        
        {/* 配置区域 */}
        <div className="space-y-4">
          
          <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 p-3 rounded-lg">
              <span className="text-xs text-slate-500 dark:text-slate-400">组合总投入</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">¥{formatMoney(totalInvest)}</span>
          </div>

          {/* 回测年限 */}
          <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-2">回测时间范围</label>
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                {[1, 3, 5].map(yr => (
                  <button
                    key={yr}
                    onClick={() => setDuration(yr)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${duration === yr ? 'bg-white dark:bg-slate-600 shadow text-primary dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    近{yr}年
                  </button>
                ))}
              </div>
          </div>

          {/* 基金配置列表 */}
          <div>
            <div className="flex justify-between items-center mb-2">
                <label className="block text-xs text-slate-500 dark:text-slate-400">配置成分基金 (金额)</label>
                <button 
                    onClick={() => setShowSearch(!showSearch)} 
                    className="text-xs text-blue-500 font-bold flex items-center gap-1"
                >
                    <Plus size={12}/> 添加基金
                </button>
            </div>

            {/* Search Box */}
            {showSearch && (
                <div className="mb-3 animate-slide-up relative">
                     <div className="relative">
                        <Search size={16} className="absolute left-3 top-2.5 text-slate-400"/>
                        <input 
                            type="text"
                            autoFocus
                            placeholder="输入代码或名称搜索..."
                            value={searchQuery}
                            onChange={e => handleSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {isSearching && <Loader2 size={16} className="absolute right-3 top-2.5 animate-spin text-blue-500"/>}
                     </div>
                     {searchResults.length > 0 && (
                         <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-xl rounded-lg z-30 max-h-48 overflow-y-auto">
                             {searchResults.map(f => (
                                 <div 
                                    key={f.code}
                                    onClick={() => handleAddFund(f.code, f.name)}
                                    className="p-3 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-50 dark:border-slate-700 last:border-0"
                                 >
                                     <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{f.name}</div>
                                     <div className="text-xs text-slate-400">{f.code}</div>
                                 </div>
                             ))}
                         </div>
                     )}
                </div>
            )}

            <div className="space-y-2 mb-3">
                {portfolio.map(p => (
                    <div key={p.code} className="flex items-center gap-2 animate-slide-up">
                        <div className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 flex justify-between items-center">
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate w-24">{p.name}</span>
                                <span className="text-[10px] text-slate-400">{p.code}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="text-xs text-slate-400">¥</span>
                                <input 
                                    type="number" 
                                    value={p.amount}
                                    onChange={e => handleAmountChange(p.code, e.target.value)}
                                    className="w-20 text-right text-sm font-bold bg-transparent text-slate-800 dark:text-slate-200 focus:outline-none focus:text-blue-600"
                                />
                            </div>
                        </div>
                        <button onClick={() => handleRemoveFund(p.code)} className="p-2 text-slate-400 hover:text-red-500">
                            <X size={16} />
                        </button>
                    </div>
                ))}
            </div>
            
            {/* 快速添加持仓中基金 */}
            {portfolio.length === 0 && availableFunds.length > 0 && (
                 <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-xs text-slate-400 w-full mb-1">快速添加持仓:</span>
                    {availableFunds.slice(0, 4).map(fund => (
                        <button
                        key={fund.id}
                        onClick={() => handleAddFund(fund.code, fund.name)}
                        className="px-3 py-1.5 rounded-full text-xs border bg-white dark:bg-slate-800 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-500 transition flex items-center gap-1"
                        >
                        <Plus size={12} /> {fund.name.substring(0, 4)}...
                        </button>
                    ))}
                </div>
            )}
          </div>

          <button
            onClick={handleRun}
            disabled={portfolio.length === 0 || isRunning}
            className={`w-full py-3 rounded-xl font-bold text-white flex items-center justify-center gap-2 transition shadow-lg ${
              portfolio.length === 0 || isRunning ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 active:scale-95'
            }`}
          >
            {isRunning ? <Loader2 size={18} className="animate-spin"/> : <Play size={18} fill="currentColor" />}
            {isRunning ? '正在回测历史数据...' : '开始回测'}
          </button>
        </div>
      </div>

      {/* 结果展示 */}
      {result && (
        <div className="space-y-6 px-4 animate-fade-in">
            
            {/* 核心指标卡片 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 text-center">
                <div className="text-[10px] text-slate-400 mb-1 flex justify-center items-center gap-1">
                   总收益率 <TrendingUp size={10} />
                </div>
                <div className={`text-base font-bold ${result.totalReturn >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                  {result.totalReturn > 0 ? '+' : ''}{result.totalReturn}%
                </div>
              </div>
              
              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 text-center">
                <div className="text-[10px] text-slate-400 mb-1">年化收益</div>
                <div className={`text-base font-bold ${result.annualizedReturn >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                  {result.annualizedReturn}%
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 text-center">
                <div className="text-[10px] text-slate-400 mb-1 flex justify-center items-center gap-1">
                   最大回撤 <AlertTriangle size={10} />
                </div>
                <div className="text-base font-bold text-slate-700 dark:text-slate-300">
                  -{result.maxDrawdown}%
                </div>
              </div>
            </div>

            {/* 最终金额 */}
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 p-4 rounded-xl flex justify-between items-center">
               <div className="flex items-center gap-2 text-indigo-800 dark:text-indigo-300">
                  <Wallet size={20} />
                  <span className="font-semibold text-sm">期末总资产</span>
               </div>
               <span className="font-bold text-xl text-indigo-900 dark:text-indigo-100">¥{formatMoney(result.finalValue)}</span>
            </div>

            {/* 图表 */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 h-64">
               <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-4">组合净值走势 (基于历史真实净值)</h3>
               <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={result.chartData}>
                   <defs>
                     <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                       <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1}/>
                       <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                     </linearGradient>
                   </defs>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                   <XAxis 
                     dataKey="date" 
                     tick={{fontSize: 10, fill: '#94a3b8'}} 
                     tickLine={false}
                     axisLine={false}
                     minTickGap={30}
                   />
                   <YAxis 
                     domain={['auto', 'auto']} 
                     tick={{fontSize: 10, fill: '#94a3b8'}} 
                     tickLine={false}
                     axisLine={false}
                     tickFormatter={(val) => `¥${(val/1000).toFixed(0)}k`}
                   />
                   <Tooltip 
                     contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                     itemStyle={{color: '#2563eb', fontWeight: 600}}
                     labelStyle={{color: '#64748b', fontSize: '12px'}}
                     formatter={(value: number) => [`¥${value.toFixed(0)}`, '总资产']}
                   />
                   <Area 
                     type="monotone" 
                     dataKey="value" 
                     stroke="#2563eb" 
                     strokeWidth={2}
                     fillOpacity={1} 
                     fill="url(#colorValue)" 
                   />
                 </AreaChart>
               </ResponsiveContainer>
            </div>
            
            <p className="text-[10px] text-slate-400 text-center pb-4">
              注：数据基于历史净值回测，未包含申购赎回费，历史业绩不代表未来表现。
            </p>
        </div>
      )}
    </div>
  );
};