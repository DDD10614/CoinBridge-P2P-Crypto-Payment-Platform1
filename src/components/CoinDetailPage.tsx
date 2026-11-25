import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  ShieldAlert,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  DEFAULT_COIN_MAP,
  DEFAULT_SUPPORTED_COINS,
  E8_PER_COIN,
  formatCoinQuantityFromE8,
  formatCompactInr,
  formatCompactSupply,
  formatSpotInr,
  MULTI_COIN_NETWORKS,
  PAISE_PER_INR,
  SupportedCoinConfig,
} from '../lib/coins';
import { formatInrFromPaise, formatRateInr, PAYMENT_METHOD_LABELS } from '../lib/domain';
import {
  createCoinPriceAlert,
  toggleCoinWatchlist,
} from '../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { useAuth } from '../context/AuthContext';
import { CoinWatchlistDoc, P2POfferDoc, SupportedCoinDoc } from '../types/models';
import { CoinBadge } from './CoinBadge';
import { CryptoChart } from './CryptoChart';

interface CoinDetailPageProps {
  symbol: string;
  onBackToMarkets: () => void;
  onOpenMarketplace: (mode: 'buy' | 'sell', symbol: string) => void;
}

interface SingleMarketPayload {
  quote: {
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
  };
  freshnessStatus: 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';
  notice: string;
  fetchedAt: string;
}

