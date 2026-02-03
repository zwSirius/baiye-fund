
export interface Stock {
  code: string;
  name: string;
  percent: number; // 持仓占比 (e.g., 8.5 for 8.5%)
  currentPrice: number;
  changePercent: number; // 涨跌幅 (e.g., 1.2 for +1.2%)
}

export interface IndustryItem {
    name: string;
    percent: number;
}

export type TransactionType = 'BUY' | 'SELL';

export interface Transaction {
  id: string;
  type: TransactionType;
  date: string;
  amount: number; // 发生金额 (元)
  shares: number; // 确认份额
  nav: number; // 成交净值
  fee: number; // 手续费
}

export interface Group {
  id: string;
  name: string;
  isDefault?: boolean;
}

export interface Fund {
  id: string; // Unique ID
  code: string;
  name: string;
  manager: string;
  lastNav: number; // 昨日净值
  lastNavDate: string;
  holdings: Stock[]; // 十大重仓
  industryDistribution?: IndustryItem[]; // 行业配置
  tags: string[]; // e.g. "科技", "白酒"
  type?: string; // e.g. "混合型", "指数型"
  start_date?: string; // 成立日期
  
  // Real-time calculated fields
  estimatedNav: number;
  estimatedChangePercent: number;
  estimatedProfit: number; // 今日预估盈亏
  estimateTime?: string; // 估值更新时间 e.g. "14:30"
  source?: string; // "official" | "holdings_calc" | "official_final"
  
  // User specific
  groupId: string; // 所属分组ID
  holdingShares: number; // 用户持有份额
  holdingCost: number; // 持仓成本 (单位净值成本)
  realizedProfit: number; // 已落袋收益 (累计收益修正项)
  transactions: Transaction[]; // 交易记录
  isWatchlist?: boolean; // 是否仅为自选关注
}

export interface SectorIndex {
  name: string;
  code: string;
  changePercent: number;
  score: number; // 0-100 hot score
  value?: number; // 当前点位
}

export interface SectorRank {
    name: string;
    changePercent: number;
    leadingStock: string;
}

export interface FundRank {
    code: string;
    name: string;
    changePercent: number;
    nav: number;
}

export interface MarketFundFlow {
    date: string;
    main_net_inflow: number; // 主力净流入
    main_net_ratio: number;
    sh_close: number;
    sh_change: number;
    sz_close: number;
    sz_change: number;
}

export interface SectorFlowRank {
    name: string;
    change: number;
    netInflow: number;
}

export interface FundFlowData {
    market: MarketFundFlow | null;
    sectorFlow: {
        inflow: SectorFlowRank[];
        outflow: SectorFlowRank[];
    };
}

export interface MarketOverview {
    indices: SectorIndex[];
    sectors: {
        top: SectorRank[];
        bottom: SectorRank[];
    };
    fundFlow?: FundFlowData; // Optional for backward compatibility
    fundRankings: {
        gainers: FundRank[];
        losers: FundRank[];
    }
}

export enum TabView {
  DASHBOARD = 'DASHBOARD',
  WATCHLIST = 'WATCHLIST',
  CALENDAR = 'CALENDAR',
  MARKET = 'MARKET',
  AI_INSIGHTS = 'AI_INSIGHTS',
  SETTINGS = 'SETTINGS'
}

// Backtest related types
export interface BacktestPoint {
  date: string;
  value: number; // Portfolio total value
}

export interface BacktestResult {
  totalReturn: number; // Percentage
  annualizedReturn: number; // Percentage
  maxDrawdown: number; // Percentage (positive number representing drop)
  chartData: BacktestPoint[];
  finalValue: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isThinking?: boolean;
}
