import React, { useState, useMemo } from 'react';
import { Fund, Group } from '../types';
import { RefreshCw, PieChart as PieChartIcon, Settings2, Users, LayoutDashboard, ChevronRight, Zap } from 'lucide-react';

interface DashboardProps {
  funds: Fund[];
  groups: Group[];
  currentGroupId: string;
  totalProfit: number;
  totalMarketValue: number;
  lastUpdate: Date;
  isRefreshing?: boolean;
  onRefresh: () => void;
  onAnalyze: (fund: Fund) => void;
  onFundClick: (fund: Fund) => void;
  onGroupChange: (groupId: string) => void;
  onManageGroups: () => void;
  onOpenSummary?: () => void; 
}

const formatMoney = (val: number) => {
  return val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Colors
const SUMMARY_COLORS = ['#2563eb', '#ef4444', '#f59e0b', '#22c55e', '#6366f1', '#ec4899'];

export const Dashboard: React.FC<DashboardProps> = ({ 
    funds, groups, currentGroupId, totalProfit, totalMarketValue, lastUpdate, isRefreshing,
    onRefresh, onAnalyze, onFundClick, onGroupChange, onManageGroups
}) => {
  const [viewMode, setViewMode] = useState<'FUNDS' | 'SUMMARY'>('FUNDS');

  const groupStats = useMemo(() => {
    return groups.map(group => {
        const groupFunds = funds.filter(f => f.groupId === group.id);
        const marketValue = groupFunds.reduce((acc, f) => acc + (f.estimatedNav * f.holdingShares), 0);
        const todayProfit = groupFunds.reduce((acc, f) => acc + f.estimatedProfit, 0);
        
        let totalRet = 0;
        groupFunds.forEach(f => {
             const mv = f.estimatedNav * f.holdingShares;
             const cost = f.holdingCost * f.holdingShares;
             totalRet += (mv - cost + (f.realizedProfit || 0));
        });

        return {
            ...group,
            marketValue,
            todayProfit,
            totalReturn: totalRet,
            count: groupFunds.length
        };
    }).sort((a, b) => b.marketValue - a.marketValue);
  }, [funds, groups]);

  // Calculated Totals
  const displayTotalReturn = useMemo(() => {
      let ret = 0;
      funds.forEach(f => {
          const marketValue = f.estimatedNav * f.holdingShares;
          const costValue = f.holdingCost * f.holdingShares;
          const unrealized = marketValue - costValue;
          ret += (unrealized + (f.realizedProfit || 0));
      });
      return ret;
  }, [funds]);


  // --- Handlers ---
  const handleGroupTabClick = (groupId: string) => {
      setViewMode('FUNDS');
      onGroupChange(groupId);
  };

  const handleSummaryClick = () => {
      if (currentGroupId !== 'all') {
          onGroupChange('all');
      }
      setViewMode('SUMMARY');
  };

  const handleGroupCardClick = (groupId: string) => {
      onGroupChange(groupId);
      setViewMode('FUNDS');
  };

  const isSummary = viewMode === 'SUMMARY';

  return (
    <div className="space-y-3 pb-24">
      
      {/* Navigation / Mode Switcher */}
      <div className="px-4 pt-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
         {/* 调整位置：汇总在第一个 */}
         <button 
             onClick={handleSummaryClick}
             className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1 ${
                 isSummary
                 ? 'bg-indigo-600 text-white shadow-md border border-indigo-600'
                 : 'bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800'
             }`}
         >
             <LayoutDashboard size={12} /> 汇总
         </button>

         <button 
             onClick={() => handleGroupTabClick('all')}
             className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition ${
                 currentGroupId === 'all' && !isSummary
                 ? 'bg-slate-800 text-white shadow-md dark:bg-white dark:text-slate-900' 
                 : 'bg-white text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
             }`}
         >
             全部
         </button>

         {groups.map(g => (
             <button
                 key={g.id}
                 onClick={() => handleGroupTabClick(g.id)}
                 className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition ${
                     currentGroupId === g.id && !isSummary
                     ? 'bg-blue-600 text-white shadow-md'
                     : 'bg-white text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
                 }`}
             >
                 {g.name}
             </button>
         ))}
         <button 
            onClick={onManageGroups}
            className="whitespace-nowrap px-2.5 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-slate-400 border border-transparent hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center gap-1"
         >
             <Settings2 size={12} />
         </button>
      </div>

      {/* Asset Card - Compact for Mobile */}
      <div className="mx-3 relative overflow-hidden rounded-xl shadow-lg transition-all duration-300 group">
        <div className={`absolute inset-0 ${
             isSummary 
             ? 'bg-gradient-to-br from-indigo-600 via-purple-700 to-indigo-800' 
             : 'bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800'
        }`}></div>
        
        {/* Decorative Circles */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl"></div>
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white/10 rounded-full blur-xl"></div>

        <div className="relative p-5 text-white">
            <div className="flex justify-between items-start mb-2">
            <span className="text-white/80 text-xs font-medium flex items-center gap-1 backdrop-blur-sm bg-white/10 px-2 py-0.5 rounded-lg">
                {isSummary ? <><LayoutDashboard size={12}/> 多账户总资产</> : (currentGroupId === 'all' ? '总资产' : groups.find(g => g.id === currentGroupId)?.name || '分组资产')}
            </span>
            <div 
                className="bg-white/20 p-1.5 rounded-full cursor-pointer hover:bg-white/30 transition active:scale-90 backdrop-blur-md" 
                onClick={onRefresh}
            >
                <RefreshCw size={14} className={`text-white ${isRefreshing ? 'animate-spin' : ''}`} />
            </div>
            </div>
            
            <div className="text-3xl font-black mb-4 tracking-tight flex items-baseline gap-1">
                <span className="text-lg font-normal opacity-80">¥</span>
                {formatMoney(totalMarketValue)}
            </div>

            <div className="grid grid-cols-2 gap-3 bg-black/10 rounded-lg p-2.5 backdrop-blur-sm border border-white/5">
                <div>
                    <div className="text-white/70 text-[10px] mb-0.5">今日预估盈亏</div>
                    <div className={`text-base font-bold flex items-center ${totalProfit >= 0 ? 'text-red-300' : 'text-green-300'}`}>
                    {totalProfit > 0 ? '+' : ''}{formatMoney(totalProfit)}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-white/70 text-[10px] mb-0.5">累计持有收益</div>
                    <div className={`text-base font-bold ${displayTotalReturn >= 0 ? 'text-red-300' : 'text-green-300'}`}>
                    {displayTotalReturn > 0 ? '+' : ''}{formatMoney(displayTotalReturn)}
                    </div>
                </div>
            </div>

            <div className="text-right text-[10px] text-white/40 mt-2 flex justify-between items-center">
                 <span className="flex items-center gap-1">
                    <Zap size={10} className="text-yellow-300"/> 
                    {totalProfit !== 0 ? '估值动态更新' : '等待开盘'}
                 </span>
                 <span>{isRefreshing ? '正在同步...' : `${lastUpdate.toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit', second: '2-digit'})}`}</span>
            </div>
        </div>
      </div>

      {/* Content List */}
      <div className="px-3">
        
        <div className="space-y-2.5">
          
          {/* Summary Mode */}
          {isSummary && groupStats.map((group, idx) => (
              <div 
                  key={group.id}
                  onClick={() => handleGroupCardClick(group.id)}
                  className="bg-white dark:bg-slate-900 rounded-xl p-3 shadow-sm border border-slate-100 dark:border-slate-800 hover:shadow-md transition-all cursor-pointer active:scale-[0.99] group relative overflow-hidden"
              >
                  <div className="absolute left-0 top-0 bottom-0 w-1" style={{backgroundColor: SUMMARY_COLORS[idx % SUMMARY_COLORS.length]}}></div>
                  
                  <div className="flex justify-between items-center mb-2 pl-2">
                      <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">{group.name}</h3>
                          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-full">{group.count} 只</span>
                      </div>
                      <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 pl-2">
                      <div className="col-span-1">
                          <div className="text-[10px] text-slate-400 mb-0.5">资产</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{formatMoney(group.marketValue)}</div>
                      </div>
                      <div className="col-span-1 text-center">
                          <div className="text-[10px] text-slate-400 mb-0.5">今日</div>
                          <div className={`text-xs font-bold ${group.todayProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                              {group.todayProfit > 0 ? '+' : ''}{group.todayProfit.toFixed(0)}
                          </div>
                      </div>
                      <div className="col-span-1 text-right">
                          <div className="text-[10px] text-slate-400 mb-0.5">累计</div>
                          <div className={`text-xs font-bold ${group.totalReturn >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                              {group.totalReturn > 0 ? '+' : ''}{group.totalReturn.toFixed(0)}
                          </div>
                      </div>
                  </div>
              </div>
          ))}

          {/* Funds Mode */}
          {!isSummary && funds.length === 0 && (
              <div className="text-center py-8 text-slate-400 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                  <Users size={24} className="mx-auto mb-2 opacity-50" />
                  <p className="text-xs">暂无基金</p>
                  <p className="text-[10px] mt-1">点击右上角 + 号添加</p>
              </div>
          )}

          {!isSummary && funds.filter(f => f.holdingShares > 0).map((fund) => {
             // Calculate metrics for display
             const marketValue = fund.estimatedNav * fund.holdingShares;
             const totalReturn = (fund.estimatedNav - fund.holdingCost) * fund.holdingShares + (fund.realizedProfit || 0);

             return (
                <div 
                    key={fund.id} 
                    onClick={() => onFundClick(fund)}
                    className="bg-white dark:bg-slate-900 rounded-xl p-3 shadow-sm border border-slate-100 dark:border-slate-800 hover:shadow-md transition-all cursor-pointer active:scale-[0.99] relative"
                >
                {/* Source Indicator */}
                {fund.source === 'holdings_calc' && (
                    <div className="absolute top-3 right-3 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-blue-500 animate-pulse"></span>
                        <span className="text-[9px] text-blue-500 font-medium opacity-80">估算</span>
                    </div>
                )}

                {/* Row 1: Name and Change % */}
                <div className="flex justify-between items-start mb-2 pr-8">
                    <div>
                        <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-tight mb-0.5 line-clamp-1">{fund.name || fund.code}</h3>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <span className="bg-slate-50 dark:bg-slate-800 px-1 rounded font-mono">{fund.code}</span>
                            {fund.tags && fund.tags[0] && <span>{fund.tags[0]}</span>}
                        </div>
                    </div>
                    <div className={`text-base font-black ${fund.estimatedChangePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                        {fund.estimatedChangePercent > 0 ? '+' : ''}{fund.estimatedChangePercent}%
                    </div>
                </div>

                {/* Separator */}
                <div className="h-px bg-slate-50 dark:bg-slate-800 mb-2"></div>

                {/* Row 2: Detailed Stats Grid */}
                <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                        <div className="text-[10px] text-slate-400 mb-0.5">持仓金额</div>
                        <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{formatMoney(marketValue)}</div>
                    </div>
                    <div className="col-span-1 text-center border-l border-slate-50 dark:border-slate-800">
                        <div className="text-[10px] text-slate-400 mb-0.5">当日盈亏</div>
                        <div className={`text-xs font-bold ${fund.estimatedProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                            {fund.estimatedProfit > 0 ? '+' : ''}{fund.estimatedProfit.toFixed(2)}
                        </div>
                    </div>
                    <div className="col-span-1 text-right border-l border-slate-50 dark:border-slate-800">
                        <div className="text-[10px] text-slate-400 mb-0.5">持有盈亏</div>
                        <div className={`text-xs font-bold ${totalReturn >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                            {totalReturn > 0 ? '+' : ''}{totalReturn.toFixed(2)}
                        </div>
                    </div>
                </div>
                </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
