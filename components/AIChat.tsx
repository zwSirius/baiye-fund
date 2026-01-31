import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { ChatMessage } from '../types';
import { Send, Bot, User, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface AIChatProps {
  apiKey?: string;
}

export const AIChat: React.FC<AIChatProps> = ({ apiKey }) => {
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
      // 如果没有 API Key，使用模拟回复
      if (!apiKey && process.env.NODE_ENV !== 'production') {
         // Fallback mock response for demo without key
         setTimeout(() => {
            const mockResponse: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: "由于未配置真实的 Gemini API Key，这是一个模拟回复。\n\n在真实环境中，我会根据您的提问：**“" + userMsg.text + "”** 进行深度分析。"
            };
            setMessages(prev => [...prev, mockResponse]);
            setIsLoading(false);
         }, 1500);
         return;
      }

      const ai = new GoogleGenAI({ apiKey: apiKey || process.env.API_KEY || '' });
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
        text: "网络连接异常，请稍后再试。"
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
        <div className="bg-white p-4 shadow-sm border-b border-slate-100 flex items-center gap-2">
            <Sparkles className="text-indigo-500" size={20} />
            <h2 className="font-bold text-slate-800">AI 投资顾问</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
            {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-slate-200' : 'bg-indigo-100 text-indigo-600'}`}>
                        {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className={`max-w-[80%] rounded-2xl p-3 text-sm leading-relaxed shadow-sm ${
                        msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none'
                    }`}>
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                </div>
            ))}
            {isLoading && (
                 <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
                        <Bot size={16} />
                    </div>
                    <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm flex items-center">
                        <Loader2 className="animate-spin text-indigo-500" size={16} />
                        <span className="text-xs text-slate-400 ml-2">正在思考...</span>
                    </div>
                 </div>
            )}
            <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-slate-200">
            <div className="relative flex items-center">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="问问它：现在适合买白酒吗？"
                    className="w-full bg-slate-100 text-slate-800 rounded-full pl-4 pr-12 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <button 
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="absolute right-2 p-2 bg-indigo-600 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition"
                >
                    <Send size={16} />
                </button>
            </div>
        </div>
    </div>
  );
};
