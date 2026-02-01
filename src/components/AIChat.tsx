import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';
import { Send, Bot, User, Loader2, Sparkles, Key, Server, Lock, LogIn } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { API_BASE } from '../services/fundService';

interface AIChatProps {
  apiKey?: string;
}

export const AIChat: React.FC<AIChatProps> = ({ apiKey }) => {
  // --- Auth State ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  
  // Determine mode based on apiKey presence
  const [useBackend, setUseBackend] = useState(false);

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

  useEffect(() => {
    // 逻辑：
    // 1. 如果用户填了 API Key -> 视为私有模式 -> 自动认证通过 (免密)
    // 2. 如果没填 API Key -> 视为公共模式 -> 需要校验本地缓存的登录状态
    if (apiKey && apiKey.trim() !== '') {
        setUseBackend(false);
        setIsAuthenticated(true); // 自带 Key，无需登录
    } else {
        setUseBackend(true);
        // 检查本地缓存 (简单模拟 Session，每日失效)
        const today = new Date().toDateString();
        const storedAuthDate = localStorage.getItem('smartfund_ai_auth_date');
        if (storedAuthDate === today) {
            setIsAuthenticated(true);
        } else {
            setIsAuthenticated(false);
        }
    }
  }, [apiKey]);

  const handleLogin = () => {
      // 验证账号密码
      if (username === 'baiye' && password === 'baiye1997') {
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
    if (isAuthenticated) {
        scrollToBottom();
    }
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
      let text = "";

      if (!useBackend && apiKey) {
          // --- Mode A: Private Channel (Frontend Direct) ---
          const ai = new GoogleGenAI({ apiKey: apiKey });
          const model = "gemini-3-flash-preview";
          const response = await ai.models.generateContent({
            model: model,
            contents: userMsg.text,
            config: {
                systemInstruction: "你是一个专业的基金投资顾问，性格沉稳客观，擅长分析中国A股和基金市场。回答要简洁明了，给出具体的逻辑。",
            }
          });
          text = response.text || "抱歉，我暂时无法回答这个问题。";
      } else {
          // --- Mode B: Public Channel (Backend Proxy) ---
          const prompt = `你是一个专业的基金投资顾问，性格沉稳客观，擅长分析中国A股和基金市场。回答要简洁明了，给出具体的逻辑。\n\n用户提问：${userMsg.text}`;
          
          const response = await fetch(`${API_BASE}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt })
          });
          
          if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              throw new Error(errData.detail || "服务器繁忙");
          }
          
          const data = await response.json();
          text = data.text;
      }
      
      const modelMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: text
      };
      
      setMessages(prev => [...prev, modelMsg]);

    } catch (error: any) {
      console.error(error);
      let errorMsg = "网络连接异常，请稍后再试。";
      
      if (useBackend) {
          errorMsg = "公共服务暂时不可用 (后端未配置 Key 或网络问题)。建议在设置中填入您自己的 Key 使用私有通道。";
      } else {
          errorMsg = "您的 API Key 似乎无效，请检查设置。";
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

  // --- Render Login Screen if not authenticated ---
  if (!isAuthenticated) {
      return (
          <div className="flex flex-col h-[calc(100vh-140px)] items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
              <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-sm text-center animate-scale-in border border-slate-100 dark:border-slate-700">
                  <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-600 dark:text-indigo-400">
                      <Lock size={32} />
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">访问受限</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                      您正在使用公共通道（消耗服务器资源），需验证身份。
                      <br/>
                      <span className="text-indigo-600 dark:text-indigo-400 font-bold mt-2 block">
                          💡 提示：在「设置」中填入您自己的 Key 可直接免密使用。
                      </span>
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
                      
                      {authError && <div className="text-xs text-red-500 text-center font-bold bg-red-50 dark:bg-red-900/20 p-2 rounded">{authError}</div>}

                      <button 
                        onClick={handleLogin}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 dark:shadow-indigo-900/20"
                      >
                          <LogIn size={18} /> 验证并进入
                      </button>
                  </div>
              </div>
          </div>
      )
  }

  // --- Render Chat Interface ---
  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
        {/* Status Header */}
        <div className="bg-white dark:bg-slate-900 p-4 shadow-sm border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-2">
                <Sparkles className="text-indigo-500" size={20} />
                <h2 className="font-bold text-slate-800 dark:text-white text-sm">AI 投资顾问</h2>
            </div>
            
            {!useBackend ? (
                 <span className="text-[10px] text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full flex items-center gap-1 border border-blue-100 dark:border-blue-900">
                     <Key size={10} /> 私有通道 (Local)
                 </span>
            ) : (
                 <span className="text-[10px] text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full flex items-center gap-1 border border-green-100 dark:border-green-900">
                     <Server size={10} /> 公共通道 (Server)
                 </span>
            )}
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
