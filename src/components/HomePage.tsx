import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Lock,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  BLOCKCHAIN_NETWORKS,
  calculateBuyBreakdown,
  calculateSellBreakdown,
  formatInrFromPaise,
  formatRateInr,
  formatUsdtFromMicro,
  MICRO_PER_USDT,
  PAISE_PER_INR,
} from '../lib/domain';
import { useAuth } from '../context/AuthContext';
import { AppRoute } from './Header';
import { P2POfferDoc, ReviewDoc } from '../types/models';

import { CoinBadge } from './CoinBadge';
import { DEFAULT_SUPPORTED_COINS, formatSpotInr } from '../lib/coins';

interface HomePageProps {
  onNavigate: (route: AppRoute) => void;
  onOpenCoinDetail?: (symbol: string) => void;
  onOpenMarketplace?: (mode: 'buy' | 'sell', symbol?: string) => void;
}

interface RateResponse {
  rateInr: number;
  rateInrPaise: number;
  change24hPct?: number | null;
  source: string;
  isLive?: boolean;
  isIllustrative: boolean;
  cached?: boolean;
  apiKeyConfigured?: boolean;
  fetchedAt: string;
  fallbackReason?: string;
}

interface HomeMarketQuote {
  symbol: string;
  name: string;
  inrPrice: number | null;
  change24hPct: number | null;
}

