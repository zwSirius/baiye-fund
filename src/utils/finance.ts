import { Fund } from '../types';

/**
 * 计算基金的各项实时指标
 * @param fund 基础基金数据
 * @param estimatedNav 最新估算净值 (GSZ)
 * @param lastNav 昨日/上一次确认净值 (DWJZ)
 * @param estimatedChangePercent 估算涨跌幅
 */
export const calculateFundMetrics = (
    shares: number,
    lastNav: number,
    estimatedNav: number,
    estimatedChangePercent: number
) => {
    // 基础公式：(最新估值 - 昨日净值) * 份额
    let profitToday = (estimatedNav - lastNav) * shares;

    // 特殊情况处理（非交易时段修正）：
    // 如果处于非交易时间，后端返回的 estNav 可能等于 lastNav，导致差值为 0。
    // 但此时涨跌幅可能不为 0（代表上个交易日的涨跌）。
    // 我们利用涨跌幅反推“当日盈亏”。
    if (Math.abs(profitToday) < 0.01 && Math.abs(estimatedChangePercent) > 0.001) {
        const currentMarketValue = estimatedNav * shares;
        const prevMarketValue = currentMarketValue / (1 + estimatedChangePercent / 100);
        profitToday = currentMarketValue - prevMarketValue;
    }

    return profitToday;
};

/**
 * 格式化金额，支持隐私模式
 */
export const formatMoney = (val: number, isHidden: boolean = false, fractionDigits: number = 2) => {
    if (isHidden) return '****';
    return val.toLocaleString('zh-CN', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
};
