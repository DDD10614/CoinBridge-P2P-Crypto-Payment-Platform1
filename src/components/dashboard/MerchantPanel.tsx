import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  Check,
  Copy,
  Eye,
  Key,
  Send,
  ShieldAlert,
  Terminal,
  Trash2,
  Webhook,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  formatInrFromPaise,
  formatRateInr,
  formatUsdtFromMicro,
  MICRO_PER_USDT,
  PAISE_PER_INR,
  PAYMENT_METHOD_LABELS,
  PaymentMethodType,
} from '../../lib/domain';
import {
  coinUnitsToE8,
  DEFAULT_SUPPORTED_COINS,
  e8ToUsdtMicro,
  formatCoinQuantityFromE8,
  MULTI_COIN_NETWORKS,
  MultiCoinNetworkId,
  SupportedCoinConfig,
} from '../../lib/coins';
import {
  createP2POffer,
  deleteMerchantWebhookDoc,
  logDeniedTradingAttempt,
  registerMerchantProfile,
  revokeMerchantApiKeyDoc,
  saveMerchantApiKeyDoc,
  saveMerchantWebhookDoc,
  toggleOfferActive,
  updateMerchantVisibilitySettings,
  updateMerchantWebhookStatus,
} from '../../lib/firestoreService';
import { evaluateMerchantVipProgram, MERCHANT_VIP_TIERS } from '../../lib/merchantVip';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { useAuth } from '../../context/AuthContext';
import {
  MerchantApiKeyDoc,
  MerchantProfileDoc,
  MerchantWebhookDoc,
  P2POfferDoc,
  P2POrderDoc,
  SupportedCoinDoc,
} from '../../types/models';

interface MerchantPanelProps {
  orders: P2POrderDoc[];
  onOpenOrder: (orderId: string) => void;
  onGoToKyc?: () => void;
}

interface ApiUsageStats {
  activeKeys: number;
  totalRequests: number;
  rateLimitedCount: number;
  keys: Array<{
    keyHash: string;
    keyPrefix: string;
    label: string;
    totalRequests: number;
    rateLimitedCount: number;
    lastUsedAtIso: string | null;
    recentEndpoints: string[];
  }>;
}

const WEBHOOK_EVENTS = [
  'order.created',
  'order.escrow_reserved',
  'order.payment_submitted',
  'order.completed',
  'order.disputed',
];

