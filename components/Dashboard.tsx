import React, { useState, useMemo } from 'react';
import { Fund, Group } from '../types';
import { TrendingUp, TrendingDown, RefreshCw, PieChart as PieChartIcon, Settings2, Users, LayoutDashboard, ChevronRight, ArrowRight } from 'lucide-react';
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

      {/* Asset Card */}
      <div className={`rounded-2xl p-6 text-white shadow-lg mx-4 transition-all duration-300 ${
          isSummary
          ? 'bg-gradient-to-r from-indigo-600 to-purple-700 dark:from-indigo-900 dark:to-purple-950'
          : 'bg-gradient-to-r from-blue-600 to-blue-800 dark:from-blue-900 dark:to-slate-900'
      }`}>
        <div className="flex justify-between items-start mb-2">
          <span className="text-white/80 text-sm font-medium flex items-center gap-1">
             {isSummary ? <><LayoutDashboard size={14}/> 多账户总资产</> : (currentGroupId === 'all' ? '总资产' : groups.find(g => g.id === currentGroupId)?.name || '分组资产')} (元)
          </span>
          <div 
             className="bg-white/20 p-1.5 rounded-full cursor-pointer hover:bg-white/30 transition active:scale-90" 
             onClick={onRefresh}
          >
             <RefreshCw size={16} className={`text-white ${isRefreshing ? 'animate-spin' : ''}`} />
          </div>
        </div>
        <div className="text-3xl font-bold mb-4 tracking-tight">
          {formatMoney(totalMarketValue)}
        </div>
        <div className="flex items-center space-x-6">
          <div>
            <div className="text-white/70 text-xs mb-1">今日预估盈亏</div>
            <div className={`text-lg font-semibold flex items-center ${totalProfit >= 0 ? 'text-red-200' : 'text-green-200'}`}>
              {totalProfit > 0 ? '+' : ''}{formatMoney(totalProfit)}
              {totalProfit >= 0 ? <TrendingUp size={16} className="ml-1" /> : <TrendingDown size={16} className="ml-1" />}
            </div>
          </div>
          <div>
            <div className="text-white/70 text-xs mb-1">累计总收益</div>
            <div className={`text-lg font-semibold flex items-center ${displayTotalReturn >= 0 ? 'text-red-200' : 'text-green-200'}`}>
              {displayTotalReturn > 0 ? '+' : ''}{formatMoney(displayTotalReturn)}
            </div>
          </div>
        </div>
        <div className="text-right text-[10px] text-white/50 mt-2 opacity-80 flex justify-end items-center gap-1">
          <span>{isRefreshing ? '正在同步数据...' : `更新时间: ${lastUpdate.toLocaleTimeString()}`}</span>
        </div>
      </div>

      {/* Charts Section */}
      {!isSummary && allocationData.length > 0 && (
          <div className="bg-white dark:bg-slate-900 mx-4 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between transition-colors">
              <div className="w-32 h-32 relative">
                  <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                          <Pie
                              data={allocationData}
                              cx="50%"
                              cy="50%"
                              innerRadius={35}
                              outerRadius={55}
                              paddingAngle={2}
                              dataKey="value"
                              stroke="none"
                          >
                              {allocationData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={TAG_COLORS[entry.name] || TAG_COLORS['其他']} />
                              ))}
                          </Pie>
                      </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <PieChartIcon size={16} className="text-slate-400 opacity-50" />
                  </div>
              </div>
              <div className="flex-1 ml-6 space-y-2">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">资产配置分布</h3>
                  {allocationData.slice(0, 3).map((item) => (
                      <div key={item.name} className="flex items-center justify-between text-xs">
                           <div className="flex items-center gap-2">
                               <span className="w-2 h-2 rounded-full" style={{backgroundColor: TAG_COLORS[item.name] || '#94a3b8'}}></span>
                               <span className="text-slate-600 dark:text-slate-300">{item.name}</span>
                           </div>
                           <span className="font-bold text-slate-700 dark:text-slate-200">{Math.round((item.value / totalMarketValue) * 100)}%</span>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {isSummary && summaryPieData.length > 0 && (
           <div className="bg-white dark:bg-slate-900 mx-4 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between transition-colors">
               <div className="w-32 h-32 relative">
                   <ResponsiveContainer width="100%" height="100%">
                       <PieChart>
                           <Pie
                               data={summaryPieData}
                               cx="50%"
                               cy="50%"
                               innerRadius={35}
                               outerRadius={55}
                               paddingAngle={2}
                               dataKey="value"
                               stroke="none"
                           >
                               {summaryPieData.map((entry, index) => (
                                   <Cell key={`cell-${index}`} fill={SUMMARY_COLORS[index % SUMMARY_COLORS.length]} />
                               ))}
                           </Pie>
                       </PieChart>
                   </ResponsiveContainer>
                   <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                       <Users size={16} className="text-slate-400 opacity-50" />
                   </div>
               </div>
               <div className="flex-1 ml-6 space-y-2">
                   <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">分组资产占比</h3>
                   {summaryPieData.slice(0, 3).map((item, index) => (
                       <div key={item.name} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full" style={{backgroundColor: SUMMARY_COLORS[index % SUMMARY_COLORS.length]}}></span>
                                <span className="text-slate-600 dark:text-slate-300">{item.name}</span>
                            </div>
                            <span className="font-bold text-slate-700 dark:text-slate-200">{Math.round((item.value / totalMarketValue) * 100)}%</span>
                       </div>
                   ))}
               </div>
           </div>
      )}

      {/* Content List */}
      <div className="px-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {isSummary ? '分组明细' : (currentGroupId === 'all' ? '所有持仓' : '分组持仓')}
          </h2>
          {!isSummary && (
             <span className={`text-xs px-2 py-1 rounded-md transition ${isRefreshing ? 'text-blue-500 bg-blue-50' : 'text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-800'}`}>
                 {isRefreshing ? '同步云端数据...' : '点击卡片上方按钮刷新'}
             </span>
          )}
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
                className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 hover:shadow-md transition-all cursor-pointer active:scale-[0.99]"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base">{fund.name}</h3>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                    <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{fund.code}</span>
                    {currentGroupId === 'all' && (
                        <span className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-800">
                            {groups.find(g => g.id === fund.groupId)?.name}
                        </span>
                    )}
                  </div>
                </div>
                <button 
                    onClick={(e) => {
                        e.stopPropagation(); 
                        onAnalyze(fund);
                    }} 
                    className="text-blue-500 p-2 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-full"
                >
                    <PieChartIcon size={20} />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <div className="text-xs text-slate-400 mb-0.5">预估净值</div>
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{fund.estimatedNav.toFixed(4)}</div>
                </div>
                <div className="col-span-1 text-center">
                  <div className="text-xs text-slate-400 mb-0.5">预估涨跌</div>
                  <div className={`text-base font-bold ${fund.estimatedChangePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                    {fund.estimatedChangePercent > 0 ? '+' : ''}{fund.estimatedChangePercent}%
                  </div>
                </div>
                <div className="col-span-1 text-right">
                  <div className="text-xs text-slate-400 mb-0.5">预估盈亏</div>
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