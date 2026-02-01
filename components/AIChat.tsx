import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';
import { Send, Bot, User, Loader2, Sparkles, Lock, Key, LogIn } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface AIChatProps {
  apiKey?: string;
}

export const AIChat: React.FC<AIChatProps> = ({ apiKey }) => {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Chat State
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

  // Check Auth on Mount or when API Key changes
  useEffect(() => {
    // 1. 如果用户在设置里填了自己的 Key，直接免登录
    if (apiKey && apiKey.trim() !== '') {
        setIsAuthenticated(true);
        return;
    }

    // 2. 否则检查本地缓存的登录状态 (每日有效)
    const today = new Date().toDateString();
    const storedAuthDate = localStorage.getItem('smartfund_ai_auth_date');
    if (storedAuthDate === today) {
        setIsAuthenticated(true);
    } else {
        setIsAuthenticated(false);
    }
  }, [apiKey]);

  const handleLogin = () => {
      if (username === 'luoxin1997' && password === 'luoxin9707') {
          const today = new Date().toDateString();
          localStorage.setItem('smartfund_ai_auth_date', today);
          setIsAuthenticated(true);
          setAuthError('');
      } else {
          setAuthError('账号或密码错误');
      }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAuthenticated]);

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
      // 如果没有 API Key，且不是生产环境，显示模拟回复 (防止开发时报错)
      // 注意：这里的 apiKey || process.env.API_KEY 确保了如果有自己的 Key 用自己的，没有则尝试用公共的
      const effectiveKey = apiKey || process.env.API_KEY || '';
      
      if (!effectiveKey && process.env.NODE_ENV !== 'production') {
         setTimeout(() => {
            const mockResponse: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: "由于未配置 Key，这是模拟回复。请在【设置】中配置 Key 或确保环境变量已注入。"
            };
            setMessages(prev => [...prev, mockResponse]);
            setIsLoading(false);
         }, 1500);
         return;
      }

      const ai = new GoogleGenAI({ apiKey: effectiveKey });
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

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: "网络连接异常，请检查 Key 是否有效或稍后再试。"
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
      return (
          <div className="flex flex-col h-[calc(100vh-140px)] items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
              <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-sm text-center animate-scale-in">
                  <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-600 dark:text-indigo-400">
                      <Lock size={32} />
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">AI 助手权限验证</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                      使用公共内置通道需每日验证。
                      <br/>
                      <span className="text-indigo-500 font-bold">提示：在【设置】填入您自己的 Key 可直接免密使用。</span>
                  </p>

                  <div className="space-y-4 text-left">
                      <div>
                          <label className="text-xs font-bold text-slate-500 mb-1 block">账号</label>
                          <div className="relative">
                              <User size={16} className="absolute left-3 top-3 text-slate-400"/>
                              <input 
                                  type="text" 
                                  value={username}
                                  onChange={e => setUsername(e.target.value)}
                                  placeholder="请输入账号"
                                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                              />
                          </div>
                      </div>
                      <div>
                          <label className="text-xs font-bold text-slate-500 mb-1 block">密码</label>
                          <div className="relative">
                              <Key size={16} className="absolute left-3 top-3 text-slate-400"/>
                              <input 
                                  type="password" 
                                  value={password}
                                  onChange={e => setPassword(e.target.value)}
                                  placeholder="请输入密码"
                                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                              />
                          </div>
                      </div>
                      
                      {authError && <div className="text-xs text-red-500 text-center font-bold">{authError}</div>}

                      <button 
                        onClick={handleLogin}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition active:scale-95 flex items-center justify-center gap-2"
                      >
                          <LogIn size={18} /> 登录并开始对话
                      </button>
                  </div>
              </div>
          </div>
      )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
        <div className="bg-white dark:bg-slate-900 p-4 shadow-sm border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 sticky top-0 z-10">
            <Sparkles className="text-indigo-500" size={20} />
            <h2 className="font-bold text-slate-800 dark:text-white text-sm">AI 投资顾问</h2>
            {apiKey ? (
                 <span className="text-[10px] text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                     <Key size={10} /> 私有通道
                 </span>
            ) : (
                 <span className="text-[10px] text-green-500 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">公共通道已认证</span>
            )}
        </div>

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