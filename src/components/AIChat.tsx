import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';
import { Send, Bot, User, Loader2, Sparkles, Lock, Key, LogOut } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getEffectiveApiKey } from '../services/geminiService';

export const AIChat: React.FC = () => {
  // --- Auth State ---
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

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
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAuthorized]);

  const handleLogin = () => {
      if (username === 'baiye' && password === '1997') {
          localStorage.setItem('smartfund_vip_unlocked', 'true');
          checkAuth();
          setLoginError('');
      } else {
          setLoginError('账号或密码错误');
      }
  };

  const handleLogout = () => {
      localStorage.removeItem('smartfund_vip_unlocked');
      // Note: We don't remove custom key here, as user might want to switch methods. 
      // But to "Re-lock" effectively if custom key exists, we might need to clear that too or logic in getEffectiveApiKey handles priority.
      // If custom key exists, getEffectiveApiKey returns it, so isAuthorized remains true.
      // We will notify user.
      if (localStorage.getItem('smartfund_custom_key')) {
          if(confirm('检测到已配置自定义 API Key。是否同时也清除自定义 Key 以完全退出？')) {
              localStorage.removeItem('smartfund_custom_key');
          }
      }
      setIsAuthorized(false);
      setUsername('');
      setPassword('');
  };

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
      const errorMsg = "网络连接异常或服务未授权，请检查设置。";

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: errorMsg
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Login View ---
  if (!isAuthorized) {
      return (
          <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] bg-slate-50 dark:bg-slate-950 px-6">
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm p-8 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 text-center animate-scale-in">
                  <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Lock size={32} />
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">AI 服务未授权</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                      请输入账号密码解锁内置通道，<br/>或在设置页面配置自定义 API Key。
                  </p>
                  
                  <div className="space-y-3">
                      <input 
                        type="text" 
                        placeholder="账号"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                      />
                      <input 
                        type="password" 
                        placeholder="密码"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                      />
                  </div>

                  {loginError && <div className="text-red-500 text-xs mt-3">{loginError}</div>}

                  <button 
                    onClick={handleLogin}
                    className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl mt-6 hover:bg-indigo-700 active:scale-95 transition"
                  >
                      解锁通道
                  </button>

                  <p className="text-xs text-slate-400 mt-4">
                      已有 API Key? 请前往 <span className="text-indigo-500 font-bold">设置</span> 页面配置
                  </p>
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
                    <Key size={10} /> 已连接
                </div>
                <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition" title="重新锁定">
                    <LogOut size={16} />
                </button>
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
