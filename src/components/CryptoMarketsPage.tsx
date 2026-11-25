import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  LineChart,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Sun,
  Trash2,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  DEFAULT_SUPPORTED_COINS,
  formatCompactInr,
  formatCompactSupply,
  formatSpotInr,
  PAISE_PER_INR,
  SupportedCoinConfig,
} from '../lib/coins';
import {
  createCoinPriceAlert,
  createUserNotification,
  deleteCoinPriceAlert,
  markCoinPriceAlertTriggered,
  toggleCoinWatchlist,
} from '../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { CoinPriceAlertDoc, CoinWatchlistDoc, SupportedCoinDoc } from '../types/models';
import { CoinBadge } from './CoinBadge';

interface MarketQuote {
  symbol: string;
  coingeckoId: string;
  name: string;
  inrPrice: number | null;
  usdPrice: number | null;
  change24hPct: number | null;
  volume24hInr: number | null;
  marketCapInr: number | null;
  high24hInr: number | null;
  low24hInr: number | null;
  circulatingSupply: number | null;
  lastUpdatedAt: string | null;
  isAvailable: boolean;
}

interface MarketsApiPayload {
  coins: MarketQuote[];
  freshnessStatus: 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';
  cached: boolean;
  cacheAgeSeconds: number;
  rateLimited: boolean;
  fetchedAt: string;
  notice: string;
}

interface CryptoMarketsPageProps {
  onOpenCoinDetail: (symbol: string) => void;
  onOpenMarketplace: (mode: 'buy' | 'sell', symbol: string) => void;
}

type SortField = 'DEFAULT' | 'MARKET_CAP' | 'PRICE_INR' | 'CHANGE_24H' | 'VOLUME_24H';

