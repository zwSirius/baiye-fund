
export interface Stock {
  code: string;
  name: string;
  percent: number; // 持仓占比 (e.g., 8.5 for 8.5%)
  currentPrice: number;
  changePercent: number; // 涨跌幅 (e.g., 1.2 for +1.2%)
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
  id: string; // Unique ID (composite of code + groupId to allow same fund in diff groups)
  code: string;
  name: string;
  manager: string;
  lastNav: number; // 昨日净值
  lastNavDate: string;
  holdings: Stock[]; // 十大重仓
  tags: string[]; // e.g. "科技", "白酒", "高风险"
  
  // Real-time calculated fields
  estimatedNav: number;
  estimatedChangePercent: number;
  estimatedProfit: number; // 今日预估盈亏
  source?: string; // "official" | "holdings_calc"
  
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
  code: string; // Add code to track it
  changePercent: number;
  score: number; // 0-100 hot score
  leadingStock: string; // 领涨股
  value?: number; // 当前点位
}

export interface MarketSentiment {
  score: number; // 0-100
  status: 'Fear' | 'Neutral' | 'Greed';
  description: string;
}

export enum TabView {
  DASHBOARD = 'DASHBOARD',
  WATCHLIST = 'WATCHLIST', // 新增自选页
  MARKET = 'MARKET',
  TOOLS = 'TOOLS',
  BACKTEST = 'BACKTEST',
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
