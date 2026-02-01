import { GoogleGenAI } from "@google/genai";
import { Fund } from "../types";

export const getGeminiKey = (): string => {
    // 1. 优先读取用户在设置里配置的 Key
    const userKey = localStorage.getItem('smartfund_user_gemini_key');
    if (userKey) return userKey;

    // 2. 其次读取环境变量 (构建时注入的默认 Key)
    // 注意：如果是分享给朋友，建议不要在 .env 中放入敏感 Key，或者提示他们必须填自己的
    return process.env.API_KEY || '';
};

export const analyzeFund = async (fund: Fund): Promise<string> => {
  const apiKey = getGeminiKey();
  
  if (!apiKey) {
    return "请在【设置】页面配置您的 Google Gemini API Key 即可使用智能分析服务。";
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";

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

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });
    return response.text || "暂时无法生成报告。";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "AI 分析服务暂时不可用，可能是 API Key 无效或网络问题。";
  }
};