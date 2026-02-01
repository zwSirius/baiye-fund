import { GoogleGenAI } from "@google/genai";
import { Fund } from "../types";

// 获取有效的 API Key
// 优先级: 自定义 Key > 解锁后的内置 Key
export const getEffectiveApiKey = (): string | null => {
    // 1. 检查自定义 Key
    const customKey = localStorage.getItem('smartfund_custom_key');
    if (customKey && customKey.trim().length > 0) {
        return customKey;
    }
    
    // 2. 检查是否解锁内置 Key
    const isVip = localStorage.getItem('smartfund_vip_unlocked') === 'true';
    if (isVip) {
        return process.env.API_KEY || null;
    }
    
    return null; // 无可用 Key
};

export const analyzeFund = async (fund: Fund): Promise<string> => {
  const apiKey = getEffectiveApiKey();
  
  if (!apiKey) {
      return "⚠️ AI 服务未授权。\n\n请在「工具 -> AI」页面登录解锁内置通道，或在「设置」中配置自定义 API Key。";
  }

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
    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview";
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });
    return response.text || "暂时无法生成报告。";
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error.message?.includes('401') || error.message?.includes('API key')) {
        return "API Key 无效或过期，请检查配置。";
    }
    return "分析服务暂时不可用，请稍后再试。";
  }
};