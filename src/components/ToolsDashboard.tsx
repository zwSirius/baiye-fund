import React, { useState, useEffect, useMemo } from 'react';
import { Fund, Transaction } from '../types';
import { Calendar, History, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { BacktestDashboard } from './BacktestDashboard';
import { getFundHistoryData } from '../services/fundService';

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

// --- 真实收益日历 (基于交易记录) ---
const ProfitCalendar = ({ funds }: { funds: Fund[] }) => {
    const [view, setView] = useState<'DAY' | 'WEEK' | 'MONTH' | 'YEAR'>('DAY');
    const [chartData, setChartData] = useState<any[]>([]);
    const [totalProfit, setTotalProfit] = useState(0);
    const [loading, setLoading] = useState(false);

    // 筛选出持有份额大于0的基金
    const holdingFunds = useMemo(() => funds.filter(f => f.holdingShares > 0), [funds]);

    useEffect(() => {
        const calculateHistory = async () => {
            if (holdingFunds.length === 0) {
                setChartData([]);
                setTotalProfit(0);
                return;
            }

            setLoading(true);
            try {
                // 1. 获取历史净值
                const historyPromises = holdingFunds.map(async (fund) => {
                    const history = await getFundHistoryData(fund.code);
                    return { fund, history };
                });

                const fundsData = await Promise.all(historyPromises);

                // 2. 每日收益聚合 Map
                const dailyProfits: { [date: string]: number } = {};
                
                // 处理“今日”预估收益 (因为历史数据通常截止到昨天)
                const today = new Date();
                const todayStr = today.toISOString().split('T')[0];
                let todayTotal = 0;
                holdingFunds.forEach(f => todayTotal += f.estimatedProfit);
                dailyProfits[todayStr] = todayTotal;

                // 3. 回溯计算
                fundsData.forEach(({ fund, history }) => {
                    if (!history || history.length < 2) return;
                    
                    // 按照日期升序排列
                    const sortedHistory = history.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
                    
                    // 获取该基金的交易记录，按日期升序
                    const transactions = (fund.transactions || []).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                    
                    // 如果没有交易记录，跳过回溯（无法确定开始时间）
                    if (transactions.length === 0) return;

                    // 确定回溯起点：第一笔交易的日期
                    const startTxDateStr = transactions[0].date;
                    const startTxDate = new Date(startTxDateStr);

                    // 动态持仓份额
                    let currentShares = 0;
                    let txIndex = 0;

                    // 遍历历史净值，从列表头开始
                    for (let i = 1; i < sortedHistory.length; i++) {
                        const currDay = sortedHistory[i];
                        const prevDay = sortedHistory[i-1];
                        const currDateObj = new Date(currDay.date);

                        // 关键：只有当日期 >= 第一笔交易日期时，才开始计算盈亏
                        if (currDateObj < startTxDate) continue;

                        // 更新截止到当前日期的持仓份额
                        // 处理所有日期 <= currDay.date 的交易
                        while(txIndex < transactions.length) {
                            const tx = transactions[txIndex];
                            const txDate = new Date(tx.date);
                            
                            // 注意：这里假设交易是收盘确认，即当天净值变动对新买入份额生效？
                            // 通常 T 日买入，T+1 确认。
                            // 为了简化体验：假设交易日当天就持有该份额享受当日涨跌（或者反之）。
                            // 这里采用：只要交易日期 <= 当前日期，就算持仓。
                            if (txDate <= currDateObj) {
                                if (tx.type === 'BUY') {
                                    currentShares += tx.shares;
                                } else {
                                    currentShares -= tx.shares;
                                }
                                txIndex++;
                            } else {
                                break;
                            }
                        }

                        // 如果当天持有份额 > 0，计算当日盈亏
                        if (currentShares > 0) {
                            const dayProfit = (currDay.value - prevDay.value) * currentShares;
                            if (dailyProfits[currDay.date]) {
                                dailyProfits[currDay.date] += dayProfit;
                            } else {
                                dailyProfits[currDay.date] = dayProfit;
                            }
                        }
                    }
                });

                // 4. 聚合数据
                const aggregatedData: any[] = [];
                let aggregatedTotal = 0;
                
                if (view === 'DAY') {
                    for (let i = 13; i >= 0; i--) {
                        const d = new Date();
                        d.setDate(d.getDate() - i);
                        const dStr = d.toISOString().split('T')[0];
                        const val = dailyProfits[dStr] || 0;
                        aggregatedData.push({
                            name: `${d.getMonth() + 1}-${d.getDate()}`,
                            fullDate: dStr,
                            value: Math.round(val)
                        });
                        aggregatedTotal += val;
                    }
                } else if (view === 'WEEK') {
                     const weekMap: {[key: string]: number} = {};
                     const weeks: string[] = [];
                     
                     for (let i = 0; i < 60; i++) {
                         const d = new Date();
                         d.setDate(d.getDate() - i);
                         const dStr = d.toISOString().split('T')[0];
                         const val = dailyProfits[dStr] || 0;
                         
                         const weekIdx = Math.floor(i / 7);
                         if (weekIdx >= 8) break;
                         
                         const key = weekIdx === 0 ? '本周' : `前${weekIdx}周`;
                         if (!weekMap[key]) {
                             weekMap[key] = 0;
                             if (!weeks.includes(key)) weeks.push(key);
                         }
                         weekMap[key] += val;
                     }
                     
                     for (let i = weeks.length - 1; i >= 0; i--) {
                         const w = weeks[i];
                         aggregatedData.push({ name: w, value: Math.round(weekMap[w]) });
                     }
                } else if (view === 'MONTH') {
                    for (let i = 11; i >= 0; i--) {
                        const d = new Date();
                        d.setMonth(d.getMonth() - i);
                        const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                        const name = `${d.getMonth() + 1}月`;
                        let monthSum = 0;
                        Object.keys(dailyProfits).forEach(date => {
                            if (date.startsWith(key)) monthSum += dailyProfits[date];
                        });
                        aggregatedData.push({ name, value: Math.round(monthSum) });
                    }
                } else if (view === 'YEAR') {
                    for (let i = 4; i >= 0; i--) {
                        const d = new Date();
                        const year = d.getFullYear() - i;
                        let yearSum = 0;
                         Object.keys(dailyProfits).forEach(date => {
                            if (date.startsWith(year.toString())) yearSum += dailyProfits[date];
                        });
                         aggregatedData.push({ name: year.toString(), value: Math.round(yearSum) });
                    }
                }

                setChartData(aggregatedData);
                if (aggregatedData.length > 0) {
                     setTotalProfit(aggregatedData[aggregatedData.length - 1].value);
                } else {
                     setTotalProfit(0);
                }

            } catch (e) {
                console.error("Calc history failed", e);
            } finally {
                setLoading(false);
            }
        };

        calculateHistory();
    }, [holdingFunds, view]);

    const labelMap = {
        'DAY': '当日收益',
        'WEEK': '本周收益',
        'MONTH': '本月收益',
        'YEAR': '本年收益'
    };

    return (
        <div className="space-y-4 animate-slide-up">
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

            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
                {loading && <div className="absolute top-2 right-2"><Loader2 className="animate-spin opacity-50" size={16}/></div>}
                <div className="text-indigo-100 text-xs mb-1">{labelMap[view]} (基于交易记录)</div>
                <div className="text-3xl font-bold flex items-center gap-2">
                    {totalProfit > 0 ? '+' : ''}{totalProfit.toLocaleString()} <span className="text-sm font-normal opacity-80">元</span>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 h-64 relative">
                {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs">
                        <Loader2 className="animate-spin mr-2" size={16}/> 计算收益历史...
                    </div>
                ) : (
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
                )}
            </div>
            
            <div className="text-xs text-slate-400 text-center px-4">
                * 仅统计添加持仓后的收益情况，添加前的历史波动不计入。
            </div>
        </div>
    );
};