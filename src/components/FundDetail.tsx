
import React, { useMemo, useState, useEffect } from 'react';
import { Fund, Transaction } from '../types';
import { getFundHistoryData, fetchFundDetails } from '../services/fundService';
import { calculateFundMetrics, formatMoney, getDynamicDateLabel } from '../utils/finance';
import { ChevronLeft, Edit2, Trash2, History, Loader2, Layers, Tag, TrendingUp, TrendingDown, PieChart as PieChartIcon, Wallet, Eye, EyeOff } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';

interface FundDetailProps {
  fund: Fund;
  onBack: () => void;
  onEdit: (fund: Fund) => void;
  onDelete: (fund: Fund) => void;
  onBuy: (fund: Fund) => void;
  onSell: (fund: Fund) => void;
  isPrivacyMode: boolean;
  onTogglePrivacy: () => void;
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

const getSourceLabel = (source?: string) => {
    switch (source) {
        case 'official_published': return '✅ 官方公布';
        case 'official_data_1': return '📊 官方数据一';
        case 'official_data_2': return '📊 官方数据二';
        case 'reset': return '⏳ 等待开盘';
        default: return '📊 估算中';
    }
}

export const FundDetail: React.FC<FundDetailProps> = ({ fund, onBack, onEdit, onDelete, onBuy, onSell, isPrivacyMode, onTogglePrivacy }) => {
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

  const { chartData } = useMemo(() => {
    if (realHistory.length === 0) return { chartData: [] };
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - chartPeriod);
    
    const filteredHistory = realHistory.filter(item => new Date(item.date) >= cutoffDate);
    
    const transactionMap = new Map<string, Transaction>();
    if (fund.transactions) {
        fund.transactions.forEach(t => transactionMap.set(t.date, t));
    }

    const data = filteredHistory.map(item => ({
        date: item.date,
        value: item.value,
        transaction: transactionMap.get(item.date) || null
    }));

    return { chartData: data };
  }, [realHistory, chartPeriod, fund.transactions]);

  const handleDelete = () => {
    if (confirm('确定要删除该基金吗？')) {
      onDelete(fund);
      onBack();
    }
  }

  const displayFund = detailedFund;
  const isPortfolio = displayFund.holdingShares > 0;
  const isReset = displayFund.source === 'reset';

  // Calculate Holdings Data
  const marketValue = displayFund.estimatedNav * displayFund.holdingShares;
  const costValue = displayFund.holdingCost * displayFund.holdingShares;
  const totalProfit = marketValue - costValue + (displayFund.realizedProfit || 0);
  const totalReturnPercent = costValue > 0 ? (totalProfit / costValue) * 100 : 0;
  
  // Dynamic Label
  const todayProfitLabel = getDynamicDateLabel(displayFund.lastNavDate, displayFund.source);

