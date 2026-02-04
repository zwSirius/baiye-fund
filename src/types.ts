

export interface Stock {
  code: string;
  name: string;
  percent: number; 
  changePercent: number; 
  currentPrice?: number;
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
  amount: number; 
  shares: number; 
  nav: number; 
  fee: number; 
}

export interface Group {
  id: string;
  name: string;
  isDefault?: boolean;
}

export interface SectorIndex {
    code: string;
    name: string;
    changePercent: number;
    current: number;
}

export interface Fund {
  id: string; 
  code: string;
  name: string;
  manager: string;
  lastNav: number; 
  lastNavDate: string;
  holdings: Stock[]; 
  industryDistribution?: IndustryItem[]; 
  tags: string[]; 
  type?: string; 
  start_date?: string; 
  
  // Real-time fields
  estimatedNav: number;
  estimatedChangePercent: number;
  estimatedProfit: number; 
  estimateTime?: string; 
  source?: string; // "official_data_1" | "official_data_2" | "official_published" | "reset" | "none"
  fee?: string; 
  
  // User specific
  groupId: string; 
  holdingShares: number; 
  holdingCost: number; 
  realizedProfit: number; 
  transactions: Transaction[]; 
  isWatchlist?: boolean; 
}

export interface SectorRank {
    name: string;
    changePercent: number;
    inflow?: number; 
}

export interface FundRank {
    code: string;
    name: string;
    changePercent: number;
}

export interface MarketOverview {
    indices: any[];
    sectors: {
        top: SectorRank[];
        bottom: SectorRank[];
    };
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isThinking?: boolean;
}