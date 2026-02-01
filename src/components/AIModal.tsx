import React from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown'; // 假设环境支持，如果不支持则直接渲染文本

interface AIModalProps {
  isOpen: boolean;
  onClose: () => void;
  fundName: string;
  report: string;
  isLoading: boolean;
}

export const AIModal: React.FC<AIModalProps> = ({ isOpen, onClose, fundName, report, isLoading }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl z-10 overflow-hidden flex flex-col max-h-[80vh]">
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-4 flex justify-between items-center text-white">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-yellow-300" />
            <h3 className="font-bold">Gemini 智能诊断</h3>
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1">
          <h4 className="font-semibold text-slate-800 mb-4 border-b pb-2">对象: {fundName}</h4>
          
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <Loader2 size={40} className="animate-spin text-indigo-500" />
              <p className="text-slate-500 animate-pulse">Gemini 正在深入分析持仓数据...</p>
            </div>
          ) : (
            <div className="prose prose-sm prose-slate">
                {/* 简单的 Markdown 渲染模拟，如果 ReactMarkdown 不可用，可以直接用 pre-wrap */}
                <div className="whitespace-pre-wrap text-slate-700 leading-relaxed text-sm">
                    {report}
                </div>
            </div>
          )}
        </div>
        
        <div className="p-4 bg-slate-50 border-t text-xs text-slate-400 text-center">
          AI 生成内容仅供参考，不构成投资建议
        </div>
      </div>
    </div>
  );
};