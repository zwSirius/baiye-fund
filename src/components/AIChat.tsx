import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';
import { Send, Bot, User, Loader2, Sparkles, Lock, Settings } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getEffectiveApiKey } from '../services/geminiService';

export const AIChat: React.FC = () => {
  // --- Auth State ---
  const [isAuthorized, setIsAuthorized] = useState(false);

  // --- Chat State ---
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'model',
      text: '你好！我是你的智能投资顾问。我可以帮你分析市场热点、解读基金报告，或者提供理财建议。今天想聊点什么？'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const checkAuth = () => {
      const key = getEffectiveApiKey();
      if (key) {
          setIsAuthorized(true);
      } else {
          setIsAuthorized(false);
      }
  };

  useEffect(() => {
      checkAuth();
      // Listen to storage changes in case user updates key in another tab/window or comes back from settings
      const handleStorageChange = () => checkAuth();
      window.addEventListener('storage', handleStorageChange);
      return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAuthorized]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const apiKey = getEffectiveApiKey();
      if (!apiKey) throw new Error("API Key Invalid");

      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-3-flash-preview";
      
      const response = await ai.models.generateContent({
        model: model,
        contents: userMsg.text,
        config: {
            systemInstruction: "你是一个专业的基金投资顾问，性格沉稳客观，擅长分析中国A股和基金市场。回答要简洁明了，给出具体的逻辑。",
        }
      });
      const text = response.text || "抱歉，我暂时无法回答这个问题。";
      
      const modelMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: text
      };
      
      setMessages(prev => [...prev, modelMsg]);

    } catch (error: any) {
      console.error(error);
      let errorMsg = "网络连接异常，请稍后再试。";
      if (error.message?.includes('401') || error.message?.includes('API key')) {
          errorMsg = "API Key 无效或过期，请前往设置页面检查配置。";
          setIsAuthorized(false); 
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: errorMsg
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // --- No Key View ---
  if (!isAuthorized) {
      return (
          <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] bg-slate-50 dark:bg-slate-950 px-6">
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm p-8 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 text-center animate-scale-in">
                  <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Lock size={32} />
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">需要配置 API Key</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                      为了保护您的隐私并提供稳定的 AI 服务，<br/>请前往设置页面配置您自己的 Gemini API Key。
                  </p>
                  
                  <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl mb-6 text-xs text-left text-slate-500 dark:text-slate-400 space-y-2">
                      <p>1. 访问 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-500 underline">Google AI Studio</a> 获取 Key。</p>
                      <p>2. 在本应用「设置」页面粘贴保存。</p>
                      <p>3. 您的 Key 仅保存在本地浏览器中。</p>
                  </div>

                  {/* 这里只是提示，实际上通过导航栏切换 */}
                  <div className="flex items-center justify-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-sm animate-bounce">
                      <Settings size={16} /> 点击底部 "设置" 进行配置
                  </div>
              </div>
          </div>
      );
  }

  // --- Chat Interface ---
  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
        {/* Status Header */}
        <div className="bg-white dark:bg-slate-900 p-4 shadow-sm border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-2">
                <Sparkles className="text-indigo-500" size={20} />
                <h2 className="font-bold text-slate-800 dark:text-white text-sm">AI 投资顾问</h2>
            </div>
            <div className="flex items-center gap-2">
                <div className="text-[10px] text-green-500 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span> 已就绪
                </div>
            </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-950">
            {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-slate-200 dark:bg-slate-700' : 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400'}`}>
                        {msg.role === 'user' ? <User size={16} className="text-slate-500 dark:text-slate-300"/> : <Bot size={16} />}
                    </div>
                    <div className={`max-w-[85%] rounded-2xl p-3 text-sm leading-relaxed shadow-sm ${
                        msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-tl-none'
                    }`}>
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                </div>
            ))}
            {isLoading && (
                 <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
                        <Bot size={16} />
                    </div>
                    <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl rounded-tl-none border border-slate-100 dark:border-slate-700 shadow-sm flex items-center">
                        <Loader2 className="animate-spin text-indigo-500" size={16} />
                        <span className="text-xs text-slate-400 ml-2">正在思考...</span>
                    </div>
                 </div>
            )}
            <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
            <div className="relative flex items-center">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="问问它：现在适合买白酒吗？"
                    className="w-full bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white rounded-full pl-4 pr-12 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <button 
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="absolute right-1.5 p-1.5 bg-indigo-600 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition"
                >
                    <Send size={16} />
                </button>
            </div>
        </div>
    </div>
  );
};