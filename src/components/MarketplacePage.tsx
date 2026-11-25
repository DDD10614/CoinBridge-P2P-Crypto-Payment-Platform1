import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Clock,
  LineChart,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  calculateBuyBreakdown,
  calculateSellBreakdown,
  formatInrFromPaise,
  formatRateInr,
  formatUsdtFromMicro,
  isKycStatusVerified,
  matchBestOffers,
  matchBestOffersScored,
  MICRO_PER_USDT,
  PAISE_PER_INR,
  PAYMENT_METHOD_LABELS,
  PaymentMethodType,
  RiskLevel,
  ScoredMatchedOffer,
} from '../lib/domain';
import {
  calculateMultiCoinBuyBreakdown,
  calculateMultiCoinSellBreakdown,
  coinUnitsToE8,
  DEFAULT_SUPPORTED_COINS,
  E8_PER_COIN,
  e8ToUsdtMicro,
  formatCoinQuantityFromE8,
  formatSpotInr,
  MULTI_COIN_NETWORKS,
  SupportedCoinConfig,
} from '../lib/coins';
import {
  createP2POrder,
  logDeniedTradingAttempt,
  savePriceLockRecord,
  seedSandboxMarketplaceAdmin,
  updatePriceLockStatus,
} from '../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { useAuth } from '../context/AuthContext';
import { P2POfferDoc, SupportedCoinDoc } from '../types/models';
import { AppRoute } from './Header';
import { DashboardTab } from './DashboardShell';
import { KycRestrictionModal } from './KycRestrictionModal';
import { CoinBadge } from './CoinBadge';

interface MarketplacePageProps {
  mode: 'buy' | 'sell';
  initialAsset?: string;
  onSelectAsset?: (symbol: string) => void;
  onNavigate: (route: AppRoute) => void;
  onNavigateDashboardTab: (tab: DashboardTab) => void;
  onOrderCreated: (orderId: string) => void;
  onOpenCoinDetail?: (symbol: string) => void;
}

