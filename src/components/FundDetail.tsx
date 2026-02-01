import React, { useMemo, useState, useEffect } from 'react';
import { Fund, Transaction } from '../types';
import { getFundHistoryData, fetchFundDetails } from '../services/fundService';
import { ChevronLeft, FileText, Edit2, Trash2, History, TrendingUp, Loader2, Activity, TrendingDown, Layers } from 'lucide-react';
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
    const color = isBuy ? '#ef4444' : '#22c55e';
    return (
      <g>
        <circle cx={cx} cy={cy} r={9} fill="white" stroke={color} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={7} fill={color} />
        <text x={cx} y={cy} dy={3} textAnchor="middle" fill="white" fontSize={9} fontWeight="bold" style={{ pointerEvents: 'none' }}>
            {isBuy ? 'B' : 'S'}
        </text>
      </g>
    );
  }
  return null;
};

export const FundDetail: React.FC<FundDetailProps> = ({ fund, onBack, onEdit, onDelete, onBuy, onSell }) => {
  const [chartPeriod, setChartPeriod] = useState<number>(90);
  const [activeTab, setActiveTab] = useState<'INFO' | 'HISTORY'>('INFO');
  
  // Real Data State
  const [realHistory, setRealHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [detailedFund, setDetailedFund] = useState<Fund>(fund);
  const [isLoadingDetails, setIsLoadingDetails] = useState(true);

  // Load Real Data on Mount
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

  // Calculate Missing Metrics
  const holdingMarketValue = displayFund.estimatedNav * displayFund.holdingShares;
  const totalHoldingProfit = (displayFund.estimatedNav - displayFund.holdingCost) * displayFund.holdingShares + (displayFund.realizedProfit || 0);

  return (
    <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950 z-50 overflow-y-auto animate-fade-in flex flex-col">
      {/* Navbar */}
      <div className="bg-white dark:bg-slate-900 sticky top-0 z-10 px-4 py-3 flex items-center justify-between shadow-sm border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center">
            <button onClick={onBack} className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <ChevronLeft size={24} className="text-slate-700 dark:text-slate-200" />
            </button>
            <div className="ml-2">
                <h2 className="font-bold text-slate-800 dark:text-white text-lg leading-tight w-40 truncate">{displayFund.name}</h2>
                <div className="text-xs text-slate-400 flex items-center gap-2">
                    <span>{displayFund.code}</span>
                    <span className="w-px h-3 bg-slate-300 dark:bg-slate-700"></span>
                    <span>{displayFund.tags[0]}</span>
                </div>
            </div>
        </div>
        <div className="flex gap-1">
            <button onClick={() => onEdit(displayFund)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-600 dark:text-slate-400">
                <Edit2 size={20} />
            </button>
            <button onClick={handleDelete} className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full text-red-500">
                <Trash2 size={20} />
            </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 pb-24">
          
          {/* Header Stats */}
          <div className="bg-white dark:bg-slate-900 p-6 mb-2">
              <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                        实时估值 {displayFund.source === 'holdings_calc_batch' ? <span className="text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-1 rounded scale-90 origin-left">重仓股推算</span> : null}
                    </div>
                    <div className="flex items-baseline gap-3">
                        <span className={`text-3xl font-black ${displayFund.estimatedChangePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                            {displayFund.estimatedNav.toFixed(4)}
                        </span>
                        <span className={`font-semibold ${displayFund.estimatedChangePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                            {displayFund.estimatedChangePercent > 0 ? '+' : ''}{displayFund.estimatedChangePercent}%
                        </span>
                    </div>
                  </div>
                  <div className="text-right">
                       <div className="text-xs text-slate-400 mb-1">净值日期</div>
                       <div className="font-medium text-slate-700 dark:text-slate-300">{displayFund.lastNavDate}</div>
                  </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-6">
                  <div className="text-center p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="text-[10px] text-slate-400 mb-1">持有金额</div>
                      <div className="text-sm font-bold text-slate-800 dark:text-white">¥{holdingMarketValue.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                  </div>
                  <div className="text-center p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="text-[10px] text-slate-400 mb-1">当日盈亏</div>
                      <div className={`text-sm font-bold ${displayFund.estimatedProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                         {displayFund.estimatedProfit > 0 ? '+' : ''}{displayFund.estimatedProfit.toFixed(2)}
                      </div>
                  </div>
                  <div className="text-center p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="text-[10px] text-slate-400 mb-1">持有盈亏</div>
                      <div className={`text-sm font-bold ${totalHoldingProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                         {totalHoldingProfit > 0 ? '+' : ''}{totalHoldingProfit.toFixed(2)}
                      </div>
                  </div>
              </div>
          </div>

          {/* Risk Analysis Card */}
          {!isLoadingHistory && realHistory.length > 0 && (
             <div className="mx-4 mb-2 grid grid-cols-2 gap-2">
                 <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
                     <div>
                         <div className="text-[10px] text-slate-400 mb-0.5 flex items-center gap-1">
                             <TrendingDown size={10} /> 区间最大回撤
                         </div>
                         <div className="text-sm font-bold text-slate-700 dark:text-slate-200">-{maxDrawdown}%</div>
                     </div>
                     <div className="h-8 w-1 bg-red-100 dark:bg-red-900/30 rounded-full overflow-hidden">
                         <div className="bg-up-red w-full" style={{height: `${Math.min(parseFloat(maxDrawdown as string), 100)}%`}}></div>
                     </div>
                 </div>
                 <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
                     <div>
                         <div className="text-[10px] text-slate-400 mb-0.5 flex items-center gap-1">
                             <Activity size={10} /> 区间收益率
                         </div>
                         <div className={`text-sm font-bold ${parseFloat(rangeReturn as string) >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                             {parseFloat(rangeReturn as string) > 0 ? '+' : ''}{rangeReturn}%
                         </div>
                     </div>
                 </div>
             </div>
          )}

          {/* Chart Section */}
          <div className="bg-white dark:bg-slate-900 p-4 mb-2 border-t border-slate-50 dark:border-slate-800 min-h-[250px]">
             <div className="flex justify-between items-center mb-4">
                 <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">净值走势</h3>
                 <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                     {[30, 90, 180, 365].map(days => (
                         <button 
                            key={days}
                            onClick={() => setChartPeriod(days)}
                            className={`px-3 py-1 text-xs rounded-md transition ${chartPeriod === days ? 'bg-white dark:bg-slate-700 shadow text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-400'}`}
                         >
                            {days === 30 ? '1月' : days === 90 ? '3月' : days === 180 ? '6月' : '1年'}
                         </button>
                     ))}
                 </div>
             </div>
             <div className="h-48 relative">
                {isLoadingHistory ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="animate-spin text-blue-500" size={32}/>
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
                            contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                            itemStyle={{color: '#2563eb', fontWeight: 600}}
                            labelStyle={{color: '#64748b', fontSize: '12px'}}
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
          </div>

          {/* Tabs */}
          <div className="flex bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
             <button 
                onClick={() => setActiveTab('INFO')}
                className={`flex-1 py-3 text-sm font-bold border-b-2 transition ${activeTab === 'INFO' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-400'}`}
             >
                基金档案
             </button>
             <button 
                onClick={() => setActiveTab('HISTORY')}
                className={`flex-1 py-3 text-sm font-bold border-b-2 transition ${activeTab === 'HISTORY' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-400'}`}
             >
                交易记录
             </button>
          </div>

          {activeTab === 'INFO' ? (
            <div className="space-y-2 mt-2">
                <div className="bg-white dark:bg-slate-900 p-4">
                    <div className="flex items-center gap-2 mb-4 justify-between">
                        <div className="flex items-center gap-2">
                            <FileText size={18} className="text-blue-500" />
                            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">十大重仓实时动向</h3>
                        </div>
                        <div className="text-[10px] text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded">
                            贡献度 = 持仓占比 × 涨跌幅
                        </div>
                    </div>
                    
                    {isLoadingDetails ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="animate-spin text-slate-300" />
                        </div>
                    ) : (
                        <div>
                             {/* Headers */}
                             <div className="flex text-[10px] text-slate-400 mb-2 px-1">
                                 <div className="w-[40%]">股票名称</div>
                                 <div className="w-[30%] text-right">现价/涨跌</div>
                                 <div className="w-[30%] text-right">持仓/贡献</div>
                             </div>

                             <div className="space-y-3">
                                {displayFund.holdings.length > 0 ? displayFund.holdings.map((stock, idx) => {
                                    const contribution = (stock.percent * stock.changePercent) / 100;
                                    return (
                                        <div key={stock.code} className="flex items-center justify-between text-sm py-1">
                                            {/* Name & Code */}
                                            <div className="w-[40%] flex items-center gap-2">
                                                <span className={`text-[10px] w-4 h-4 flex items-center justify-center rounded ${idx < 3 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}>{idx + 1}</span>
                                                <div className="overflow-hidden">
                                                    <div className="font-bold text-slate-700 dark:text-slate-200 truncate">{stock.name}</div>
                                                    <div className="text-[10px] text-slate-400 font-mono">{stock.code}</div>
                                                </div>
                                            </div>
                                            
                                            {/* Price & Change */}
                                            <div className="w-[30%] text-right">
                                                <div className="font-mono text-xs text-slate-700 dark:text-slate-300">{stock.currentPrice > 0 ? stock.currentPrice.toFixed(2) : '--'}</div>
                                                <div className={`text-xs font-bold ${stock.changePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                                    {stock.changePercent > 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                                                </div>
                                            </div>

                                            {/* Weight & Contribution */}
                                            <div className="w-[30%] text-right pl-2">
                                                <div className="text-xs text-slate-500 dark:text-slate-400">{stock.percent}%</div>
                                                <div className={`text-[10px] font-medium ${contribution >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                                     {contribution > 0 ? '+' : ''}{contribution.toFixed(2)}%
                                                </div>
                                                {/* Visual Bar for Weight */}
                                                <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full mt-1 overflow-hidden">
                                                    <div className="h-full bg-blue-500 opacity-50" style={{width: `${stock.percent * 5}%`}}></div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <div className="text-center text-slate-400 text-xs py-4 flex flex-col items-center">
                                        <Layers size={24} className="mb-2 opacity-20"/>
                                        暂无持仓数据或获取失败
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
          ) : (
             <div className="bg-white dark:bg-slate-900 p-4 min-h-[300px]">
                 {displayFund.transactions && displayFund.transactions.length > 0 ? (
                     <div className="space-y-4">
                        {[...displayFund.transactions].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(t => (
                            <div key={t.id} className="flex justify-between items-center border-b border-slate-50 dark:border-slate-800 pb-3 last:border-0">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <div className={`text-xs font-bold px-1.5 py-0.5 rounded ${t.type === 'BUY' ? 'bg-red-100 dark:bg-red-900/30 text-up-red' : 'bg-green-100 dark:bg-green-900/30 text-green-600'}`}>
                                            {t.type === 'BUY' ? '买入' : '卖出'}
                                        </div>
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t.date}</span>
                                    </div>
                                    <div className="text-xs text-slate-400 mt-1">
                                        净值 {t.nav} | 手续费 ¥{t.fee}
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
                         <History size={40} className="mb-2 opacity-50" />
                         <p className="text-xs">暂无交易记录</p>
                     </div>
                 )}
             </div>
          )}
      </div>

      {/* Footer Action */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 pb-safe flex gap-3 max-w-md mx-auto">
          <button 
            onClick={() => onSell(displayFund)}
            className="flex-1 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 font-bold py-3 rounded-xl active:scale-95 transition"
          >
              卖出
          </button>
          <button 
            onClick={() => onBuy(displayFund)}
            className="flex-1 bg-up-red text-white font-bold py-3 rounded-xl shadow-lg shadow-red-200 dark:shadow-red-900/30 active:scale-95 transition"
          >
              买入
          </button>
      </div>
    </div>
  );
};
