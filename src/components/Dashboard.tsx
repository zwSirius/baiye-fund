
import React, { useState, useMemo, useEffect } from 'react';
import { Fund, Group } from '../types';
import { RefreshCw, LayoutDashboard, ChevronRight, Zap, Clock, Moon, Coffee, Plus, Wallet, Gem, BarChart3, Binary, ShieldCheck, Microscope } from 'lucide-react';

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

const SourceBadge = ({ source }: { source?: string }) => {
    if (!source) return null;
    
    // LV1: Official
    if (source.includes('LV1')) {
         return <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border border-transparent bg-green-50 text-green-600 dark:bg-green-900/30"><ShieldCheck size={10} /> 官方估值</span>;
    }
    // LV2: Proxy
    if (source.includes('LV2')) {
         return <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border border-transparent bg-indigo-50 text-indigo-500 dark:bg-indigo-900/30"><Zap size={10} /> 场内映射</span>;
    }
    // LV3: Holdings
    if (source.includes('LV3')) {
         return <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border border-transparent bg-blue-50 text-blue-500 dark:bg-blue-900/30"><Microscope size={10} /> 重仓穿透</span>;
    }
    // LV4: None
    return null;
};

const MarketStatus = () => {
    const [status, setStatus] = useState<{label: string, icon: any, color: string}>({label: '...', icon: Clock, color: 'text-slate-400'});
    useEffect(() => {
        const check = () => {
            const now = new Date();
            const day = now.getDay();
            const hour = now.getHours();
            const min = now.getMinutes();
            const timeVal = hour * 60 + min;
            if (day === 0 || day === 6) setStatus({label: '周末休市', icon: Moon, color: 'text-blue-400'});
            else if (timeVal < 570) setStatus({label: '等待开盘', icon: Coffee, color: 'text-orange-400'});
            else if ((timeVal >= 570 && timeVal < 690) || (timeVal >= 780 && timeVal < 900)) setStatus({label: '盘中交易', icon: Zap, color: 'text-green-500 animate-pulse'});
            else if (timeVal >= 690 && timeVal < 780) setStatus({label: '午间休市', icon: Coffee, color: 'text-slate-400'});
            else setStatus({label: '已收盘', icon: Moon, color: 'text-blue-400'});
        };
        check();
        const itv = setInterval(check, 60000);
        return () => clearInterval(itv);
    }, []);
    return (
        <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 ${status.color}`}>
            <status.icon size={10} />
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
        const gFunds = funds.filter(f => f.groupId === group.id && f.holdingShares > 0);
        const mv = gFunds.reduce((acc, f) => acc + (f.estimatedNav * f.holdingShares), 0);
        const tp = gFunds.reduce((acc, f) => acc + f.estimatedProfit, 0);
        const tr = gFunds.reduce((acc, f) => acc + ((f.estimatedNav - f.holdingCost) * f.holdingShares + (f.realizedProfit || 0)), 0);
        return { ...group, marketValue: mv, todayProfit: tp, totalReturn: tr, count: gFunds.length };
    }).sort((a, b) => b.marketValue - a.marketValue);
  }, [funds, groups]);

  const displayTotalReturn = useMemo(() => {
      const targetFunds = currentGroupId === 'all' 
          ? funds.filter(f => !f.isWatchlist && f.holdingShares > 0)
          : funds.filter(f => !f.isWatchlist && f.holdingShares > 0 && f.groupId === currentGroupId);
      return targetFunds.reduce((acc, f) => acc + ((f.estimatedNav - f.holdingCost) * f.holdingShares + (f.realizedProfit || 0)), 0);
  }, [funds, currentGroupId]);

  const isSummary = viewMode === 'SUMMARY';

  return (
    <div className="space-y-3 pb-24">
      {/* Group Tabs */}
      <div className="px-4 pt-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
         <button onClick={() => setViewMode('SUMMARY')} className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1 flex-shrink-0 ${isSummary ? 'bg-indigo-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-slate-500 border dark:border-slate-700'}`}><LayoutDashboard size={12}/> 汇总</button>
         <button onClick={() => { setViewMode('FUNDS'); onGroupChange('all'); }} className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex-shrink-0 ${currentGroupId === 'all' && !isSummary ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-white dark:bg-slate-800 text-slate-500 border dark:border-slate-700'}`}>全部</button>
         {groups.map(g => (
             <button key={g.id} onClick={() => { setViewMode('FUNDS'); onGroupChange(g.id); }} className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition flex-shrink-0 ${currentGroupId === g.id && !isSummary ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border dark:border-slate-700'}`}>{g.name}</button>
         ))}
         <button onClick={onManageGroups} className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400"><Plus size={16}/></button>
      </div>

      {/* Asset Card */}
      <div className={`mx-3 relative overflow-hidden rounded-2xl shadow-xl p-5 text-white transition-all duration-500 ${isSummary ? 'bg-gradient-to-br from-indigo-600 to-purple-700' : 'bg-gradient-to-br from-blue-600 to-indigo-800'}`}>
        <div className="flex justify-between items-center mb-4">
            <span className="text-white/80 text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded-lg flex items-center gap-1">
                {isSummary ? <><LayoutDashboard size={12}/> 多账户汇总</> : (currentGroupId === 'all' ? '总资产' : groups.find(g => g.id === currentGroupId)?.name)}
            </span>
            <div className="flex items-center gap-2">
                <MarketStatus />
                <button onClick={onRefresh} className="bg-white/20 p-1.5 rounded-full active:scale-90"><RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''}/></button>
            </div>
        </div>
        
        <div className="text-3xl font-black mb-5 tracking-tighter">
            <span className="text-lg font-normal opacity-60 mr-1">¥</span>
            {isRefreshing ? '......' : formatMoney(totalMarketValue, isPrivacyMode)}
        </div>

        <div className="grid grid-cols-2 gap-4 bg-black/10 rounded-xl p-3 backdrop-blur-sm">
            <div>
                <div className="text-white/60 text-[10px] mb-1">今日预估</div>
                <div className={`text-base font-bold ${totalProfit >= 0 ? 'text-red-300' : 'text-green-300'}`}>{formatMoney(totalProfit, isPrivacyMode)}</div>
            </div>
            <div className="text-right">
                <div className="text-white/60 text-[10px] mb-1">持有收益</div>
                <div className={`text-base font-bold ${displayTotalReturn >= 0 ? 'text-red-300' : 'text-green-300'}`}>{formatMoney(displayTotalReturn, isPrivacyMode)}</div>
            </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-3 space-y-2.5">
          {isSummary ? groupStats.map(group => (
              <div key={group.id} onClick={() => { onGroupChange(group.id); setViewMode('FUNDS'); }} className="bg-white dark:bg-slate-900 rounded-xl p-3 border dark:border-slate-800 flex justify-between items-center cursor-pointer active:scale-98 transition shadow-sm">
                  <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-500"><Wallet size={20}/></div>
                      <div>
                          <div className="font-bold text-sm">{group.name}</div>
                          <div className="text-[10px] text-slate-400">{group.count} 只基金</div>
                      </div>
                  </div>
                  <div className="text-right">
                      <div className="text-sm font-black">{formatMoney(group.marketValue, isPrivacyMode)}</div>
                      <div className={`text-[10px] font-bold ${group.todayProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>{group.todayProfit > 0 ? '+' : ''}{group.todayProfit.toFixed(0)}</div>
                  </div>
              </div>
          )) : funds.filter(f => !f.isWatchlist && f.holdingShares > 0 && (currentGroupId === 'all' || f.groupId === currentGroupId)).map(fund => (
              <div key={fund.id} onClick={() => onFundClick(fund)} className="bg-white dark:bg-slate-900 rounded-xl p-3 border dark:border-slate-800 shadow-sm active:scale-98 transition cursor-pointer">
                  <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 overflow-hidden mr-2">
                          <div className="flex items-center gap-2 mb-0.5">
                              <h3 className="font-bold text-sm truncate">{fund.name}</h3>
                              <SourceBadge source={fund.source} />
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{fund.code}</div>
                      </div>
                      <div className={`text-base font-black ${fund.estimatedChangePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>{fund.estimatedChangePercent > 0 ? '+' : ''}{fund.estimatedChangePercent}%</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t dark:border-slate-800">
                      <div>
                          <div className="text-[10px] text-slate-400">持仓</div>
                          <div className="text-xs font-bold">{formatMoney(fund.estimatedNav * fund.holdingShares, isPrivacyMode)}</div>
                      </div>
                      <div className="text-center">
                          <div className="text-[10px] text-slate-400">今日</div>
                          <div className={`text-xs font-bold ${fund.estimatedProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>{isPrivacyMode ? '****' : fund.estimatedProfit.toFixed(1)}</div>
                      </div>
                      <div className="text-right">
                          <div className="text-[10px] text-slate-400">收益</div>
                          <div className={`text-xs font-bold ${((fund.estimatedNav - fund.holdingCost) * fund.holdingShares + (fund.realizedProfit || 0)) >= 0 ? 'text-up-red' : 'text-down-green'}`}>{isPrivacyMode ? '****' : ((fund.estimatedNav - fund.holdingCost) * fund.holdingShares + (fund.realizedProfit || 0)).toFixed(1)}</div>
                      </div>
                  </div>
              </div>
          ))}
      </div>
    </div>
  );
};
