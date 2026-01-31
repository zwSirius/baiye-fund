import React, { useState, useMemo } from 'react';
import { Fund } from '../types';
import { Calendar, History, TrendingUp, BarChart2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { BacktestDashboard } from './BacktestDashboard';

interface ToolsDashboardProps {
    funds: Fund[];
}

export const ToolsDashboard: React.FC<ToolsDashboardProps> = ({ funds }) => {
    const [activeTool, setActiveTool] = useState<'CALENDAR' | 'BACKTEST'>('CALENDAR');

    return (
        <div className="pb-24 animate-fade-in">
             <div className="bg-white dark:bg-slate-900 sticky top-[72px] z-20 border-b border-slate-100 dark:border-slate-800 px-4 pt-2">
                 <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                     <ToolTab 
                        isActive={activeTool === 'CALENDAR'} 
                        onClick={() => setActiveTool('CALENDAR')} 
                        icon={<Calendar size={16}/>} 
                        label="收益日历"
                     />
                     <ToolTab 
                        isActive={activeTool === 'BACKTEST'} 
                        onClick={() => setActiveTool('BACKTEST')} 
                        icon={<History size={16}/>} 
                        label="组合回测"
                     />
                 </div>
             </div>

             <div className="p-4">
                 {activeTool === 'CALENDAR' && <ProfitCalendar funds={funds} />}
                 {activeTool === 'BACKTEST' && <BacktestDashboard availableFunds={funds} />}
             </div>
        </div>
    );
};

const ToolTab = ({ isActive, onClick, icon, label }: any) => (
    <button 
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition ${
            isActive 
            ? 'bg-blue-600 text-white shadow-md' 
            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
        }`}
    >
        {icon} {label}
    </button>
);

// --- 1. 升级版收益日历 ---
const ProfitCalendar = ({ funds }: { funds: Fund[] }) => {
    const [view, setView] = useState<'DAY' | 'WEEK' | 'MONTH' | 'YEAR'>('DAY');

    // 模拟数据生成器 (因为没有后端历史数据)
    // 实际项目中应从 API 获取 /api/user/profit_history
    const { chartData, totalProfit, label } = useMemo(() => {
        let count = 0;
        let unit = '';
        if (view === 'DAY') { count = 14; unit = '天'; }
        else if (view === 'WEEK') { count = 8; unit = '周'; }
        else if (view === 'MONTH') { count = 12; unit = '月'; }
        else { count = 5; unit = '年'; }

        const res = [];
        let total = 0;
        const now = new Date();

        // 基于当前持仓总盈亏反推波动，仅做展示
        // 假设当前持仓日波动在 -2% ~ 2% 之间
        const totalMarketValue = funds.reduce((acc, f) => acc + f.estimatedNav * f.holdingShares, 0);
        
        for(let i=count-1; i>=0; i--) {
            let dateStr = '';
            let profit = 0;
            
            if (view === 'DAY') {
                const d = new Date(now);
                d.setDate(d.getDate() - i);
                dateStr = `${d.getMonth()+1}-${d.getDate()}`;
            } else if (view === 'WEEK') {
                dateStr = `W${count-i}`;
            } else if (view === 'MONTH') {
                const d = new Date(now);
                d.setMonth(d.getMonth() - i);
                dateStr = `${d.getMonth()+1}月`;
            } else {
                const d = new Date(now);
                d.setFullYear(d.getFullYear() - i);
                dateStr = `${d.getFullYear()}`;
            }

            // 模拟随机数
            const volatility = totalMarketValue * (Math.random() * 0.04 - 0.015); // 偏正收益一点点
            profit = Math.round(volatility);
            if (i === 0) {
                // 今天/本周/本月 用真实/接近真实的计算值
                if (view === 'DAY') profit = Math.round(funds.reduce((acc, f) => acc + f.estimatedProfit, 0));
            }

            res.push({ name: dateStr, value: profit });
            total += profit;
        }
        
        return { chartData: res, totalProfit: total, label: `近${count}${unit}` };
    }, [view, funds]);

    return (
        <div className="space-y-4 animate-slide-up">
            {/* View Switcher */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                {['DAY', 'WEEK', 'MONTH', 'YEAR'].map((v) => (
                    <button
                        key={v}
                        onClick={() => setView(v as any)}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition ${
                            view === v 
                            ? 'bg-white dark:bg-slate-700 shadow text-blue-600 dark:text-blue-400' 
                            : 'text-slate-400'
                        }`}
                    >
                        {v === 'DAY' ? '日' : v === 'WEEK' ? '周' : v === 'MONTH' ? '月' : '年'}
                    </button>
                ))}
            </div>

            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg">
                <div className="text-indigo-100 text-xs mb-1">{label}累计盈亏 (模拟)</div>
                <div className="text-3xl font-bold flex items-center gap-2">
                    {totalProfit > 0 ? '+' : ''}{totalProfit.toLocaleString()} <span className="text-sm font-normal opacity-80">元</span>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                        <XAxis dataKey="name" tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip 
                            cursor={{fill: 'transparent'}}
                            contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'}}
                            formatter={(val: number) => [`${val}元`, '盈亏']}
                        />
                        <Bar dataKey="value" radius={[4, 4, 4, 4]}>
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.value >= 0 ? '#ef4444' : '#22c55e'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            
            <div className="text-xs text-slate-400 text-center">
                * 历史数据基于当前持仓规模模拟，仅供展示交互效果
            </div>
        </div>
    );
};
