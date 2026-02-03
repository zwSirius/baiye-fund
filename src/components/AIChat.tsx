
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';
import { Send, Bot, User, Loader2, Sparkles, Lock, Settings, LogOut, Wifi, WifiOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getEffectiveApiKey } from '../services/geminiService';

interface AIChatProps {
    onGoToSettings: () => void;
    connectionStatus: 'connected' | 'failed' | 'unknown';
}

export const AIChat: React.FC<AIChatProps> = ({ onGoToSettings, connectionStatus }) => {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: '1', role: 'model', text: '你好！我是你的智能投资顾问。我可以帮你分析市场热点、解读基金报告，或者提供理财建议。今天想聊点什么？' }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const checkAuth = () => {
      const key = getEffectiveApiKey();
      setIsAuthorized(!!key);
  };

  useEffect(() => {
      checkAuth();
      const handleStorageChange = () => checkAuth();
      window.addEventListener('storage', handleStorageChange);
      return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => scrollToBottom(), [messages, isAuthorized]);
  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  const handleDisconnect = () => {
      if(confirm('确定要断开连接并清除本地保存的 API Key 吗？')) {
          localStorage.removeItem('smartfund_custom_key');
          window.dispatchEvent(new Event('storage'));
          checkAuth();
      }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const apiKey = getEffectiveApiKey();
      if (!apiKey) throw new Error("API Key Invalid");
      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-3-flash-preview";
      const response = await ai.models.generateContent({ model: model, contents: userMsg.text, config: { systemInstruction: "你是一个专业的基金投资顾问，回答要简洁明了。" }});
      const text = response.text || "无回复";
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'model', text }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'model', text: "请求失败，请检查网络或 Key。" }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthorized) {
      return (
          <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] bg-slate-50 dark:bg-slate-950 px-6">
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm p-8 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 text-center animate-scale-in">
                  <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4"><Lock size={32} /></div>
                  <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">需要配置 API Key</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">为了提供 AI 服务，请前往设置配置 Gemini API Key。</p>
                  <button onClick={onGoToSettings} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl shadow-lg active:scale-95 transition flex items-center justify-center gap-2"><Settings size={18} /> 前往设置</button>
              </div>
          </div>
      );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
        <div className="bg-white dark:bg-slate-900 p-4 shadow-sm border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-2">
                <Sparkles className="text-indigo-500" size={20} />
                <h2 className="font-bold text-slate-800 dark:text-white text-sm">AI 投资顾问</h2>
            </div>
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                    {connectionStatus === 'connected' ? <Wifi size={14} className="text-green-500"/> : <WifiOff size={14} className="text-slate-300"/>}
                    <span className={`text-[10px] font-bold ${connectionStatus === 'connected' ? 'text-green-600' : 'text-slate-400'}`}>
                        {connectionStatus === 'connected' ? '已连接' : (connectionStatus === 'failed' ? '连接失败' : '检测中...')}
                    </span>
                </div>
                <button onClick={handleDisconnect} className="text-xs text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-full flex items-center gap-1 hover:bg-red-100"><LogOut size={10} /> 断开</button>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-950">
            {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-slate-200 dark:bg-slate-700' : 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400'}`}>{msg.role === 'user' ? <User size={16}/> : <Bot size={16} />}</div>
                    <div className={`max-w-[85%] rounded-2xl p-3 text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-tl-none'}`}><ReactMarkdown>{msg.text}</ReactMarkdown></div>
                </div>
            ))}
            {isLoading && <div className="flex gap-3"><Bot size={32} className="text-indigo-500"/><div className="bg-white dark:bg-slate-800 p-3 rounded-2xl shadow-sm"><Loader2 className="animate-spin text-indigo-500" size={16}/></div></div>}
            <div ref={messagesEndRef} />
        </div>

        <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
            <div className="relative flex items-center">
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="问问它..." className="w-full bg-slate-100 dark:bg-slate-800 rounded-full pl-4 pr-12 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
                <button onClick={handleSend} disabled={!input.trim() || isLoading} className="absolute right-1.5 p-1.5 bg-indigo-600 text-white rounded-full disabled:opacity-50"><Send size={16} /></button>
            </div>
        </div>
    </div>
  );
};