  return (
    <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950 z-50 overflow-y-auto animate-fade-in flex flex-col">
      <div className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl dark:bg-slate-900/90 pt-detail-header px-4 pb-3 flex items-center justify-between shadow-sm border-b border-slate-100 dark:border-slate-800 transition-colors">
        <div className="flex items-center">
            <button onClick={onBack} className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition text-slate-600 dark:text-slate-300">
            <ChevronLeft size={24} />
            </button>
            <div className="ml-1">
                <h2 className="font-bold text-slate-800 dark:text-white text-base leading-tight max-w-[150px] truncate">{displayFund.name}</h2>
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
        <div className="flex gap-1 items-center">
            <button onClick={onTogglePrivacy} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 hover:text-slate-700 transition">
                {isPrivacyMode ? <EyeOff size={18}/> : <Eye size={18}/>}
            </button>
            <button onClick={() => onEdit(displayFund)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 hover:text-blue-500 transition">
                <Edit2 size={18} />
            </button>
            <button onClick={handleDelete} className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full text-slate-500 hover:text-red-500 transition">
                <Trash2 size={18} />
            </button>
        </div>
      </div>

      <div className="pt-detail-header mt-[60px]"></div>

      <div className="flex-1 pb-24">
          
          {/* Hero Card */}
          <div className="p-4 pb-2">
              <div className={`rounded-2xl p-6 text-white shadow-xl relative overflow-hidden transition-colors ${
                  isReset ? 'bg-slate-400' :
                  displayFund.estimatedChangePercent >= 0 
                  ? 'bg-gradient-to-br from-red-500 to-rose-600 shadow-red-500/20' 
                  : 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/20'
              }`}>
                   <div className="absolute inset-0 opacity-10 mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`}}></div>

                   <div className="relative z-10 flex justify-between items-start">
                       <div>
                           <div className="flex items-center gap-2 mb-1 opacity-90">
                               <span className="text-xs font-medium border border-white/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                                    {getSourceLabel(displayFund.source)}
                               </span>
                               <span className="text-[10px]">{displayFund.estimateTime || displayFund.lastNavDate}</span>
                           </div>
                           <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-black tracking-tight">
                                    {isReset ? '--' : (
                                        <>
                                        {displayFund.estimatedChangePercent > 0 ? '+' : ''}{displayFund.estimatedChangePercent}%
                                        </>
                                    )}
                                </span>
                                <span className="text-lg font-bold opacity-80">
                                    {isReset ? '--' : displayFund.estimatedNav.toFixed(4)}
                                </span>
                           </div>
                       </div>
                   </div>

                    {!isPortfolio && !isReset && (
                        <div className="mt-4 flex gap-4 text-xs opacity-80">
                            <div>昨日净值: {displayFund.lastNav.toFixed(4)}</div>
                            <div>更新日期: {displayFund.lastNavDate}</div>
                        </div>
                    )}
              </div>
          </div>
          
          {/* Holdings Info Module */}
          {isPortfolio && (
              <div className="px-4 mb-4">
                  <div className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2 mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">
                          <Wallet size={16} className="text-blue-500"/> 持仓详情
                      </div>
                      <div className="grid grid-cols-3 gap-y-4 gap-x-2">
                          <div>
                              <div className="text-[10px] text-slate-400 mb-0.5">持仓金额</div>
                              <div className="text-sm font-bold text-slate-800 dark:text-white">{isReset ? '--' : formatMoney(marketValue, isPrivacyMode)}</div>
                          </div>
                          <div className="text-center">
                              <div className="text-[10px] text-slate-400 mb-0.5">持仓份额</div>
                              <div className="text-sm font-bold text-slate-800 dark:text-white">{displayFund.holdingShares.toFixed(2)}</div>
                          </div>
                          <div className="text-right">
                              <div className="text-[10px] text-slate-400 mb-0.5">持仓成本</div>
                              <div className="text-sm font-bold text-slate-800 dark:text-white">{isPrivacyMode ? '****' : displayFund.holdingCost.toFixed(4)}</div>
                          </div>
                          
                          <div>
                              <div className="text-[10px] text-slate-400 mb-0.5">{todayProfitLabel}</div>
                              <div className={`text-sm font-bold ${displayFund.estimatedProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                  {isReset ? '--' : (
                                      <>{!isPrivacyMode && displayFund.estimatedProfit > 0 ? '+' : ''}{formatMoney(displayFund.estimatedProfit, isPrivacyMode)}</>
                                  )}
                              </div>
                          </div>
                          <div className="text-center">
                              <div className="text-[10px] text-slate-400 mb-0.5">累计盈亏</div>
                              <div className={`text-sm font-bold ${totalProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                  {isReset ? '--' : (
                                      <>{!isPrivacyMode && totalProfit > 0 ? '+' : ''}{formatMoney(totalProfit, isPrivacyMode)}</>
                                  )}
                              </div>
                          </div>
                          <div className="text-right">
                              <div className="text-[10px] text-slate-400 mb-0.5">累计收益率</div>
                              <div className={`text-sm font-bold ${totalReturnPercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                  {isReset ? '--' : (
                                      <>{!isPrivacyMode && totalReturnPercent > 0 ? '+' : ''}{isPrivacyMode ? '****' : totalReturnPercent.toFixed(2)}%</>
                                  )}
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          )}

          <div className="px-4 mb-2">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button 
                    onClick={() => setActiveTab('INFO')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${activeTab === 'INFO' ? 'bg-white dark:bg-slate-700 shadow text-slate-800 dark:text-white' : 'text-slate-400'}`}
                >
                    基金概况
                </button>
                {isPortfolio && (
                    <button 
                        onClick={() => setActiveTab('HISTORY')}
                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${activeTab === 'HISTORY' ? 'bg-white dark:bg-slate-700 shadow text-slate-800 dark:text-white' : 'text-slate-400'}`}
                    >
                        交易记录
                    </button>
                )}
              </div>
          </div>

          {activeTab === 'INFO' && (
             <>
             <div className="bg-white dark:bg-slate-900 p-4 mb-3 shadow-sm mx-4 rounded-xl border border-slate-100 dark:border-slate-800">
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
                            <Tooltip contentStyle={{fontSize: '12px'}} />
                            <Area 
                                type="monotone" 
                                dataKey="value" 
                                stroke="#2563eb" 
                                strokeWidth={2} 
                                fillOpacity={1} 
                                fill="url(#colorValueDetail)" 
                                dot={isPortfolio ? <CustomizedDot /> : false}
                            />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                 </div>
             </div>

             {/* Industry Distribution Module */}
             {displayFund.industryDistribution && displayFund.industryDistribution.length > 0 && (
                <div className="bg-white dark:bg-slate-900 p-4 shadow-sm border border-slate-100 dark:border-slate-800 mx-4 rounded-xl mb-3">
                     <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 text-sm mb-4">
                        <PieChartIcon size={16} className="text-indigo-500" />
                        行业配置
                     </h3>
                     <div className="h-40">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart layout="vertical" data={displayFund.industryDistribution.slice(0, 5)} margin={{left: 0, right: 30}}>
                                <XAxis type="number" hide />
                                <YAxis 
                                    type="category" 
                                    dataKey="name" 
                                    width={70} 
                                    tick={{fontSize: 10, fill: '#64748b'}} 
                                    axisLine={false} 
                                    tickLine={false}
                                />
                                <Tooltip cursor={{fill: 'transparent'}} contentStyle={{fontSize: '10px'}} />
                                <Bar dataKey="percent" barSize={12} radius={[0, 4, 4, 0]}>
                                    {displayFund.industryDistribution.slice(0, 5).map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'][index % 5]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                     </div>
                </div>
             )}

             {/* Holdings List (No real-time price) */}
             <div className="bg-white dark:bg-slate-900 shadow-sm border border-slate-100 dark:border-slate-800 mx-4 rounded-xl overflow-hidden mb-4">
                 <div className="flex items-center justify-between p-4 border-b border-slate-50 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                     <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 text-sm">
                        <Layers size={16} className="text-indigo-500" />
                        十大重仓股
                     </h3>
                 </div>
                 
                 {isLoadingDetails ? (
                    <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-slate-300"/></div>
                 ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                        <div className="flex px-4 py-2 bg-slate-50 dark:bg-slate-900 text-[10px] font-bold text-slate-400">
                            <div className="w-[70%]">股票</div>
                            <div className="w-[30%] text-right">占比</div>
                        </div>

                        {displayFund.holdings.length > 0 ? displayFund.holdings.map((stock, idx) => {
                            return (
                                <div key={stock.code} className="flex items-center px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                                    <div className="w-[70%] flex items-center gap-3 min-w-0 pr-2">
                                        <div className={`w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-md text-[10px] font-bold ${
                                            idx < 3 ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/20' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                        }`}>
                                            {idx + 1}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-bold text-sm text-slate-700 dark:text-slate-200 truncate">{stock.name}</div>
                                            <div className="text-[10px] text-slate-400 font-mono">{stock.code}</div>
                                        </div>
                                    </div>

                                    <div className="w-[30%] text-right">
                                        <div className="text-[10px] text-slate-500 font-medium">
                                            {stock.percent}%
                                        </div>
                                    </div>
                                </div>
                            )
                        }) : (
                            <div className="text-center text-slate-400 text-xs py-8">暂无持仓数据</div>
                        )}
                    </div>
                 )}
             </div>
             </>
          )}

          {activeTab === 'HISTORY' && isPortfolio && (
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
                                        净值 {t.nav}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-slate-800 dark:text-white">¥{formatMoney(t.amount, isPrivacyMode)}</div>
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
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 pb-safe flex gap-3 max-w-md mx-auto z-30">
          <button 
            onClick={() => onSell(displayFund)}
            className="flex-1 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 font-bold py-3.5 rounded-2xl active:scale-95 transition text-sm flex items-center justify-center gap-2"
          >
              <TrendingDown size={16} /> 卖出
          </button>
          <button 
            onClick={() => onBuy(displayFund)}
            className="flex-1 bg-blue-600 text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-blue-200 dark:shadow-blue-900/40 active:scale-95 transition text-sm flex items-center justify-center gap-2"
          >
              <TrendingUp size={16} /> 买入
          </button>
      </div>
    </div>
  );
};
