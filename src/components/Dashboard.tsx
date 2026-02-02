import React, { useState, useMemo, useEffect } from 'react';
import { Fund, Group } from '../types';
import { RefreshCw, LayoutDashboard, ChevronRight, Zap, Clock, Moon, Coffee, Plus, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';

interface DashboardProps {
  funds: Fund[];
  groups: Group[];
  currentGroupId: string;
  totalProfit: number;
  totalMarketValue: number;
  lastUpdate: Date;
  isRefreshing?: boolean;
  isPrivacyMode: boolean;
  onRefresh: () => void;
  onAnalyze: (fund: Fund) => void;
  onFundClick: (fund: Fund) => void;
  onGroupChange: (groupId: string) => void;
  onManageGroups: () => void;
}

const formatMoney = (val: number, isHidden: boolean) => {
  if (isHidden) return '****';
  return val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const Skeleton = ({ className }: { className: string }) => (
    <div className={`animate-pulse bg-slate-200 dark:bg-slate-700 rounded ${className}`}></div>
);

const MarketStatus = () => {
    const [status, setStatus] = useState<{label: string, icon: any, color: string}>({label: '加载中', icon: Clock, color: 'text-slate-400'});
    
    useEffect(() => {
        const checkStatus = () => {
            const now = new Date();
            const day = now.getDay();
            const hour = now.getHours();
            const min = now.getMinutes();
            const timeVal = hour * 60 + min;

            if (day === 0 || day === 6) {
                setStatus({label: '周末休市', icon: Moon, color: 'text-indigo-200 bg-indigo-500/20 border-indigo-500/30'});
                return;
            }
            
            if (timeVal < 570) {
                 setStatus({label: '等待开盘', icon: Coffee, color: 'text-orange-200 bg-orange-500/20 border-orange-500/30'});
            } else if (timeVal >= 570 && timeVal < 690) {
                 setStatus({label: '盘中', icon: Zap, color: 'text-emerald-200 bg-emerald-500/20 border-emerald-500/30 animate-pulse'});
            } else if (timeVal >= 690 && timeVal < 780) {
                 setStatus({label: '休市', icon: Coffee, color: 'text-slate-200 bg-slate-500/20 border-slate-500/30'});
            } else if (timeVal >= 780 && timeVal < 900) {
                 setStatus({label: '盘中', icon: Zap, color: 'text-emerald-200 bg-emerald-500/20 border-emerald-500/30 animate-pulse'});
            } else {
                 setStatus({label: '收盘', icon: Moon, color: 'text-indigo-200 bg-indigo-500/20 border-indigo-500/30'});
            }
        };
        
        checkStatus();
        const interval = setInterval(checkStatus, 60000);
        return () => clearInterval(interval);
    }, []);

    const Icon = status.icon;

    return (
        <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border backdrop-blur-md transition-colors duration-500 ${status.color}`}>
            <Icon size={10} />
            <span>{status.label}</span>
        </div>
    );
};

export const Dashboard: React.FC<DashboardProps> = ({ 
    funds, groups, currentGroupId, totalProfit, totalMarketValue, lastUpdate, isRefreshing, isPrivacyMode,
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

  // Use the passed in funds to calculate total return for display, instead of all funds globally
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
      
      {/* Tabs */}
      <div className="px-4 pt-2 flex items-center gap-2 overflow-x-auto no-scrollbar mask-gradient-r">
         <button 
             onClick={handleSummaryClick}
             className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 ${
                 isSummary
                 ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900/40'
                 : 'bg-white text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
             }`}
         >
             <LayoutDashboard size={14} /> 汇总
         </button>

         <button 
             onClick={() => handleGroupTabClick('all')}
             className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex-shrink-0 ${
                 currentGroupId === 'all' && !isSummary
                 ? 'bg-slate-800 text-white shadow-lg dark:bg-slate-200 dark:text-slate-900' 
                 : 'bg-white text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
             }`}
         >
             全部
         </button>

         {groups.map(g => (
             <button
                 key={g.id}
                 onClick={() => handleGroupTabClick(g.id)}
                 className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex-shrink-0 ${
                     currentGroupId === g.id && !isSummary
                     ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 dark:shadow-blue-900/40'
                     : 'bg-white text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
                 }`}
             >
                 {g.name}
             </button>
         ))}

         <button
            onClick={onManageGroups}
            className="whitespace-nowrap w-7 h-7 flex items-center justify-center rounded-full text-xs bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition flex-shrink-0"
         >
            <Plus size={14} />
         </button>
      </div>

      {/* Compact Asset Card */}
      <div className="mx-4 relative overflow-hidden rounded-xl shadow-lg transition-all duration-300 group ring-1 ring-white/10">
        <div className={`absolute inset-0 ${
             isSummary 
             ? 'bg-gradient-to-br from-indigo-500 via-purple-600 to-indigo-900' 
             : 'bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-800'
        }`}></div>
        
        {/* Modern Noise Texture */}
        <div className="absolute inset-0 opacity-10 mix-blend-overlay" style={{backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`}}></div>
        
        <div className="relative p-4 text-white">
            <div className="flex justify-between items-center mb-2">
                <span className="text-white/80 text-[10px] font-semibold flex items-center gap-1.5 bg-white/10 px-2 py-0.5 rounded-full border border-white/5">
                    {isSummary ? <><LayoutDashboard size={10}/> 多账户</> : (currentGroupId === 'all' ? '总资产' : groups.find(g => g.id === currentGroupId)?.name || '分组')}
                </span>
                
                <div className="flex items-center gap-2">
                    <MarketStatus />
                    <button 
                        className="p-1.5 rounded-full cursor-pointer hover:bg-white/20 transition active:scale-95" 
                        onClick={onRefresh}
                    >
                        <RefreshCw size={12} className={`text-white ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>
            
            <div className="flex items-baseline gap-1 mb-3">
                <span className="text-sm font-medium opacity-70">{isPrivacyMode ? '' : '¥'}</span>
                <span className="text-2xl font-black tracking-tight drop-shadow-sm">
                    {isRefreshing ? <Skeleton className="h-8 w-32 inline-block bg-white/20 rounded" /> : formatMoney(totalMarketValue, isPrivacyMode)}
                </span>
            </div>

            <div className="flex gap-2">
                <div className="flex-1 bg-black/20 rounded-lg p-2 backdrop-blur-md border border-white/5 hover:bg-black/30 transition">
                    <div className="text-white/60 text-[10px] mb-0.5 font-medium">今日预估</div>
                    <div className={`text-sm font-bold flex items-center gap-1 ${totalProfit >= 0 ? 'text-red-200' : 'text-emerald-200'}`}>
                        {!isPrivacyMode && totalProfit > 0 ? '+' : ''}{isRefreshing ? '--' : formatMoney(totalProfit, isPrivacyMode)}
                    </div>
                </div>
                <div className="flex-1 bg-black/20 rounded-lg p-2 backdrop-blur-md border border-white/5 hover:bg-black/30 transition">
                    <div className="text-white/60 text-[10px] mb-0.5 font-medium">累计收益</div>
                    <div className={`text-sm font-bold flex items-center gap-1 ${displayTotalReturn >= 0 ? 'text-red-200' : 'text-emerald-200'}`}>
                        {!isPrivacyMode && displayTotalReturn > 0 ? '+' : ''}{isRefreshing ? '--' : formatMoney(displayTotalReturn, isPrivacyMode)}
                    </div>
                </div>
            </div>
            
             <div className="absolute bottom-4 right-4 text-[9px] text-white/20 font-medium">
                 {lastUpdate.toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit'})}
            </div>
        </div>
      </div>

      {/* Content List */}
      <div className="px-4">
        
        <div className="space-y-3">
          
          {/* Summary Mode */}
          {isSummary && groupStats.map((group, idx) => (
              <div 
                  key={group.id}
                  onClick={() => handleGroupCardClick(group.id)}
                  className="bg-white dark:bg-slate-900/50 rounded-xl p-3 shadow-sm border border-slate-100 dark:border-slate-800 hover:shadow-md transition-all cursor-pointer active:scale-[0.98] group relative overflow-hidden backdrop-blur-xl"
              >
                  <div className="absolute left-0 top-0 bottom-0 w-1" style={{backgroundColor: SUMMARY_COLORS[idx % SUMMARY_COLORS.length]}}></div>
                  
                  <div className="flex justify-between items-center mb-2 pl-3">
                      <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">{group.name}</h3>
                          <span className="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold px-1.5 py-0.5 rounded-full">{group.count}只</span>
                      </div>
                      <div className="text-slate-300">
                        <ArrowRight size={14} />
                      </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pl-3">
                      <div className="col-span-1">
                          <div className="text-[9px] text-slate-400">资产</div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{formatMoney(group.marketValue, isPrivacyMode)}</div>
                      </div>
                      <div className="col-span-1 text-center">
                          <div className="text-[9px] text-slate-400">今日</div>
                          <div className={`text-xs font-bold ${group.todayProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                              {!isPrivacyMode && group.todayProfit > 0 ? '+' : ''}{isPrivacyMode ? '****' : group.todayProfit.toFixed(0)}
                          </div>
                      </div>
                      <div className="col-span-1 text-right">
                          <div className="text-[9px] text-slate-400">累计</div>
                          <div className={`text-xs font-bold ${group.totalReturn >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                              {!isPrivacyMode && group.totalReturn > 0 ? '+' : ''}{isPrivacyMode ? '****' : group.totalReturn.toFixed(0)}
                          </div>
                      </div>
                  </div>
              </div>
          ))}

          {/* Funds Mode */}
          {!isSummary && funds.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                  <div className="w-12 h-12 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mb-2">
                     <LayoutDashboard size={20} className="opacity-40" />
                  </div>
                  <p className="text-xs font-medium">暂无基金</p>
                  <p className="text-[10px] mt-1 opacity-60">点击右上角 + 号添加</p>
              </div>
          )}

          {!isSummary && funds.filter(f => f.holdingShares > 0).map((fund) => {
             const marketValue = fund.estimatedNav * fund.holdingShares;
             const totalReturn = (fund.estimatedNav - fund.holdingCost) * fund.holdingShares + (fund.realizedProfit || 0);

             return (
                <div 
                    key={fund.id} 
                    onClick={() => onFundClick(fund)}
                    className="bg-white dark:bg-slate-900/80 rounded-xl p-3 shadow-sm border border-slate-100 dark:border-slate-800 hover:shadow-md transition-all cursor-pointer active:scale-[0.98] relative overflow-hidden backdrop-blur-sm group"
                >
                    {/* Source Indicator */}
                    {fund.source === 'holdings_calc_batch' && (
                        <div className="absolute top-0 right-0">
                             <div className="bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[8px] px-1.5 py-0.5 rounded-bl-lg font-bold flex items-center gap-0.5">
                                <Zap size={8} fill="currentColor" /> 估
                             </div>
                        </div>
                    )}

                    <div className="flex justify-between items-center mb-3">
                        <div className="flex-1 min-w-0 pr-4">
                            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-tight mb-0.5 truncate">{fund.name}</h3>
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1 rounded font-mono">{fund.code}</span>
                                {fund.tags && fund.tags[0] && <span className="text-[9px] text-slate-400 border border-slate-100 dark:border-slate-700 px-1 rounded">{fund.tags[0]}</span>}
                            </div>
                        </div>
                        <div className="text-right">
                             <div className={`text-lg font-bold tracking-tight ${fund.estimatedChangePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                {isRefreshing ? <Skeleton className="h-6 w-12 mb-1" /> : (
                                    <>{fund.estimatedChangePercent > 0 ? '+' : ''}{fund.estimatedChangePercent}%</>
                                )}
                             </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg px-2 border border-slate-100 dark:border-slate-700/50">
                        <div className="col-span-1">
                            <div className="text-[9px] text-slate-400 mb-0.5">持仓</div>
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                {isRefreshing ? <Skeleton className="h-3 w-12" /> : formatMoney(marketValue, isPrivacyMode)}
                            </div>
                        </div>
                        <div className="col-span-1 text-center border-l border-slate-200 dark:border-slate-700">
                            <div className="text-[9px] text-slate-400 mb-0.5">当日</div>
                            <div className={`text-xs font-bold ${fund.estimatedProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                {isRefreshing ? <Skeleton className="h-3 w-10 mx-auto" /> : (
                                    <>{!isPrivacyMode && fund.estimatedProfit > 0 ? '+' : ''}{isPrivacyMode ? '****' : fund.estimatedProfit.toFixed(2)}</>
                                )}
                            </div>
                        </div>
                        <div className="col-span-1 text-right border-l border-slate-200 dark:border-slate-700">
                            <div className="text-[9px] text-slate-400 mb-0.5">持有</div>
                            <div className={`text-xs font-bold ${totalReturn >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                {isRefreshing ? <Skeleton className="h-3 w-10 ml-auto" /> : (
                                    <>{!isPrivacyMode && totalReturn > 0 ? '+' : ''}{isPrivacyMode ? '****' : totalReturn.toFixed(2)}</>
                                )}
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

const SUMMARY_COLORS = ['#3b82f6', '#f43f5e', '#f59e0b', '#10b981', '#6366f1', '#ec4899'];