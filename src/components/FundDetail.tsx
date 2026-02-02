import React, { useMemo, useState, useEffect } from 'react';
import { Fund, Transaction } from '../types';
import { getFundHistoryData, fetchFundDetails } from '../services/fundService';
import { ChevronLeft, Edit2, Trash2, History, Loader2, Layers, Zap, Info, Tag } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface FundDetailProps {
  fund: Fund;
  onBack: () => void;
  onEdit: (fund: Fund) => void;
  onDelete: (fund: Fund) => void;
  onBuy: (fund: Fund) => void;
  onSell: (fund: Fund) => void;
}

const CustomizedDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (payload && payload.transaction) {
    const isBuy = payload.transaction.type === 'BUY';
    const color = isBuy ? '#f43f5e' : '#10b981';
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill="white" stroke={color} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={4} fill={color} />
      </g>
    );
  }
  return null;
};

export const FundDetail: React.FC<FundDetailProps> = ({ fund, onBack, onEdit, onDelete, onBuy, onSell }) => {
  const [chartPeriod, setChartPeriod] = useState<number>(90);
  const [activeTab, setActiveTab] = useState<'INFO' | 'HISTORY'>('INFO');
  
  const [realHistory, setRealHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [detailedFund, setDetailedFund] = useState<Fund>(fund);
  const [isLoadingDetails, setIsLoadingDetails] = useState(true);

  useEffect(() => {
    const loadData = async () => {
        setIsLoadingHistory(true);
        setIsLoadingDetails(true);

        const history = await getFundHistoryData(fund.code);
        setRealHistory(history);
        setIsLoadingHistory(false);

        const details = await fetchFundDetails(fund);
        setDetailedFund(prev => ({ ...prev, ...details }));
        setIsLoadingDetails(false);
    };
    loadData();
  }, [fund.code]);

  const { chartData, maxDrawdown, rangeReturn } = useMemo(() => {
    if (realHistory.length === 0) return { chartData: [], maxDrawdown: 0, rangeReturn: 0 };
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - chartPeriod);
    
    const filteredHistory = realHistory.filter(item => new Date(item.date) >= cutoffDate);
    
    let maxDD = 0;
    let peak = -Infinity;
    if (filteredHistory.length > 0) {
        filteredHistory.forEach(point => {
            if (point.value > peak) peak = point.value;
            const dd = (peak - point.value) / peak;
            if (dd > maxDD) maxDD = dd;
        });
    }

    let ret = 0;
    if (filteredHistory.length > 1) {
        const start = filteredHistory[0].value;
        const end = filteredHistory[filteredHistory.length - 1].value;
        ret = ((end - start) / start) * 100;
    }
    
    const transactionMap = new Map<string, Transaction>();
    if (fund.transactions) {
        fund.transactions.forEach(t => transactionMap.set(t.date, t));
    }

    const data = filteredHistory.map(item => ({
        date: item.date,
        value: item.value,
        transaction: transactionMap.get(item.date) || null
    }));

    return { chartData: data, maxDrawdown: (maxDD * 100).toFixed(2), rangeReturn: ret.toFixed(2) };
  }, [realHistory, chartPeriod, fund.transactions]);

  const handleDelete = () => {
    if (confirm('确定要删除该自选基金吗？持仓记录将被清空。')) {
      onDelete(fund);
      onBack();
    }
  }

  const displayFund = detailedFund;
  const holdingMarketValue = displayFund.estimatedNav * displayFund.holdingShares;
  const totalCostValue = displayFund.holdingCost * displayFund.holdingShares;
  const totalHoldingProfit = (displayFund.estimatedNav - displayFund.holdingCost) * displayFund.holdingShares + (displayFund.realizedProfit || 0);
  const holdingProfitRatio = totalCostValue > 0 ? (totalHoldingProfit / totalCostValue) * 100 : 0;

  // Calculate Contribution
  const topHoldingsContribution = displayFund.holdings.reduce((acc, h) => acc + (h.percent * h.changePercent / 100), 0);

  return (
    <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950 z-50 overflow-y-auto animate-fade-in flex flex-col">
      {/* Navbar */}
      <div className="bg-white/90 backdrop-blur-md dark:bg-slate-900/90 sticky top-0 z-20 px-4 py-3 flex items-center justify-between shadow-sm border-b border-slate-100 dark:border-slate-800 transition-colors">
        <div className="flex items-center">
            <button onClick={onBack} className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition text-slate-600 dark:text-slate-300">
            <ChevronLeft size={24} />
            </button>
            <div className="ml-1">
                <h2 className="font-bold text-slate-800 dark:text-white text-base leading-tight max-w-[180px] truncate">{displayFund.name}</h2>
                <div className="text-[10px] text-slate-400 flex items-center gap-2">
                    <span className="font-mono">{displayFund.code}</span>
                    {displayFund.type && (
                         <span className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-1 rounded flex items-center gap-0.5">
                            <Tag size={8}/> {displayFund.type}
                         </span>
                    )}
                </div>
            </div>
        </div>
        <div className="flex gap-1">
            <button onClick={() => onEdit(displayFund)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 hover:text-blue-500 transition">
                <Edit2 size={18} />
            </button>
            <button onClick={handleDelete} className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full text-slate-500 hover:text-red-500 transition">
                <Trash2 size={18} />
            </button>
        </div>
      </div>

      <div className="flex-1 pb-24">
          
          {/* Hero Card */}
          <div className="p-4">
              <div className={`rounded-2xl p-6 text-white shadow-xl relative overflow-hidden transition-colors ${
                  displayFund.estimatedChangePercent >= 0 
                  ? 'bg-gradient-to-br from-red-500 to-rose-600 shadow-red-500/20' 
                  : 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/20'
              }`}>
                   {/* Background Noise */}
                   <div className="absolute inset-0 opacity-10 mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`}}></div>

                   <div className="relative z-10 flex justify-between items-start">
                       <div>
                           <div className="flex items-center gap-2 mb-1 opacity-90">
                               <span className="text-xs font-medium border border-white/20 px-2 py-0.5 rounded-full">
                                    {displayFund.source === 'official_final' ? '已更新 · 真实净值' : (displayFund.source === 'holdings_calc_batch' ? '实时估算 · 重仓股' : '官方估算')}
                               </span>
                               <span className="text-[10px]">{displayFund.estimateTime || displayFund.lastNavDate}</span>
                           </div>
                           <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-black tracking-tight">
                                    {displayFund.estimatedChangePercent > 0 ? '+' : ''}{displayFund.estimatedChangePercent}%
                                </span>
                                <span className="text-lg font-bold opacity-80">
                                    {displayFund.estimatedNav.toFixed(4)}
                                </span>
                           </div>
                       </div>
                   </div>

                   <div className="mt-6 grid grid-cols-3 gap-2">
                       <div className="bg-black/10 rounded-lg p-2 backdrop-blur-sm">
                           <div className="text-[10px] opacity-70 mb-0.5">持有金额</div>
                           <div className="font-bold text-sm">¥{holdingMarketValue.toFixed(0)}</div>
                       </div>
                       <div className="bg-black/10 rounded-lg p-2 backdrop-blur-sm">
                           <div className="text-[10px] opacity-70 mb-0.5">当日盈亏</div>
                           <div className="font-bold text-sm">{displayFund.estimatedProfit > 0 ? '+' : ''}{displayFund.estimatedProfit.toFixed(2)}</div>
                       </div>
                       <div className="bg-black/10 rounded-lg p-2 backdrop-blur-sm">
                           <div className="text-[10px] opacity-70 mb-0.5">持有收益率</div>
                           <div className="font-bold text-sm">{holdingProfitRatio > 0 ? '+' : ''}{holdingProfitRatio.toFixed(2)}%</div>
                       </div>
                   </div>
              </div>
          </div>

          {/* Manager Info */}
          <div className="px-4 mb-4">
              <div className="bg-white dark:bg-slate-900 rounded-xl p-3 flex items-center justify-between border border-slate-100 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400">
                          <Info size={20}/>
                      </div>
                      <div>
                          <div className="text-xs text-slate-400">基金经理</div>
                          <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{displayFund.manager}</div>
                      </div>
                  </div>
                  {/* Future: Add fund size or years */}
              </div>
          </div>

          {/* Tabs */}
          <div className="px-4 mb-2">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button 
                    onClick={() => setActiveTab('INFO')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${activeTab === 'INFO' ? 'bg-white dark:bg-slate-700 shadow text-slate-800 dark:text-white' : 'text-slate-400'}`}
                >
                    业绩走势
                </button>
                <button 
                    onClick={() => setActiveTab('HISTORY')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${activeTab === 'HISTORY' ? 'bg-white dark:bg-slate-700 shadow text-slate-800 dark:text-white' : 'text-slate-400'}`}
                >
                    交易记录
                </button>
              </div>
          </div>

          {activeTab === 'INFO' && (
             <div className="bg-white dark:bg-slate-900 p-4 mb-3 shadow-sm min-h-[260px] mx-4 rounded-xl border border-slate-100 dark:border-slate-800">
                 <div className="flex justify-between items-center mb-4">
                     <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">净值走势</h3>
                     <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                         {[30, 90, 180, 365].map(days => (
                             <button 
                                key={days}
                                onClick={() => setChartPeriod(days)}
                                className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition ${chartPeriod === days ? 'bg-white dark:bg-slate-700 shadow text-blue-600 dark:text-blue-400' : 'text-slate-400'}`}
                             >
                                {days === 30 ? '1月' : days === 90 ? '3月' : days === 180 ? '6月' : '1年'}
                             </button>
                         ))}
                     </div>
                 </div>
                 <div className="h-48 relative">
                    {isLoadingHistory ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="animate-spin text-indigo-500" size={24}/>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                            <defs>
                                <linearGradient id="colorValueDetail" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1}/>
                                <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="date" hide />
                            <YAxis domain={['auto', 'auto']} hide />
                            <Tooltip 
                                contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '12px'}}
                                itemStyle={{color: '#2563eb', fontWeight: 600}}
                                labelStyle={{color: '#94a3b8', marginBottom: '4px'}}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="value" 
                                stroke="#2563eb" 
                                strokeWidth={2} 
                                fillOpacity={1} 
                                fill="url(#colorValueDetail)" 
                                dot={<CustomizedDot />}
                            />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                 </div>
                 
                 {!isLoadingHistory && realHistory.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 mt-4">
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg flex items-center justify-between">
                            <span className="text-[10px] text-slate-400">区间收益</span>
                            <span className={`text-xs font-bold ${parseFloat(rangeReturn as string) >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                {parseFloat(rangeReturn as string) > 0 ? '+' : ''}{rangeReturn}%
                            </span>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg flex items-center justify-between">
                            <span className="text-[10px] text-slate-400">最大回撤</span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">-{maxDrawdown}%</span>
                        </div>
                    </div>
                 )}
             </div>
          )}

          {activeTab === 'HISTORY' && (
             <div className="bg-white dark:bg-slate-900 p-4 min-h-[300px] shadow-sm mx-4 rounded-xl border border-slate-100 dark:border-slate-800">
                 {displayFund.transactions && displayFund.transactions.length > 0 ? (
                     <div className="space-y-4">
                        {[...displayFund.transactions].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(t => (
                            <div key={t.id} className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-3 last:border-0">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.type === 'BUY' ? 'bg-red-50 text-up-red' : 'bg-green-50 text-down-green'}`}>
                                            {t.type === 'BUY' ? '买入' : '卖出'}
                                        </div>
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t.date}</span>
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-1">
                                        净值 {t.nav} <span className="mx-1">·</span> 手续费 ¥{t.fee}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-slate-800 dark:text-white">¥{t.amount.toLocaleString()}</div>
                                    <div className="text-xs text-slate-400">{t.shares.toFixed(2)} 份</div>
                                </div>
                            </div>
                        ))}
                     </div>
                 ) : (
                     <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                         <History size={32} className="mb-2 opacity-30" />
                         <p className="text-xs">暂无交易记录</p>
                     </div>
                 )}
             </div>
          )}

          {/* Holdings Breakdown */}
          <div className="bg-white dark:bg-slate-900 p-5 mb-3 shadow-sm border border-slate-100 dark:border-slate-800 mt-2 mx-4 rounded-xl">
                 <div className="flex items-center justify-between mb-4">
                     <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Layers size={18} className="text-indigo-500" />
                        十大重仓股 (实时)
                     </h3>
                     <div className="text-[10px] text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-lg">
                        Top10 贡献: <span className={topHoldingsContribution >= 0 ? 'text-up-red' : 'text-down-green'}>{topHoldingsContribution > 0 ? '+' : ''}{topHoldingsContribution.toFixed(2)}%</span>
                     </div>
                 </div>

                 {isLoadingDetails ? (
                    <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-slate-300"/></div>
                 ) : (
                    <div className="space-y-3">
                        {displayFund.holdings.length > 0 ? displayFund.holdings.map((stock, idx) => {
                            const contribution = (stock.percent * stock.changePercent) / 100;
                            return (
                                <div key={stock.code} className="relative">
                                    <div className="flex justify-between items-center text-sm z-10 relative py-1">
                                        <div className="flex items-center gap-3 w-[40%]">
                                            <span className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-md ${idx < 3 ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}>
                                                {idx + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="font-bold text-slate-700 dark:text-slate-200 leading-tight truncate">{stock.name}</div>
                                                <div className="text-[10px] text-slate-400 font-mono">{stock.code}</div>
                                            </div>
                                        </div>

                                        <div className="text-right w-[25%]">
                                            <div className={`font-bold ${stock.changePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                                {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                                            </div>
                                            <div className="text-[9px] text-slate-400">
                                                ¥{stock.currentPrice > 0 ? stock.currentPrice.toFixed(2) : '--'}
                                            </div>
                                        </div>

                                        <div className="text-right w-[35%] pl-2">
                                            <div className="text-[10px] text-slate-400">持仓 {stock.percent}%</div>
                                            <div className={`text-xs font-bold ${contribution >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                                贡献 {contribution > 0 ? '+' : ''}{contribution.toFixed(2)}%
                                            </div>
                                        </div>
                                    </div>
                                    {/* Visual Bar Background */}
                                    <div className="absolute bottom-0 left-0 h-0.5 bg-slate-100 dark:bg-slate-800 w-full rounded-full overflow-hidden mt-1">
                                        <div 
                                            className={`h-full ${contribution >= 0 ? 'bg-up-red' : 'bg-down-green'} opacity-40`} 
                                            style={{width: `${Math.min(stock.percent * 3, 100)}%`}}
                                        ></div>
                                    </div>
                                </div>
                            )
                        }) : (
                            <div className="text-center text-slate-400 text-xs py-4">暂无持仓数据或更新失败</div>
                        )}
                    </div>
                 )}
          </div>
      </div>

      {/* Footer Action */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 pb-safe flex gap-3 max-w-md mx-auto z-30">
          <button 
            onClick={() => onSell(displayFund)}
            className="flex-1 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 font-bold py-3.5 rounded-2xl active:scale-95 transition text-sm"
          >
              卖出
          </button>
          <button 
            onClick={() => onBuy(displayFund)}
            className="flex-1 bg-blue-600 text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-blue-200 dark:shadow-blue-900/40 active:scale-95 transition text-sm"
          >
              买入
          </button>
      </div>
    </div>
  );
};