export function HomePage({ onNavigate, onOpenCoinDetail, onOpenMarketplace }: HomePageProps) {
  const { platformSettings, user, signInWithGoogle } = useAuth();
  const [calcSide, setCalcSide] = useState<'BUY' | 'SELL'>('BUY');
  const [inrInput, setInrInput] = useState('10000');
  const [usdtInput, setUsdtInput] = useState('100');
  const [rateInfo, setRateInfo] = useState<RateResponse>({
    rateInr: platformSettings.baseUsdtInrPaise / PAISE_PER_INR,
    rateInrPaise: platformSettings.baseUsdtInrPaise,
    source: 'Fallback Reference (MARKET_RATE_FALLBACK_INR)',
    isLive: false,
    isIllustrative: true,
    fetchedAt: new Date().toISOString(),
  });
  const [marketPreview, setMarketPreview] = useState<{
    coins: HomeMarketQuote[];
    freshnessStatus: string;
  }>({ coins: [], freshnessStatus: 'CONNECTING' });
  const [stats, setStats] = useState<{
    activeOffers: number;
    verifiedMerchants: number;
    totalLiquidityUsdtMicro: number;
    approvedReviews: ReviewDoc[];
  }>({
    activeOffers: 0,
    verifiedMerchants: 0,
    totalLiquidityUsdtMicro: 0,
    approvedReviews: [],
  });
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/rates/usdt-inr')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: RateResponse | null) => {
        if (!cancelled && data && data.rateInrPaise) {
          setRateInfo(data);
        }
      })
      .catch(() => {});

    fetch('/api/markets')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { coins?: HomeMarketQuote[]; freshnessStatus?: string } | null) => {
        if (!cancelled && data?.coins) {
          setMarketPreview({
            coins: data.coins,
            freshnessStatus: data.freshnessStatus || 'LIVE',
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPublicStats() {
      try {
        const [offersSnap, merchantsSnap, reviewsSnap] = await Promise.all([
          getDocs(query(collection(db, 'p2p_offers'), where('isActive', '==', true), limit(50))),
          getDocs(query(collection(db, 'merchants'), limit(50))),
          getDocs(query(collection(db, 'reviews'), where('approved', '==', true), limit(6))),
        ]);

        if (cancelled) return;
        let liquidityMicro = 0;
        offersSnap.forEach((d) => {
          const offer = d.data() as P2POfferDoc;
          liquidityMicro += offer.availableUsdtMicro || 0;
        });

        const approvedReviews: ReviewDoc[] = [];
        reviewsSnap.forEach((d) => {
          approvedReviews.push({ id: d.id, ...(d.data() as Omit<ReviewDoc, 'id'>) });
        });

        setStats({
          activeOffers: offersSnap.size,
          verifiedMerchants: merchantsSnap.size,
          totalLiquidityUsdtMicro: liquidityMicro,
          approvedReviews,
        });
      } catch {
        // Keep clean zeros if database has not been seeded yet
      } finally {
        if (!cancelled) setStatsLoaded(true);
      }
    }
    void loadPublicStats();
    return () => {
      cancelled = true;
    };
  }, []);

  const parsedInrPaise = Math.max(0, Math.round((Number(inrInput) || 0) * PAISE_PER_INR));
  const parsedUsdtMicro = Math.max(0, Math.round((Number(usdtInput) || 0) * MICRO_PER_USDT));

  const buyCalc = calculateBuyBreakdown({
    inrPaise: parsedInrPaise,
    rateInrPaise: rateInfo.rateInrPaise,
    buyerFeeBps: platformSettings.buyerFeeBps,
    tdsRateBps: platformSettings.tdsRateBps,
  });

  const sellCalc = calculateSellBreakdown({
    usdtMicro: parsedUsdtMicro,
    rateInrPaise: rateInfo.rateInrPaise,
    sellerFeeBps: platformSettings.sellerFeeBps,
    tdsRateBps: platformSettings.tdsRateBps,
  });

  const faqs = [
    {
      q: 'How does CoinBridge P2P protect USDT during an INR transfer?',
      a: 'Before you send INR via UPI, IMPS, NEFT, or RTGS, the seller’s USDT is locked inside the order’s escrow workflow. USDT is never released based on a screenshot alone—settlement proceeds only after independent payment confirmation and risk verification.',
    },
    {
      q: 'Why is KYC verification mandatory before full P2P trading?',
      a: 'India’s PMLA and FIU-IND guidelines require customer identity verification (PAN/Government ID), bank account ownership matching, and sanctions/PEP screening so buyers and sellers only transact with verified counterparties.',
    },
    {
      q: 'How is Section 194S 1% TDS handled on USDT/INR trades?',
      a: 'Every order preview transparently calculates and displays the applicable Section 194S VDA TDS deduction rate configured by compliance administrators alongside platform trading fees before you confirm an order.',
    },
    {
      q: 'Which blockchain networks are supported for USDT deposits and withdrawals?',
      a: 'CoinBridge P2P configures verified USDT contracts across TRON (TRC-20), Ethereum (ERC-20), Polygon PoS, and BNB Smart Chain (BEP-20), with non-custodial wallet signatures and confirmation tracking.',
    },
  ];

  const featuredSymbols = ['BTC', 'ETH', 'USDT', 'USDC', 'SOL'];

  return (
    <div className="bg-slate-50 dark:bg-slate-950">
      {/* 1. Hero & Trading Calculator */}
      <section className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            {/* Left column: Value proposition + CTAs + Hero visual */}
            <div className="lg:col-span-7 flex flex-col justify-between gap-8">
              <div className="space-y-5">
                <div className="text-xs font-medium text-blue-700 dark:text-blue-400 tracking-wide">
                  Multi-Coin P2P &amp; USDT / INR Desk · India Payment Rails ·{' '}
                  {platformSettings.sandboxMode ? 'Sandbox Mode Active' : 'Live Settlement'}
                </div>

                <h1
                  className="font-display font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-[1.1]"
                  style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', textWrap: 'balance' }}
                >
                  Buy and Sell Crypto Directly. Securely. Simply.
                </h1>

                <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                  Trade USDT and Admin-approved crypto assets with verified people using trusted
                  local payment methods. Built with KYC identity screening, escrow protection, and
                  live INR market analytics.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => (onOpenMarketplace ? onOpenMarketplace('buy', 'USDT') : onNavigate('buy'))}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Buy Crypto
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => (onOpenMarketplace ? onOpenMarketplace('sell', 'USDT') : onNavigate('sell'))}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Sell Crypto
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('markets')}
                    className="inline-flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Live Markets &amp; Charts
                  </button>
                </div>
              </div>

              <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 aspect-[16/9]">
                <img
                  src="/src/assets/images/hero_fintech_exchange_1795498318330.jpg"
                  alt="Minimalist architectural fintech glass and titanium currency infrastructure"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Right column: Functional Trading Calculator */}
            <div className="lg:col-span-5 flex flex-col">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-7 flex-1 flex flex-col justify-between gap-6">
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                      USDT / INR Rate Calculator
                    </h2>
                    <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setCalcSide('BUY')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          calcSide === 'BUY'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Buy USDT
                      </button>
                      <button
                        type="button"
                        onClick={() => setCalcSide('SELL')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          calcSide === 'SELL'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Sell USDT
                      </button>
                    </div>
                  </div>

                  {calcSide === 'BUY' ? (
                    <div className="space-y-4">
                      <div>
                        <label
                          htmlFor="calc-inr"
                          className="block text-xs font-medium text-slate-600 mb-1.5"
                        >
                          You Pay (INR)
                        </label>
                        <div className="relative">
                          <input
                            id="calc-inr"
                            type="number"
                            min={1000}
                            step={500}
                            value={inrInput}
                            onChange={(e) => setInrInput(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 pr-16 font-mono text-base font-medium text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                            INR
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {['5000', '10000', '25000', '50000'].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setInrInput(preset)}
                            className="px-2.5 py-1 text-xs font-mono tabular-nums rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            ₹{Number(preset).toLocaleString('en-IN')}
                          </button>
                        ))}
                      </div>

                      <div className="border-t border-slate-200 pt-4 space-y-2.5 text-sm">
                        <div className="flex justify-between text-slate-600">
                          <span>Reference Exchange Rate</span>
                          <span className="font-mono tabular-nums font-medium text-slate-900">
                            {formatRateInr(rateInfo.rateInrPaise)} / USDT
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Estimated Gross USDT</span>
                          <span className="font-mono tabular-nums text-slate-900">
                            {formatUsdtFromMicro(buyCalc.grossUsdtMicro, 2)}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>
                            Platform Buyer Fee ({(platformSettings.buyerFeeBps / 100).toFixed(2)}%)
                          </span>
                          <span className="font-mono tabular-nums text-slate-900">
                            -{formatUsdtFromMicro(buyCalc.feeUsdtMicro, 4)}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>
                            Sec 194S TDS Disclosure ({(platformSettings.tdsRateBps / 100).toFixed(2)}%)
                          </span>
                          <span className="font-mono tabular-nums text-slate-700">
                            {formatInrFromPaise(buyCalc.tdsInrPaise)}
                          </span>
                        </div>
                        <div className="border-t border-slate-200 pt-3 flex justify-between items-baseline">
                          <span className="font-semibold text-slate-900">Final Estimated USDT</span>
                          <span className="font-mono text-xl font-bold text-blue-700 tabular-nums">
                            {formatUsdtFromMicro(buyCalc.netUsdtMicro, 2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label
                          htmlFor="calc-usdt"
                          className="block text-xs font-medium text-slate-600 mb-1.5"
                        >
                          You Sell (USDT)
                        </label>
                        <div className="relative">
                          <input
                            id="calc-usdt"
                            type="number"
                            min={10}
                            step={10}
                            value={usdtInput}
                            onChange={(e) => setUsdtInput(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 pr-16 font-mono text-base font-medium text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                            USDT
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {['50', '100', '250', '500'].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setUsdtInput(preset)}
                            className="px-2.5 py-1 text-xs font-mono tabular-nums rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            {preset} USDT
                          </button>
                        ))}
                      </div>

                      <div className="border-t border-slate-200 pt-4 space-y-2.5 text-sm">
                        <div className="flex justify-between text-slate-600">
                          <span>Reference Exchange Rate</span>
                          <span className="font-mono tabular-nums font-medium text-slate-900">
                            {formatRateInr(rateInfo.rateInrPaise)} / USDT
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>
                            Seller Fee ({(platformSettings.sellerFeeBps / 100).toFixed(2)}%)
                          </span>
                          <span className="font-mono tabular-nums text-slate-900">
                            -{formatUsdtFromMicro(sellCalc.feeUsdtMicro, 4)}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Gross INR Value</span>
                          <span className="font-mono tabular-nums text-slate-900">
                            {formatInrFromPaise(sellCalc.grossInrPaise)}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>
                            Est. Sec 194S TDS ({(platformSettings.tdsRateBps / 100).toFixed(2)}%)
                          </span>
                          <span className="font-mono tabular-nums text-slate-700">
                            -{formatInrFromPaise(sellCalc.tdsInrPaise)}
                          </span>
                        </div>
                        <div className="border-t border-slate-200 pt-3 flex justify-between items-baseline">
                          <span className="font-semibold text-slate-900">Net INR Payout</span>
                          <span className="font-mono text-xl font-bold text-blue-700 tabular-nums">
                            {formatInrFromPaise(sellCalc.netInrPaise)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-xs text-slate-600 leading-relaxed space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 font-medium">
                      <span className={rateInfo.isLive ? 'text-emerald-700' : 'text-amber-700'}>
                        {rateInfo.isLive
                          ? 'Live Market Price (CoinGecko API)'
                          : 'Fallback Reference Price (MARKET_RATE_FALLBACK_INR)'}
                      </span>
                      {typeof rateInfo.change24hPct === 'number' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-slate-700">
                            24h {rateInfo.change24hPct >= 0 ? '+' : ''}
                            {rateInfo.change24hPct.toFixed(2)}%
                          </span>
                        </>
                      )}
                      {rateInfo.cached && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-500">Cached</span>
                        </>
                      )}
                    </div>
                    <p className="text-slate-500">
                      Source: {rateInfo.source}.{' '}
                      {rateInfo.isIllustrative
                        ? 'Fallback illustrative value shown; live P2P offers use merchant-configured rates.'
                        : 'Live CoinGecko spot reference; actual P2P offer quotes vary by merchant and payment method.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate(calcSide === 'BUY' ? 'buy' : 'sell')}
                    className="w-full py-3 px-4 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    {calcSide === 'BUY' ? 'View Verified Sellers' : 'View Verified Buyers'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Platform Statistics from Real Database Records */}
          <div className="mt-10 pt-8 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Active P2P Offers (DB)
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {statsLoaded ? stats.activeOffers : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Registered Merchants (DB)
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {statsLoaded ? stats.verifiedMerchants : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Listed USDT Liquidity
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {statsLoaded ? formatUsdtFromMicro(stats.totalLiquidityUsdtMicro, 0) : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Primary Settlement Pair
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                USDT / INR
              </div>
            </div>
          </div>

          {/* 2b. Live Multi-Coin INR Markets Preview */}
          <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                  Live Multi-Coin INR Markets ({marketPreview.freshnessStatus})
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Inspect live CoinGecko INR spot quotes, candlestick charts, and technical analysis
                  across supported digital assets.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('markets')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer self-start"
              >
                Open All 9+ Markets &amp; Charts
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {featuredSymbols.map((sym) => {
                const cfg = DEFAULT_SUPPORTED_COINS.find((c) => c.symbol === sym);
                const live = marketPreview.coins.find((q) => q.symbol === sym);
                const pct = live?.change24hPct;
                return (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => (onOpenCoinDetail ? onOpenCoinDetail(sym) : onNavigate('markets'))}
                    className="text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 hover:border-blue-400 dark:hover:border-blue-600 transition-colors cursor-pointer space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CoinBadge symbol={sym} accentHex={cfg?.accentHex} size="sm" />
                        <div>
                          <div className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
                            {sym}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {cfg?.name || sym}
                          </div>
                        </div>
                      </div>
                      {typeof pct === 'number' && (
                        <span
                          className={`font-mono text-[11px] font-semibold tabular-nums ${
                            pct >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {pct >= 0 ? '+' : ''}
                          {pct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {live?.inrPrice !== undefined ? formatSpotInr(live.inrPrice) : 'Loading...'}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {cfg?.tradingEnabled && cfg?.custodyApproved
                        ? 'P2P Trading Approved'
                        : 'Charting Active · Pending Admin'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* 3. How P2P Trading Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5">
            <div className="rounded-xl overflow-hidden border border-slate-200 bg-white aspect-[4/3]">
              <img
                src="/src/assets/images/how_it_works_escrow_1795498317839.jpg"
                alt="Interlocking escrow plates and digital settlement blocks"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-2">
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                Structured Escrow-Protected P2P Settlement
              </h2>
              <p className="text-slate-600 text-sm sm:text-base">
                Every USDT/INR trade follows an atomic state lifecycle with independent payment
                verification—screenshots alone never trigger crypto release.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {[
                {
                  num: '01. Verify Identity & Wallet',
                  desc: 'Complete KYC verification (PAN, Government ID, bank ownership) and link your non-custodial wallet.',
                },
                {
                  num: '02. Match & Lock Escrow',
                  desc: 'Choose a verified counterparty rate. Seller reserves the exact USDT amount in the escrow mechanism.',
                },
                {
                  num: '03. Transfer & Verify INR',
                  desc: 'Send INR via UPI, IMPS, NEFT, or RTGS and submit the bank UTR reference for independent verification.',
                },
                {
                  num: '04. Release & Reconcile',
                  desc: 'Once payment and compliance checks clear, USDT settles to the buyer with an immutable audit log.',
                },
              ].map((step) => (
                <div key={step.num} className="bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="font-display text-sm font-semibold text-slate-900">{step.num}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>

            <div>
              <button
                type="button"
                onClick={() => onNavigate('how-it-works')}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                Explore the full 10-step trade workflow
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Security & Risk Architecture */}
      <section className="bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="space-y-2">
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                  Compliance, Risk Triage, and Non-Custodial Wallet Discipline
                </h2>
                <p className="text-slate-600 text-sm sm:text-base">
                  No peer-to-peer system is completely risk-free. CoinBridge P2P layers KYC/AML
                  screening, AI-assisted risk scoring for human review, and strict payment-ownership
                  rules to reduce counterparty exposure.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                  <ShieldCheck className="w-5 h-5 text-blue-600" />
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    KYC & Name Matching
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Masked ID storage, bank account holder matching, PEP/sanctions screening, and
                    compliance audit logs.
                  </p>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                  <Lock className="w-5 h-5 text-blue-600" />
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    AI Risk Triage
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    0–100 transaction risk scores flag unusual INR sizes or new accounts for human
                    compliance review.
                  </p>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                  <Wallet className="w-5 h-5 text-blue-600" />
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    Zero Seed Storage
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Never asks for private keys or seed phrases. Supports EIP-1193 wallet message
                    signing and tx verification.
                  </p>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => onNavigate('security')}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                >
                  Read Security & India Regulatory Framework
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 aspect-[4/3]">
                <img
                  src="/src/assets/images/security_vault_architecture_1795498318584.jpg"
                  alt="Hardware security module representing cryptographic key protection"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Payment Rails & Blockchain Support */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-16 space-y-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="font-display text-xl font-bold text-slate-900">
              Supported INR Payment Rails
            </h3>
            <p className="text-sm text-slate-600">
              Configurable domestic INR settlement methods with duplicate UTR detection and account
              holder name verification.
            </p>
            <div className="divide-y divide-slate-100">
              {[
                ['UPI', 'Instant mobile transfers · Verified VPA handle matching'],
                ['IMPS', '24x7 immediate interbank settlement · UTR reconciliation'],
                ['NEFT', 'Standard batch bank transfers for mid-tier orders'],
                ['RTGS', 'High-value INR settlement for verified liquidity desks'],
                ['Bank Transfer', 'Direct domestic IFSC-verified account transfer'],
              ].map(([name, detail]) => (
                <div key={name} className="py-3 flex items-center justify-between gap-4 text-sm">
                  <span className="font-semibold text-slate-900">{name}</span>
                  <span className="text-slate-600 text-right">{detail}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="font-display text-xl font-bold text-slate-900">
              Supported USDT Blockchain Networks
            </h3>
            <p className="text-sm text-slate-600">
              Verified USDT token contract addresses configured per network with confirmation
              thresholds.
            </p>
            <div className="divide-y divide-slate-100">
              {Object.values(BLOCKCHAIN_NETWORKS).map((net) => (
                <div key={net.id} className="py-3 flex items-center justify-between gap-4 text-sm">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {net.name} · {net.tokenStandard}
                    </div>
                    <div className="font-mono text-xs text-slate-500 truncate max-w-[260px]">
                      {net.usdtContractAddress}
                    </div>
                  </div>
                  <div className="text-right font-mono text-xs text-slate-700 tabular-nums shrink-0">
                    <div>Est. Fee: {formatUsdtFromMicro(net.estimatedNetworkFeeUsdtMicro, 2)}</div>
                    <div className="text-slate-500">{net.requiredConfirmations} confs</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 6. Merchant Liquidity & Approved Trader Reviews */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5 bg-slate-900 text-white rounded-xl p-7 flex flex-col justify-between gap-6">
            <div className="space-y-3">
              <div className="text-xs font-medium text-blue-300">
                Merchant & Liquidity Desk
              </div>
              <h3 className="font-display text-2xl font-bold tracking-tight">
                Provide USDT / INR Liquidity with Configurable Spreads
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Verified merchants set their own buy/sell quotes within admin-governed bounds,
                manage active availability, and track settlement history without fabricated yield
                promises.
              </p>
            </div>
            <div className="space-y-2 text-sm text-slate-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
                <span>KYB & bank ownership onboarding</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Configurable min/max INR order limits</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Real-time order queue & dispute response tools</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => (user ? onNavigate('merchants') : void signInWithGoogle())}
              className="w-full py-2.5 px-4 text-sm font-semibold bg-white text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {user ? 'Open Merchant Desk' : 'Sign In to Apply as Merchant'}
            </button>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                Verified Trader Feedback
              </h3>
              <span className="text-xs text-slate-500">
                Admin-approved reviews from completed orders only
              </span>
            </div>

            {stats.approvedReviews.length === 0 ? (
              <div className="py-10 text-center space-y-2 border border-dashed border-slate-200 rounded-lg">
                <p className="text-sm font-medium text-slate-700">
                  No approved customer testimonials published yet.
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  CoinBridge P2P does not fabricate reviews. Genuine trader ratings appear here once
                  submitted on completed orders and approved by administrators.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {stats.approvedReviews.map((rev) => (
                  <div key={rev.id} className="border border-slate-200 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold text-slate-900">{rev.authorName}</span>
                      <span className="font-mono tabular-nums">{rev.rating}/5</span>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">{rev.comment}</p>
                    <div className="text-xs text-slate-400">{rev.roleLabel}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 7. FAQ Preview & Support CTA */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900">
                Frequently Asked Questions
              </h2>
              <p className="text-sm text-slate-600">
                Key answers on escrow protection, KYC verification, India TDS, and settlement rails.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('faq')}
                className="px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                All FAQs
              </button>
              <button
                type="button"
                onClick={() => onNavigate('contact')}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
              >
                Contact Support
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-200">
            {faqs.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q} className="py-3.5">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left font-medium text-slate-900 text-sm cursor-pointer"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-500 transition-transform shrink-0 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed pr-6">{item.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