export function CoinDetailPage({
  symbol,
  onBackToMarkets,
  onOpenMarketplace,
}: CoinDetailPageProps) {
  const { user, signInWithGoogle } = useAuth();
  const normSymbol = symbol.trim().toUpperCase();

  const [coinConfig, setCoinConfig] = useState<SupportedCoinConfig>(
    DEFAULT_COIN_MAP[normSymbol] || DEFAULT_SUPPORTED_COINS[0]
  );
  const [marketInfo, setMarketInfo] = useState<SingleMarketPayload | null>(null);
  const [offers, setOffers] = useState<P2POfferDoc[]>([]);
  const [watchlist, setWatchlist] = useState<CoinWatchlistDoc[]>([]);
  const [quickAlertInr, setQuickAlertInr] = useState('');
  const [quickAlertCond, setQuickAlertCond] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [alertFeedback, setAlertFeedback] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'supported_coins', normSymbol),
      (snap) => {
        if (!snap.exists()) {
          if (DEFAULT_COIN_MAP[normSymbol]) {
            setCoinConfig(DEFAULT_COIN_MAP[normSymbol]);
          }
          return;
        }
        const data = snap.data() as SupportedCoinDoc;
        setCoinConfig({
          id: snap.id,
          symbol: (data.symbol || snap.id).toUpperCase(),
          name: data.name,
          coingeckoId: data.coingeckoId,
          iconKey: data.iconKey || normSymbol.toLowerCase(),
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
      },
      (err) => handleFirestoreError(err, OperationType.GET, `supported_coins/${normSymbol}`)
    );
    return () => unsub();
  }, [normSymbol]);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/markets/${encodeURIComponent(normSymbol)}?coingeckoId=${encodeURIComponent(
        coinConfig.coingeckoId
      )}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SingleMarketPayload | null) => {
        if (!cancelled && data) setMarketInfo(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [normSymbol, coinConfig.coingeckoId]);

  useEffect(() => {
    const q = query(collection(db, 'p2p_offers'), where('isActive', '==', true));
    return onSnapshot(
      q,
      (snap) => {
        const matched: P2POfferDoc[] = [];
        snap.forEach((d) => {
          const item = { id: d.id, ...(d.data() as Omit<P2POfferDoc, 'id'>) };
          if ((item.asset || 'USDT').toUpperCase() === normSymbol) {
            matched.push(item);
          }
        });
        setOffers(matched);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'p2p_offers')
    );
  }, [normSymbol]);

  useEffect(() => {
    if (!user) {
      setWatchlist([]);
      return;
    }
    return onSnapshot(
      query(collection(db, 'coin_watchlists'), where('uid', '==', user.uid)),
      (snap) => {
        setWatchlist(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CoinWatchlistDoc, 'id'>) }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'coin_watchlists')
    );
  }, [user]);

  const isWatchlisted = useMemo(
    () => watchlist.some((w) => w.symbol.toUpperCase() === normSymbol),
    [watchlist, normSymbol]
  );

  const buyOffers = useMemo(
    () => offers.filter((o) => o.side === 'SELL_USDT' || o.side === 'SELL').slice(0, 5),
    [offers]
  );
  const sellOffers = useMemo(
    () => offers.filter((o) => o.side === 'BUY_USDT' || o.side === 'BUY').slice(0, 5),
    [offers]
  );

  const quote = marketInfo?.quote;
  const approved = coinConfig.tradingEnabled && coinConfig.custodyApproved;

  const handleQuickAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      void signInWithGoogle();
      return;
    }
    const val = Number(quickAlertInr);
    if (!Number.isFinite(val) || val <= 0) return;
    await createCoinPriceAlert({
      uid: user.uid,
      symbol: normSymbol,
      targetInrPaise: Math.round(val * PAISE_PER_INR),
      condition: quickAlertCond,
    });
    setQuickAlertInr('');
    setAlertFeedback(`Alert configured for ${normSymbol}/INR.`);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <button
        type="button"
        onClick={onBackToMarkets}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Crypto Markets
      </button>

      {/* Asset Header Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <CoinBadge symbol={coinConfig.symbol} accentHex={coinConfig.accentHex} size="lg" />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {coinConfig.name} ({coinConfig.symbol})
                </h1>
                {approved ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                    P2P Approved
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-amber-700 dark:text-amber-400">
                    <ShieldAlert className="w-4 h-4" />
                    Admin Approval Pending
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl">
                {coinConfig.description}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                user
                  ? void toggleCoinWatchlist({
                      uid: user.uid,
                      symbol: normSymbol,
                      currentlyWatchlisted: isWatchlisted,
                    })
                  : void signInWithGoogle()
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Star
                className={`w-4 h-4 ${
                  isWatchlisted ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                }`}
              />
              {isWatchlisted ? 'Watchlisted' : 'Add to Watchlist'}
            </button>

            <button
              type="button"
              onClick={() => onOpenMarketplace('buy', normSymbol)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
            >
              Buy {normSymbol}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onOpenMarketplace('sell', normSymbol)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              Sell {normSymbol}
            </button>
          </div>
        </div>

        {/* Price & Market Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs">
          <div>
            <div className="text-slate-500 dark:text-slate-400">Spot Price (INR)</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatSpotInr(quote?.inrPrice)}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Spot Price (USD)</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {quote?.usdPrice !== null && quote?.usdPrice !== undefined
                ? `$${quote.usdPrice.toLocaleString('en-US', {
                    minimumFractionDigits: quote.usdPrice >= 1 ? 2 : 4,
                    maximumFractionDigits: quote.usdPrice >= 1 ? 2 : 5,
                  })}`
                : 'Unavailable'}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">24h Change</div>
            <div
              className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                quote?.change24hPct === null || quote?.change24hPct === undefined
                  ? 'text-slate-400'
                  : quote.change24hPct >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {typeof quote?.change24hPct === 'number'
                ? `${quote.change24hPct >= 0 ? '+' : ''}${quote.change24hPct.toFixed(2)}%`
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">24h High / Low</div>
            <div className="mt-1 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {quote?.high24hInr && quote?.low24hInr
                ? `${formatSpotInr(quote.high24hInr)} / ${formatSpotInr(quote.low24hInr)}`
                : 'Unavailable'}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">24h Volume</div>
            <div className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatCompactInr(quote?.volume24hInr)}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Market Cap &amp; Supply</div>
            <div className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatCompactInr(quote?.marketCapInr)}
            </div>
            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {formatCompactSupply(quote?.circulatingSupply, normSymbol)}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Chart + TA */}
      <CryptoChart
        symbol={normSymbol}
        coingeckoId={coinConfig.coingeckoId}
        name={coinConfig.name}
        currentInrPrice={quote?.inrPrice}
      />

      {/* Governance, Supported Networks & Quick Price Alert */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Asset Networks, Contracts &amp; Governance Controls
            </h2>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              Fee: {(coinConfig.tradingFeeBps / 100).toFixed(2)}% · Confs: {coinConfig.confirmationsRequired}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <div className="text-slate-500 dark:text-slate-400">P2P Trading</div>
              <div className={`font-mono font-semibold mt-0.5 ${coinConfig.tradingEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {coinConfig.tradingEnabled ? 'ENABLED' : 'LOCKED'}
              </div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400">Custody Gate</div>
              <div className={`font-mono font-semibold mt-0.5 ${coinConfig.custodyApproved ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {coinConfig.custodyApproved ? 'APPROVED' : 'PENDING'}
              </div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400">Deposits</div>
              <div className={`font-mono font-semibold mt-0.5 ${coinConfig.depositEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                {coinConfig.depositEnabled ? 'ENABLED' : 'DISABLED'}
              </div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400">Withdrawals</div>
              <div className={`font-mono font-semibold mt-0.5 ${coinConfig.withdrawalEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>
                {coinConfig.withdrawalEnabled ? 'ENABLED' : 'DISABLED'}
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap gap-6 font-mono tabular-nums">
            <span>
              Qty Limits: {formatCoinQuantityFromE8(coinConfig.minTradeQuantityE8, 6)} –{' '}
              {formatCoinQuantityFromE8(coinConfig.maxTradeQuantityE8, 4)} {normSymbol}
            </span>
            <span>
              INR Limits: {formatInrFromPaise(coinConfig.minOrderInrPaise)} –{' '}
              {formatInrFromPaise(coinConfig.maxOrderInrPaise)}
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {coinConfig.networkContracts.map((nc) => (
              <div key={nc.network} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {MULTI_COIN_NETWORKS[nc.network]?.label || nc.network}
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 break-all">
                    Contract: {nc.contractAddress}
                  </div>
                </div>
                <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300 shrink-0 tabular-nums">
                  {nc.confirmationsRequired} confs · Dep {nc.depositEnabled ? 'ON' : 'OFF'} · W/D{' '}
                  {nc.withdrawalEnabled ? 'ON' : 'OFF'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Price Alert Widget */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-blue-600" />
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {normSymbol}/INR Price Alert
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Receive an in-app notification when live CoinGecko {normSymbol}/INR crosses your target.
          </p>
          <form onSubmit={handleQuickAlert} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Condition
              </label>
              <select
                value={quickAlertCond}
                onChange={(e) => setQuickAlertCond(e.target.value as 'ABOVE' | 'BELOW')}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
              >
                <option value="ABOVE">Price Rises Above (INR)</option>
                <option value="BELOW">Price Drops Below (INR)</option>
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
                placeholder={quote?.inrPrice ? String(Math.round(quote.inrPrice)) : 'Target INR'}
                value={quickAlertInr}
                onChange={(e) => setQuickAlertInr(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs font-mono tabular-nums"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-700 cursor-pointer"
            >
              {user ? `Create ${normSymbol} Alert` : 'Sign In to Create Alert'}
            </button>
          </form>
          {alertFeedback && (
            <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              {alertFeedback}
            </div>
          )}
        </div>
      </div>

      {/* Live P2P Buy & Sell Order Book Preview for This Asset */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              P2P Sellers Offering {normSymbol} ({buyOffers.length})
            </h3>
            <button
              type="button"
              onClick={() => onOpenMarketplace('buy', normSymbol)}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              View All Buy Offers
            </button>
          </div>
          {buyOffers.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
              {approved
                ? `No active ${normSymbol} sell offers posted yet.`
                : `${normSymbol} P2P offers will appear once Admin approves ${normSymbol} trading & custody.`}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {buyOffers.map((o) => {
                const qtyE8 = o.availableAssetE8 || o.availableUsdtMicro * 100;
                return (
                  <div key={o.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {o.merchantUsername} {o.isDemo ? '· DEMO' : ''}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        Avail: {(qtyE8 / E8_PER_COIN).toFixed(4)} {normSymbol} ·{' '}
                        {o.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(', ')}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatRateInr(o.rateInrPaise)}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenMarketplace('buy', normSymbol)}
                        className="text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer"
                      >
                        Buy {normSymbol}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              P2P Buyers Bidding for {normSymbol} ({sellOffers.length})
            </h3>
            <button
              type="button"
              onClick={() => onOpenMarketplace('sell', normSymbol)}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              View All Sell Offers
            </button>
          </div>
          {sellOffers.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
              {approved
                ? `No active ${normSymbol} buy bids posted yet.`
                : `${normSymbol} P2P bids will appear once Admin approves ${normSymbol} trading & custody.`}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {sellOffers.map((o) => {
                const qtyE8 = o.availableAssetE8 || o.availableUsdtMicro * 100;
                return (
                  <div key={o.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {o.merchantUsername} {o.isDemo ? '· DEMO' : ''}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        Demand: {(qtyE8 / E8_PER_COIN).toFixed(4)} {normSymbol} ·{' '}
                        {o.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(', ')}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatRateInr(o.rateInrPaise)}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenMarketplace('sell', normSymbol)}
                        className="text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer"
                      >
                        Sell {normSymbol}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
