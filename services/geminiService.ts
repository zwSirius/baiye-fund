import { GoogleGenAI } from "@google/genai";
import { Fund } from "../types";

// 警告：在实际生产中，不要在前端直接暴露 API Key。
// 此处仅为演示目的。process.env.API_KEY 会被 Vite 在构建时替换为字符串常量，
// 所以这里不需要担心 process 未定义的问题。
const apiKey = process.env.API_KEY || ''; 
const ai = new GoogleGenAI({ apiKey });

export const analyzeFund = async (fund: Fund): Promise<string> => {
  if (!apiKey) {
    return "API Key 未配置，无法生成 AI 报告。请在 metadata.json 或环境变量中配置。";
  }

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
    return "AI 分析服务暂时不可用，请稍后再试。";
  }
};