export function MarketplacePage({
  mode,
  initialAsset = 'USDT',
  onSelectAsset,
  onNavigate,
  onNavigateDashboardTab,
  onOrderCreated,
  onOpenCoinDetail,
}: MarketplacePageProps) {
  const {
    user,
    account,
    wallet,
    platformSettings,
    isAdmin,
    isTradingEligible,
    kycRestriction,
    getIdToken,
    signInWithGoogle,
  } = useAuth();
  const [showKycModal, setShowKycModal] = useState(false);
  const [coinConfigs, setCoinConfigs] = useState<SupportedCoinConfig[]>(DEFAULT_SUPPORTED_COINS);
  const [selectedAsset, setSelectedAsset] = useState<string>(initialAsset.toUpperCase() || 'USDT');
  const [offers, setOffers] = useState<P2POfferDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [marketRate, setMarketRate] = useState<{
    inrPrice: number | null;
    change24hPct: number | null;
    freshnessStatus: string;
    notice: string;
  } | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [inrFilter, setInrFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | PaymentMethodType>('ALL');
  const [networkFilter, setNetworkFilter] = useState<string>('ALL');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [showDemo, setShowDemo] = useState(true);
  const [sortBy, setSortBy] = useState<'RATE' | 'COMPLETION' | 'SPEED'>('RATE');
  const [matchingMode, setMatchingMode] = useState<'SMART' | 'MANUAL'>('SMART');

  // Order creation modal & Price Lock state
  const [selectedOffer, setSelectedOffer] = useState<P2POfferDoc | null>(null);
  const [amountInput, setAmountInput] = useState('10000');
  const [chosenMethod, setChosenMethod] = useState<PaymentMethodType>('UPI');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [creating, setCreating] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [matchNotice, setMatchNotice] = useState<string | null>(null);
  const [priceLockTtl, setPriceLockTtl] = useState<45 | 90 | 180>(90);
  const [priceLock, setPriceLock] = useState<{
    lockId: string;
    rateInrPaise: number;
    ttlSeconds: number;
    expiresAtMs: number;
    signature: string;
  } | null>(null);
  const [lockSecondsLeft, setLockSecondsLeft] = useState<number>(0);
  const [lockingQuote, setLockingQuote] = useState(false);

  useEffect(() => {
    if (initialAsset) {
      setSelectedAsset(initialAsset.toUpperCase());
    }
  }, [initialAsset]);

  // Subscribe to supported_coins governance registry
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
      (err) => handleFirestoreError(err, OperationType.LIST, 'supported_coins')
    );
    return () => unsub();
  }, []);

  const activeCoinConfig = useMemo(() => {
    return (
      coinConfigs.find((c) => c.symbol.toUpperCase() === selectedAsset) || coinConfigs[0]
    );
  }, [coinConfigs, selectedAsset]);

  const isAssetApprovedForTrading = Boolean(
    activeCoinConfig?.tradingEnabled && activeCoinConfig?.custodyApproved
  );

  const handleSelectAsset = (sym: string) => {
    const upper = sym.toUpperCase();
    setSelectedAsset(upper);
    setNetworkFilter('ALL');
    setSelectedOffer(null);
    setMatchNotice(null);
    onSelectAsset?.(upper);
  };

  // Subscribe to active offers
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'p2p_offers'), where('isActive', '==', true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: P2POfferDoc[] = [];
        snap.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...(docSnap.data() as Omit<P2POfferDoc, 'id'>) });
        });
        setOffers(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        handleFirestoreError(err, OperationType.LIST, 'p2p_offers');
      }
    );
    return () => unsub();
  }, []);

  // Fetch live CoinGecko INR spot price for currently selected coin
  useEffect(() => {
    let cancelled = false;
    setMarketRate(null);
    const cgId = activeCoinConfig?.coingeckoId || '';
    fetch(
      `/api/markets/${encodeURIComponent(selectedAsset)}${
        cgId ? `?coingeckoId=${encodeURIComponent(cgId)}` : ''
      }`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.quote) {
          setMarketRate({
            inrPrice: data.quote.inrPrice ?? null,
            change24hPct: data.quote.change24hPct ?? null,
            freshnessStatus: data.freshnessStatus || 'LIVE',
            notice: data.notice || '',
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedAsset, activeCoinConfig?.coingeckoId]);

  const sideMatches = (offerSide: P2POfferDoc['side']) =>
    mode === 'buy'
      ? offerSide === 'SELL_USDT' || offerSide === 'SELL'
      : offerSide === 'BUY_USDT' || offerSide === 'BUY';

  const assetOffers = useMemo(() => {
    return offers.filter(
      (o) => sideMatches(o.side) && (o.asset || 'USDT').toUpperCase() === selectedAsset
    );
  }, [offers, mode, selectedAsset]);

  const filteredOffers = useMemo(() => {
    const filterPaise = inrFilter ? Math.round((Number(inrFilter) || 0) * PAISE_PER_INR) : 0;
    const qLower = searchQuery.trim().toLowerCase();
    return assetOffers
      .filter((o) => {
        if (!showDemo && o.isDemo) return false;
        if (verifiedOnly && o.verificationLevel === 'BASIC') return false;
        if (paymentFilter !== 'ALL' && !o.paymentMethods.includes(paymentFilter)) return false;
        if (networkFilter !== 'ALL' && o.network !== networkFilter) return false;
        if (filterPaise > 0 && (filterPaise < o.minInrPaise || filterPaise > o.maxInrPaise)) {
          return false;
        }
        if (qLower) {
          const matchesName = o.merchantUsername.toLowerCase().includes(qLower);
          const matchesTerms = (o.termsNote || '').toLowerCase().includes(qLower);
          if (!matchesName && !matchesTerms) return false;
        }
        const availE8 = o.availableAssetE8 ?? o.availableUsdtMicro * 100;
        return availE8 > 0;
      })
      .sort((a, b) => {
        if (sortBy === 'COMPLETION') return b.completionRateBps - a.completionRateBps;
        if (sortBy === 'SPEED') return a.avgCompletionMins - b.avgCompletionMins;
        return mode === 'buy'
          ? a.rateInrPaise - b.rateInrPaise
          : b.rateInrPaise - a.rateInrPaise;
      });
  }, [
    assetOffers,
    searchQuery,
    inrFilter,
    paymentFilter,
    networkFilter,
    verifiedOnly,
    showDemo,
    sortBy,
    mode,
  ]);

  const demoCount = useMemo(() => assetOffers.filter((o) => o.isDemo).length, [assetOffers]);
  const liveMerchantCount = useMemo(() => assetOffers.filter((o) => !o.isDemo).length, [assetOffers]);

  const smartCandidates = useMemo<ScoredMatchedOffer<P2POfferDoc>[]>(() => {
    const targetInrPaise = Math.round((Number(inrFilter) || 10000) * PAISE_PER_INR);
    return matchBestOffersScored(filteredOffers, {
      mode,
      asset: selectedAsset,
      inrPaise: targetInrPaise,
      paymentMethod: paymentFilter,
      verifiedOnly,
      includeDemo: showDemo,
    }).slice(0, 3);
  }, [filteredOffers, mode, selectedAsset, inrFilter, paymentFilter, verifiedOnly, showDemo]);

  // Countdown tick for temporary Price Lock
  useEffect(() => {
    if (!selectedOffer || !priceLock) {
      setLockSecondsLeft(0);
      return;
    }
    const updateTick = () => {
      const rem = Math.max(0, Math.ceil((priceLock.expiresAtMs - Date.now()) / 1000));
      setLockSecondsLeft(rem);
      if (rem === 0 && priceLock.lockId) {
        void updatePriceLockStatus(priceLock.lockId, 'EXPIRED');
      }
    };
    updateTick();
    const timer = window.setInterval(updateTick, 1000);
    return () => window.clearInterval(timer);
  }, [selectedOffer, priceLock]);

  const issuePriceLock = async (offer: P2POfferDoc, ttl: 45 | 90 | 180, refreshSpot = false) => {
    if (!user) return;
    setLockingQuote(true);
    try {
      if (refreshSpot) {
        const cgId = activeCoinConfig?.coingeckoId || '';
        const marketResp = await fetch(
          `/api/markets/${encodeURIComponent(selectedAsset)}${
            cgId ? `?coingeckoId=${encodeURIComponent(cgId)}` : ''
          }`
        );
        if (marketResp.ok) {
          const marketJson = await marketResp.json();
          if (marketJson?.quote) {
            setMarketRate({
              inrPrice: marketJson.quote.inrPrice ?? null,
              change24hPct: marketJson.quote.change24hPct ?? null,
              freshnessStatus: marketJson.freshnessStatus || 'LIVE',
              notice: marketJson.notice || '',
            });
          }
        }
      }
      const token = await getIdToken();
      if (!token) return;
      const resp = await fetch('/api/quotes/lock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          offerId: offer.id,
          asset: selectedAsset,
          rateInrPaise: offer.rateInrPaise,
          ttlSeconds: ttl,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setPriceLock({
          lockId: data.lockId,
          rateInrPaise: data.rateInrPaise,
          ttlSeconds: data.ttlSeconds,
          expiresAtMs: data.expiresAtMs,
          signature: data.signature,
        });
        void savePriceLockRecord({
          lockId: data.lockId,
          uid: user.uid,
          offerId: offer.id,
          asset: selectedAsset,
          side: mode === 'buy' ? 'BUY' : 'SELL',
          rateInrPaise: data.rateInrPaise,
          ttlSeconds: data.ttlSeconds,
          expiresAtMs: data.expiresAtMs,
          signature: data.signature,
        });
      }
    } catch {
      // Non-fatal; allow local fallback countdown if lock endpoint unreachable
    } finally {
      setLockingQuote(false);
    }
  };

  const guardTradingAction = (actionLabel: string): boolean => {
    if (!user) {
      void signInWithGoogle();
      return false;
    }
    if (!isTradingEligible) {
      setShowKycModal(true);
      void logDeniedTradingAttempt({
        uid: user.uid,
        action: actionLabel,
        kycStatus: kycRestriction.effectiveKycStatus,
        reasonCode: kycRestriction.reasonCode,
        reasonMessage: kycRestriction.reasonMessage,
      });
      return false;
    }
    if (!isAssetApprovedForTrading) {
      setMatchNotice(
        `${selectedAsset} P2P trading is currently locked awaiting Admin trading & custody approval.`
      );
      return false;
    }
    return true;
  };

  const openOrderModal = (offer: P2POfferDoc, overrideInrPaise?: number) => {
    if (!guardTradingAction(mode === 'buy' ? `BUY_${selectedAsset}_CLICK` : `SELL_${selectedAsset}_CLICK`)) {
      return;
    }
    setSelectedOffer(offer);
    setOrderError(null);
    setAcceptedTerms(false);
    setPriceLock(null);
    void issuePriceLock(offer, priceLockTtl, false);
    setChosenMethod(
      paymentFilter !== 'ALL' && offer.paymentMethods.includes(paymentFilter)
        ? paymentFilter
        : offer.paymentMethods[0] || 'UPI'
    );
    if (mode === 'buy') {
      const targetInr =
        overrideInrPaise && overrideInrPaise > 0
          ? Math.round(overrideInrPaise / PAISE_PER_INR)
          : Math.max(1000, Math.round(offer.minInrPaise / PAISE_PER_INR));
      setAmountInput(String(targetInr));
    } else {
      const defaultUnits =
        selectedAsset === 'USDT' || selectedAsset === 'USDC'
          ? 100
          : Math.max(0.001, Number(((offer.minInrPaise / offer.rateInrPaise) * 1.2).toFixed(4)));
      const targetUnits =
        overrideInrPaise && overrideInrPaise > 0
          ? Math.max(0.0001, Number((overrideInrPaise / offer.rateInrPaise).toFixed(6)))
          : defaultUnits;
      setAmountInput(String(targetUnits));
    }
  };

  const handleQuickBestMatch = () => {
    setMatchNotice(null);
    if (!guardTradingAction(mode === 'buy' ? 'QUICK_MATCH_BUY' : 'QUICK_MATCH_SELL')) {
      return;
    }
    const inrPaise = Math.round((Number(inrFilter) || 10000) * PAISE_PER_INR);
    const candidates = matchBestOffers(filteredOffers, {
      mode,
      asset: selectedAsset,
      inrPaise,
      paymentMethod: paymentFilter,
      verifiedOnly,
      includeDemo: showDemo,
      prioritize: matchingMode === 'SMART' ? 'SMART' : 'RATE',
    });
    if (candidates.length === 0) {
      setMatchNotice(`No active ${selectedAsset} offer matched those INR amount and payment filters.`);
      return;
    }
    openOrderModal(candidates[0], inrPaise);
  };

  const previewBreakdown = useMemo(() => {
    if (!selectedOffer) return null;
    const assetFeeBps =
      selectedAsset === 'USDT'
        ? mode === 'buy'
          ? platformSettings.buyerFeeBps
          : platformSettings.sellerFeeBps
        : activeCoinConfig?.tradingFeeBps ?? 15;

    if (selectedAsset === 'USDT') {
      if (mode === 'buy') {
        const inrPaise = Math.max(0, Math.round((Number(amountInput) || 0) * PAISE_PER_INR));
        const res = calculateBuyBreakdown({
          inrPaise,
          rateInrPaise: selectedOffer.rateInrPaise,
          buyerFeeBps: platformSettings.buyerFeeBps,
          tdsRateBps: platformSettings.tdsRateBps,
        });
        return {
          mode: 'buy' as const,
          inrPaise: res.inrPaise,
          grossQuantityE8: res.grossUsdtMicro * 100,
          feeE8: res.feeUsdtMicro * 100,
          netQuantityE8: res.netUsdtMicro * 100,
          tdsInrPaise: res.tdsInrPaise,
          netInrPaise: res.inrPaise,
          usdtMicroEquivalent: res.grossUsdtMicro,
          feeUsdtMicroEquivalent: res.feeUsdtMicro,
        };
      } else {
        const usdtMicro = Math.max(0, Math.round((Number(amountInput) || 0) * MICRO_PER_USDT));
        const res = calculateSellBreakdown({
          usdtMicro,
          rateInrPaise: selectedOffer.rateInrPaise,
          sellerFeeBps: platformSettings.sellerFeeBps,
          tdsRateBps: platformSettings.tdsRateBps,
        });
        return {
          mode: 'sell' as const,
          inrPaise: res.grossInrPaise,
          grossQuantityE8: res.usdtMicro * 100,
          feeE8: res.feeUsdtMicro * 100,
          netQuantityE8: Math.max(0, res.usdtMicro - res.feeUsdtMicro) * 100,
          tdsInrPaise: res.tdsInrPaise,
          netInrPaise: res.netInrPaise,
          usdtMicroEquivalent: res.usdtMicro,
          feeUsdtMicroEquivalent: res.feeUsdtMicro,
        };
      }
    }

    if (mode === 'buy') {
      const inrPaise = Math.max(0, Math.round((Number(amountInput) || 0) * PAISE_PER_INR));
      const res = calculateMultiCoinBuyBreakdown({
        inrPaise,
        rateInrPaise: selectedOffer.rateInrPaise,
        feeBps: assetFeeBps,
      });
      const tdsInrPaise = Math.round((inrPaise * platformSettings.tdsRateBps) / 10_000);
      return {
        mode: 'buy' as const,
        inrPaise: res.inrPaise,
        grossQuantityE8: res.grossQuantityE8,
        feeE8: res.feeE8,
        netQuantityE8: res.netQuantityE8,
        tdsInrPaise,
        netInrPaise: res.inrPaise,
        usdtMicroEquivalent: e8ToUsdtMicro(res.grossQuantityE8),
        feeUsdtMicroEquivalent: Math.round(res.feeE8 / 100),
      };
    } else {
      const qtyE8 = coinUnitsToE8(Number(amountInput) || 0);
      const res = calculateMultiCoinSellBreakdown({
        quantityE8: qtyE8,
        rateInrPaise: selectedOffer.rateInrPaise,
        feeBps: assetFeeBps,
        tdsBps: platformSettings.tdsRateBps,
      });
      return {
        mode: 'sell' as const,
        inrPaise: res.grossInrPaise,
        grossQuantityE8: res.quantityE8,
        feeE8: res.feeE8,
        netQuantityE8: res.netQuantityE8,
        tdsInrPaise: res.tdsInrPaise,
        netInrPaise: res.netInrPaise,
        usdtMicroEquivalent: e8ToUsdtMicro(res.quantityE8),
        feeUsdtMicroEquivalent: Math.round(res.feeE8 / 100),
      };
    }
  }, [selectedOffer, selectedAsset, mode, amountInput, platformSettings, activeCoinConfig]);

  const handleSeedSandbox = async () => {
    if (!user || !account) return;
    setSeeding(true);
    try {
      await seedSandboxMarketplaceAdmin(user.uid, account.username);
    } finally {
      setSeeding(false);
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError(null);

    if (!user || !account) {
      setOrderError('Please sign in first to create a P2P order.');
      return;
    }
    if (!isTradingEligible) {
      setSelectedOffer(null);
      setShowKycModal(true);
      void logDeniedTradingAttempt({
        uid: user.uid,
        action: mode === 'buy' ? 'CREATE_BUY_ORDER' : 'CREATE_SELL_ORDER',
        kycStatus: kycRestriction.effectiveKycStatus,
        reasonCode: kycRestriction.reasonCode,
        reasonMessage: kycRestriction.reasonMessage,
      });
      return;
    }
    if (!isAssetApprovedForTrading) {
      setOrderError(`${selectedAsset} is not yet approved for P2P trading by Admin governance.`);
      return;
    }
    if (!selectedOffer || !previewBreakdown) return;
    if (selectedOffer.merchantUid === user.uid) {
      setOrderError('You cannot trade against your own liquidity offer.');
      return;
    }
    if (!acceptedTerms) {
      setOrderError('Please accept the order and escrow verification terms.');
      return;
    }

    const inrPaise = previewBreakdown.inrPaise;
    const qtyE8 = previewBreakdown.grossQuantityE8;
    const offerAvailE8 =
      selectedOffer.availableAssetE8 ?? selectedOffer.availableUsdtMicro * 100;

    if (inrPaise < selectedOffer.minInrPaise || inrPaise > selectedOffer.maxInrPaise) {
      setOrderError(
        `Order value must be between ${formatInrFromPaise(selectedOffer.minInrPaise)} and ${formatInrFromPaise(selectedOffer.maxInrPaise)}.`
      );
      return;
    }
    if (qtyE8 <= 0 || qtyE8 > offerAvailE8) {
      setOrderError(`Requested ${selectedAsset} exceeds the offer’s available liquidity.`);
      return;
    }
    if (
      selectedAsset === 'USDT' &&
      mode === 'sell' &&
      wallet &&
      wallet.availableUsdtMicro < previewBreakdown.usdtMicroEquivalent
    ) {
      setOrderError(
        `Insufficient available USDT in your wallet ledger (${formatUsdtFromMicro(wallet.availableUsdtMicro, 2)}). Deposit sandbox or on-chain USDT in Wallet first.`
      );
      return;
    }

    if (priceLock && lockSecondsLeft <= 0) {
      setOrderError('Your temporary Price Lock has expired. Recalculate & lock a fresh rate to continue.');
      return;
    }

    setCreating(true);
    try {
      const token = await getIdToken();
      if (token && priceLock) {
        const verifyLockResp = await fetch('/api/quotes/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(priceLock),
        });
        if (verifyLockResp.ok) {
          const vJson = await verifyLockResp.json();
          if (!vJson.valid) {
            throw new Error('Price Lock expired on server verification. Refresh the quote and lock again.');
          }
        }
      }
      let riskResult: {
        score: number;
        level: RiskLevel;
        reasons: string[];
        recommendedAction:
          | 'ALLOW'
          | 'REQUEST_ADDITIONAL_VERIFICATION'
          | 'APPLY_LIMITS'
          | 'HOLD_MANUAL_REVIEW'
          | 'ESCALATE_COMPLIANCE'
          | 'BLOCK';
      } = {
        score: 12,
        level: 'LOW',
        reasons: ['Baseline order parameters checked.'],
        recommendedAction: 'ALLOW',
      };

      if (token) {
        const authResp = await fetch('/api/trading/authorize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: mode === 'buy' ? 'CREATE_BUY_ORDER' : 'CREATE_SELL_ORDER',
            coinSymbol: selectedAsset,
            network: selectedOffer.network,
          }),
        });
        if (!authResp.ok) {
          const authErr = (await authResp.json()) as {
            reasonCode?: string;
            reasonMessage?: string;
          };
          if (authErr.reasonCode?.startsWith('COIN_')) {
            throw new Error(authErr.reasonMessage || `${selectedAsset} trading is restricted.`);
          }
          setSelectedOffer(null);
          setShowKycModal(true);
          throw new Error(authErr.reasonMessage || 'KYC verification is required before trading.');
        }

        const riskResp = await fetch('/api/risk/assess', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            inrPaise,
            kycStatus: account.kycStatus,
            completedTrades: account.completedTrades,
            disputedCount: 0,
            cancelledCount: 0,
            newPaymentAccount: !isKycStatusVerified(account.kycStatus),
            paymentMethod: chosenMethod,
            network: selectedOffer.network,
          }),
        });
        if (riskResp.ok) {
          riskResult = (await riskResp.json()) as typeof riskResult;
        }
      }

      const orderSide =
        selectedAsset === 'USDT'
          ? mode === 'buy'
            ? 'BUY_USDT'
            : 'SELL_USDT'
          : mode === 'buy'
          ? 'BUY'
          : 'SELL';

      const created = await createP2POrder({
        offerId: selectedOffer.id,
        side: orderSide,
        asset: selectedAsset,
        buyerUid: mode === 'buy' ? user.uid : selectedOffer.merchantUid,
        sellerUid: mode === 'buy' ? selectedOffer.merchantUid : user.uid,
        buyerUsername: mode === 'buy' ? account.username : selectedOffer.merchantUsername,
        sellerUsername: mode === 'buy' ? selectedOffer.merchantUsername : account.username,
        usdtMicro: Math.max(1, previewBreakdown.usdtMicroEquivalent),
        quantityE8: qtyE8,
        inrPaise,
        rateInrPaise: priceLock?.rateInrPaise || selectedOffer.rateInrPaise,
        feeUsdtMicro: Math.max(0, previewBreakdown.feeUsdtMicroEquivalent),
        feeE8: previewBreakdown.feeE8,
        tdsInrPaise: previewBreakdown.tdsInrPaise,
        paymentMethod: chosenMethod,
        network: selectedOffer.network,
        buyerWalletAddress: mode === 'buy' ? wallet?.connectedAddress : undefined,
        sellerWalletAddress: mode === 'sell' ? wallet?.connectedAddress : undefined,
        riskScore: riskResult.score,
        riskLevel: riskResult.level,
        riskReasons: riskResult.reasons,
        recommendedAction: riskResult.recommendedAction,
        isSandbox: selectedOffer.isSandbox || platformSettings.sandboxMode,
        actorUid: user.uid,
      });

      if (priceLock?.lockId) {
        void updatePriceLockStatus(priceLock.lockId, 'CONSUMED');
      }

      if (token) {
        void fetch('/api/integrations/supabase/sync-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            orderCode: created.orderCode,
            side: orderSide,
            inrPaise,
            usdtMicro: Math.max(1, previewBreakdown.usdtMicroEquivalent),
            status: 'CREATED',
            isSandbox: selectedOffer.isSandbox || platformSettings.sandboxMode,
          }),
        }).catch(() => {});
      }

      setSelectedOffer(null);
      setPriceLock(null);
      onOrderCreated(created.id);
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Unable to create order.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      {/* Header & Side Switch */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="text-xs font-medium text-blue-700 dark:text-blue-400">
            Multi-Coin P2P Marketplace · {selectedAsset} / INR ·{' '}
            {platformSettings.sandboxMode ? 'Sandbox Mode' : 'Live'} · {liveMerchantCount} Live /{' '}
            {demoCount} Demo Offers
          </div>
          <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            {mode === 'buy' ? `Buy ${selectedAsset} with INR` : `Sell ${selectedAsset} for INR`}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            {mode === 'buy'
              ? `Match with verified desks or clearly marked DEMO sandbox merchants for ${selectedAsset}/INR. INR transfers settle via UPI/IMPS/NEFT/RTGS with ledger escrow protection.`
              : `Match with verified ${selectedAsset} buyers below and release crypto only after independently confirming INR settlement in your bank account.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => onNavigate('buy')}
              className={`px-4 py-2 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                mode === 'buy'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Buy {selectedAsset}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('sell')}
              className={`px-4 py-2 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                mode === 'sell'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Sell {selectedAsset}
            </button>
          </div>
          {onOpenCoinDetail && (
            <button
              type="button"
              onClick={() => onOpenCoinDetail(selectedAsset)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
            >
              <LineChart className="w-3.5 h-3.5" />
              {selectedAsset} Chart
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!guardTradingAction('POST_P2P_OFFER')) return;
              onNavigate('merchants');
            }}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
          >
            Post an Offer
          </button>
        </div>
      </div>

      {/* Cryptocurrency Selector Tabs */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          {coinConfigs.map((coin) => {
            const active = coin.symbol === selectedAsset;
            const approved = coin.tradingEnabled && coin.custodyApproved;
            return (
              <button
                key={coin.symbol}
                type="button"
                onClick={() => handleSelectAsset(coin.symbol)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                  active
                    ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <CoinBadge symbol={coin.symbol} accentHex={coin.accentHex} size="xs" />
                <span>{coin.symbol}</span>
                {!approved && (
                  <span
                    className={`text-[10px] font-mono ${
                      active ? 'text-amber-300' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    Pending
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Live vs Fallback Market Reference Bar */}
      {marketRate && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Market Spot Reference ({selectedAsset}/INR):
            </span>
            <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatSpotInr(marketRate.inrPrice)}
            </span>
            {typeof marketRate.change24hPct === 'number' && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`font-mono tabular-nums font-semibold ${
                    marketRate.change24hPct >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  24h {marketRate.change24hPct >= 0 ? '+' : ''}
                  {marketRate.change24hPct.toFixed(2)}%
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                marketRate.freshnessStatus === 'LIVE'
                  ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                  : 'font-semibold text-amber-700 dark:text-amber-400'
              }
            >
              {marketRate.freshnessStatus} (CoinGecko API)
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-500 dark:text-slate-400">{marketRate.notice}</span>
          </div>
        </div>
      )}

      {/* Coin Governance Approval Gate Banner */}
      {!isAssetApprovedForTrading && activeCoinConfig && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 text-xs text-amber-950 dark:text-amber-200">
            <ShieldAlert className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">
                {activeCoinConfig.name} ({activeCoinConfig.symbol}) Trading Locked Pending Admin Approval.
              </span>{' '}
              Administrators must verify network contracts and enable both Trading and Custody
              approval in Admin Coin Governance before real or sandbox {activeCoinConfig.symbol} P2P
              orders can be created.
            </div>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => onNavigateDashboardTab('admin')}
              className="px-3.5 py-2 text-xs font-semibold bg-amber-900 text-white rounded-lg hover:bg-amber-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Configure in Admin Console
            </button>
          )}
        </div>
      )}

      {/* Mandatory KYC Trading Restriction Banner */}
      {user && account && !isTradingEligible && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 text-sm text-amber-950 dark:text-amber-200">
            <AlertCircle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">
                Trading Locked — KYC Status: {kycRestriction.effectiveKycStatus.replace(/_/g, ' ')}.
              </span>{' '}
              {kycRestriction.reasonMessage}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateDashboardTab('kyc')}
            className="px-3.5 py-2 text-xs font-semibold bg-amber-900 text-white rounded-lg hover:bg-amber-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Complete KYC
          </button>
        </div>
      )}

      {/* Filter & Quick Match Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label htmlFor="mkt-search" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Merchant Search
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="mkt-search"
                type="text"
                placeholder="Username or terms"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div>
            <label htmlFor="mkt-inr" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              INR Amount
            </label>
            <input
              id="mkt-inr"
              type="number"
              placeholder="e.g. 10000"
              value={inrFilter}
              onChange={(e) => setInrFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label htmlFor="mkt-rail" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Payment Rail
            </label>
            <select
              id="mkt-rail"
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value as typeof paymentFilter)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">All Payment Methods</option>
              <option value="UPI">UPI</option>
              <option value="IMPS">IMPS</option>
              <option value="NEFT">NEFT</option>
              <option value="RTGS">RTGS</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
            </select>
          </div>

          <div>
            <label htmlFor="mkt-net" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Network
            </label>
            <select
              id="mkt-net"
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">All Supported Networks</option>
              {(activeCoinConfig?.supportedNetworks || []).map((netId) => (
                <option key={netId} value={netId}>
                  {MULTI_COIN_NETWORKS[netId]?.label || netId}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="mkt-sort" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Sort By
            </label>
            <select
              id="mkt-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'RATE' | 'COMPLETION' | 'SPEED')}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="RATE">Best INR Rate</option>
              <option value="COMPLETION">Highest Completion Rate</option>
              <option value="SPEED">Fastest Settlement</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleQuickBestMatch}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-700 cursor-pointer whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Quick Best Match
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setMatchingMode('SMART')}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer ${
                  matchingMode === 'SMART'
                    ? 'bg-slate-900 dark:bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Automatic Smart Match
              </button>
              <button
                type="button"
                onClick={() => setMatchingMode('MANUAL')}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer ${
                  matchingMode === 'MANUAL'
                    ? 'bg-slate-900 dark:bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Manual Offer Book
              </button>
            </div>

            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(e) => setVerifiedOnly(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Verified / Premium Tier Only</span>
            </label>

            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showDemo}
                onChange={(e) => setShowDemo(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Show Labeled DEMO Merchants ({demoCount})</span>
            </label>
          </div>

          <span className="text-slate-500 dark:text-slate-400">
            DEMO listings are fictional sandbox fixtures—never presented as KYC-verified real merchants.
          </span>
        </div>

        {matchNotice && (
          <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
            {matchNotice}
          </div>
        )}
      </div>

      {/* Smart P2P Order Matching Recommendations */}
      {matchingMode === 'SMART' && smartCandidates.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900 rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Smart P2P Order Matching — Top Eligible Offers
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              Scored across Rate (45%) · Reputation (25%) · Liquidity (15%) · Speed &amp; Rails (15%)
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {smartCandidates.map((item, idx) => (
              <div
                key={item.offer.id}
                className={`border rounded-xl p-4 space-y-2.5 ${
                  idx === 0
                    ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    #{idx + 1} · {item.offer.merchantUsername}
                    {item.offer.isDemo ? ' (DEMO)' : ''}
                  </span>
                  <span className="font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums shrink-0">
                    {item.matchScore}/100
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatRateInr(item.offer.rateInrPaise)}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {(item.offer.completionRateBps / 100).toFixed(1)}% · {item.offer.avgCompletionMins}m
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                  <div>{item.reasons.slice(0, 2).join(' · ')}</div>
                  <div className="font-mono text-[10px] text-slate-500 dark:text-slate-500 tabular-nums">
                    Rate {item.rateCompetitivenessScore}/45 · Rep {item.reputationScore}/25 · Liq {item.liquidityFitScore}/15 · Speed {item.speedAndRailScore}/15
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!isAssetApprovedForTrading}
                  onClick={() => {
                    const inrPaise = Math.round((Number(inrFilter) || 10000) * PAISE_PER_INR);
                    if (user) openOrderModal(item.offer, inrPaise);
                    else void signInWithGoogle();
                  }}
                  className="w-full py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-45 cursor-pointer"
                >
                  {user ? 'Lock Quote & Match' : 'Sign In to Match'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Offers List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredOffers.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <SlidersHorizontal className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="space-y-1">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                No matching {selectedAsset} {mode === 'buy' ? 'seller' : 'buyer'} offers found
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                {isAssetApprovedForTrading
                  ? 'Adjust your INR amount or payment filters, or publish a live offer from the Merchant Desk.'
                  : `${selectedAsset} offers require Admin approval before merchants can publish liquidity.`}
              </p>
            </div>
            {isAdmin && selectedAsset === 'USDT' && (
              <button
                type="button"
                disabled={seeding}
                onClick={() => void handleSeedSandbox()}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {seeding ? 'Seeding DEMO Merchants...' : 'Seed Labeled DEMO Merchants'}
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredOffers.map((offer) => {
              const netMeta = MULTI_COIN_NETWORKS[offer.network as keyof typeof MULTI_COIN_NETWORKS];
              const availE8 = offer.availableAssetE8 ?? offer.availableUsdtMicro * 100;
              return (
                <div
                  key={offer.id}
                  className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <span>{offer.merchantUsername}</span>
                      {offer.isDemo ? (
                        <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 px-1.5 py-0.5 rounded-sm">
                          {offer.demoLabel || 'DEMO'}
                        </span>
                      ) : (
                        <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        {offer.isDemo
                          ? `Simulated ${offer.verificationLevel} Desk`
                          : `${offer.verificationLevel} Verified Merchant`}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {(offer.completionRateBps / 100).toFixed(1)}% completion
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{offer.completedTrades} orders</span>
                      {typeof offer.merchantRatingBps === 'number' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums font-mono">
                            {(offer.merchantRatingBps / 100).toFixed(2)}★
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">Avg {offer.avgCompletionMins} min</span>
                    </div>
                    {offer.termsNote && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl truncate">
                        {offer.termsNote}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 lg:gap-6 items-center">
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Price / {selectedAsset}
                      </div>
                      <div className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatRateInr(offer.rateInrPaise)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Available &amp; Limits
                      </div>
                      <div className="font-mono text-xs font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                        {selectedAsset === 'USDT'
                          ? formatUsdtFromMicro(offer.availableUsdtMicro, 2)
                          : `${formatCoinQuantityFromE8(availE8, 6)} ${selectedAsset}`}
                      </div>
                      <div className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {formatInrFromPaise(offer.minInrPaise)} –{' '}
                        {formatInrFromPaise(offer.maxInrPaise)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Payment &amp; Chain
                      </div>
                      <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                        {offer.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(' · ')}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {netMeta ? netMeta.label : offer.network}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={!isAssetApprovedForTrading}
                        onClick={() => (user ? openOrderModal(offer) : void signInWithGoogle())}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {user
                          ? mode === 'buy'
                            ? `Buy ${selectedAsset}`
                            : `Sell ${selectedAsset}`
                          : 'Sign In to Trade'}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Order Modal */}
      {selectedOffer && previewBreakdown && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                    {mode === 'buy'
                      ? `Create Buy ${selectedAsset} Order`
                      : `Create Sell ${selectedAsset} Order`}
                  </h2>
                  {selectedOffer.isDemo && (
                    <span className="font-mono text-[11px] font-bold uppercase text-amber-800 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded-sm">
                      DEMO
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Counterparty: {selectedOffer.merchantUsername} · Rate{' '}
                  {formatRateInr(selectedOffer.rateInrPaise)} ·{' '}
                  {MULTI_COIN_NETWORKS[selectedOffer.network as keyof typeof MULTI_COIN_NETWORKS]
                    ?.label || selectedOffer.network}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOffer(null)}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>

            {orderError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-900 dark:text-red-200">
                {orderError}
              </div>
            )}

            <form onSubmit={handleCreateOrder} className="space-y-4">
              {/* Temporary Signed Price Lock Bar */}
              <div className="border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl p-3.5 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                    <Lock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Temporary Exchange-Rate Lock</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {([45, 90, 180] as const).map((ttl) => (
                      <button
                        key={ttl}
                        type="button"
                        disabled={lockingQuote}
                        onClick={() => {
                          setPriceLockTtl(ttl);
                          if (selectedOffer) void issuePriceLock(selectedOffer, ttl, false);
                        }}
                        className={`px-2 py-0.5 font-mono text-[11px] rounded border cursor-pointer ${
                          priceLockTtl === ttl
                            ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {ttl}s
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-mono tabular-nums">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    {priceLock ? (
                      lockSecondsLeft > 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          Locked @ {formatRateInr(priceLock.rateInrPaise)} · Expires in{' '}
                          {String(Math.floor(lockSecondsLeft / 60)).padStart(2, '0')}:
                          {String(lockSecondsLeft % 60).padStart(2, '0')}
                        </span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400 font-semibold">
                          Price Lock Expired — Recalculate rate before creating order
                        </span>
                      )
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">
                        {lockingQuote ? 'Signing quote lock...' : `Spot quote @ ${formatRateInr(selectedOffer.rateInrPaise)}`}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={lockingQuote}
                    onClick={() => selectedOffer && void issuePriceLock(selectedOffer, priceLockTtl, true)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Recalculate &amp; Lock Fresh Rate
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {mode === 'buy'
                    ? 'Amount to Pay (INR)'
                    : `${selectedAsset} Quantity to Sell`}
                </label>
                <input
                  type="number"
                  step={mode === 'buy' ? '100' : 'any'}
                  min={mode === 'buy' ? 100 : 0.00001}
                  required
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3.5 py-2.5 font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  Order limits: {formatInrFromPaise(selectedOffer.minInrPaise)} –{' '}
                  {formatInrFromPaise(selectedOffer.maxInrPaise)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Payment Method
                </label>
                <select
                  value={chosenMethod}
                  onChange={(e) => setChosenMethod(e.target.value as PaymentMethodType)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {selectedOffer.paymentMethods.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Locked Quote Rate</span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatRateInr(priceLock?.rateInrPaise || selectedOffer.rateInrPaise)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Platform Fee</span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {(previewBreakdown.feeE8 / E8_PER_COIN).toFixed(6)} {selectedAsset}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Sec 194S 1% TDS</span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatInrFromPaise(previewBreakdown.tdsInrPaise)}
                  </span>
                </div>
                <div className="border-t border-slate-200 dark:border-slate-800 pt-2 flex justify-between font-semibold text-sm">
                  <span className="text-slate-900 dark:text-slate-100">
                    {mode === 'buy'
                      ? `Estimated ${selectedAsset} Received`
                      : 'Estimated Net INR Received'}
                  </span>
                  <span className="font-mono tabular-nums text-blue-700 dark:text-blue-400">
                    {previewBreakdown.mode === 'buy'
                      ? `${formatCoinQuantityFromE8(previewBreakdown.netQuantityE8, 6)} ${selectedAsset}`
                      : formatInrFromPaise(previewBreakdown.netInrPaise)}
                  </span>
                </div>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>
                  I accept the counterparty terms. I understand INR transfers must come from my
                  KYC-verified account, screenshots alone never authorize crypto release, and
                  sandbox escrow records represent simulated ledger entries.
                </span>
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedOffer(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || (Boolean(priceLock) && lockSecondsLeft <= 0)}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {creating ? 'Running Risk Check & Creating...' : 'Confirm & Create Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <KycRestrictionModal
        open={showKycModal}
        kycStatus={kycRestriction.effectiveKycStatus}
        reasonCode={kycRestriction.reasonCode}
        reasonMessage={kycRestriction.reasonMessage}
        onCompleteKyc={() => {
          setShowKycModal(false);
          onNavigateDashboardTab('kyc');
        }}
        onViewStatus={() => {
          setShowKycModal(false);
          onNavigateDashboardTab('kyc');
        }}
        onClose={() => setShowKycModal(false)}
      />
    </div>
  );
}
