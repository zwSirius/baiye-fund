import React, { useState, useMemo } from 'react';
import { Fund, Group } from '../types';
import { TrendingUp, TrendingDown, RefreshCw, PieChart as PieChartIcon, Settings2, Users, LayoutDashboard, ChevronRight, ArrowRight, Zap, Info } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

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
const TAG_COLORS: Record<string, string> = {
    '消费': '#ef4444',
    '白酒': '#ef4444',
    '医药': '#22c55e',
    '医疗': '#22c55e',
    '科技': '#3b82f6',
    '半导体': '#3b82f6',
    '银行': '#f59e0b',
    '指数': '#6366f1',
    '其他': '#94a3b8'
};
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

  // Data for Allocation Chart (Funds View)
  const allocationData = useMemo(() => {
      const distribution: Record<string, number> = {};
      funds.forEach(fund => {
          if (fund.holdingShares > 0) {
            const tag = fund.tags[0] || '其他';
            const value = fund.estimatedNav * fund.holdingShares;
            distribution[tag] = (distribution[tag] || 0) + value;
          }
      });
      return Object.entries(distribution)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
  }, [funds]);

  // Data for Group Distribution Chart (Summary View)
  const summaryPieData = useMemo(() => {
      return groupStats
        .filter(g => g.marketValue > 0)
        .map(g => ({ name: g.name, value: g.marketValue }));
  }, [groupStats]);

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
    <div className="space-y-4 pb-24">
      
      {/* Navigation / Mode Switcher */}
      <div className="px-4 pt-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
         <button 
             onClick={() => handleGroupTabClick('all')}
             className={`whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-bold transition ${
                 currentGroupId === 'all' && !isSummary
                 ? 'bg-slate-800 text-white shadow-md dark:bg-white dark:text-slate-900' 
                 : 'bg-white text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
             }`}
         >
             全部持仓
         </button>
         
         <button 
             onClick={handleSummaryClick}
             className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1 ${
                 isSummary
                 ? 'bg-indigo-600 text-white shadow-md border border-indigo-600'
                 : 'bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800'
             }`}
         >
             <LayoutDashboard size={12} /> 汇总视图
         </button>

         {groups.map(g => (
             <button
                 key={g.id}
                 onClick={() => handleGroupTabClick(g.id)}
                 className={`whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-bold transition ${
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
            className="whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-slate-400 border border-transparent hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center gap-1"
         >
             <Settings2 size={12} />
         </button>
      </div>

      {/* Asset Card - Glassmorphism Style */}
      <div className="mx-4 relative overflow-hidden rounded-2xl shadow-xl transition-all duration-300 group">
        <div className={`absolute inset-0 ${
             isSummary 
             ? 'bg-gradient-to-br from-indigo-600 via-purple-700 to-indigo-800' 
             : 'bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800'
        }`}></div>
        
        {/* Decorative Circles */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>

        <div className="relative p-6 text-white">
            <div className="flex justify-between items-start mb-3">
            <span className="text-white/80 text-sm font-medium flex items-center gap-1 backdrop-blur-sm bg-white/10 px-2 py-0.5 rounded-lg">
                {isSummary ? <><LayoutDashboard size={14}/> 多账户总资产</> : (currentGroupId === 'all' ? '总资产' : groups.find(g => g.id === currentGroupId)?.name || '分组资产')}
            </span>
            <div 
                className="bg-white/20 p-2 rounded-full cursor-pointer hover:bg-white/30 transition active:scale-90 backdrop-blur-md" 
                onClick={onRefresh}
            >
                <RefreshCw size={16} className={`text-white ${isRefreshing ? 'animate-spin' : ''}`} />
            </div>
            </div>
            
            <div className="text-4xl font-black mb-6 tracking-tight flex items-baseline gap-1">
                <span className="text-2xl font-normal opacity-80">¥</span>
                {formatMoney(totalMarketValue)}
            </div>

            <div className="grid grid-cols-2 gap-4 bg-black/10 rounded-xl p-3 backdrop-blur-sm border border-white/5">
                <div>
                    <div className="text-white/70 text-xs mb-1">今日预估盈亏</div>
                    <div className={`text-lg font-bold flex items-center ${totalProfit >= 0 ? 'text-red-300' : 'text-green-300'}`}>
                    {totalProfit > 0 ? '+' : ''}{formatMoney(totalProfit)}
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-white/70 text-xs mb-1">累计持有收益</div>
                    <div className={`text-lg font-bold ${displayTotalReturn >= 0 ? 'text-red-300' : 'text-green-300'}`}>
                    {displayTotalReturn > 0 ? '+' : ''}{formatMoney(displayTotalReturn)}
                    </div>
                </div>
            </div>

            <div className="text-right text-[10px] text-white/40 mt-3 flex justify-between items-center">
                 <span className="flex items-center gap-1">
                    <Zap size={10} className="text-yellow-300"/> 
                    {totalProfit !== 0 ? '盘中估值动态更新' : '等待开盘数据'}
                 </span>
                 <span>{isRefreshing ? '正在同步数据...' : `更新时间: ${lastUpdate.toLocaleTimeString()}`}</span>
            </div>
        </div>
      </div>

      {/* Content List */}
      <div className="px-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              {isSummary ? '分组明细' : (currentGroupId === 'all' ? '持仓列表' : '分组持仓')}
              {!isSummary && funds.length > 0 && (
                  <span className="text-xs font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">{funds.length}</span>
              )}
          </h2>
        </div>

        <div className="space-y-3">
          
          {/* Summary Mode */}
          {isSummary && groupStats.map((group, idx) => (
              <div 
                  key={group.id}
                  onClick={() => handleGroupCardClick(group.id)}
                  className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 hover:shadow-md transition-all cursor-pointer active:scale-[0.99] group relative overflow-hidden"
              >
                  <div className="absolute left-0 top-0 bottom-0 w-1" style={{backgroundColor: SUMMARY_COLORS[idx % SUMMARY_COLORS.length]}}></div>
                  
                  <div className="flex justify-between items-center mb-3 pl-2">
                      <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">{group.name}</h3>
                          <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">{group.count} 只基金</span>
                      </div>
                      <ChevronRight size={18} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 pl-2">
                      <div className="col-span-1">
                          <div className="text-xs text-slate-400 mb-0.5">资产规模</div>
                          <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{formatMoney(group.marketValue)}</div>
                      </div>
                      <div className="col-span-1 text-center">
                          <div className="text-xs text-slate-400 mb-0.5">今日盈亏</div>
                          <div className={`text-sm font-bold ${group.todayProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                              {group.todayProfit > 0 ? '+' : ''}{group.todayProfit.toFixed(0)}
                          </div>
                      </div>
                      <div className="col-span-1 text-right">
                          <div className="text-xs text-slate-400 mb-0.5">累计收益</div>
                          <div className={`text-sm font-bold ${group.totalReturn >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                              {group.totalReturn > 0 ? '+' : ''}{group.totalReturn.toFixed(0)}
                          </div>
                      </div>
                  </div>
              </div>
          ))}

          {/* Funds Mode */}
          {!isSummary && funds.length === 0 && (
              <div className="text-center py-10 text-slate-400 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                  <Users size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">该分组下暂无基金</p>
                  <p className="text-xs mt-1">点击右上角 + 号添加</p>
              </div>
          )}

          {!isSummary && funds.filter(f => f.holdingShares > 0).map((fund) => (
            <div 
                key={fund.id} 
                onClick={() => onFundClick(fund)}
                className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 hover:shadow-md transition-all cursor-pointer active:scale-[0.99] relative"
            >
              {/* Source Indicator */}
              {fund.source === 'holdings_calc' && (
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                     <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                     <span className="text-[9px] text-blue-500 font-bold bg-blue-50 dark:bg-blue-900/30 px-1 rounded">重仓估算</span>
                  </div>
              )}
              {fund.estimatedChangePercent === 0 && fund.lastNavDate === new Date().toISOString().split('T')[0] && (
                   <div className="absolute top-2 right-2">
                     <span className="text-[9px] text-green-600 font-bold bg-green-50 dark:bg-green-900/30 px-1 rounded">真实净值已更新</span>
                  </div>
              )}

              <div className="flex justify-between items-start mb-3 pr-16">
                <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base">{fund.name}</h3>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                    <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono">{fund.code}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <div className="text-xs text-slate-400 mb-0.5">{fund.source === 'holdings_calc' ? '预估净值' : '净值'}</div>
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{fund.estimatedNav.toFixed(4)}</div>
                </div>
                <div className="col-span-1 text-center">
                  <div className="text-xs text-slate-400 mb-0.5">涨跌幅</div>
                  <div className={`text-base font-bold ${fund.estimatedChangePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                    {fund.estimatedChangePercent > 0 ? '+' : ''}{fund.estimatedChangePercent}%
                  </div>
                </div>
                <div className="col-span-1 text-right">
                  <div className="text-xs text-slate-400 mb-0.5">盈亏</div>
                  <div className={`text-sm font-medium ${fund.estimatedProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                    {fund.estimatedProfit > 0 ? '+' : ''}{fund.estimatedProfit.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
