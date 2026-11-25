import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Check,
  Clock,
  Lock,
  PieChart,
  Search,
  Shield,
  Star,
  Store,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  formatInrFromPaise,
  formatRateInr,
  formatUsdtFromMicro,
  getKycExpiryStatus,
  isUserKycEligibleForTrading,
  PAISE_PER_INR,
} from '../../lib/domain';
import { CoinMarketQuote, formatCoinQuantityFromE8, formatSpotInr } from '../../lib/coins';
import { computePortfolioAnalytics } from '../../lib/portfolioAndTax';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { useAuth } from '../../context/AuthContext';
import type { DashboardTab } from '../DashboardShell';
import {
  CoinPriceAlertDoc,
  CoinWatchlistDoc,
  DepositTransactionDoc,
  MerchantProfileDoc,
  P2POfferDoc,
  P2POrderDoc,
  PriceAlertDoc,
  UserNotificationDoc,
  WithdrawalTransactionDoc,
} from '../../types/models';
import { CoinBadge } from '../CoinBadge';

interface OverviewPanelProps {
  orders: P2POrderDoc[];
  notifications: UserNotificationDoc[];
  onOpenOrder: (orderId: string) => void;
  onGoToKyc: () => void;
  onGoToSecurity?: () => void;
  onNavigateTab?: (tab: DashboardTab) => void;
}

type OrderStatusFilter = 'ALL' | 'ACTIVE' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED_EXPIRED';

const ACTIVE_STATUSES = [
  'CREATED',
  'AWAITING_ACCEPTANCE',
  'ACCEPTED',
  'ESCROW_RESERVED',
  'PAYMENT_PENDING',
  'PAYMENT_SUBMITTED',
  'PAYMENT_VERIFIED',
  'SETTLING',
];