export function MerchantPanel({ orders, onOpenOrder, onGoToKyc }: MerchantPanelProps) {
  const { user, account, platformSettings, isTradingEligible, kycRestriction, getIdToken } =
    useAuth();
  const [merchant, setMerchant] = useState<MerchantProfileDoc | null>(null);
  const [myOffers, setMyOffers] = useState<P2POfferDoc[]>([]);
  const [apiKeys, setApiKeys] = useState<MerchantApiKeyDoc[]>([]);
  const [webhooks, setWebhooks] = useState<MerchantWebhookDoc[]>([]);
  const [apiUsage, setApiUsage] = useState<ApiUsageStats | null>(null);

  // Registration form
  const [businessName, setBusinessName] = useState('');
  const [merchantType, setMerchantType] = useState<'INDIVIDUAL' | 'BUSINESS'>('INDIVIDUAL');
  const [declaredUsdt, setDeclaredUsdt] = useState('5000');
  const [minInr, setMinInr] = useState('1000');
  const [maxInr, setMaxInr] = useState('200000');
  const [agreed, setAgreed] = useState(false);

  // Visibility controls
  const [visibilityMode, setVisibilityMode] = useState<'PUBLIC' | 'HIGH_VOLUME_ONLY' | 'HIDDEN'>(
    'PUBLIC'
  );
  const [showVipBadge, setShowVipBadge] = useState(true);

  // New Offer form
  const [coinConfigs, setCoinConfigs] = useState<SupportedCoinConfig[]>(DEFAULT_SUPPORTED_COINS);
  const [offerAsset, setOfferAsset] = useState<string>('USDT');
  const [offerSide, setOfferSide] = useState<'SELL_USDT' | 'BUY_USDT'>('SELL_USDT');
  const [offerRateInr, setOfferRateInr] = useState('92.10');
  const [offerQuantity, setOfferQuantity] = useState('2500');
  const [offerMinInr, setOfferMinInr] = useState('1000');
  const [offerMaxInr, setOfferMaxInr] = useState('100000');
  const [offerMethods, setOfferMethods] = useState<PaymentMethodType[]>(['UPI', 'IMPS']);
  const [offerNetwork, setOfferNetwork] = useState<MultiCoinNetworkId>('TRON_TRC20');
  const [offerTerms, setOfferTerms] = useState(
    'Transfer from KYC-matched bank account only. No third-party payments.'
  );

  // Developer API & Webhook forms
  const [apiKeyLabel, setApiKeyLabel] = useState('Automated Desk Integration');
  const [apiKeyScopes, setApiKeyScopes] = useState<string[]>([
    'markets:read',
    'offers:read',
    'orders:read',
  ]);
  const [revealedRawKey, setRevealedRawKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>([
    'order.created',
    'order.completed',
  ]);
  const [webhookSecretsById, setWebhookSecretsById] = useState<Record<string, string>>({});

  // Live REST v1 Tester
  const [testApiKey, setTestApiKey] = useState('');
  const [testEndpoint, setTestEndpoint] = useState<'profile' | 'markets'>('profile');
  const [testOutput, setTestOutput] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const unsubCoins = onSnapshot(
      collection(db, 'supported_coins'),
      (snap) => {
        if (snap.empty) {
          setCoinConfigs(DEFAULT_SUPPORTED_COINS);
          return;
        }
        const bySym = new Map<string, SupportedCoinConfig>();
        for (const c of DEFAULT_SUPPORTED_COINS) bySym.set(c.symbol, c);
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
      (e) => handleFirestoreError(e, OperationType.LIST, 'supported_coins')
    );
    return () => unsubCoins();
  }, []);

  const approvedCoins = useMemo(
    () => coinConfigs.filter((c) => c.tradingEnabled && c.custodyApproved),
    [coinConfigs]
  );

  const selectedOfferCoin = useMemo(
    () =>
      approvedCoins.find((c) => c.symbol === offerAsset) ||
      approvedCoins[0] ||
      DEFAULT_SUPPORTED_COINS[0],
    [approvedCoins, offerAsset]
  );

  useEffect(() => {
    if (
      selectedOfferCoin &&
      selectedOfferCoin.supportedNetworks.length > 0 &&
      !selectedOfferCoin.supportedNetworks.includes(offerNetwork)
    ) {
      setOfferNetwork(selectedOfferCoin.supportedNetworks[0]);
    }
  }, [selectedOfferCoin, offerNetwork]);

  useEffect(() => {
    if (!user) return;
    const unsubMerchant = onSnapshot(
      doc(db, 'merchants', user.uid),
      (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...(snap.data() as Omit<MerchantProfileDoc, 'id'>) };
          setMerchant(data);
          setVisibilityMode(data.visibilityMode || 'PUBLIC');
          setShowVipBadge(data.showVipBadge !== false);
        } else {
          setMerchant(null);
        }
      },
      (e) => handleFirestoreError(e, OperationType.GET, `merchants/${user.uid}`)
    );

    const unsubOffers = onSnapshot(
      query(collection(db, 'p2p_offers'), where('merchantUid', '==', user.uid)),
      (snap) => {
        const list: P2POfferDoc[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<P2POfferDoc, 'id'>) }));
        setMyOffers(list);
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'p2p_offers')
    );

    const unsubKeys = onSnapshot(
      query(collection(db, 'merchant_api_keys'), where('uid', '==', user.uid)),
      (snap) => {
        setApiKeys(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MerchantApiKeyDoc, 'id'>) }))
        );
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'merchant_api_keys')
    );

    const unsubWebhooks = onSnapshot(
      query(collection(db, 'merchant_webhooks'), where('uid', '==', user.uid)),
      (snap) => {
        setWebhooks(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MerchantWebhookDoc, 'id'>) }))
        );
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'merchant_webhooks')
    );

    return () => {
      unsubMerchant();
      unsubOffers();
      unsubKeys();
      unsubWebhooks();
    };
  }, [user]);

  const loadUsageStats = async () => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const resp = await fetch('/api/merchant/api-keys/usage', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        setApiUsage((await resp.json()) as ApiUsageStats);
      }
    } catch {
      // Optional telemetry sync
    }
  };

  // Sync persisted hashed keys into server runtime registry & fetch usage stats
  useEffect(() => {
    if (!user || !merchant || merchant.isDemo || !isTradingEligible) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token || cancelled) return;
        if (apiKeys.length > 0) {
          await fetch('/api/merchant/api-keys/sync', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              keys: apiKeys.map((k) => ({
                keyHash: k.keyHash,
                keyPrefix: k.keyPrefix,
                label: k.label,
                scopes: k.scopes,
                rateLimitPerMin: k.rateLimitPerMin,
                revoked: k.revoked,
              })),
            }),
          });
        }
        if (!cancelled) await loadUsageStats();
      } catch {
        // Non-blocking
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, merchant?.id, merchant?.isDemo, isTradingEligible, apiKeys]);

  const merchantOrders = useMemo(
    () => orders.filter((o) => o.sellerUid === user?.uid || o.buyerUid === user?.uid),
    [orders, user?.uid]
  );

  const analytics = useMemo(() => {
    const completed = merchantOrders.filter((o) => o.status === 'COMPLETED');
    const disputed = merchantOrders.filter((o) => o.status === 'DISPUTED');
    const volumeUsdtMicro = completed.reduce((acc, o) => acc + o.usdtMicro, 0);
    const feeEarnedMicro = completed.reduce((acc, o) => acc + o.feeUsdtMicro, 0);
    const disputeRatePct =
      merchantOrders.length > 0 ? (disputed.length / merchantOrders.length) * 100 : 0;

    let avgMins = merchant?.avgCompletionMins || 8;
    const timed = completed.filter((o) => o.completedAtMs && o.createdAt?.toMillis);
    if (timed.length > 0) {
      const totalMs = timed.reduce(
        (acc, o) => acc + Math.max(60_000, (o.completedAtMs || 0) - o.createdAt.toMillis()),
        0
      );
      avgMins = Math.round(totalMs / timed.length / 60_000);
    }

    const dailyBuckets: { label: string; inr: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      let inr = 0;
      for (const o of completed) {
        const oKey = o.createdAt?.toDate ? o.createdAt.toDate().toISOString().slice(0, 10) : '';
        if (oKey === key) inr += o.inrPaise / PAISE_PER_INR;
      }
      dailyBuckets.push({ label, inr });
    }

    return {
      completedCount: Math.max(completed.length, merchant?.completedOrders || 0),
      disputedCount: Math.max(disputed.length, merchant?.disputedOrders || 0),
      volumeUsdtMicro: Math.max(volumeUsdtMicro, merchant?.totalVolumeUsdtMicro || 0),
      feeEarnedMicro,
      avgMins,
      disputeRatePct,
      dailyBuckets,
    };
  }, [merchantOrders, merchant]);

  const vipEval = useMemo(() => {
    if (!merchant) return null;
    return evaluateMerchantVipProgram({
      completedOrders: analytics.completedCount,
      totalVolumeUsdtMicro: analytics.volumeUsdtMicro,
      disputedOrders: analytics.disputedCount,
      verificationLevel: merchant.verificationLevel,
      isDemo: merchant.isDemo,
    });
  }, [merchant, analytics]);

  const maxBucketInr = Math.max(1000, ...analytics.dailyBuckets.map((b) => b.inr));

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setErr(null);
    setMsg(null);
    if (!isTradingEligible) {
      setErr(
        `Complete KYC Verification required (${kycRestriction.effectiveKycStatus.replace(/_/g, ' ')}): ${kycRestriction.reasonMessage}`
      );
      void logDeniedTradingAttempt({
        uid: user.uid,
        action: 'MERCHANT_REGISTER',
        kycStatus: kycRestriction.effectiveKycStatus,
        reasonCode: kycRestriction.reasonCode,
        reasonMessage: kycRestriction.reasonMessage,
      });
      return;
    }
    if (!agreed) {
      setErr('You must accept the merchant liquidity & compliance agreement.');
      return;
    }
    setBusy(true);
    try {
      await registerMerchantProfile({
        uid: user.uid,
        businessName,
        merchantType,
        declaredLiquidityUsdtMicro: Math.round((Number(declaredUsdt) || 1000) * MICRO_PER_USDT),
        minOrderInrPaise: Math.round((Number(minInr) || 1000) * PAISE_PER_INR),
        maxOrderInrPaise: Math.round((Number(maxInr) || 100000) * PAISE_PER_INR),
        commissionBps: platformSettings.merchantCommissionBps,
      });
      setMsg('Merchant desk registered. You can now publish P2P liquidity offers.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAvailability = async () => {
    if (!user || !merchant) return;
    await updateDoc(doc(db, 'merchants', user.uid), {
      isAvailable: !merchant.isAvailable,
      updatedAt: serverTimestamp(),
    });
  };

  const handleSaveVisibility = async () => {
    if (!user || !merchant) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await updateMerchantVisibilitySettings({
        uid: user.uid,
        visibilityMode,
        showVipBadge,
      });
      setMsg('Merchant desk visibility & VIP badge preferences saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save visibility preferences.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleMethod = (m: PaymentMethodType) => {
    setOfferMethods((prev) => {
      if (prev.includes(m)) {
        return prev.length > 1 ? prev.filter((x) => x !== m) : prev;
      }
      return [...prev, m].slice(0, 5);
    });
  };

  const handlePublishOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !account || !merchant) return;
    setErr(null);
    setMsg(null);
    if (!isTradingEligible) {
      setErr(
        `Complete KYC Verification required (${kycRestriction.effectiveKycStatus.replace(/_/g, ' ')}): ${kycRestriction.reasonMessage}`
      );
      void logDeniedTradingAttempt({
        uid: user.uid,
        action: 'PUBLISH_P2P_OFFER',
        kycStatus: kycRestriction.effectiveKycStatus,
        reasonCode: kycRestriction.reasonCode,
        reasonMessage: kycRestriction.reasonMessage,
      });
      return;
    }
    const ratePaise = Math.round((Number(offerRateInr) || 0) * PAISE_PER_INR);
    const qtyE8 = coinUnitsToE8(Number(offerQuantity) || 0);
    const usdtMicro = e8ToUsdtMicro(qtyE8);
    const minPaise = Math.round((Number(offerMinInr) || 0) * PAISE_PER_INR);
    const maxPaise = Math.round((Number(offerMaxInr) || 0) * PAISE_PER_INR);

    if (!selectedOfferCoin?.tradingEnabled || !selectedOfferCoin?.custodyApproved) {
      setErr(`${selectedOfferCoin?.symbol || offerAsset} requires Admin trading & custody approval.`);
      return;
    }

    if (ratePaise <= 0 || qtyE8 <= 0 || minPaise <= 0 || maxPaise < minPaise) {
      setErr('Enter valid positive rate, liquidity, and INR min/max limits.');
      return;
    }

    setBusy(true);
    try {
      const level = merchant.verificationLevel === 'SUSPENDED' ? 'BASIC' : merchant.verificationLevel;
      const mappedSide =
        selectedOfferCoin.symbol === 'USDT'
          ? offerSide
          : offerSide === 'SELL_USDT'
            ? 'SELL'
            : 'BUY';
      await createP2POffer({
        merchantUid: user.uid,
        merchantUsername: account.username,
        verificationLevel:
          level === 'BASIC' || level === 'VERIFIED' || level === 'PREMIUM' ? level : 'BASIC',
        side: mappedSide,
        asset: selectedOfferCoin.symbol,
        rateInrPaise: ratePaise,
        availableUsdtMicro: usdtMicro,
        availableAssetE8: qtyE8,
        minInrPaise: minPaise,
        maxInrPaise: maxPaise,
        paymentMethods: offerMethods,
        network: offerNetwork,
        avgCompletionMins: analytics.avgMins,
        termsNote: offerTerms,
        isSandbox: platformSettings.sandboxMode,
      });
      setMsg(`${selectedOfferCoin.symbol} P2P liquidity offer published to the live marketplace.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Unable to publish offer.');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !merchant || merchant.isDemo || !isTradingEligible) return;
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/merchant/api-keys/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          label: apiKeyLabel.trim() || 'Merchant Desk Key',
          scopes: apiKeyScopes.length > 0 ? apiKeyScopes : ['markets:read'],
          rateLimitPerMin: vipEval?.definition.apiRateLimitPerMin || 60,
        }),
      });
      const data = (await resp.json()) as {
        rawKey?: string;
        keyHash?: string;
        keyPrefix?: string;
        rateLimitPerMin?: number;
        scopes?: string[];
        error?: string;
      };
      if (!resp.ok || !data.rawKey || !data.keyHash || !data.keyPrefix) {
        throw new Error(data.error || 'Failed to generate API key.');
      }
      await saveMerchantApiKeyDoc({
        uid: user.uid,
        keyHash: data.keyHash,
        keyPrefix: data.keyPrefix,
        label: apiKeyLabel.trim() || 'Merchant Desk Key',
        scopes: data.scopes || apiKeyScopes,
        rateLimitPerMin: data.rateLimitPerMin || 60,
      });
      setRevealedRawKey(data.rawKey);
      setTestApiKey(data.rawKey);
      setCopiedKey(false);
      setMsg('Merchant API key created. Copy the raw key now—only the SHA-256 hash is stored.');
      await loadUsageStats();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'API key generation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeApiKey = async (keyHash: string) => {
    if (!user) return;
    setBusy(true);
    try {
      const token = await getIdToken();
      await fetch('/api/merchant/api-keys/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ keyHash }),
      });
      await revokeMerchantApiKeyDoc(keyHash, user.uid);
      setMsg('API key revoked immediately.');
      await loadUsageStats();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to revoke key.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !merchant || merchant.isDemo || !isTradingEligible) return;
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/merchant/webhooks/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: webhookUrl.trim() }),
      });
      const data = (await resp.json()) as {
        valid?: boolean;
        normalizedUrl?: string;
        signingSecret?: string;
        error?: string;
      };
      if (!resp.ok || !data.valid || !data.normalizedUrl || !data.signingSecret) {
        throw new Error(data.error || 'Invalid webhook endpoint.');
      }
      const masked = `${data.signingSecret.slice(0, 10)}...${data.signingSecret.slice(-4)}`;
      const webhookId = await saveMerchantWebhookDoc({
        uid: user.uid,
        url: data.normalizedUrl,
        events: webhookEvents.length > 0 ? webhookEvents : ['order.completed'],
        secretMasked: masked,
      });
      if (webhookId) {
        setWebhookSecretsById((prev) => ({ ...prev, [webhookId]: data.signingSecret! }));
      }
      setWebhookUrl('');
      setMsg('HTTPS webhook saved with SSRF checks and HMAC-SHA256 signing secret.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to register webhook.');
    } finally {
      setBusy(false);
    }
  };

  const handleTestWebhook = async (wh: MerchantWebhookDoc) => {
    setBusy(true);
    setErr(null);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/merchant/webhooks/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          url: wh.url,
          secret: webhookSecretsById[wh.id] || wh.secretMasked,
          eventType: wh.events[0] || 'order.settlement.ping',
        }),
      });
      const data = (await resp.json()) as {
        delivered?: boolean;
        statusCode?: number;
        error?: string;
      };
      const statusLabel = data.delivered
        ? `HTTP ${data.statusCode} OK (${new Date().toISOString().slice(11, 19)}Z)`
        : `FAILED (${data.statusCode || 'ERR'}: ${data.error || 'No response'})`;
      await updateMerchantWebhookStatus(wh.id, statusLabel);
      setMsg(`Webhook ping dispatched: ${statusLabel}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Webhook test failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRunLiveApiTest = async () => {
    if (!testApiKey.trim()) {
      setErr('Paste your generated raw cb_test_ or cb_live_ API key to execute a live test call.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const path =
        testEndpoint === 'profile' ? '/api/v1/merchant/profile' : '/api/v1/merchant/markets';
      const resp = await fetch(path, {
        headers: { 'X-CB-API-Key': testApiKey.trim() },
      });
      const data = await resp.json();
      setTestOutput(JSON.stringify({ httpStatus: resp.status, data }, null, 2));
      await loadUsageStats();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Live API test request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          Merchant, VIP Program &amp; Developer Desk
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Verified merchant desks undergo KYC/KYB compliance checks and gradually replace clearly
          labeled DEMO sandbox desks. Promotional VIP tiers reward volume &amp; reliability without
          overriding compliance controls.
        </p>
      </div>

      {!isTradingEligible && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950 dark:text-amber-200">
          <div>
            <strong>Complete KYC Verification:</strong> Merchant registration, publishing P2P
            offers, and generating API keys require verified &amp; active KYC status (Current:{' '}
            <span className="font-mono font-bold">
              {kycRestriction.effectiveKycStatus.replace(/_/g, ' ')}
            </span>
            ).
          </div>
          {onGoToKyc && (
            <button
              type="button"
              onClick={onGoToKyc}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-amber-900 dark:bg-amber-600 rounded-lg hover:bg-amber-800 dark:hover:bg-amber-500 shrink-0 cursor-pointer"
            >
              Complete KYC
            </button>
          )}
        </div>
      )}

      {msg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200">
          {msg}
        </div>
      )}
      {err && (
        <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-900 dark:text-red-200">
          {err}
        </div>
      )}

      {!merchant ? (
        <form
          onSubmit={handleRegister}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 max-w-2xl space-y-4"
        >
          <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            Apply for Merchant Liquidity Desk
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Business / Desk Name
              </label>
              <input
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Bharat Digital Desk"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3.5 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Entity Type
              </label>
              <select
                value={merchantType}
                onChange={(e) => setMerchantType(e.target.value as 'INDIVIDUAL' | 'BUSINESS')}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3.5 py-2.5 text-sm"
              >
                <option value="INDIVIDUAL">Individual Desk</option>
                <option value="BUSINESS">Registered Business (KYB)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Declared Liquidity (USDT)
              </label>
              <input
                type="number"
                min={100}
                value={declaredUsdt}
                onChange={(e) => setDeclaredUsdt(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3.5 py-2.5 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Min / Max Order (INR)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={minInr}
                  onChange={(e) => setMinInr(e.target.value)}
                  className="w-1/2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2.5 text-sm font-mono tabular-nums"
                />
                <input
                  type="number"
                  value={maxInr}
                  onChange={(e) => setMaxInr(e.target.value)}
                  className="w-1/2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2.5 text-sm font-mono tabular-nums"
                />
              </div>
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-blue-600"
            />
            <span>
              I accept the CoinBridge Merchant Liquidity Agreement, KYC/AML compliance terms, and
              independent INR settlement verification rules.
            </span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
          >
            {busy ? 'Registering...' : 'Register Merchant Account'}
          </button>
        </form>
      ) : (
        <div className="space-y-6">
          {/* Merchant Analytics KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">KYB Verification</div>
              <div className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                {merchant.isDemo ? 'DEMO DESK' : merchant.verificationLevel}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">VIP Program Tier</div>
              <div className="mt-1 font-mono text-base font-bold text-blue-700 dark:text-blue-400">
                {vipEval?.tier || 'BRONZE'}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Completed Orders</div>
              <div className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {analytics.completedCount}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Trading Volume</div>
              <div className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatUsdtFromMicro(analytics.volumeUsdtMicro, 0)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Avg Settlement · Dispute</div>
              <div className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {analytics.avgMins}m · {analytics.disputeRatePct.toFixed(1)}%
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div className="text-xs text-slate-500 dark:text-slate-400">Desk Status</div>
              <button
                type="button"
                onClick={() => void handleToggleAvailability()}
                className={`mt-1 px-3 py-1 rounded-md text-xs font-semibold cursor-pointer self-start ${
                  merchant.isAvailable
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {merchant.isAvailable ? 'Online' : 'Paused'}
              </button>
            </div>
          </div>

          {/* Module 8: Merchant VIP Program & Visibility Controls */}
          {vipEval && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Award className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                        Merchant VIP Performance Program — {vipEval.definition.label} Tier
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Completion rate:{' '}
                        <strong className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                          {vipEval.completionRatePct}%
                        </strong>{' '}
                        · Promotional Fee Rebate:{' '}
                        <strong className="font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {vipEval.definition.feeRebateBps} bps
                        </strong>{' '}
                        · Smart-Match Boost:{' '}
                        <strong className="font-mono tabular-nums">
                          +{vipEval.definition.rankingBoostPoints} pts
                        </strong>
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-1 rounded-sm font-mono text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                    KYB: {vipEval.verificationSummary.kycKybStatus}
                  </span>
                </div>

                {/* Progress bar to next tier */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600 dark:text-slate-400">
                    <span>
                      {vipEval.nextTier
                        ? `Progress toward ${vipEval.nextTier.label} (${vipEval.nextTier.minCompletedOrders} orders · ${vipEval.nextTier.minVolumeUsdt.toLocaleString()} USDT)`
                        : 'Maximum Platinum VIP Tier Unlocked'}
                    </span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {vipEval.progressToNextPct}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-sm overflow-hidden">
                    <div
                      style={{ width: `${vipEval.progressToNextPct}%` }}
                      className="h-full bg-blue-600 transition-all"
                    />
                  </div>
                </div>

                {/* Tier Ladder */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[11px]">
                  {MERCHANT_VIP_TIERS.map((t) => {
                    const isCurrent = t.tier === vipEval.tier;
                    return (
                      <div
                        key={t.tier}
                        className={`p-3 rounded-lg border ${
                          isCurrent
                            ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50'
                        }`}
                      >
                        <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {t.label}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                          {t.minCompletedOrders}+ orders · ${t.minVolumeUsdt.toLocaleString()}
                        </div>
                        <div className="text-emerald-700 dark:text-emerald-400 font-mono mt-1 tabular-nums">
                          {t.feeRebateBps} bps rebate · {t.apiRateLimitPerMin}/m API
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                  <strong>Compliance Separation Notice:</strong> {vipEval.verificationSummary.disclaimer}
                </div>
              </div>

              {/* Visibility Preferences */}
              <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    Desk Visibility Controls
                  </h3>
                </div>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Offer Book Discovery Mode
                    </label>
                    <select
                      value={visibilityMode}
                      onChange={(e) =>
                        setVisibilityMode(
                          e.target.value as 'PUBLIC' | 'HIGH_VOLUME_ONLY' | 'HIDDEN'
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
                    >
                      <option value="PUBLIC">Public Marketplace Listing</option>
                      <option value="HIGH_VOLUME_ONLY">High-Volume Desk Filter Only</option>
                      <option value="HIDDEN">Hidden (Direct Link / API Only)</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showVipBadge}
                      onChange={(e) => setShowVipBadge(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-700 text-blue-600"
                    />
                    <span>Display promotional VIP performance tier alongside offers</span>
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSaveVisibility()}
                    className="w-full py-2 px-3 font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500 cursor-pointer"
                  >
                    Save Visibility Settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 7-Day Completed INR Settlement SVG Chart */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Merchant 7-Day Completed INR Settlement Chart
              </h3>
              <div className="text-xs font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                Fee Share Tracked: {formatUsdtFromMicro(analytics.feeEarnedMicro, 2)} · Commission{' '}
                {(merchant.commissionBps / 100).toFixed(2)}%
              </div>
            </div>
            <svg
              viewBox="0 0 700 120"
              className="w-full h-32"
              role="img"
              aria-label="7-day merchant INR settlement volume"
            >
              {analytics.dailyBuckets.map((b, idx) => {
                const barH = Math.max(6, Math.round((b.inr / maxBucketInr) * 78));
                const x = idx * 96 + 24;
                const y = 92 - barH;
                return (
                  <g key={b.label}>
                    <rect x={x} y={y} width="48" height={barH} rx="4" fill="#2563EB" />
                    <text x={x + 24} y="112" textAnchor="middle" fontSize="11" fill="#64748B">
                      {b.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Publish New P2P Offer */}
          <form
            onSubmit={handlePublishOffer}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Publish New Multi-Coin P2P Liquidity Offer
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Admin-Approved Asset
                </label>
                <select
                  value={selectedOfferCoin.symbol}
                  onChange={(e) => setOfferAsset(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  {approvedCoins.map((c) => (
                    <option key={c.symbol} value={c.symbol}>
                      {c.symbol} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Offer Type
                </label>
                <select
                  value={offerSide}
                  onChange={(e) => setOfferSide(e.target.value as 'SELL_USDT' | 'BUY_USDT')}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  <option value="SELL_USDT">Sell {selectedOfferCoin.symbol} (Buyers pay INR)</option>
                  <option value="BUY_USDT">Buy {selectedOfferCoin.symbol} (Sellers receive INR)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Quote Rate (INR / {selectedOfferCoin.symbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={offerRateInr}
                  onChange={(e) => setOfferRateInr(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Available {selectedOfferCoin.symbol}
                </label>
                <input
                  type="number"
                  step="any"
                  min={0.0001}
                  required
                  value={offerQuantity}
                  onChange={(e) => setOfferQuantity(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Min Order (INR)
                </label>
                <input
                  type="number"
                  min={500}
                  required
                  value={offerMinInr}
                  onChange={(e) => setOfferMinInr(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Max Order (INR)
                </label>
                <input
                  type="number"
                  min={1000}
                  required
                  value={offerMaxInr}
                  onChange={(e) => setOfferMaxInr(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono tabular-nums"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Settlement Network for {selectedOfferCoin.symbol}
                </label>
                <select
                  value={offerNetwork}
                  onChange={(e) => setOfferNetwork(e.target.value as MultiCoinNetworkId)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm"
                >
                  {selectedOfferCoin.supportedNetworks.map((netId) => (
                    <option key={netId} value={netId}>
                      {MULTI_COIN_NETWORKS[netId]?.label || netId}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Accepted INR Payment Rails
              </div>
              <div className="flex flex-wrap gap-2">
                {(['UPI', 'IMPS', 'NEFT', 'RTGS', 'BANK_TRANSFER'] as PaymentMethodType[]).map(
                  (m) => {
                    const active = offerMethods.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleToggleMethod(m)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                          active
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {PAYMENT_METHOD_LABELS[m]}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Counterparty Terms Note
              </label>
              <input
                type="text"
                value={offerTerms}
                onChange={(e) => setOfferTerms(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
            >
              Publish Offer
            </button>
          </form>

          {/* Module 12: Merchant API & Developer Portal */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-start gap-2.5">
                <Terminal className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    Merchant API &amp; Developer Portal
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Generate SHA-256 hashed REST API keys, configure SSRF-protected HMAC-SHA256
                    webhooks, inspect rate limits, and test live v1 endpoints.
                  </p>
                </div>
              </div>
              <a
                href="/api/docs/openapi.json"
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/40"
              >
                OpenAPI 3.0 Spec (v1.4.0)
              </a>
            </div>

            {merchant.isDemo || !isTradingEligible ? (
              <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {merchant.isDemo
                    ? 'DEMO simulation desks are excluded from generating Merchant API keys. Register a real KYC-verified desk to enable REST API access.'
                    : 'Verified KYC & ACTIVE account status is mandatory to generate Merchant API keys or register webhooks.'}
                </span>
              </div>
            ) : (
              <div className="space-y-6">
                {/* API Usage Telemetry */}
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-slate-500 dark:text-slate-400">Active API Keys</div>
                    <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                      {apiKeys.filter((k) => !k.revoked).length}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-slate-500 dark:text-slate-400">API Calls (Runtime)</div>
                    <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                      {apiUsage?.totalRequests ?? 0}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-slate-500 dark:text-slate-400">Rate Limit Tier</div>
                    <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                      {vipEval?.definition.apiRateLimitPerMin || 60} req/min
                    </div>
                  </div>
                </div>

                {/* Generate API Key */}
                <form
                  onSubmit={handleGenerateApiKey}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3 text-xs"
                >
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                    <Key className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    Generate Merchant REST API Key
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      required
                      value={apiKeyLabel}
                      onChange={(e) => setApiKeyLabel(e.target.value)}
                      placeholder="Key label (e.g. Treasury Bot)"
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="px-4 py-2 font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer shrink-0"
                    >
                      Generate API Key
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['markets:read', 'offers:read', 'orders:read', 'quotes:verify'].map((sc) => {
                      const active = apiKeyScopes.includes(sc);
                      return (
                        <button
                          key={sc}
                          type="button"
                          onClick={() =>
                            setApiKeyScopes((prev) =>
                              active
                                ? prev.length > 1
                                  ? prev.filter((x) => x !== sc)
                                  : prev
                                : [...prev, sc]
                            )
                          }
                          className={`px-2 py-1 rounded-sm font-mono text-[11px] border cursor-pointer ${
                            active
                              ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {sc}
                        </button>
                      );
                    })}
                  </div>
                </form>

                {revealedRawKey && (
                  <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-2 text-xs">
                    <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                      Copy Your Raw API Key Now (Shown Once)
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-950 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
                      <code className="font-mono text-slate-900 dark:text-slate-100 break-all">
                        {revealedRawKey}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(revealedRawKey);
                          setCopiedKey(true);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 text-white rounded cursor-pointer shrink-0"
                      >
                        {copiedKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedKey ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Existing Keys Table */}
                {apiKeys.length > 0 && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                    {apiKeys.map((k) => {
                      const stat = apiUsage?.keys.find((x) => x.keyHash === k.keyHash);
                      return (
                        <div
                          key={k.id}
                          className="p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {k.label}{' '}
                              <span className="font-mono text-slate-500 dark:text-slate-400">
                                ({k.keyPrefix})
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                              Scopes: {k.scopes.join(', ')} · Limit: {k.rateLimitPerMin}/min · Calls:{' '}
                              {stat?.totalRequests ?? 0}
                            </div>
                          </div>
                          {k.revoked ? (
                            <span className="font-mono text-[11px] font-semibold text-red-600 dark:text-red-400">
                              REVOKED
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleRevokeApiKey(k.keyHash)}
                              className="px-3 py-1 rounded-lg border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                            >
                              Revoke Key
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Live v1 Endpoint Tester */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Live Merchant REST v1 Tester (<span className="font-mono">X-CB-API-Key</span>)
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={testApiKey}
                      onChange={(e) => setTestApiKey(e.target.value)}
                      placeholder="Paste raw cb_test_... or cb_live_... key"
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                    />
                    <select
                      value={testEndpoint}
                      onChange={(e) => setTestEndpoint(e.target.value as 'profile' | 'markets')}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                    >
                      <option value="profile">GET /api/v1/merchant/profile</option>
                      <option value="markets">GET /api/v1/merchant/markets</option>
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRunLiveApiTest()}
                      className="px-4 py-2 font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500 cursor-pointer shrink-0"
                    >
                      Execute Request
                    </button>
                  </div>
                  {testOutput && (
                    <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-56">
                      {testOutput}
                    </pre>
                  )}
                </div>

                {/* HTTPS Webhooks */}
                <form
                  onSubmit={handleAddWebhook}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3 text-xs"
                >
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                    <Webhook className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    Register Signed HTTPS Webhook (SSRF Protected)
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="url"
                      required
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://api.yourdomain.com/coinbridge/webhook"
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="px-4 py-2 font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer shrink-0"
                    >
                      Save Webhook
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {WEBHOOK_EVENTS.map((ev) => {
                      const active = webhookEvents.includes(ev);
                      return (
                        <button
                          key={ev}
                          type="button"
                          onClick={() =>
                            setWebhookEvents((prev) =>
                              active
                                ? prev.length > 1
                                  ? prev.filter((x) => x !== ev)
                                  : prev
                                : [...prev, ev]
                            )
                          }
                          className={`px-2 py-1 rounded-sm font-mono text-[11px] border cursor-pointer ${
                            active
                              ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {ev}
                        </button>
                      );
                    })}
                  </div>
                </form>

                {webhooks.length > 0 && (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                    {webhooks.map((wh) => (
                      <div
                        key={wh.id}
                        className="p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {wh.url}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Secret: {wh.secretMasked} · Events: {wh.events.join(', ')} · Last Test:{' '}
                            {wh.lastTestStatus || 'NOT_TESTED'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleTestWebhook(wh)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
                          >
                            <Send className="w-3 h-3" />
                            Send HMAC Test Ping
                          </button>
                          <button
                            type="button"
                            aria-label="Delete webhook"
                            onClick={() => void deleteMerchantWebhookDoc(wh.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Active Offers Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                My Liquidity Offers ({myOffers.length})
              </h3>
            </div>
            {myOffers.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                No offers published yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {myOffers.map((o) => {
                  const sym = (o.asset || 'USDT').toUpperCase();
                  const qtyE8 = o.availableAssetE8 ?? o.availableUsdtMicro * 100;
                  const isSellOffer = o.side === 'SELL_USDT' || o.side === 'SELL';
                  return (
                    <div
                      key={o.id}
                      className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {isSellOffer ? `Selling ${sym}` : `Buying ${sym}`} at{' '}
                          <span className="font-mono">{formatRateInr(o.rateInrPaise)}</span>
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 font-mono mt-0.5 tabular-nums">
                          {sym === 'USDT'
                            ? formatUsdtFromMicro(o.availableUsdtMicro, 2)
                            : `${formatCoinQuantityFromE8(qtyE8, 6)} ${sym}`}{' '}
                          · {formatInrFromPaise(o.minInrPaise)} – {formatInrFromPaise(o.maxInrPaise)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => user && void toggleOfferActive(o.id, !o.isActive, user.uid)}
                        className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                          o.isActive
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {o.isActive ? 'Active (Pause)' : 'Paused (Activate)'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Incoming Orders */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Order Queue ({merchantOrders.length})
              </h3>
            </div>
            {merchantOrders.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                No incoming orders yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {merchantOrders.slice(0, 10).map((ord) => {
                  const sym = (ord.asset || 'USDT').toUpperCase();
                  const qtyE8 = ord.quantityE8 ?? ord.usdtMicro * 100;
                  return (
                    <div
                      key={ord.id}
                      className="p-4 flex items-center justify-between gap-4 text-xs"
                    >
                      <div>
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {ord.orderCode} ({sym}) · {ord.status.replace(/_/g, ' ')}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 tabular-nums">
                          {formatInrFromPaise(ord.inrPaise)} ↔{' '}
                          {sym === 'USDT'
                            ? formatUsdtFromMicro(ord.usdtMicro, 2)
                            : `${formatCoinQuantityFromE8(qtyE8, 6)} ${sym}`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenOrder(ord.id)}
                        className="px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/60 cursor-pointer"
                      >
                        Manage Order
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
