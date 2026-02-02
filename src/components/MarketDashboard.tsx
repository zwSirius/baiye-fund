import React, { useState, useEffect } from 'react';
import { MarketOverview, FundRank, SectorRank } from '../types';
import { fetchMarketOverview } from '../services/fundService';
import { TrendingUp, TrendingDown, RefreshCw, Layers, BarChart3, Settings, AlertCircle } from 'lucide-react';

interface MarketDashboardProps {
    marketCodes: string[];
    onConfigMarket: () => void;
}

export const MarketDashboard: React.FC<MarketDashboardProps> = ({ marketCodes, onConfigMarket }) => {
    const [data, setData] = useState<MarketOverview | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [rankType, setRankType] = useState<'GAIN' | 'LOSS'>('GAIN');

    const loadData = async () => {
        setIsLoading(true);
        const res = await fetchMarketOverview(marketCodes);
        if (res) setData(res);
        setIsLoading(false);
    };

    useEffect(() => {
        loadData();
    }, [marketCodes]);

    const Skeleton = ({ className }: { className: string }) => (
        <div className={`animate-pulse bg-slate-200 dark:bg-slate-800 rounded ${className}`}></div>
    );

    return (
        <div className="pb-24 animate-fade-in space-y-6">
            
            {/* Header / Refresh */}
            <div className="sticky top-[72px] z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-4 py-2 flex justify-between items-center border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <BarChart3 className="text-blue-500" size={20}/> 市场全景
                </h2>
                <button 
                    onClick={loadData} 
                    className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition active:rotate-180"
                >
                    <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Core Indices */}
            <div className="px-4">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">核心指数</h3>
                    <button onClick={onConfigMarket} className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-1 rounded-md flex items-center gap-1">
                        <Settings size={12}/> 配置
                    </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                    {isLoading ? [1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-20 w-full"/>) : (
                        data?.indices.map((idx) => (
                            <div key={idx.code} className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center text-center">
                                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 truncate w-full">{idx.name}</div>
                                <div className={`text-lg font-black tracking-tight ${idx.changePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                    {idx.value?.toFixed(2)}
                                </div>
                                <div className={`text-xs font-bold ${idx.changePercent >= 0 ? 'text-up-red' : 'text-down-green'} flex items-center gap-0.5`}>
                                    {idx.changePercent >= 0 ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
                                    {idx.changePercent > 0 ? '+' : ''}{idx.changePercent}%
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Sector Rankings */}
            <div className="px-4">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                    <Layers size={16} /> 板块风向标
                </h3>
                <div className="grid grid-cols-2 gap-4">
                    {/* Gainers */}
                    <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-3 border border-red-100 dark:border-red-900/30">
                        <div className="text-xs font-bold text-red-500 mb-2 flex justify-between">
                            <span>领涨板块</span> <TrendingUp size={12}/>
                        </div>
                        <div className="space-y-2">
                            {isLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-8 w-full"/>) : (
                                data?.sectors.top.map((s, idx) => (
                                    <SectorRow key={s.name} rank={idx+1} name={s.name} change={s.changePercent} stock={s.leadingStock} type="up"/>
                                ))
                            )}
                            {!isLoading && data?.sectors.top.length === 0 && <EmptyState text="暂无数据" />}
                        </div>
                    </div>
                    {/* Losers */}
                    <div className="bg-green-50 dark:bg-green-900/10 rounded-xl p-3 border border-green-100 dark:border-green-900/30">
                        <div className="text-xs font-bold text-green-500 mb-2 flex justify-between">
                            <span>领跌板块</span> <TrendingDown size={12}/>
                        </div>
                        <div className="space-y-2">
                            {isLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-8 w-full"/>) : (
                                data?.sectors.bottom.map((s, idx) => (
                                    <SectorRow key={s.name} rank={idx+1} name={s.name} change={s.changePercent} stock={s.leadingStock} type="down"/>
                                ))
                            )}
                            {!isLoading && data?.sectors.bottom.length === 0 && <EmptyState text="暂无数据" />}
                        </div>
                    </div>
                </div>
            </div>

            {/* Fund Rankings */}
            <div className="px-4">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">基金涨跌榜 (Top 20)</h3>
                    <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                        <button 
                            onClick={() => setRankType('GAIN')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition ${rankType === 'GAIN' ? 'bg-white dark:bg-slate-700 text-red-500 shadow-sm' : 'text-slate-400'}`}
                        >
                            涨幅榜
                        </button>
                        <button 
                            onClick={() => setRankType('LOSS')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition ${rankType === 'LOSS' ? 'bg-white dark:bg-slate-700 text-green-500 shadow-sm' : 'text-slate-400'}`}
                        >
                            跌幅榜
                        </button>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="grid grid-cols-12 gap-2 p-3 bg-slate-50 dark:bg-slate-950/50 text-[10px] text-slate-400 font-bold border-b border-slate-100 dark:border-slate-800">
                        <div className="col-span-1">排名</div>
                        <div className="col-span-6">基金名称</div>
                        <div className="col-span-3 text-right">净值</div>
                        <div className="col-span-2 text-right">涨跌</div>
                    </div>
                    <div>
                        {isLoading ? [1,2,3,4,5].map(i => <div key={i} className="p-3 border-b border-slate-50 dark:border-slate-800"><Skeleton className="h-4 w-full"/></div>) : (
                            (rankType === 'GAIN' ? data?.fundRankings.gainers : data?.fundRankings.losers)?.map((f, idx) => (
                                <div key={f.code} className="grid grid-cols-12 gap-2 p-3 border-b border-slate-50 dark:border-slate-800 last:border-0 items-center hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                                    <div className={`col-span-1 text-xs font-bold ${idx < 3 ? 'text-orange-500' : 'text-slate-400'}`}>{idx + 1}</div>
                                    <div className="col-span-6 min-w-0">
                                        <div className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{f.name}</div>
                                        <div className="text-[10px] text-slate-400 font-mono">{f.code}</div>
                                    </div>
                                    <div className="col-span-3 text-right text-sm font-medium text-slate-600 dark:text-slate-300">
                                        {f.nav.toFixed(4)}
                                    </div>
                                    <div className={`col-span-2 text-right text-sm font-bold ${f.changePercent >= 0 ? 'text-up-red' : 'text-down-green'}`}>
                                        {f.changePercent > 0 ? '+' : ''}{f.changePercent}%
                                    </div>
                                </div>
                            ))
                        )}
                        {!isLoading && (!data?.fundRankings.gainers.length) && <EmptyState text="数据加载中或休市" />}
                    </div>
                </div>
                <div className="text-center py-4 text-[10px] text-slate-400">
                    数据来源：实时市场行情 (延迟约 1-5 分钟)
                </div>
            </div>

        </div>
    );
};

const SectorRow = ({ rank, name, change, stock, type }: { rank: number, name: string, change: number, stock: string, type: 'up'|'down' }) => (
    <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 w-1/2 min-w-0">
            <span className={`w-3.5 h-3.5 flex items-center justify-center rounded text-[9px] font-bold ${rank === 1 ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                {rank}
            </span>
            <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{name}</span>
        </div>
        <div className={`font-bold ${type === 'up' ? 'text-up-red' : 'text-down-green'}`}>
            {type === 'up' ? '+' : ''}{change.toFixed(2)}%
        </div>
    </div>
);

const EmptyState = ({ text }: { text: string }) => (
    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
        <AlertCircle size={24} className="mb-2 opacity-30"/>
        <span className="text-xs">{text}</span>
    </div>
);