export function CryptoMarketsPage({
  onOpenCoinDetail,
  onOpenMarketplace,
}: CryptoMarketsPageProps) {
  const { user, signInWithGoogle } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [coinConfigs, setCoinConfigs] = useState<SupportedCoinConfig[]>(DEFAULT_SUPPORTED_COINS);
  const [marketData, setMarketData] = useState<MarketsApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [viewFilter, setViewFilter] = useState<'ALL' | 'WATCHLIST' | 'APPROVED'>('ALL');
  const [sortBy, setSortBy] = useState<SortField>('MARKET_CAP');

  const [watchlist, setWatchlist] = useState<CoinWatchlistDoc[]>([]);
  const [alerts, setAlerts] = useState<CoinPriceAlertDoc[]>([]);
  const [alertSymbol, setAlertSymbol] = useState('BTC');
  const [alertCondition, setAlertCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [alertTargetInr, setAlertTargetInr] = useState('');
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  const evaluatedAlertsRef = useRef<Set<string>>(new Set());

  // Subscribe to supported_coins from Firestore, defaulting to DEFAULT_SUPPORTED_COINS
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'supported_coins'),
      (snap) => {
        if (snap.empty) {
          setCoinConfigs(DEFAULT_SUPPORTED_COINS);
          return;
        }
        const bySym = new Map<string, SupportedCoinConfig>();
        for (const c of DEFAULT_SUPPORTED_COINS) {
          bySym.set(c.symbol, c);
        }
        snap.forEach((docSnap) => {
          const data = docSnap.data() as SupportedCoinDoc;
          const sym = (data.symbol || docSnap.id).toUpperCase();
          bySym.set(sym, {
            id: docSnap.id,
            symbol: sym,
            name: data.name,
            coingeckoId: data.coingeckoId,
            iconKey: data.iconKey || sym.toLowerCase(),
            accentHex: data.accentHex || '#2563EB',
            description: data.description || '',
            decimals: data.decimals ?? 8,
            supportedNetworks: data.supportedNetworks || [],
            networkContracts: data.networkContracts || [],
            minTradeQuantityE8: data.minTradeQuantityE8,
            maxTradeQuantityE8: data.maxTradeQuantityE8,
            minOrderInrPaise: data.minOrderInrPaise,
            maxOrderInrPaise: data.maxOrderInrPaise,
            tradingFeeBps: data.tradingFeeBps,
            confirmationsRequired: data.confirmationsRequired,
            depositEnabled: Boolean(data.depositEnabled),
            withdrawalEnabled: Boolean(data.withdrawalEnabled),
            tradingEnabled: Boolean(data.tradingEnabled),
            custodyApproved: Boolean(data.custodyApproved),
            isFeatured: Boolean(data.isFeatured),
            sortOrder: data.sortOrder ?? 99,
          });
        });
        setCoinConfigs(
          Array.from(bySym.values()).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
        );
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'supported_coins');
      }
    );
    return () => unsub();
  }, []);

  // Subscribe to signed-in user watchlist & price alerts
  useEffect(() => {
    if (!user) {
      setWatchlist([]);
      setAlerts([]);
      return;
    }
    const u1 = onSnapshot(
      query(collection(db, 'coin_watchlists'), where('uid', '==', user.uid)),
      (snap) => {
        setWatchlist(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CoinWatchlistDoc, 'id'>) }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'coin_watchlists')
    );
    const u2 = onSnapshot(
      query(collection(db, 'coin_price_alerts'), where('uid', '==', user.uid)),
      (snap) => {
        setAlerts(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CoinPriceAlertDoc, 'id'>) }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'coin_price_alerts')
    );
    return () => {
      u1();
      u2();
    };
  }, [user]);

  // Fetch live CoinGecko INR/USD market data + 60s auto-refresh
  useEffect(() => {
    let cancelled = false;
    const defaultSymbols = new Set(DEFAULT_SUPPORTED_COINS.map((c) => c.symbol));
    const extraCoins = coinConfigs
      .filter((c) => !defaultSymbols.has(c.symbol) && c.coingeckoId)
      .map((c) => ({ symbol: c.symbol, coingeckoId: c.coingeckoId, name: c.name }));

    const querySuffix =
      extraCoins.length > 0 ? `?extra=${encodeURIComponent(JSON.stringify(extraCoins))}` : '';

    setLoading((prev) => (marketData ? prev : true));
    fetch(`/api/markets${querySuffix}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MarketsApiPayload | null) => {
        if (!cancelled && data) {
          setMarketData(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const timer = setInterval(() => {
      setRefreshNonce((n) => n + 1);
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [coinConfigs, refreshNonce]);

  // Evaluate multi-coin INR price alerts against live quotes
  useEffect(() => {
    if (!user || !marketData || alerts.length === 0) return;
    const quoteMap = new Map(marketData.coins.map((c) => [c.symbol.toUpperCase(), c]));
    for (const alert of alerts) {
      if (!alert.isActive || alert.triggered || evaluatedAlertsRef.current.has(alert.id)) continue;
      const quote = quoteMap.get(alert.symbol.toUpperCase());
      if (!quote || quote.inrPrice === null) continue;

      const currentPaise = Math.round(quote.inrPrice * PAISE_PER_INR);
      const hit =
        alert.condition === 'ABOVE'
          ? currentPaise >= alert.targetInrPaise
          : currentPaise <= alert.targetInrPaise;

      if (hit) {
        evaluatedAlertsRef.current.add(alert.id);
        void markCoinPriceAlertTriggered(alert.id);
        void createUserNotification({
          uid: user.uid,
          type: 'WALLET',
          title: `${alert.symbol} Price Alert Triggered`,
          body: `${alert.symbol}/INR reached ${formatSpotInr(quote.inrPrice)} (${alert.condition} ₹${(
            alert.targetInrPaise / PAISE_PER_INR
          ).toLocaleString('en-IN')}).`,
        });
      }
    }
  }, [user, marketData, alerts]);

  const watchlistedSet = useMemo(
    () => new Set(watchlist.map((w) => w.symbol.toUpperCase())),
    [watchlist]
  );

  const quoteBySymbol = useMemo(() => {
    const map = new Map<string, MarketQuote>();
    for (const q of marketData?.coins || []) {
      map.set(q.symbol.toUpperCase(), q);
    }
    return map;
  }, [marketData]);

  const combinedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return coinConfigs
      .map((cfg) => ({
        cfg,
        quote: quoteBySymbol.get(cfg.symbol.toUpperCase()) || null,
        isWatchlisted: watchlistedSet.has(cfg.symbol.toUpperCase()),
      }))
      .filter(({ cfg, isWatchlisted }) => {
        if (viewFilter === 'WATCHLIST' && !isWatchlisted) return false;
        if (viewFilter === 'APPROVED' && !(cfg.tradingEnabled && cfg.custodyApproved)) return false;
        if (!q) return true;
        return (
          cfg.symbol.toLowerCase().includes(q) ||
          cfg.name.toLowerCase().includes(q) ||
          cfg.coingeckoId.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortBy === 'PRICE_INR') {
          return (b.quote?.inrPrice ?? -1) - (a.quote?.inrPrice ?? -1);
        }
        if (sortBy === 'CHANGE_24H') {
          return (b.quote?.change24hPct ?? -9999) - (a.quote?.change24hPct ?? -9999);
        }
        if (sortBy === 'VOLUME_24H') {
          return (b.quote?.volume24hInr ?? -1) - (a.quote?.volume24hInr ?? -1);
        }
        if (sortBy === 'MARKET_CAP') {
          return (b.quote?.marketCapInr ?? -1) - (a.quote?.marketCapInr ?? -1);
        }
        return (a.cfg.sortOrder ?? 99) - (b.cfg.sortOrder ?? 99);
      });
  }, [coinConfigs, quoteBySymbol, watchlistedSet, searchQuery, viewFilter, sortBy]);

  const handleToggleStar = async (symbol: string) => {
    if (!user) {
      void signInWithGoogle();
      return;
    }
    await toggleCoinWatchlist({
      uid: user.uid,
      symbol,
      currentlyWatchlisted: watchlistedSet.has(symbol.toUpperCase()),
    });
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      void signInWithGoogle();
      return;
    }
    const targetVal = Number(alertTargetInr);
    if (!Number.isFinite(targetVal) || targetVal <= 0) {
      setAlertMsg('Enter a valid positive INR target price.');
      return;
    }
    await createCoinPriceAlert({
      uid: user.uid,
      symbol: alertSymbol,
      targetInrPaise: Math.round(targetVal * PAISE_PER_INR),
      condition: alertCondition,
    });
    setAlertTargetInr('');
    setAlertMsg(`Price alert saved for ${alertSymbol}/INR.`);
  };

  const freshnessColor =
    marketData?.freshnessStatus === 'LIVE'
      ? 'text-emerald-700 dark:text-emerald-400'
      : marketData?.freshnessStatus === 'DELAYED' || marketData?.freshnessStatus === 'STALE'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-red-700 dark:text-red-400';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="text-xs font-medium text-blue-700 dark:text-blue-400">
            CRYPTO MARKETS · Live CoinGecko INR &amp; USD Reference Feed
          </div>
          <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Cryptocurrency Markets &amp; P2P Availability
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            Real-time INR market prices, 24h changes, market capitalization, interactive technical
            charts, watchlists, and Admin-governed P2P trading eligibility.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            {theme === 'dark' ? 'Light Theme' : 'Dark Theme'}
          </button>

          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-700 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Quotes
          </button>
        </div>
      </div>

      {/* Freshness & Upstream Feed Notice */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900 dark:text-slate-100">Market Feed Status:</span>
          <span className={`font-mono font-bold ${freshnessColor}`}>
            {marketData?.freshnessStatus || (loading ? 'CONNECTING' : 'UNAVAILABLE')}
          </span>
          {marketData && (
            <>
              <span aria-hidden="true" className="text-slate-400">·</span>
              <span className="text-slate-600 dark:text-slate-400">{marketData.notice}</span>
            </>
          )}
        </div>
        <div className="font-mono text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
          {marketData?.fetchedAt
            ? `Updated ${new Date(marketData.fetchedAt).toLocaleTimeString('en-IN')}`
            : 'Fetching quotes...'}
        </div>
      </div>

      {/* Search, View Filter, Sort Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['ALL', `All Assets (${coinConfigs.length})`],
              ['WATCHLIST', `Watchlist (${watchlist.length})`],
              [
                'APPROVED',
                `P2P Enabled (${coinConfigs.filter((c) => c.tradingEnabled && c.custodyApproved).length})`,
              ],
            ] as ['ALL' | 'WATCHLIST' | 'APPROVED', string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setViewFilter(id)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-colors ${
                viewFilter === id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search coin or symbol..."
              className="w-full sm:w-56 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortField)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="MARKET_CAP">Sort: Market Cap</option>
            <option value="PRICE_INR">Sort: Price (INR)</option>
            <option value="CHANGE_24H">Sort: 24h % Change</option>
            <option value="VOLUME_24H">Sort: 24h Volume</option>
            <option value="DEFAULT">Sort: Registry Order</option>
          </select>
        </div>
      </div>

      {/* Market Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {loading && !marketData ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : combinedRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-600 dark:text-slate-400">
            No cryptocurrencies match the current search or watchlist filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/60">
                  <th className="py-3 px-4 font-medium w-8">Fav</th>
                  <th className="py-3 px-4 font-medium">Asset</th>
                  <th className="py-3 px-4 font-medium text-right">Price (INR)</th>
                  <th className="py-3 px-4 font-medium text-right">Price (USD)</th>
                  <th className="py-3 px-4 font-medium text-right">24h %</th>
                  <th className="py-3 px-4 font-medium text-right">24h High / Low</th>
                  <th className="py-3 px-4 font-medium text-right">24h Volume</th>
                  <th className="py-3 px-4 font-medium text-right">Market Cap</th>
                  <th className="py-3 px-4 font-medium">P2P Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {combinedRows.map(({ cfg, quote, isWatchlisted }) => {
                  const approved = cfg.tradingEnabled && cfg.custodyApproved;
                  const pct = quote?.change24hPct;
                  const pctPositive = typeof pct === 'number' && pct >= 0;

                  return (
                    <tr
                      key={cfg.symbol}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => void handleToggleStar(cfg.symbol)}
                          aria-label={isWatchlisted ? `Remove ${cfg.symbol} from watchlist` : `Add ${cfg.symbol} to watchlist`}
                          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Star
                            className={`w-4 h-4 ${
                              isWatchlisted
                                ? 'fill-amber-400 text-amber-500'
                                : 'text-slate-400 hover:text-amber-500'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => onOpenCoinDetail(cfg.symbol)}
                          className="flex items-center gap-3 text-left cursor-pointer group"
                        >
                          <CoinBadge symbol={cfg.symbol} accentHex={cfg.accentHex} size="sm" />
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                              {cfg.name}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {cfg.symbol} · {cfg.supportedNetworks.length} net(s)
                            </div>
                          </div>
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatSpotInr(quote?.inrPrice)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                        {quote?.usdPrice !== null && quote?.usdPrice !== undefined
                          ? `$${quote.usdPrice.toLocaleString('en-US', {
                              minimumFractionDigits: quote.usdPrice >= 1 ? 2 : 4,
                              maximumFractionDigits: quote.usdPrice >= 1 ? 2 : 5,
                            })}`
                          : 'Unavailable'}
                      </td>
                      <td
                        className={`py-3.5 px-4 text-right font-mono font-semibold tabular-nums ${
                          pct === null || pct === undefined
                            ? 'text-slate-400'
                            : pctPositive
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {typeof pct === 'number'
                          ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                        {quote?.high24hInr !== null && quote?.low24hInr !== null && quote
                          ? `${formatSpotInr(quote.high24hInr)} / ${formatSpotInr(quote.low24hInr)}`
                          : 'Unavailable'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                        {formatCompactInr(quote?.volume24hInr)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                        <div>{formatCompactInr(quote?.marketCapInr)}</div>
                        {quote?.circulatingSupply && (
                          <div className="text-[10px] text-slate-500">
                            {formatCompactSupply(quote.circulatingSupply, cfg.symbol)}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {approved ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Approved
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] text-amber-700 dark:text-amber-400">
                            Admin Approval Pending
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenCoinDetail(cfg.symbol)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <LineChart className="w-3.5 h-3.5" />
                            Chart
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenMarketplace('buy', cfg.symbol)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold rounded-md cursor-pointer ${
                              approved
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                            }`}
                          >
                            Trade
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Multi-Coin INR Price Alerts */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-blue-600" />
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Multi-Coin INR Price Alerts
            </h2>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Evaluated against live CoinGecko INR spot quotes and delivered to your Notification Inbox.
          </span>
        </div>

        <form onSubmit={handleCreateAlert} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Cryptocurrency
            </label>
            <select
              value={alertSymbol}
              onChange={(e) => setAlertSymbol(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
            >
              {coinConfigs.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.symbol} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Trigger Condition
            </label>
            <select
              value={alertCondition}
              onChange={(e) => setAlertCondition(e.target.value as 'ABOVE' | 'BELOW')}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
            >
              <option value="ABOVE">Rises Above (≥)</option>
              <option value="BELOW">Drops Below (≤)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Target Price (INR)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="e.g. 7500000"
              value={alertTargetInr}
              onChange={(e) => setAlertTargetInr(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs font-mono tabular-nums"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
          >
            {user ? 'Set Price Alert' : 'Sign In to Set Alert'}
          </button>
        </form>

        {alertMsg && (
          <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">{alertMsg}</div>
        )}

        {user && alerts.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800 pt-2">
            {alerts.map((a) => (
              <div key={a.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                  <strong>{a.symbol}/INR</strong> {a.condition === 'ABOVE' ? '≥' : '≤'}{' '}
                  {formatSpotInr(a.targetInrPaise / PAISE_PER_INR)}
                  <span
                    className={`ml-2 font-semibold ${
                      a.triggered ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    ({a.triggered ? 'TRIGGERED' : 'WATCHING'})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteCoinPriceAlert(a.id)}
                  aria-label="Delete alert"
                  className="text-slate-400 hover:text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
