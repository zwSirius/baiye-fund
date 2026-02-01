import { GoogleGenAI } from "@google/genai";
import { Fund } from "../types";

export const analyzeFund = async (fund: Fund): Promise<string> => {
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
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = "gemini-3-flash-preview";
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });
    return response.text || "暂时无法生成报告。";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "分析服务暂时不可用。请检查 API Key 配置。";
  }
};