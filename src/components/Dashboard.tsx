
import React, { useState, useMemo, useEffect } from 'react';
import { Fund, Group } from '../types';
import { RefreshCw, LayoutDashboard, Zap, Clock, Moon, Coffee, Plus, ArrowRight } from 'lucide-react';

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
                setStatus({label: '周末休市', icon: Moon, color: 'text-indigo-200 bg-indigo-500/20'});
                return;
            }
            if (timeVal < 570) setStatus({label: '等待开盘', icon: Coffee, color: 'text-orange-200 bg-orange-500/20'});
            else if (timeVal >= 570 && timeVal < 690) setStatus({label: '盘中', icon: Zap, color: 'text-emerald-200 bg-emerald-500/20 animate-pulse'});
            else if (timeVal >= 690 && timeVal < 780) setStatus({label: '休市', icon: Coffee, color: 'text-slate-200 bg-slate-500/20'});
            else if (timeVal >= 780 && timeVal < 900) setStatus({label: '盘中', icon: Zap, color: 'text-emerald-200 bg-emerald-500/20 animate-pulse'});
            else setStatus({label: '收盘', icon: Moon, color: 'text-indigo-200 bg-indigo-500/20'});
        };
        checkStatus();
        const interval = setInterval(checkStatus, 60000);
        return () => clearInterval(interval);
    }, []);
    const Icon = status.icon;
    return (
        <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/10 ${status.color}`}>
            <Icon size={10} /><span>{status.label}</span>
        </div>
    );
};

export const Dashboard: React.FC<DashboardProps> = ({ 
    funds, groups, currentGroupId, totalMarketValue, totalProfit, lastUpdate, isRefreshing, isPrivacyMode,
    onRefresh, onFundClick, onGroupChange, onManageGroups
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
        return { ...group, marketValue, todayProfit, totalReturn: totalRet, count: groupFunds.length };
    }).sort((a, b) => b.marketValue - a.marketValue);
  }, [funds, groups]);

  const displayTotalReturn = useMemo(() => {
      let ret = 0;
      funds.forEach(f => {
          const mv = f.estimatedNav * f.holdingShares;
          const cv = f.holdingCost * f.holdingShares;
          ret += (mv - cv + (f.realizedProfit || 0));
      });
      return ret;
  }, [funds]);

  const handleGroupTabClick = (groupId: string) => { setViewMode('FUNDS'); onGroupChange(groupId); };
  const handleSummaryClick = () => { if (currentGroupId !== 'all') onGroupChange('all'); setViewMode('SUMMARY'); };

  return (
    <div className="space-y-4 pb-24">
      {/* Tabs */}
      <div className="px-4 pt-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
         <button onClick={handleSummaryClick} className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 ${viewMode === 'SUMMARY' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700'}`}><LayoutDashboard size={14} /> 汇总</button>
         <button onClick={() => handleGroupTabClick('all')} className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex-shrink-0 ${currentGroupId === 'all' && viewMode !== 'SUMMARY' ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-white text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700'}`}>全部</button>
         {groups.map(g => (
             <button key={g.id} onClick={() => handleGroupTabClick(g.id)} className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex-shrink-0 ${currentGroupId === g.id && viewMode !== 'SUMMARY' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700'}`}>{g.name}</button>
         ))}
         <button onClick={onManageGroups} className="whitespace-nowrap w-7 h-7 flex items-center justify-center rounded-full text-xs bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"><Plus size={14} /></button>
      </div>

      {/* Asset Card */}
      <div className="mx-4 relative overflow-hidden rounded-xl shadow-lg ring-1 ring-white/10 bg-gradient-to-br from-blue-600 to-indigo-800">
        <div className="relative p-4 text-white">
            <div className="flex justify-between items-center mb-2">
                <span className="text-white/80 text-[10px] font-semibold bg-white/10 px-2 py-0.5 rounded-full border border-white/5">
                    {viewMode === 'SUMMARY' ? '多账户汇总' : (currentGroupId === 'all' ? '总资产' : groups.find(g => g.id === currentGroupId)?.name)}
                </span>
                <div className="flex items-center gap-2"><MarketStatus /><button onClick={onRefresh} className="p-1 rounded-full hover:bg-white/20"><RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} /></button></div>
            </div>
            <div className="flex items-baseline gap-1 mb-3">
                <span className="text-sm font-medium opacity-70">{isPrivacyMode ? '' : '¥'}</span>
                <span className="text-2xl font-black">{isRefreshing ? '---' : formatMoney(totalMarketValue, isPrivacyMode)}</span>
            </div>
            <div className="flex gap-2">
                <div className="flex-1 bg-black/20 rounded-lg p-2 backdrop-blur-md border border-white/5">
                    <div className="text-white/60 text-[10px] mb-0.5">今日预估</div>
                    <div className={`text-sm font-bold ${totalProfit >= 0 ? 'text-red-200' : 'text-emerald-200'}`}>{!isPrivacyMode && totalProfit > 0 ? '+' : ''}{isRefreshing ? '--' : formatMoney(totalProfit, isPrivacyMode)}</div>
                </div>
                <div className="flex-1 bg-black/20 rounded-lg p-2 backdrop-blur-md border border-white/5">
                    <div className="text-white/60 text-[10px] mb-0.5">累计收益</div>
                    <div className={`text-sm font-bold ${displayTotalReturn >= 0 ? 'text-red-200' : 'text-emerald-200'}`}>{!isPrivacyMode && displayTotalReturn > 0 ? '+' : ''}{isRefreshing ? '--' : formatMoney(displayTotalReturn, isPrivacyMode)}</div>
                </div>
            </div>
            <div className="flex justify-end mt-2"><span className="text-[9px] text-white/50">更新: {lastUpdate.toLocaleTimeString()}</span></div>
        </div>
      </div>

      {/* List */}
      <div className="px-4 space-y-3">
          {viewMode === 'SUMMARY' && groupStats.map((group, idx) => (
              <div key={group.id} onClick={() => { onGroupChange(group.id); setViewMode('FUNDS'); }} className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border-[0.5px] border-slate-100 dark:border-slate-800 cursor-pointer relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1" style={{backgroundColor: ['#3b82f6', '#f43f5e', '#f59e0b', '#10b981'][idx%4]}}></div>
                  <div className="flex justify-between items-center mb-3 pl-2">
                      <div className="font-bold text-slate-800 dark:text-slate-100">{group.name} <span className="text-[10px] text-slate-400 font-normal">({group.count})</span></div>
                      <ArrowRight size={14} className="text-slate-300"/>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pl-2">
                      <div><div className="text-[9px] text-slate-400">资产</div><div className="text-xs font-bold text-slate-800 dark:text-slate-200">{formatMoney(group.marketValue, isPrivacyMode)}</div></div>
                      <div className="text-center"><div className="text-[9px] text-slate-400">今日</div><div className={`text-xs font-bold ${group.todayProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>{!isPrivacyMode && group.todayProfit > 0 ? '+' : ''}{isPrivacyMode ? '****' : group.todayProfit.toFixed(2)}</div></div>
                      <div className="text-right"><div className="text-[9px] text-slate-400">累计</div><div className={`text-xs font-bold ${group.totalReturn >= 0 ? 'text-up-red' : 'text-down-green'}`}>{!isPrivacyMode && group.totalReturn > 0 ? '+' : ''}{isPrivacyMode ? '****' : group.totalReturn.toFixed(2)}</div></div>
                  </div>
              </div>
          ))}

          {viewMode === 'FUNDS' && funds.filter(f => f.holdingShares > 0).map(fund => {
              const mv = fund.estimatedNav * fund.holdingShares;
              const ret = (fund.estimatedNav - fund.holdingCost) * fund.holdingShares + (fund.realizedProfit || 0);
              return (
                  <div key={fund.id} onClick={() => onFundClick(fund)} className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border-[0.5px] border-slate-100 dark:border-slate-800 active:scale-[0.99] transition cursor-pointer relative">
                      {fund.source === 'official_published' && <div className="absolute top-0 right-0 bg-green-500/10 text-green-600 text-[8px] px-1.5 py-0.5 rounded-bl-lg font-bold">官方公布</div>}
                      {fund.source === 'holdings_calc' && <div className="absolute top-0 right-0 bg-orange-500/10 text-orange-600 text-[8px] px-1.5 py-0.5 rounded-bl-lg font-bold">重仓估算</div>}
                      {fund.source === 'official_data_1' && <div className="absolute top-0 right-0 bg-blue-500/10 text-blue-600 text-[8px] px-1.5 py-0.5 rounded-bl-lg font-bold">官方数据一</div>}
                      {fund.source === 'official_data_2' && <div className="absolute top-0 right-0 bg-purple-500/10 text-purple-600 text-[8px] px-1.5 py-0.5 rounded-bl-lg font-bold">官方数据二</div>}
                      
                      <div className="flex justify-between items-start mb-3">
                          <div>
                              <div className="font-bold text-slate-800 dark:text-slate-100 text-sm mb-1">{fund.name}</div>
                              <div className="text-[10px] text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded inline-block">{fund.code}</div>
                          </div>
                          <div className={`text-lg font-black tracking-tight ${fund.estimatedChangePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                              {fund.estimatedChangePercent > 0 ? '+' : ''}{fund.estimatedChangePercent}%
                          </div>
                      </div>
                      
                      <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg">
                          <div><div className="text-[9px] text-slate-400">持仓</div><div className="text-xs font-bold text-slate-700 dark:text-slate-200">{formatMoney(mv, isPrivacyMode)}</div></div>
                          <div className="text-center"><div className="text-[9px] text-slate-400">当日</div><div className={`text-xs font-bold ${fund.estimatedProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>{!isPrivacyMode && fund.estimatedProfit > 0 ? '+' : ''}{isPrivacyMode ? '****' : fund.estimatedProfit.toFixed(2)}</div></div>
                          <div className="text-right"><div className="text-[9px] text-slate-400">持有</div><div className={`text-xs font-bold ${ret >= 0 ? 'text-up-red' : 'text-down-green'}`}>{!isPrivacyMode && ret > 0 ? '+' : ''}{isPrivacyMode ? '****' : ret.toFixed(2)}</div></div>
                      </div>
                  </div>
              );
          })}
      </div>
    </div>
  );
};
