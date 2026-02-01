import { GoogleGenAI } from "@google/genai";
import { Fund } from "../types";
import { API_BASE } from "./fundService";

export const getGeminiKey = (): string => {
    // 1. 优先读取用户在设置里配置的 Key
    const userKey = localStorage.getItem('smartfund_user_gemini_key');
    if (userKey) return userKey;

    // 2. 如果没有 User Key，返回空字符串，后续逻辑将转为调用后端
    return '';
};

export const analyzeFund = async (fund: Fund): Promise<string> => {
  const userKey = getGeminiKey();
  
  const prompt = `
    你是一位专业的基金分析师。请根据以下基金数据，生成一份简短的投资分析报告（200字以内）。
    
    基金名称：${fund.name} (${fund.code})
    基金经理：${fund.manager}
    标签：${fund.tags.join(', ')}
    今日实时预估涨跌：${fund.estimatedChangePercent}%
    
    前五大重仓股：
    ${fund.holdings.slice(0, 5).map(h => `${h.name} (${h.percent}%)`).join(', ')}
    
    请分析：
    1. 该基金的行业集中度风险。
    2. 基于今日预估涨跌，给出短期操作建议（持有/定投/止盈）。
    3. 语气要专业、客观但通俗易懂。
  `;

  // 策略 A: 私有通道 (前端直接调用)
  if (userKey) {
      const ai = new GoogleGenAI({ apiKey: userKey });
      const model = "gemini-3-flash-preview";
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
        });
        return response.text || "暂时无法生成报告。";
      } catch (error) {
        console.error("Gemini Frontend API Error:", error);
        return "您的 API Key 可能无效，请检查设置。";
      }
  }

  // 策略 B: 公共通道 (后端代理调用)
  try {
      const response = await fetch(`${API_BASE}/api/analyze`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({ prompt: prompt })
      });
      
      if (!response.ok) {
          throw new Error("Backend analysis failed");
      }
      
      const data = await response.json();
      return data.text || "生成失败";
  } catch (error) {
      console.warn("Backend API Error:", error);
      return "AI 分析服务暂时不可用 (后端未配置 Key 或网络问题)，请在设置中填入您自己的 API Key 尝试私有通道。";
  }
};
