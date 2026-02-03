
import React, { useState, useEffect } from 'react';
import { Fund, Transaction, TransactionType } from '../types';
import { getNavByDate } from '../services/fundService';
import { X, Calendar, DollarSign, Calculator, Loader2 } from 'lucide-react';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  fund: Fund;
  type: TransactionType;
  onConfirm: (transaction: Transaction) => void;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({ isOpen, onClose, fund, type, onConfirm }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState('');
  const [feeRate, setFeeRate] = useState('0.15'); // 默认费率 0.15%
  
  const [nav, setNav] = useState<number | null>(null);
  const [isLoadingNav, setIsLoadingNav] = useState(false);

  // 当日期变化时，模拟获取当日净值
  useEffect(() => {
    if (isOpen) {
        const fetchNav = async () => {
            setIsLoadingNav(true);
            const val = await getNavByDate(fund.code, date);
            setNav(val);
            setIsLoadingNav(false);
        };
        fetchNav();
    }
  }, [date, fund.code, isOpen]);

  if (!isOpen) return null;

  const numAmount = parseFloat(amount);
  const numFeeRate = parseFloat(feeRate) / 100;
  
  // 计算逻辑
  // 买入: 净认购金额 = 申请金额 / (1 + 费率)
  //       份额 = 净认购金额 / 净值
  // 卖出: 赎回总额 = 份额 * 净值
  //       赎回费 = 赎回总额 * 费率
  //       到手金额 = 赎回总额 - 赎回费
  
  let estimatedShares = 0;
  let estimatedFee = 0;

  if (nav && numAmount > 0) {
      if (type === 'BUY') {
          const netAmount = numAmount / (1 + numFeeRate);
          estimatedFee = numAmount - netAmount;
          estimatedShares = netAmount / nav;
      } else {
          // 卖出金额 (假设为赎回总资产，不含费)
          // 实际到手 = Amount * (1 - fee)
          // 份额 = Amount / Nav
          estimatedShares = numAmount / nav;
          estimatedFee = numAmount * numFeeRate;
      }
  }

  const handleConfirm = () => {
      if (!nav || !numAmount) return;
      
      const transaction: Transaction = {
          id: Date.now().toString(),
          type,
          date,
          amount: numAmount,
          shares: parseFloat(estimatedShares.toFixed(2)),
          nav: nav,
          fee: parseFloat(estimatedFee.toFixed(2))
      };
      
      onConfirm(transaction);
      onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white rounded-2xl w-[90%] max-w-[320px] shadow-2xl z-10 overflow-hidden animate-scale-in">
        <div className={`p-3 text-white flex justify-between items-center ${type === 'BUY' ? 'bg-up-red' : 'bg-green-600'}`}>
           <h3 className="font-bold text-sm">{type === 'BUY' ? '买入' : '卖出'} - {fund.name}</h3>
           <button onClick={onClose}><X size={18}/></button>
        </div>

        <div className="p-4 space-y-3">
            {/* 日期选择 */}
            <div>
                <label className="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
                    <Calendar size={12}/> 交易日期
                </label>
                <div className="flex gap-2">
                    <input 
                        type="date" 
                        value={date} 
                        onChange={e => setDate(e.target.value)}
                        className="flex-1 p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium"
                    />
                    <div className="flex items-center bg-slate-50 px-2 rounded-lg border border-slate-100">
                         {isLoadingNav ? (
                            <Loader2 size={12} className="animate-spin text-blue-500" />
                        ) : (
                            <span className="font-bold text-slate-700 text-xs">净值 {nav?.toFixed(4)}</span>
                        )}
                    </div>
                </div>
            </div>

            {/* 金额输入 */}
            <div>
                <label className="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
                    <DollarSign size={12}/> {type === 'BUY' ? '买入金额' : '卖出金额(估算)'}
                </label>
                <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-400 font-bold text-sm">¥</span>
                    <input 
                        type="number" 
                        value={amount} 
                        onChange={e => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-base font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                </div>
            </div>

            {/* 费率输入 */}
            <div>
                <label className="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
                    <Calculator size={12}/> 手续费率 (%)
                </label>
                <input 
                    type="number" 
                    value={feeRate} 
                    onChange={e => setFeeRate(e.target.value)}
                    placeholder="0.15"
                    step="0.01"
                    className="w-full p-1.5 border border-slate-200 rounded-lg text-xs font-medium"
                />
            </div>

            {/* 结果预览 */}
            <div className="bg-blue-50 p-3 rounded-xl space-y-1">
                <div className="flex justify-between text-xs">
                    <span className="text-slate-500">预估手续费</span>
                    <span className="font-medium">¥{estimatedFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs">
                    <span className="text-slate-500">确认份额</span>
                    <span className="font-bold text-blue-700 text-sm">{estimatedShares.toFixed(2)} 份</span>
                </div>
            </div>

            <button 
                onClick={handleConfirm}
                disabled={!nav || !numAmount || numAmount <= 0}
                className={`w-full py-2.5 rounded-xl text-white font-bold text-sm shadow-lg transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${type === 'BUY' ? 'bg-up-red shadow-red-200' : 'bg-green-600 shadow-green-200'}`}
            >
                确认{type === 'BUY' ? '买入' : '卖出'}
            </button>
        </div>
      </div>
    </div>
  );
};
