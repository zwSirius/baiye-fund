import React, { useMemo } from 'react';
import { Fund, Group } from '../types';
import { X, TrendingUp, TrendingDown, Users, Wallet } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface GroupSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  funds: Fund[];
  groups: Group[];
}

const COLORS = ['#2563eb', '#ef4444', '#f59e0b', '#22c55e', '#6366f1', '#ec4899'];

export const GroupSummaryModal: React.FC<GroupSummaryModalProps> = ({ isOpen, onClose, funds, groups }) => {
  if (!isOpen) return null;

  // Calculate stats per group
  const groupStats = useMemo(() => {
    return groups.map(group => {
        const groupFunds = funds.filter(f => f.groupId === group.id);
        const marketValue = groupFunds.reduce((acc, f) => acc + (f.estimatedNav * f.holdingShares), 0);
        const todayProfit = groupFunds.reduce((acc, f) => acc + f.estimatedProfit, 0);
        
        let totalReturn = 0;
        groupFunds.forEach(f => {
             const mv = f.estimatedNav * f.holdingShares;
             const cost = f.holdingCost * f.holdingShares;
             totalReturn += (mv - cost + (f.realizedProfit || 0));
        });

        return {
            ...group,
            marketValue,
            todayProfit,
            totalReturn
        };
    }).sort((a, b) => b.marketValue - a.marketValue);
  }, [funds, groups]);

  const totalMarketValue = groupStats.reduce((sum, g) => sum + g.marketValue, 0);
  const totalTodayProfit = groupStats.reduce((sum, g) => sum + g.todayProfit, 0);
  const totalAccumReturn = groupStats.reduce((sum, g) => sum + g.totalReturn, 0);

  const pieData = groupStats.map(g => ({ name: g.name, value: g.marketValue }));

  const formatMoney = (val: number) => {
    return val.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm shadow-2xl z-10 overflow-hidden animate-scale-in flex flex-col max-h-[85vh]">
        <div className="bg-slate-800 dark:bg-slate-950 p-4 text-white flex justify-between items-center">
            <h3 className="font-bold text-lg flex items-center gap-2">
                <Users size={20} className="text-blue-400"/> 资产总览
            </h3>
            <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded-full"><X size={20}/></button>
        </div>

        <div className="overflow-y-auto p-6 flex-1">
             {/* Total Aggregated */}
             <div className="text-center mb-8">
                <div className="text-sm text-slate-400 mb-1">所有分组总资产</div>
                <div className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">
                    ¥{totalMarketValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="flex justify-center gap-6 mt-4">
                    <div>
                        <div className="text-xs text-slate-400">今日盈亏</div>
                        <div className={`text-sm font-bold ${totalTodayProfit >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                            {totalTodayProfit > 0 ? '+' : ''}{totalTodayProfit.toFixed(2)}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-slate-400">累计收益</div>
                        <div className={`text-sm font-bold ${totalAccumReturn >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                            {totalAccumReturn > 0 ? '+' : ''}{totalAccumReturn.toFixed(2)}
                        </div>
                    </div>
                </div>
             </div>

             {/* Chart */}
             <div className="h-40 relative mb-6">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={40}
                            outerRadius={60}
                            paddingAngle={5}
                            dataKey="value"
                            stroke="none"
                        >
                            {pieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip 
                           contentStyle={{borderRadius: '8px', border: 'none'}}
                           formatter={(value: number) => `¥${formatMoney(value)}`}
                        />
                    </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <Wallet size={24} className="text-slate-300 opacity-50" />
                </div>
             </div>

             {/* Group Details */}
             <div className="space-y-3">
                 {groupStats.map((g, idx) => (
                     <div key={g.id} className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                         <div className="flex justify-between items-center mb-2">
                             <div className="flex items-center gap-2">
                                 <span className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS[idx % COLORS.length]}}></span>
                                 <span className="font-bold text-slate-700 dark:text-slate-200">{g.name}</span>
                             </div>
                             <span className="font-bold text-slate-800 dark:text-slate-100">¥{formatMoney(g.marketValue)}</span>
                         </div>
                         <div className="flex justify-between text-xs">
                             <span className="text-slate-400">今日: <span className={g.todayProfit >= 0 ? 'text-up-red' : 'text-down-green'}>{g.todayProfit > 0 ? '+' : ''}{g.todayProfit.toFixed(0)}</span></span>
                             <span className="text-slate-400">累计: <span className={g.totalReturn >= 0 ? 'text-up-red' : 'text-down-green'}>{g.totalReturn > 0 ? '+' : ''}{g.totalReturn.toFixed(0)}</span></span>
                         </div>
                     </div>
                 ))}
             </div>
        </div>
      </div>
    </div>
  );
};