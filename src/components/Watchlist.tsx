import React from 'react';
import { Fund } from '../types';
import { Plus, Search, Eye, TrendingUp, TrendingDown, Trash2 } from 'lucide-react';

interface WatchlistProps {
  funds: Fund[];
  onAdd: () => void;
  onRemove: (fund: Fund) => void;
  onRefresh: () => void;
  onFundClick: (fund: Fund) => void;
  isRefreshing: boolean;
}

export const Watchlist: React.FC<WatchlistProps> = ({ funds, onAdd, onRemove, onRefresh, onFundClick, isRefreshing }) => {
  return (
    <div className="pb-24 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 sticky top-[72px] z-20 border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex justify-between items-center shadow-sm">
         <div className="flex items-center gap-2">
            <Eye className="text-blue-500" size={20} />
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">自选观察</h2>
            <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">{funds.length}</span>
         </div>
         <button 
            onClick={onAdd}
            className="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full font-bold flex items-center gap-1 active:scale-95 transition"
         >
            <Plus size={14} /> 添加基金
         </button>
      </div>

      <div className="p-4 space-y-3">
         {funds.length === 0 ? (
             <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                 <Search size={48} className="mb-4 opacity-20" />
                 <p className="text-sm">暂无自选基金</p>
                 <button onClick={onAdd} className="mt-4 text-blue-500 font-bold text-sm">去添加</button>
             </div>
         ) : (
             funds.map(fund => (
                 <div 
                    key={fund.id} 
                    onClick={() => onFundClick(fund)}
                    className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 relative group active:scale-[0.98] transition cursor-pointer"
                 >
                     <div className="flex justify-between items-start mb-2">
                         <div>
                             <div className="font-bold text-slate-800 dark:text-slate-100 text-base">{fund.name}</div>
                             <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                                 <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono">{fund.code}</span>
                                 <span>{fund.tags[0]}</span>
                             </div>
                         </div>
                         <button 
                            onClick={(e) => { e.stopPropagation(); onRemove(fund); }}
                            className="p-2 text-slate-300 hover:text-red-500 transition"
                         >
                            <Trash2 size={16} />
                         </button>
                     </div>

                     <div className="flex items-center justify-between mt-3 bg-slate-50 dark:bg-slate-800 p-3 rounded-lg">
                         <div>
                             <div className="text-xs text-slate-400 mb-0.5">预估净值</div>
                             <div className="font-bold text-slate-700 dark:text-slate-200">{fund.estimatedNav.toFixed(4)}</div>
                         </div>
                         <div className="text-right">
                             <div className="text-xs text-slate-400 mb-0.5">今日估值</div>
                             <div className={`text-lg font-black ${fund.estimatedChangePercent >= 0 ? 'text-up-red' : 'text-down-green'} flex items-center gap-1`}>
                                 {fund.estimatedChangePercent >= 0 ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}
                                 {fund.estimatedChangePercent > 0 ? '+' : ''}{fund.estimatedChangePercent}%
                             </div>
                         </div>
                     </div>
                 </div>
             ))
         )}
      </div>
      
      {funds.length > 0 && (
        <div className="px-4 text-center">
             <button onClick={onRefresh} className="text-xs text-slate-400 flex items-center justify-center gap-1 mx-auto w-full py-2">
                 {isRefreshing ? '更新中...' : '下拉或点击刷新数据'}
             </button>
        </div>
      )}
    </div>
  );
};