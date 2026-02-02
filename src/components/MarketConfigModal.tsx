import React, { useState } from 'react';
import { X, Check } from 'lucide-react';

interface MarketConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCodes: string[];
  onSave: (codes: string[]) => void;
}

// 预置的热门板块/指数代码 (Mapping to Eastmoney secids)
// 这里为了简化，我们列出常用的，并假设后端可以处理
const PRESETS = [
    { name: '上证指数', code: '1.000001', category: '大盘' },
    { name: '深证成指', code: '0.399001', category: '大盘' },
    { name: '创业板指', code: '0.399006', category: '大盘' },
    { name: '科创50', code: '1.000688', category: '大盘' },
    { name: '恒生指数', code: '100.HSI', category: '港美' }, // 需后端支持，这里暂留位
    { name: '纳斯达克', code: '100.NDX', category: '港美' },
    { name: '中证白酒', code: '0.399997', category: '行业' },
    { name: '新能源车', code: '0.399976', category: '行业' },
    { name: '半导体', code: '0.991023', category: '行业' }, // 中证半导体
    { name: '光伏产业', code: '0.931151', category: '行业' },
    { name: '中证医药', code: '0.000933', category: '行业' },
    { name: '中证军工', code: '0.399967', category: '行业' },
    { name: '证券公司', code: '0.399975', category: '行业' },
    { name: '中证银行', code: '0.399986', category: '行业' },
    { name: '人工智能', code: '0.931071', category: '行业' },
];

export const MarketConfigModal: React.FC<MarketConfigModalProps> = ({ isOpen, onClose, currentCodes, onSave }) => {
    const [selected, setSelected] = useState<string[]>(currentCodes);

    const toggleCode = (code: string) => {
        if (selected.includes(code)) {
            setSelected(prev => prev.filter(c => c !== code));
        } else {
            if (selected.length >= 8) {
                alert("最多选择 8 个关注板块");
                return;
            }
            setSelected(prev => [...prev, code]);
        }
    };

    const handleSave = () => {
        onSave(selected);
        onClose();
    };

    if (!isOpen) return null;

    // Group by category
    const categories = ['大盘', '行业', '港美']; // 港美可能需要后端适配，暂且放着

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm shadow-2xl z-10 overflow-hidden animate-scale-in flex flex-col max-h-[80vh]">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <h3 className="font-bold text-lg dark:text-white">管理关注板块</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400"/></button>
                </div>

                <div className="p-4 overflow-y-auto flex-1 space-y-4">
                    {categories.map(cat => (
                        <div key={cat}>
                            <h4 className="text-xs font-bold text-slate-400 mb-2">{cat}</h4>
                            <div className="grid grid-cols-3 gap-2">
                                {PRESETS.filter(p => p.category === cat).map(item => {
                                    const isSelected = selected.includes(item.code);
                                    return (
                                        <button
                                            key={item.code}
                                            onClick={() => toggleCode(item.code)}
                                            className={`p-2 rounded-lg text-xs font-bold border transition relative ${
                                                isSelected 
                                                ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-600' 
                                                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                                            }`}
                                        >
                                            {item.name}
                                            {isSelected && <div className="absolute top-0 right-0 p-0.5"><Check size={8} className="text-blue-500"/></div>}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    <div className="text-xs text-slate-400 mt-2 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded text-center">
                        提示：部分港美股指数数据可能延迟
                    </div>
                </div>

                <div className="p-4 border-t border-slate-100 dark:border-slate-800">
                    <button 
                        onClick={handleSave}
                        className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl shadow-lg active:scale-95 transition"
                    >
                        保存设置
                    </button>
                </div>
            </div>
        </div>
    );
};