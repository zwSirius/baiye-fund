import { Fund } from '../types';

export const calculateFundMetrics = (
    shares: number,
    lastNav: number,
    estimatedNav: number,
    estimatedChangePercent: number
) => {
    let profitToday = (estimatedNav - lastNav) * shares;

    // Special handling for non-trading hours where Nav equals estimatedNav but change percent exists
    if (Math.abs(profitToday) < 0.01 && Math.abs(estimatedChangePercent) > 0.001) {
        const currentMarketValue = estimatedNav * shares;
        const prevMarketValue = currentMarketValue / (1 + estimatedChangePercent / 100);
        profitToday = currentMarketValue - prevMarketValue;
    }

    return profitToday;
};

export const formatMoney = (val: number, isHidden: boolean = false, fractionDigits: number = 2) => {
    if (isHidden) return '****';
    return val.toLocaleString('zh-CN', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
};