export function OverviewPanel({
  orders,
  notifications,
  onOpenOrder,
  onGoToKyc,
  onGoToSecurity,
  onNavigateTab,
}: OverviewPanelProps) {
  const { user, account, privateProfile, wallet, platformSettings } = useAuth();
  const [viewMode, setViewMode] = useState<'BUYER' | 'SELLER'>('BUYER');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState<OrderStatusFilter>('ALL');
  const [priceAlerts, setPriceAlerts] = useState<PriceAlertDoc[]>([]);
  const [watchlist, setWatchlist] = useState<CoinWatchlistDoc[]>([]);
  const [coinAlerts, setCoinAlerts] = useState<CoinPriceAlertDoc[]>([]);
  const [deposits, setDeposits] = useState<DepositTransactionDoc[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalTransactionDoc[]>([]);
  const [myMerchant, setMyMerchant] = useState<MerchantProfileDoc | null>(null);
  const [myOffers, setMyOffers] = useState<P2POfferDoc[]>([]);
  const [marketQuotes, setMarketQuotes] = useState<Record<string, CoinMarketQuote>>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/markets')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { coins?: CoinMarketQuote[] } | null) => {
        if (cancelled || !data?.coins) return;
        const map: Record<string, CoinMarketQuote> = {};
        data.coins.forEach((c) => {
          map[c.symbol.toUpperCase()] = c;
        });
        setMarketQuotes(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const u1 = onSnapshot(
      query(collection(db, 'price_alerts'), where('uid', '==', user.uid)),
      (snap) => {
        setPriceAlerts(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PriceAlertDoc, 'id'>) }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'price_alerts')
    );
    const u2 = onSnapshot(
      query(collection(db, 'coin_watchlists'), where('uid', '==', user.uid)),
      (snap) => {
        setWatchlist(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CoinWatchlistDoc, 'id'>) }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'coin_watchlists')
    );
    const u3 = onSnapshot(
      query(collection(db, 'coin_price_alerts'), where('uid', '==', user.uid)),
      (snap) => {
        setCoinAlerts(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CoinPriceAlertDoc, 'id'>) }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'coin_price_alerts')
    );
    const u4 = onSnapshot(
      query(collection(db, 'deposit_transactions'), where('uid', '==', user.uid)),
      (snap) => {
        setDeposits(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<DepositTransactionDoc, 'id'>),
          }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'deposit_transactions')
    );
    const u5 = onSnapshot(
      query(collection(db, 'withdrawal_transactions'), where('uid', '==', user.uid)),
      (snap) => {
        setWithdrawals(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<WithdrawalTransactionDoc, 'id'>),
          }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'withdrawal_transactions')
    );
    const u6 = onSnapshot(
      doc(db, 'merchants', user.uid),
      (snap) => {
        setMyMerchant(
          snap.exists()
            ? { id: snap.id, ...(snap.data() as Omit<MerchantProfileDoc, 'id'>) }
            : null
        );
      },
      (err) => handleFirestoreError(err, OperationType.GET, `merchants/${user.uid}`)
    );
    const u7 = onSnapshot(
      query(collection(db, 'p2p_offers'), where('merchantUid', '==', user.uid)),
      (snap) => {
        setMyOffers(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<P2POfferDoc, 'id'>) }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'p2p_offers')
    );

    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
      u7();
    };
  }, [user]);

  const kycExpiry = useMemo(
    () => getKycExpiryStatus({ kycExpiresAtMs: account?.kycExpiresAtMs }),
    [account?.kycExpiresAtMs]
  );

  const portfolio = useMemo(
    () =>
      computePortfolioAnalytics({
        uid: user?.uid || '',
        orders,
        deposits,
        withdrawals,
        walletLedger: wallet,
        marketQuotes,
        fallbackUsdtInr: platformSettings.baseUsdtInrPaise / PAISE_PER_INR,
      }),
    [user?.uid, orders, deposits, withdrawals, wallet, marketQuotes, platformSettings.baseUsdtInrPaise]
  );

  const tickerCoins = useMemo(() => {
    const syms =
      watchlist.length > 0
        ? watchlist.map((w) => w.symbol.toUpperCase())
        : ['USDT', 'BTC', 'ETH', 'SOL'];
    return Array.from(new Set(syms))
      .slice(0, 6)
      .map((s) => marketQuotes[s])
      .filter((q): q is CoinMarketQuote => Boolean(q));
  }, [watchlist, marketQuotes]);

  const buyerStats = useMemo(() => {
    if (!user) return { usdtMicro: 0, inrPaise: 0, active: 0, completed: 0, pending: 0, cancelled: 0 };
    const myBuy = orders.filter((o) => o.buyerUid === user.uid);
    return {
      usdtMicro: myBuy
        .filter((o) => o.status === 'COMPLETED')
        .reduce((acc, o) => acc + o.usdtMicro, 0),
      inrPaise: myBuy
        .filter((o) => o.status === 'COMPLETED')
        .reduce((acc, o) => acc + o.inrPaise, 0),
      active: myBuy.filter((o) => ACTIVE_STATUSES.includes(o.status)).length,
      completed: myBuy.filter((o) => o.status === 'COMPLETED').length,
      pending: myBuy.filter((o) =>
        ['AWAITING_ACCEPTANCE', 'PAYMENT_PENDING', 'PAYMENT_SUBMITTED'].includes(o.status)
      ).length,
      cancelled: myBuy.filter((o) => ['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(o.status)).length,
    };
  }, [orders, user]);

  const sellerStats = useMemo(() => {
    if (!user) return { usdtMicro: 0, inrPaise: 0, active: 0, completed: 0, pendingPayments: 0 };
    const mySell = orders.filter((o) => o.sellerUid === user.uid);
    return {
      usdtMicro: mySell
        .filter((o) => o.status === 'COMPLETED')
        .reduce((acc, o) => acc + o.usdtMicro, 0),
      inrPaise: mySell
        .filter((o) => o.status === 'COMPLETED')
        .reduce((acc, o) => acc + o.inrPaise, 0),
      active: mySell.filter((o) => ACTIVE_STATUSES.includes(o.status)).length,
      completed: mySell.filter((o) => o.status === 'COMPLETED').length,
      pendingPayments: mySell.filter((o) =>
        ['PAYMENT_PENDING', 'PAYMENT_SUBMITTED'].includes(o.status)
      ).length,
    };
  }, [orders, user]);

  // Real 7-day volume series computed directly from Firestore orders
  const dailySeries = useMemo(() => {
    const days: { label: string; buyInr: number; sellInr: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      let buyInr = 0;
      let sellInr = 0;
      for (const o of orders) {
        const created = o.createdAt?.toDate ? o.createdAt.toDate().toISOString().slice(0, 10) : '';
        if (created === key) {
          if (o.buyerUid === user?.uid) buyInr += o.inrPaise / PAISE_PER_INR;
          if (o.sellerUid === user?.uid) sellInr += o.inrPaise / PAISE_PER_INR;
        }
      }
      days.push({ label, buyInr, sellInr });
    }
    return days;
  }, [orders, user]);

  const maxDayVolume = Math.max(
    1000,
    ...dailySeries.map((d) => Math.max(d.buyInr, d.sellInr))
  );

  const markNotifRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${id}`);
    }
  };

  const visibleOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders
      .filter((o) => (viewMode === 'BUYER' ? o.buyerUid === user?.uid : o.sellerUid === user?.uid))
      .filter((o) => {
        if (orderFilter === 'ACTIVE') return ACTIVE_STATUSES.includes(o.status);
        if (orderFilter === 'COMPLETED') return o.status === 'COMPLETED';
        if (orderFilter === 'DISPUTED') return o.status === 'DISPUTED';
        if (orderFilter === 'CANCELLED_EXPIRED') {
          return ['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(o.status);
        }
        return true;
      })
      .filter((o) => {
        if (!q) return true;
        const counterparty = viewMode === 'BUYER' ? o.sellerUsername : o.buyerUsername;
        return (
          o.orderCode.toLowerCase().includes(q) ||
          counterparty.toLowerCase().includes(q) ||
          o.paymentMethod.toLowerCase().includes(q)
        );
      })
      .slice(0, 15);
  }, [orders, viewMode, user?.uid, orderFilter, orderSearch]);

  const activeAlerts = priceAlerts.filter((a) => a.isActive && !a.triggered);
  const triggeredAlerts = priceAlerts.filter((a) => a.triggered);
  const totalPnlInr = portfolio.totalUnrealizedPnlInr + portfolio.totalRealizedPnlInr;
  const activeOfferCount = myOffers.filter((o) => o.isActive).length;
  const pendingDeposits = deposits.filter((d) => d.status !== 'CREDITED' && d.status !== 'REJECTED').length;
  const pendingWithdrawals = withdrawals.filter(
    (w) => !['COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED'].includes(w.status)
  ).length;

  return (
    <div className="space-y-6">
      {/* Mode Switch */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            {viewMode === 'BUYER' ? 'Exchange Portfolio & Buyer Desk' : 'Exchange Portfolio & Seller Desk'}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Real-time INR portfolio valuation, watchlist prices, escrow order status, merchant desk
            metrics, and security controls.
          </p>
        </div>

        <div className="inline-flex p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setViewMode('BUYER')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
              viewMode === 'BUYER'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Buyer View
          </button>
          <button
            type="button"
            onClick={() => setViewMode('SELLER')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
              viewMode === 'SELLER'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Seller View
          </button>
        </div>
      </div>

      {/* Security & KYC Expiry Reminder Banners */}
      {account?.withdrawalLocked && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-900 dark:text-red-200">
          <div className="flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Emergency Withdrawal Freeze Active</div>
              <div className="text-red-700 dark:text-red-300 mt-0.5">
                {account.restrictedReason ||
                  'Outbound USDT withdrawals are locked for this account.'}
              </div>
            </div>
          </div>
          {onGoToSecurity && (
            <button
              type="button"
              onClick={onGoToSecurity}
              className="px-3 py-1.5 font-semibold bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 rounded-lg hover:bg-red-100 dark:hover:bg-red-950 cursor-pointer shrink-0 self-start"
            >
              Review Security Lock
            </button>
          )}
        </div>
      )}

      {(kycExpiry.status === 'EXPIRING_SOON' || kycExpiry.status === 'EXPIRED') && (
        <div
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
            kycExpiry.status === 'EXPIRED'
              ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
              : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <Clock className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">
                {kycExpiry.status === 'EXPIRED'
                  ? 'KYC Verification Expired'
                  : 'KYC Expiry Reminder'}
              </div>
              <div className="mt-0.5">{kycExpiry.message}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onGoToKyc}
            className="px-3 py-1.5 font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shrink-0 self-start"
          >
            Renew Video KYC
          </button>
        </div>
      )}

      {/* Portfolio Hero Valuation + Watchlist Ticker + Quick Activity Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <PieChart className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Total Portfolio Value (INR)</span>
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                ₹{portfolio.totalValueInr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="mt-1 text-xs font-mono tabular-nums flex flex-wrap gap-x-3 gap-y-1">
                <span
                  className={
                    totalPnlInr >= 0
                      ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                      : 'text-red-700 dark:text-red-400 font-semibold'
                  }
                >
                  Net P&amp;L: {totalPnlInr >= 0 ? '+' : ''}₹
                  {totalPnlInr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  Sec 194S TDS: ₹{portfolio.totalTdsPaidInr.toFixed(2)}
                </span>
              </div>
            </div>
            {onNavigateTab && (
              <button
                type="button"
                onClick={() => onNavigateTab('portfolio')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer shrink-0"
              >
                Portfolio &amp; Tax
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Wallet Available</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatUsdtFromMicro(wallet?.availableUsdtMicro || 0, 2)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">In Escrow</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatUsdtFromMicro(wallet?.reservedUsdtMicro || 0, 2)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Tracked Assets</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {portfolio.holdings.length}
              </div>
            </div>
          </div>
        </div>

        {/* Live Market Watchlist Ticker + Wallet / Merchant Quick Cards */}
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>{watchlist.length > 0 ? 'Your Watchlist Spot INR' : 'Top INR Spot Markets'}</span>
              </div>
              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('liquidity')}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Liquidity &amp; AI →
                </button>
              )}
            </div>
            {tickerCoins.length === 0 ? (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Loading live CoinGecko INR spot quotes...
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                {tickerCoins.slice(0, 4).map((q) => (
                  <div key={q.symbol} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CoinBadge symbol={q.symbol} size="sm" />
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {q.symbol}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono tabular-nums">
                      <span className="text-slate-900 dark:text-slate-100 font-semibold">
                        {q.inrPrice ? formatSpotInr(q.inrPrice) : '—'}
                      </span>
                      {typeof q.change24hPct === 'number' && (
                        <span
                          className={
                            q.change24hPct >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }
                        >
                          {q.change24hPct >= 0 ? '+' : ''}
                          {q.change24hPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-3">
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                  <Store className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  Merchant Desk Summary
                </span>
                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab('merchant')}
                    className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Open Desk →
                  </button>
                )}
              </div>
              <div className="text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                {myMerchant
                  ? `${myMerchant.businessName} · ${activeOfferCount} active offer(s) · ${myMerchant.completedOrders} orders`
                  : 'No merchant liquidity desk registered yet.'}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                  <Wallet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  Wallet On-Chain Activity
                </span>
                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab('wallet')}
                    className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Manage Wallet →
                  </button>
                )}
              </div>
              <div className="text-slate-600 dark:text-slate-400 font-mono tabular-nums">
                {deposits.length} deposits ({pendingDeposits} pending) · {withdrawals.length}{' '}
                withdrawals ({pendingWithdrawals} active)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      {viewMode === 'BUYER' ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total USDT Purchased</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatUsdtFromMicro(buyerStats.usdtMicro, 2)}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total INR Spent</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatInrFromPaise(buyerStats.inrPaise)}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Active / Pending Orders
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {buyerStats.active} / {buyerStats.pending}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Completed / Cancelled</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {buyerStats.completed} / {buyerStats.cancelled}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              KYC &amp; Trading Access
            </div>
            <button
              type="button"
              onClick={onGoToKyc}
              className={`mt-1 font-mono text-sm font-bold hover:underline cursor-pointer text-left ${
                isUserKycEligibleForTrading(account)
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-blue-700 dark:text-blue-400'
              }`}
            >
              {(account?.kycStatus || 'NOT_STARTED').replace(/_/g, ' ')}
            </button>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {isUserKycEligibleForTrading(account) ? 'Trading unlocked' : 'KYC required to trade'}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total USDT Sold</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatUsdtFromMicro(sellerStats.usdtMicro, 2)}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total INR Received</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatInrFromPaise(sellerStats.inrPaise)}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Available Wallet USDT</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatUsdtFromMicro(wallet?.availableUsdtMicro || 0, 2)}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Active / Pending Payments
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {sellerStats.active} / {sellerStats.pendingPayments}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Seller Rating</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {((account?.ratingAvgBps || 500) / 100).toFixed(2)} / 5.00
            </div>
          </div>
        </div>
      )}

      {/* Volume Chart + Security Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              7-Day Trading Volume (INR)
            </h3>
            <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-blue-600 rounded-xs inline-block" /> Buy
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-slate-800 dark:bg-slate-400 rounded-xs inline-block" />{' '}
                Sell
              </span>
            </div>
          </div>

          <div className="h-44 flex items-end justify-between gap-2 pt-4 border-b border-slate-100 dark:border-slate-800 pb-2">
            {dailySeries.map((day) => {
              const buyH = Math.round((day.buyInr / maxDayVolume) * 100);
              const sellH = Math.round((day.sellInr / maxDayVolume) * 100);
              return (
                <div
                  key={day.label}
                  className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end"
                >
                  <div className="w-full flex items-end justify-center gap-1 h-32">
                    <div
                      title={`Buy: ₹${day.buyInr.toFixed(0)}`}
                      style={{ height: `${Math.max(4, buyH)}%` }}
                      className="w-3 sm:w-4 bg-blue-600 rounded-t-sm transition-all"
                    />
                    <div
                      title={`Sell: ₹${day.sellInr.toFixed(0)}`}
                      style={{ height: `${Math.max(4, sellH)}%` }}
                      className="w-3 sm:w-4 bg-slate-800 dark:bg-slate-400 rounded-t-sm transition-all"
                    />
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {day.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Account Security &amp; Alerts
              </h3>
            </div>
            {!privateProfile?.twoFactorEnabled && (
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            )}
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400">Username / Role</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                @{account?.username} · {account?.role}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400">Authenticator 2FA</span>
              <span
                className={`font-mono font-semibold ${
                  privateProfile?.twoFactorEnabled
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {privateProfile?.twoFactorEnabled ? 'ACTIVE (RFC 6238)' : 'NOT ENABLED'}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400">Whitelist Enforcement</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {privateProfile?.whitelistOnlyWithdrawals ? 'STRICT' : 'OPTIONAL'}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400">Withdrawal Lock</span>
              <span
                className={`font-mono font-semibold ${
                  account?.withdrawalLocked
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {account?.withdrawalLocked ? 'FROZEN' : 'OPEN'}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-600 dark:text-slate-400 inline-flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                Active Price Alerts
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {activeAlerts.length + coinAlerts.filter((a) => a.isActive && !a.triggered).length}{' '}
                active
                {triggeredAlerts.length + coinAlerts.filter((a) => a.triggered).length > 0
                  ? ` · ${triggeredAlerts.length + coinAlerts.filter((a) => a.triggered).length} hit`
                  : ''}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-slate-600 dark:text-slate-400 inline-flex items-center gap-1">
                <Star className="w-3.5 h-3.5 text-amber-500" />
                Watchlist Assets
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {watchlist.length > 0 ? watchlist.map((w) => w.symbol).join(', ') : 'None yet'}
              </span>
            </div>
            {(priceAlerts.length > 0 || coinAlerts.length > 0) && (
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 space-y-1">
                {coinAlerts.slice(0, 2).map((a) => (
                  <div
                    key={a.id}
                    className="flex justify-between font-mono text-[11px] text-slate-700 dark:text-slate-300"
                  >
                    <span>
                      {a.symbol} {a.condition} {formatSpotInr(a.targetInrPaise / PAISE_PER_INR)}
                    </span>
                    <span
                      className={
                        a.triggered
                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          : 'text-slate-500 dark:text-slate-400'
                      }
                    >
                      {a.triggered ? 'TRIGGERED' : 'WATCHING'}
                    </span>
                  </div>
                ))}
                {priceAlerts.slice(0, 2).map((a) => (
                  <div
                    key={a.id}
                    className="flex justify-between font-mono text-[11px] text-slate-700 dark:text-slate-300"
                  >
                    <span>
                      USDT {a.condition} {formatRateInr(a.targetRateInrPaise)}
                    </span>
                    <span
                      className={
                        a.triggered
                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          : 'text-slate-500 dark:text-slate-400'
                      }
                    >
                      {a.triggered ? 'TRIGGERED' : 'WATCHING'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {onGoToSecurity && (
            <button
              type="button"
              onClick={onGoToSecurity}
              className="w-full py-2 px-3 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-700 cursor-pointer"
            >
              Manage Security, 2FA &amp; Alerts
            </button>
          )}
        </div>
      </div>

      {/* Recent Orders & Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              {viewMode === 'BUYER' ? 'Buy' : 'Sell'} Order History ({visibleOrders.length})
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Order ID or user..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-44"
                />
              </div>
              <select
                value={orderFilter}
                onChange={(e) => setOrderFilter(e.target.value as OrderStatusFilter)}
                className="py-1.5 px-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active Escrow</option>
                <option value="COMPLETED">Completed</option>
                <option value="DISPUTED">Disputed</option>
                <option value="CANCELLED_EXPIRED">Cancelled / Expired</option>
              </select>
            </div>
          </div>
          {visibleOrders.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No matching {viewMode === 'BUYER' ? 'buy' : 'sell'} orders found. Visit the Buy / Sell
              P2P marketplace to create an order.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4 font-medium">Order ID</th>
                    <th className="py-2.5 px-4 font-medium">Counterparty</th>
                    <th className="py-2.5 px-4 font-medium">Rail</th>
                    <th className="py-2.5 px-4 font-medium text-right">INR</th>
                    <th className="py-2.5 px-4 font-medium text-right">Asset Qty</th>
                    <th className="py-2.5 px-4 font-medium">Status</th>
                    <th className="py-2.5 px-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleOrders.map((o) => {
                    const sym = (o.asset || 'USDT').toUpperCase();
                    const qtyE8 = o.quantityE8 ?? o.usdtMicro * 100;
                    return (
                      <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {o.orderCode}
                        </td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                          {viewMode === 'BUYER' ? o.sellerUsername : o.buyerUsername}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">
                          {o.paymentMethod}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatInrFromPaise(o.inrPaise)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {sym === 'USDT'
                            ? formatUsdtFromMicro(o.usdtMicro, 2)
                            : `${formatCoinQuantityFromE8(qtyE8, 6)} ${sym}`}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-300">
                          {o.status.replace(/_/g, ' ')}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => onOpenOrder(o.id)}
                            className="text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer"
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Notifications
            </h3>
          </div>
          {notifications.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No notifications yet.</p>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto">
              {notifications.slice(0, 8).map((n) => (
                <div
                  key={n.id}
                  className={`p-3 rounded-lg border text-xs ${
                    n.read
                      ? 'border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 text-slate-500 dark:text-slate-400'
                      : 'border-blue-100 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/30 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {n.title}
                    </span>
                    {!n.read && (
                      <button
                        type="button"
                        onClick={() => void markNotifRead(n.id)}
                        title="Mark as read"
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-800 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
