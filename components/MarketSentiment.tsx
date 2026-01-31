import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface MarketSentimentProps {
    data: { name: string; value: number; color: string }[];
    score: number;
}

export const MarketSentiment: React.FC<MarketSentimentProps> = ({ data, score }) => {
    // 简单的仪表盘逻辑
    const needleRotation = (score / 100) * 180 - 90;

    return (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mx-4">
             <h3 className="font-bold text-slate-800 mb-4 flex items-center">
                📊 市场情绪表盘 (模拟)
             </h3>
             <div className="h-40 relative flex justify-center overflow-hidden">
                <ResponsiveContainer width="100%" height="200%">
                    <PieChart>
                        <Pie
                            dataKey="value"
                            startAngle={180}
                            endAngle={0}
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            fill="#8884d8"
                            stroke="none"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                
                {/* Needle */}
                <div 
                    className="absolute bottom-0 left-1/2 w-1 h-20 bg-slate-600 origin-bottom transform transition-transform duration-1000 ease-out"
                    style={{ transform: `translateX(-50%) rotate(${needleRotation}deg)`, zIndex: 10 }}
                ></div>
                <div className="absolute bottom-0 left-1/2 w-4 h-4 bg-slate-800 rounded-full transform -translate-x-1/2 translate-y-1/2 z-20"></div>
             </div>
             
             <div className="text-center mt-2">
                 <div className="text-3xl font-bold text-slate-700">{score}</div>
                 <div className="text-sm text-slate-500">
                     {score < 30 ? '极度恐慌' : score < 70 ? '中性震荡' : '极度贪婪'}
                 </div>
             </div>
             <p className="text-xs text-slate-400 mt-4 text-center">
                 基于全市场成交量、换手率及主力资金流向综合计算
             </p>
        </div>
    );
}