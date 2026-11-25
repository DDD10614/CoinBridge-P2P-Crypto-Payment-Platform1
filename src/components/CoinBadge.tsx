import React from 'react';
import { DEFAULT_COIN_MAP } from '../lib/coins';

interface CoinBadgeProps {
  symbol: string;
  accentHex?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES: Record<NonNullable<CoinBadgeProps['size']>, string> = {
  xs: 'w-5 h-5 text-[9px]',
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-sm',
};

export function CoinBadge({ symbol, accentHex, size = 'md' }: CoinBadgeProps) {
  const sym = symbol.trim().toUpperCase();
  const color = accentHex || DEFAULT_COIN_MAP[sym]?.accentHex || '#2563EB';
  const dim = SIZE_CLASSES[size];

  if (sym === 'BTC') {
    return (
      <span
        className={`${dim} inline-flex items-center justify-center rounded-full shrink-0 font-bold text-white shadow-xs`}
        style={{ backgroundColor: '#F7931A' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-[62%] h-[62%] fill-current">
          <path d="M14.7 11.4c1-.5 1.7-1.4 1.5-2.7-.2-1.8-1.6-2.5-3.4-2.7V4h-1.4v1.9h-1.1V4H8.9v1.9H6.5v1.4h1c.6 0 .8.2.8.7v7.9c0 .4-.2.6-.7.6h-1V18h2.3v2h1.4v-2h1.1v2h1.4v-2c2.4-.2 4-1 4.2-3.2.2-1.7-.7-2.8-2.3-3.4zM10.4 7.4c1.2 0 3.2-.2 3.2 1.4 0 1.5-2 1.4-3.2 1.4V7.4zm0 8.9v-3.2c1.4 0 3.8-.2 3.8 1.6 0 1.7-2.4 1.6-3.8 1.6z" />
        </svg>
      </span>
    );
  }

  if (sym === 'ETH') {
    return (
      <span
        className={`${dim} inline-flex items-center justify-center rounded-full shrink-0 text-white shadow-xs`}
        style={{ backgroundColor: '#4F6EF7' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-[60%] h-[60%] fill-current">
          <path d="M12 2.5L5.8 12.2 12 15.8l6.2-3.6L12 2.5zm0 14.8l-6.2-3.6L12 21.5l6.2-7.8-6.2 3.6z" />
        </svg>
      </span>
    );
  }

  if (sym === 'USDT') {
    return (
      <span
        className={`${dim} inline-flex items-center justify-center rounded-full shrink-0 text-white shadow-xs`}
        style={{ backgroundColor: '#0F9D8A' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-[62%] h-[62%] fill-current">
          <path d="M6.5 6h11v2.6h-4.1v2.5c2.7.2 4.7.8 4.7 1.6s-2 1.4-4.7 1.6V19h-2.8v-4.7c-2.7-.2-4.7-.8-4.7-1.6s2-1.4 4.7-1.6V8.6H6.5V6zm5.5 7.5c2.2 0 3.9-.3 3.9-.8s-1.7-.8-3.9-.8-3.9.3-3.9.8 1.7.8 3.9.8z" />
        </svg>
      </span>
    );
  }

  if (sym === 'USDC') {
    return (
      <span
        className={`${dim} inline-flex items-center justify-center rounded-full shrink-0 text-white font-mono font-bold shadow-xs`}
        style={{ backgroundColor: '#2775CA' }}
        aria-hidden="true"
      >
        $
      </span>
    );
  }

  if (sym === 'SOL') {
    return (
      <span
        className={`${dim} inline-flex items-center justify-center rounded-full shrink-0 text-slate-950 shadow-xs`}
        style={{ background: 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-[58%] h-[58%] fill-white">
          <path d="M6.5 7h11l-1.8 2h-11L6.5 7zm0 4h11l-1.8 2h-11L6.5 11zm0 4h11l-1.8 2h-11L6.5 15z" />
        </svg>
      </span>
    );
  }

  if (sym === 'BNB') {
    return (
      <span
        className={`${dim} inline-flex items-center justify-center rounded-full shrink-0 text-slate-950 shadow-xs`}
        style={{ backgroundColor: '#F0B90B' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-[62%] h-[62%] fill-white">
          <path d="M12 4.5l3.1 3.1-1.6 1.6L12 7.7 10.5 9.2 8.9 7.6 12 4.5zm-4.4 4.4l1.6 1.6-1.6 1.5 1.6 1.5-1.6 1.6-3.1-3.1 3.1-3.1zm8.8 0l3.1 3.1-3.1 3.1-1.6-1.6 1.6-1.5-1.6-1.5 1.6-1.6zM12 10.2l1.8 1.8-1.8 1.8-1.8-1.8L12 10.2zm0 9.3l-3.1-3.1 1.6-1.6 1.5 1.5 1.5-1.5 1.6 1.6L12 19.5z" />
        </svg>
      </span>
    );
  }

  if (sym === 'XRP') {
    return (
      <span
        className={`${dim} inline-flex items-center justify-center rounded-full shrink-0 text-white shadow-xs`}
        style={{ backgroundColor: '#1D2939' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-[58%] h-[58%] fill-current">
          <path d="M5.5 6h2.6l3.9 4.2L15.9 6h2.6l-5.2 5.6a1.8 1.8 0 01-2.6 0L5.5 6zm13 12h-2.6L12 13.8 8.1 18H5.5l5.2-5.6a1.8 1.8 0 012.6 0L18.5 18z" />
        </svg>
      </span>
    );
  }

  if (sym === 'DOGE') {
    return (
      <span
        className={`${dim} inline-flex items-center justify-center rounded-full shrink-0 text-white font-display font-bold shadow-xs`}
        style={{ backgroundColor: '#C2A633' }}
        aria-hidden="true"
      >
        Ð
      </span>
    );
  }

  if (sym === 'TRX') {
    return (
      <span
        className={`${dim} inline-flex items-center justify-center rounded-full shrink-0 text-white shadow-xs`}
        style={{ backgroundColor: '#EB0029' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-[58%] h-[58%] fill-current">
          <path d="M4.5 5.5l14 3.2-5.2 10.8L4.5 5.5zm3.3 2.5l5.1 8.3 2.8-6-7.9-2.3z" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`${dim} inline-flex items-center justify-center rounded-full shrink-0 font-mono font-bold text-white shadow-xs`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {sym.slice(0, 3)}
    </span>
  );
}
