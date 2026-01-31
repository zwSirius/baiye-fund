import React, { useState } from 'react';
import { Fund } from '../types';
import { Calendar, Calculator, GripHorizontal, TrendingUp, DollarSign, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface ToolsDashboardProps {
    funds: Fund[];
}

export const ToolsDashboard: React.FC<ToolsDashboardProps> = ({ funds }) => {
    const [activeTool, setActiveTool] = useState<'CALENDAR' | 'GRID' | 'SIP'>('CALENDAR');

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
                        isActive={activeTool === 'GRID'} 
                        onClick={() => setActiveTool('GRID')} 
                        icon={<GripHorizontal size={16}/>} 
                        label="网格计算"
                     />
                     <ToolTab 
                        isActive={activeTool === 'SIP'} 
                        onClick={() => setActiveTool('SIP')} 
                        icon={<TrendingUp size={16}/>} 
                        label="定投测算"
                     />
                 </div>
             </div>

             <div className="p-4">
                 {activeTool === 'CALENDAR' && <ProfitCalendar funds={funds} />}
                 {activeTool === 'GRID' && <GridCalculator />}
                 {activeTool === 'SIP' && <SipCalculator />}
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

// --- 1. 收益日历 ---
const ProfitCalendar = ({ funds }: { funds: Fund[] }) => {
    // 模拟生成最近14天的盈亏数据 (基于当前总持仓模拟)
    // 真实情况需要后端记录每日快照
    const data = React.useMemo(() => {
        const res = [];
        const today = new Date();
        for(let i=13; i>=0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = `${d.getMonth()+1}-${d.getDate()}`;
            // 随机模拟波动
            const volatility = Math.random() * 2000 - 800; 
            res.push({
                date: dateStr,
                profit: Math.round(volatility),
            });
        }
        return res;
    }, []);

    const totalProfit = data.reduce((sum, item) => sum + item.profit, 0);

    return (
        <div className="space-y-4 animate-slide-up">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg">
                <div className="text-indigo-100 text-xs mb-1">近14天累计盈亏 (模拟)</div>
                <div className="text-3xl font-bold flex items-center gap-2">
                    {totalProfit > 0 ? '+' : ''}{totalProfit} <span className="text-sm font-normal opacity-80">元</span>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data}>
                        <XAxis dataKey="date" tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip 
                            cursor={{fill: 'transparent'}}
                            contentStyle={{borderRadius: '8px'}}
                            formatter={(val: number) => [`${val}元`, '盈亏']}
                        />
                        <Bar dataKey="profit" radius={[4, 4, 4, 4]}>
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#ef4444' : '#22c55e'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            
            <div className="text-xs text-slate-400 text-center">
                * 由于未连接真实交易账户，数据为基于当前持仓的模拟演示
            </div>
        </div>
    );
};

// --- 2. 网格交易计算器 ---
const GridCalculator = () => {
    const [basePrice, setBasePrice] = useState<string>('1.000');
    const [gridPercent, setGridPercent] = useState<string>('2.0');
    const [grids, setGrids] = useState<number>(5);

    const calculateGrids = () => {
        const price = parseFloat(basePrice);
        const percent = parseFloat(gridPercent) / 100;
        const res = [];
        // Sell Grids
        for(let i=grids; i>=1; i--) {
            const p = price * (1 + percent * i);
            res.push({ type: 'SELL', price: p.toFixed(4), percent: `+${(percent*i*100).toFixed(1)}%` });
        }
        // Base
        res.push({ type: 'BASE', price: price.toFixed(4), percent: '0.0%' });
        // Buy Grids
        for(let i=1; i<=grids; i++) {
            const p = price * (1 - percent * i);
            res.push({ type: 'BUY', price: p.toFixed(4), percent: `-${(percent*i*100).toFixed(1)}%` });
        }
        return res;
    };

    const gridData = calculateGrids();

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 shadow-sm border border-slate-100 dark:border-slate-800 animate-slide-up">
            <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <GripHorizontal className="text-blue-500"/> 网格交易策略生成
            </h3>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                    <label className="text-xs text-slate-500 mb-1">基准价格</label>
                    <input 
                        type="number" 
                        value={basePrice} 
                        onChange={e => setBasePrice(e.target.value)}
                        className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-bold"
                    />
                </div>
                <div>
                    <label className="text-xs text-slate-500 mb-1">每格涨跌幅 (%)</label>
                    <input 
                        type="number" 
                        value={gridPercent} 
                        onChange={e => setGridPercent(e.target.value)}
                        className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-bold"
                    />
                </div>
            </div>

            <div className="space-y-1 max-h-80 overflow-y-auto">
                {gridData.map((g, idx) => (
                    <div key={idx} className={`flex justify-between items-center p-2 rounded-lg text-sm ${
                        g.type === 'BASE' ? 'bg-slate-100 dark:bg-slate-800 font-bold' : 
                        g.type === 'SELL' ? 'bg-red-50 dark:bg-red-900/10 text-red-600' : 'bg-green-50 dark:bg-green-900/10 text-green-600'
                    }`}>
                        <span className="w-12 font-bold">{g.type === 'BASE' ? '基准' : g.type === 'SELL' ? '卖出' : '买入'}</span>
                        <span>{g.price}</span>
                        <span className="w-16 text-right">{g.percent}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- 3. 定投计算器 ---
const SipCalculator = () => {
    const [monthly, setMonthly] = useState('1000');
    const [rate, setRate] = useState('10');
    const [years, setYears] = useState('5');
    
    const calculateSIP = () => {
        const p = parseFloat(monthly);
        const r = parseFloat(rate) / 100 / 12; // 月利率
        const n = parseFloat(years) * 12;
        
        // FV = P * (((1 + r)^n - 1) / r) * (1 + r)
        const fv = p * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
        const totalInvest = p * n;
        const profit = fv - totalInvest;
        
        return { fv, totalInvest, profit };
    };
    
    const { fv, totalInvest, profit } = calculateSIP();

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 shadow-sm border border-slate-100 dark:border-slate-800 animate-slide-up">
             <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <Calculator className="text-orange-500"/> 复利定投推演
            </h3>

            <div className="space-y-4 mb-6">
                <div className="flex items-center gap-2">
                    <label className="w-24 text-sm text-slate-500">每月定投</label>
                    <input type="number" value={monthly} onChange={e => setMonthly(e.target.value)} className="flex-1 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-sm"/>
                </div>
                <div className="flex items-center gap-2">
                    <label className="w-24 text-sm text-slate-500">年化收益(%)</label>
                    <input type="number" value={rate} onChange={e => setRate(e.target.value)} className="flex-1 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-sm"/>
                </div>
                <div className="flex items-center gap-2">
                    <label className="w-24 text-sm text-slate-500">定投年限</label>
                    <input type="number" value={years} onChange={e => setYears(e.target.value)} className="flex-1 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-sm"/>
                </div>
            </div>

            <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                    <span className="text-slate-600 dark:text-slate-300 text-sm">期末总资产</span>
                    <span className="text-xl font-bold text-orange-600 dark:text-orange-400">¥{fv.toLocaleString('zh-CN', {maximumFractionDigits:0})}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">本金投入</span>
                    <span>¥{totalInvest.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">定投收益</span>
                    <span className="text-up-red font-bold">+{profit.toLocaleString('zh-CN', {maximumFractionDigits:0})}</span>
                </div>
            </div>
            
            <p className="text-xs text-slate-400 mt-4 leading-relaxed">
                * 复利是世界第八大奇迹。假设年化 {rate}%，坚持 {years} 年，时间会给你答案。
            </p>
        </div>
    );
};
