import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { CoinMarketQuote, formatSpotInr } from '../../lib/coins';
import { computeExchangeLiquidityStats } from '../../lib/portfolioAndTax';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { useAuth } from '../../context/AuthContext';
import {
  CoinWatchlistDoc,
  MerchantProfileDoc,
  P2POfferDoc,
  P2POrderDoc,
} from '../../types/models';
import { CoinBadge } from '../CoinBadge';

interface LiquidityMarketsPanelProps {
  orders: P2POrderDoc[];
}

interface IntelligenceSnapshot {
  symbol: string;
  name: string;
  inrPrice: number | null;
  change24hPct: number | null;
  volume24hInr: number | null;
  range24hPct: number | null;
  annualizedVolatilityPct: number | null;
  trendSignal: string;
  drawdownFromPeriodHighPct: number | null;
}

interface IntelligenceResponse {
  aiAvailable: boolean;
  modelName: string;
  freshnessStatus: string;
  fetchedAt: string;
  snapshots: IntelligenceSnapshot[];
  volatilityAlerts: string[];
  summary: string;
  assistantReply: string | null;
  disclaimer: string;
}

function formatCompactInr(v: number): string {
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)} Cr`;
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(2)} L`;
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function LiquidityMarketsPanel({ orders }: LiquidityMarketsPanelProps) {
  const { user, getIdToken } = useAuth();
  const [offers, setOffers] = useState<P2POfferDoc[]>([]);
  const [merchants, setMerchants] = useState<MerchantProfileDoc[]>([]);
  const [watchlists, setWatchlists] = useState<CoinWatchlistDoc[]>([]);
  const [marketQuotes, setMarketQuotes] = useState<Record<string, CoinMarketQuote>>({});
  const [intel, setIntel] = useState<IntelligenceResponse | null>(null);
  const [loadingIntel, setLoadingIntel] = useState(false);
  const [question, setQuestion] = useState('');
  const [intelError, setIntelError] = useState<string | null>(null);

  useEffect(() => {
    const unsubOffers = onSnapshot(
      query(collection(db, 'p2p_offers'), where('isActive', '==', true)),
      (snap) => {
        const list: P2POfferDoc[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<P2POfferDoc, 'id'>) }));
        setOffers(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'p2p_offers')
    );

    const unsubMerchants = onSnapshot(
      collection(db, 'merchants'),
      (snap) => {
        const list: MerchantProfileDoc[] = [];
        snap.forEach((d) =>
          list.push({ id: d.id, ...(d.data() as Omit<MerchantProfileDoc, 'id'>) })
        );
        setMerchants(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'merchants')
    );

    return () => {
      unsubOffers();
      unsubMerchants();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubWatch = onSnapshot(
      query(collection(db, 'coin_watchlists'), where('uid', '==', user.uid)),
      (snap) => {
        const list: CoinWatchlistDoc[] = [];
        snap.forEach((d) =>
          list.push({ id: d.id, ...(d.data() as Omit<CoinWatchlistDoc, 'id'>) })
        );
        setWatchlists(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'coin_watchlists')
    );
    return () => unsubWatch();
  }, [user]);

  useEffect(() => {
    fetch('/api/markets')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.coins) {
          const map: Record<string, CoinMarketQuote> = {};
          for (const c of data.coins as CoinMarketQuote[]) {
            map[c.symbol.toUpperCase()] = c;
          }
          setMarketQuotes(map);
        }
      })
      .catch(() => {});
  }, []);

  const liquidityStats = useMemo(
    () =>
      computeExchangeLiquidityStats({
        offers,
        orders,
        merchants,
        marketQuotes,
      }),
    [offers, orders, merchants, marketQuotes]
  );

  const watchedSymbols = useMemo(
    () => watchlists.map((w) => w.symbol.toUpperCase()),
    [watchlists]
  );

  const runIntelligence = async (promptQuestion?: string) => {
    setLoadingIntel(true);
    setIntelError(null);
    try {
      const token = await getIdToken();
      if (!token) {
        setIntelError('Sign in again to query server-side Market Intelligence.');
        return;
      }
      const symbols = Array.from(new Set([...watchedSymbols, 'BTC', 'ETH', 'USDT', 'SOL'])).slice(
        0,
        6
      );
      const resp = await fetch('/api/intelligence/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          symbols,
          watchlistSymbols: watchedSymbols,
          question: promptQuestion || undefined,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Unable to compute market intelligence.');
      }
      const data = (await resp.json()) as IntelligenceResponse;
      setIntel(data);
    } catch (err) {
      setIntelError(err instanceof Error ? err.message : 'Market intelligence unavailable.');
    } finally {
      setLoadingIntel(false);
    }
  };

  useEffect(() => {
    if (user) {
      void runIntelligence();
    }
  }, [user?.uid]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Liquidity Depth &amp; Market Intelligence
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Real-time exchange liquidity across verified &amp; labeled DEMO desks, bid-ask spreads vs.
            CoinGecko INR spot, and quantitative OHLCV volatility intelligence.
          </p>
        </div>

        <button
          type="button"
          disabled={loadingIntel}
          onClick={() => void runIntelligence()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-700 cursor-pointer self-start"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingIntel ? 'animate-spin' : ''}`} />
          Refresh Analytics
        </button>
      </div>

      {/* Liquidity KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Sell Offer Liquidity</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatCompactInr(liquidityStats.totalSellLiquidityInr)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Available for INR buyers
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Buy Bid Liquidity</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatCompactInr(liquidityStats.totalBuyLiquidityInr)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Available for crypto sellers
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Verified vs. DEMO Desks</div>
          <div className="mt-1 font-mono text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">
            {liquidityStats.verifiedMerchantCount} Live / {liquidityStats.demoMerchantCount} Demo
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {liquidityStats.totalActiveOffers} active marketplace offers
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Avg Spread &amp; Order Demand
          </div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {liquidityStats.avgMarketSpreadPct.toFixed(2)}%
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Buy orders: {liquidityStats.buyOrderDemandCount} · Sell orders:{' '}
            {liquidityStats.sellOrderDemandCount}
          </div>
        </div>
      </div>

      {/* Coin-Wise Liquidity Breakdown */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Coin-Wise Liquidity Depth &amp; Spread vs. CoinGecko Spot
          </h3>
        </div>
        {liquidityStats.coinBreakdown.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No active offers found in the order book yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Asset</th>
                  <th className="py-2.5 px-4 font-medium text-right">Sell Depth (INR)</th>
                  <th className="py-2.5 px-4 font-medium text-right">Buy Depth (INR)</th>
                  <th className="py-2.5 px-4 font-medium text-right">Best Ask</th>
                  <th className="py-2.5 px-4 font-medium text-right">Best Bid</th>
                  <th className="py-2.5 px-4 font-medium text-right">CoinGecko Spot</th>
                  <th className="py-2.5 px-4 font-medium text-right">Spread</th>
                  <th className="py-2.5 px-4 font-medium text-right">Offers (Live / Demo)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {liquidityStats.coinBreakdown.map((row) => (
                  <tr key={row.symbol}>
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <CoinBadge symbol={row.symbol} size="xs" />
                        <span>{row.symbol}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatCompactInr(row.sellLiquidityInr)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatCompactInr(row.buyLiquidityInr)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {row.bestAskInr ? formatSpotInr(row.bestAskInr) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {row.bestBidInr ? formatSpotInr(row.bestBidInr) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-blue-700 dark:text-blue-400">
                      {row.spotInr ? formatSpotInr(row.spotInr) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {row.spreadPct !== null ? `${row.spreadPct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {row.verifiedOfferCount} / {row.demoOfferCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Advanced Market Intelligence & Volatility Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Quantitative Volatility &amp; AI Market Intelligence
            </h3>
          </div>
          {intel && (
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              Feed: {intel.freshnessStatus} · Model: {intel.aiAvailable ? intel.modelName : 'Quantitative Fallback'}
            </span>
          )}
        </div>

        {intelError && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-900 dark:text-red-200">
            {intelError}
          </div>
        )}

        {intel && (
          <>
            {intel.volatilityAlerts.length > 0 && (
              <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-950 dark:text-amber-200 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                  Volatility Signals Detected
                </div>
                <ul className="list-disc pl-5 space-y-0.5 font-mono tabular-nums">
                  {intel.volatilityAlerts.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-3 font-medium">Asset</th>
                    <th className="py-2.5 px-3 font-medium text-right">INR Spot</th>
                    <th className="py-2.5 px-3 font-medium text-right">24h Change</th>
                    <th className="py-2.5 px-3 font-medium text-right">24h Range</th>
                    <th className="py-2.5 px-3 font-medium text-right">Ann. Volatility</th>
                    <th className="py-2.5 px-3 font-medium text-right">7D Drawdown</th>
                    <th className="py-2.5 px-3 font-medium">SMA Trend Signal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {intel.snapshots.map((s) => (
                    <tr key={s.symbol}>
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-2">
                          <CoinBadge symbol={s.symbol} size="xs" />
                          <span>{s.symbol}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {formatSpotInr(s.inrPrice)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${
                          (s.change24hPct ?? 0) >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {typeof s.change24hPct === 'number'
                          ? `${s.change24hPct >= 0 ? '+' : ''}${s.change24hPct.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {typeof s.range24hPct === 'number' ? `${s.range24hPct.toFixed(2)}%` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {typeof s.annualizedVolatilityPct === 'number'
                          ? `${s.annualizedVolatilityPct.toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {typeof s.drawdownFromPeriodHighPct === 'number'
                          ? `${s.drawdownFromPeriodHighPct.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {s.trendSignal.replace(/_/g, ' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Grounded AI Market Brief + Q&A */}
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Market Intelligence Brief (CoinGecko Grounded)</span>
              </div>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                {intel.assistantReply || intel.summary}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!question.trim()) return;
                  void runIntelligence(question.trim());
                }}
                className="flex flex-col sm:flex-row gap-2 pt-1"
              >
                <input
                  type="text"
                  maxLength={300}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask about current INR volatility, spreads, or watchlist momentum..."
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  disabled={loadingIntel || !question.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <Send className="w-3 h-3" />
                  Analyze
                </button>
              </form>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{intel.disclaimer}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
