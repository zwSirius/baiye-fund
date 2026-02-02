import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';

interface MarketConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCodes: string[];
  onSave: (codes: string[]) => void;
}

// 预置的热门板块/指数代码
// 使用更稳定的官方指数代码 (中证/国证/交易所核心指数)
const PRESETS = [
    // --- 大盘 ---
    { name: '上证指数', code: '1.000001', category: '大盘' },
    { name: '深证成指', code: '0.399001', category: '大盘' },
    { name: '创业板指', code: '0.399006', category: '大盘' },
    { name: '科创50', code: '1.000688', category: '大盘' },
    { name: '北证50', code: '0.899050', category: '大盘' },
    { name: '沪深300', code: '1.000300', category: '大盘' },
    
    // --- 行业 (优先使用中证/国证指数，更稳定) ---
    { name: '中证白酒', code: '0.399997', category: '行业' },
    { name: '中证医疗', code: '0.399989', category: '行业' },
    { name: '新能源车', code: '0.399976', category: '行业' },
    { name: '半导体', code: '1.000997', category: '行业' }, // 中证全指半导体
    { name: '光伏产业', code: '1.931151', category: '行业' }, // 中证光伏
    { name: '人工智能', code: '1.931071', category: '行业' }, // 中证人工智能
    { name: '证券公司', code: '0.399975', category: '行业' },
    { name: '中证银行', code: '0.399986', category: '行业' },
    { name: '中证军工', code: '0.399967', category: '行业' },
    { name: '煤炭指数', code: '0.399998', category: '行业' },
    
    // --- 港美 ---
    { name: '恒生指数', code: '100.HSI', category: '港美' },
    { name: '恒生科技', code: '100.HSTECH', category: '港美' },
    { name: '纳斯达克', code: '100.NDX', category: '港美' },
    { name: '标普500', code: '100.SPX', category: '港美' },
];

export const MarketConfigModal: React.FC<MarketConfigModalProps> = ({ isOpen, onClose, currentCodes, onSave }) => {
    const [selected, setSelected] = useState<string[]>([]);

    // 核心修复：每次打开弹窗时，强制同步父组件的配置
    useEffect(() => {
        if (isOpen) {
            setSelected(currentCodes);
        }
    }, [isOpen, currentCodes]);

    const toggleCode = (code: string) => {
        if (selected.includes(code)) {
            setSelected(prev => prev.filter(c => c !== code));
        } else {
            if (selected.length >= 10) {
                alert("最多选择 10 个关注板块");
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
    const categories = ['大盘', '行业', '港美'];

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm shadow-2xl z-10 overflow-hidden animate-scale-in flex flex-col max-h-[85vh]">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <h3 className="font-bold text-lg dark:text-white">管理关注板块</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400"/></button>
                </div>

                <div className="p-4 overflow-y-auto flex-1 space-y-5">
                    {categories.map(cat => (
                        <div key={cat}>
                            <h4 className="text-xs font-bold text-slate-400 mb-2.5 flex items-center gap-2">
                                <span className="w-1 h-3 bg-blue-500 rounded-full"></span>
                                {cat}
                            </h4>
                            <div className="grid grid-cols-3 gap-2">
                                {PRESETS.filter(p => p.category === cat).map(item => {
                                    const isSelected = selected.includes(item.code);
                                    return (
                                        <button
                                            key={item.code}
                                            onClick={() => toggleCode(item.code)}
                                            className={`p-2 rounded-lg text-xs font-bold border transition relative text-center truncate ${
                                                isSelected 
                                                ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-600 dark:text-blue-400' 
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
                    <div className="text-xs text-slate-400 mt-2 bg-yellow-50 dark:bg-yellow-900/10 text-yellow-600 dark:text-yellow-500 p-2 rounded text-center">
                        提示：港美股指数可能存在 15 分钟延迟
                    </div>
                </div>

                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
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