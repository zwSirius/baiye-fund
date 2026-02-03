
import React, { useState } from 'react';
import { Fund } from '../types';
import { Calendar } from 'lucide-react';
import { ProfitCalendar } from './ProfitCalendar';

interface ToolsDashboardProps {
    funds: Fund[];
}

export const ToolsDashboard: React.FC<ToolsDashboardProps> = ({ funds }) => {
    return (
        <div className="pb-24 animate-fade-in">
             <div className="bg-white dark:bg-slate-900 sticky top-[72px] z-20 border-b border-slate-100 dark:border-slate-800 px-4 pt-2">
                 <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                     <button className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap bg-blue-600 text-white shadow-md">
                        <Calendar size={16}/> 收益日历
                     </button>
                 </div>
             </div>
             <div className="p-4">
                 <ProfitCalendar funds={funds} />
             </div>
        </div>
    );
};
