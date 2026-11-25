import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { Coins, Database, Download, ExternalLink, MessageSquare, Plus, RefreshCw, Send, ShieldAlert } from 'lucide-react';
import { db } from '../../lib/firebase';
import {
  BLOCKCHAIN_NETWORKS,
  BlockchainNetworkConfig,
  BlockchainNetworkId,
  DEFAULT_WALLET_SECURITY_POLICY,
  formatInrFromPaise,
  formatUsdtFromMicro,
  isKycStatusVerified,
  KycStatus,
  MICRO_PER_USDT,
  PaymentMethodType,
  PlatformSettings,
  UserRole,
  WalletSecurityPolicy,
  WithdrawalStatus,
} from '../../lib/domain';
import {
  logAuditEvent,
  replaceDemoMerchantsWithVerifiedAdmin,
  reviewDepositAdmin,
  reviewKycAdmin,
  runSchemaMigrationAdmin,
  savePlatformSettingsAdmin,
  saveSupportedCoinAdmin,
  saveWalletNetworkAdmin,
  saveWalletSecuritySettingsAdmin,
  seedDefaultSupportedCoinsAdmin,
  seedSandboxMarketplaceAdmin,
  seedWalletDefaultsAdmin,
  sendSupportMessage,
  transitionWithdrawalAdmin,
  updateDisputeAdmin,
  updateSupportTicketAdmin,
  updateUserRoleOrStatusAdmin,
} from '../../lib/firestoreService';
import {
  coinUnitsToE8,
  DEFAULT_COIN_MAP,
  DEFAULT_SUPPORTED_COINS,
  E8_PER_COIN,
  formatCoinQuantityFromE8,
  isValidCoinSymbol,
  isValidContractOrNative,
  MULTI_COIN_NETWORKS,
  MultiCoinNetworkId,
  normalizeCoinSymbol,
  SupportedCoinConfig,
} from '../../lib/coins';
import { CoinBadge } from '../CoinBadge';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { useAuth } from '../../context/AuthContext';
import { ConfirmDialog } from '../ConfirmDialog';
import {
  AuditLogDoc,
  DepositTransactionDoc,
  DisputeCaseDoc,
  KycSubmissionDoc,
  MerchantProfileDoc,
  P2POrderDoc,
  ReviewDoc,
  RiskAssessmentDoc,
  SupportedCoinDoc,
  SupportedNetworkDoc,
  SupportMessageDoc,
  SupportTicketDoc,
  UserAccountDoc,
  WalletAuditLogDoc,
  WalletLedgerDoc,
  WalletSecuritySettingsDoc,
  WithdrawalTransactionDoc,
} from '../../types/models';

type AdminSection =
  | 'overview'
  | 'coins'
  | 'wallet_ops'
  | 'integrations'
  | 'users'
  | 'kyc'
  | 'merchants'
  | 'orders'
  | 'disputes'
  | 'risk'
  | 'settings'
  | 'tickets'
  | 'reviews'
  | 'audit';

interface PendingConfirmAction {
  title: string;
  description: string;
  confirmLabel: string;
  tone: 'primary' | 'danger';
  run: () => Promise<void>;
}

const PAYMENT_RAILS: PaymentMethodType[] = ['UPI', 'IMPS', 'NEFT', 'RTGS', 'BANK_TRANSFER'];

export function AdminPanel({ onOpenOrder }: { onOpenOrder: (id: string) => void }) {
  const { user, account, platformSettings, isAdmin, isTreasuryAdmin, getIdToken } = useAuth();
  const hasTreasuryAccess = isAdmin || isTreasuryAdmin;
  const [section, setSection] = useState<AdminSection>(
    !isAdmin && isTreasuryAdmin ? 'wallet_ops' : 'overview'
  );

  const [users, setUsers] = useState<UserAccountDoc[]>([]);
  const [kycs, setKycs] = useState<KycSubmissionDoc[]>([]);
  const [merchants, setMerchants] = useState<MerchantProfileDoc[]>([]);
  const [orders, setOrders] = useState<P2POrderDoc[]>([]);
  const [disputes, setDisputes] = useState<DisputeCaseDoc[]>([]);
  const [risks, setRisks] = useState<RiskAssessmentDoc[]>([]);
  const [tickets, setTickets] = useState<SupportTicketDoc[]>([]);
  const [reviews, setReviews] = useState<ReviewDoc[]>([]);
  const [audits, setAudits] = useState<AuditLogDoc[]>([]);

  // Wallet & Blockchain Admin states
  const [deposits, setDeposits] = useState<DepositTransactionDoc[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalTransactionDoc[]>([]);
  const [wallets, setWallets] = useState<WalletLedgerDoc[]>([]);
  const [supportedNetworks, setSupportedNetworks] = useState<Record<string, SupportedNetworkDoc>>({});
  const [walletPolicy, setWalletPolicy] = useState<WalletSecurityPolicy>(DEFAULT_WALLET_SECURITY_POLICY);
  const [walletAudits, setWalletAudits] = useState<WalletAuditLogDoc[]>([]);
  const [depositNote, setDepositNote] = useState<Record<string, string>>({});
  const [wdNote, setWdNote] = useState<Record<string, string>>({});
  const [wdTxHash, setWdTxHash] = useState<Record<string, string>>({});

  const [supportedCoinsMap, setSupportedCoinsMap] = useState<Record<string, SupportedCoinConfig>>(
    DEFAULT_COIN_MAP
  );
  const [coinDrafts, setCoinDrafts] = useState<Record<string, SupportedCoinConfig>>({});
  const [coinErrors, setCoinErrors] = useState<Record<string, string>>({});
  const [savingCoinSym, setSavingCoinSym] = useState<string | null>(null);
  const [showAddCustomCoin, setShowAddCustomCoin] = useState(false);
  const [customCoinError, setCustomCoinError] = useState<string | null>(null);
  const [customCoinForm, setCustomCoinForm] = useState<{
    symbol: string;
    name: string;
    coingeckoId: string;
    accentHex: string;
    description: string;
    network: MultiCoinNetworkId;
    contractAddress: string;
    decimals: string;
    minQtyUnits: string;
    maxQtyUnits: string;
    feeBps: string;
    confirmations: string;
  }>({
    symbol: '',
    name: '',
    coingeckoId: '',
    accentHex: '#2563EB',
    description: '',
    network: 'ETHEREUM_ERC20',
    contractAddress: 'NATIVE',
    decimals: '8',
    minQtyUnits: '1',
    maxQtyUnits: '1000',
    feeBps: '15',
    confirmations: '12',
  });

  const [settingsForm, setSettingsForm] = useState<PlatformSettings>(platformSettings);
  const [kycNote, setKycNote] = useState<Record<string, string>>({});
  const [disputeNote, setDisputeNote] = useState<Record<string, string>>({});
  const [ticketReply, setTicketReply] = useState<Record<string, string>>({});
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [ticketMessages, setTicketMessages] = useState<SupportMessageDoc[]>([]);
  const [ticketChatInput, setTicketChatInput] = useState('');
  const [ticketPriorityDraft, setTicketPriorityDraft] = useState<
    Record<string, 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>
  >({});
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [integrationData, setIntegrationData] = useState<{
    summary: {
      sandboxMode: boolean;
      marketRateFallbackInr: number;
      coingecko: { configured: boolean; baseUrl: string };
      trongrid: { configured: boolean; network: string; baseUrl: string };
      supabase: {
        configured: boolean;
        hasUrl: boolean;
        hasAnonKey: boolean;
        hasServiceRoleKey: boolean;
        kycBucket: string;
      };
    } | null;
    rate: {
      rateInr: number;
      isLive: boolean;
      source: string;
      cached: boolean;
    } | null;
    tron: {
      networkLabel: string;
      latestBlockNumber: number | null;
      isLive: boolean;
      notice: string;
    } | null;
    supabaseHealth: {
      configured: boolean;
      mode: string;
      bucketName: string;
      bucketExists?: boolean;
      message: string;
    } | null;
  }>({
    summary: null,
    rate: null,
    tron: null,
    supabaseHealth: null,
  });

  const loadIntegrationHealth = async () => {
    setIntegrationLoading(true);
    try {
      const token = await getIdToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const [sumRes, rateRes, tronRes, supaRes] = await Promise.all([
        fetch('/api/integrations/status', { headers }),
        fetch('/api/rates/usdt-inr'),
        fetch('/api/tron/status'),
        fetch('/api/integrations/supabase/health', { headers }),
      ]);
      setIntegrationData({
        summary: sumRes.ok ? await sumRes.json() : null,
        rate: rateRes.ok ? await rateRes.json() : null,
        tron: tronRes.ok ? await tronRes.json() : null,
        supabaseHealth: supaRes.ok ? await supaRes.json() : null,
      });
    } finally {
      setIntegrationLoading(false);
    }
  };

  useEffect(() => {
    setSettingsForm(platformSettings);
  }, [platformSettings]);

  useEffect(() => {
    if (isAdmin && section === 'integrations') {
      void loadIntegrationHealth();
    }
  }, [isAdmin, section]);

  useEffect(() => {
    if (!isAdmin || !expandedTicketId) {
      setTicketMessages([]);
      return;
    }
    const qMsgs = query(
      collection(db, 'support_tickets', expandedTicketId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      qMsgs,
      (snap) => {
        setTicketMessages(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SupportMessageDoc, 'id'>) }))
        );
      },
      (e) =>
        handleFirestoreError(e, OperationType.LIST, `support_tickets/${expandedTicketId}/messages`)
    );
    return () => unsub();
  }, [isAdmin, expandedTicketId]);

  useEffect(() => {
    if (!hasTreasuryAccess) return;
    const unsubs = [
      onSnapshot(
        query(collection(db, 'deposit_transactions'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setDeposits(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DepositTransactionDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'deposit_transactions')
      ),
      onSnapshot(
        query(collection(db, 'withdrawal_transactions'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setWithdrawals(
            s.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<WithdrawalTransactionDoc, 'id'>),
            }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'withdrawal_transactions')
      ),
      onSnapshot(
        query(collection(db, 'wallets'), limit(200)),
        (s) => setWallets(s.docs.map((d) => d.data() as WalletLedgerDoc)),
        (e) => handleFirestoreError(e, OperationType.LIST, 'wallets')
      ),
      onSnapshot(
        collection(db, 'supported_networks'),
        (s) => {
          const map: Record<string, SupportedNetworkDoc> = {};
          s.docs.forEach((d) => {
            map[d.id] = {
              id: d.id as BlockchainNetworkId,
              ...(d.data() as Omit<SupportedNetworkDoc, 'id'>),
            };
          });
          setSupportedNetworks(map);
        },
        (e) => handleFirestoreError(e, OperationType.LIST, 'supported_networks')
      ),
      onSnapshot(
        doc(db, 'wallet_security_settings', 'default'),
        (s) => {
          if (s.exists()) {
            const d = s.data() as WalletSecuritySettingsDoc;
            setWalletPolicy({
              newAddressCooldownHours: d.newAddressCooldownHours,
              manualReviewThresholdUsdtMicro: d.manualReviewThresholdUsdtMicro,
              dailyWithdrawalLimitUsdtMicro: d.dailyWithdrawalLimitUsdtMicro,
              require2faForWithdrawals: d.require2faForWithdrawals,
              sandboxFaucetEnabled: d.sandboxFaucetEnabled,
            });
          }
        },
        (e) => handleFirestoreError(e, OperationType.GET, 'wallet_security_settings/default')
      ),
      onSnapshot(
        query(collection(db, 'wallet_audit_logs'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setWalletAudits(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WalletAuditLogDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'wallet_audit_logs')
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [hasTreasuryAccess]);

  useEffect(() => {
    if (!isAdmin) return;
    const unsubs = [
      onSnapshot(
        query(collection(db, 'users'), limit(150)),
        (s) => setUsers(s.docs.map((d) => d.data() as UserAccountDoc)),
        (e) => handleFirestoreError(e, OperationType.LIST, 'users')
      ),
      onSnapshot(
        query(collection(db, 'kyc_submissions'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setKycs(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<KycSubmissionDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'kyc_submissions')
      ),
      onSnapshot(
        query(collection(db, 'merchants'), limit(100)),
        (s) =>
          setMerchants(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MerchantProfileDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'merchants')
      ),
      onSnapshot(
        query(collection(db, 'p2p_orders'), orderBy('createdAt', 'desc'), limit(150)),
        (s) =>
          setOrders(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<P2POrderDoc, 'id'>) }))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'p2p_orders')
      ),
      onSnapshot(
        query(collection(db, 'disputes'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setDisputes(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DisputeCaseDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'disputes')
      ),
      onSnapshot(
        query(collection(db, 'risk_assessments'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setRisks(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RiskAssessmentDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'risk_assessments')
      ),
      onSnapshot(
        query(collection(db, 'support_tickets'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setTickets(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SupportTicketDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'support_tickets')
      ),
      onSnapshot(
        query(collection(db, 'reviews'), orderBy('createdAt', 'desc'), limit(50)),
        (s) => setReviews(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReviewDoc, 'id'>) }))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'reviews')
      ),
      onSnapshot(
        query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setAudits(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLogDoc, 'id'>) }))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'audit_logs')
      ),
      onSnapshot(
        query(collection(db, 'supported_coins'), limit(50)),
        (s) => {
          if (s.empty) {
            setSupportedCoinsMap({ ...DEFAULT_COIN_MAP });
            return;
          }
          const next: Record<string, SupportedCoinConfig> = { ...DEFAULT_COIN_MAP };
          s.docs.forEach((d) => {
            const data = d.data() as Omit<SupportedCoinDoc, 'id'>;
            const sym = normalizeCoinSymbol(data.symbol || d.id);
            next[sym] = {
              id: sym,
              symbol: sym,
              name: data.name,
              coingeckoId: data.coingeckoId,
              iconKey: data.iconKey || sym.toLowerCase(),
              accentHex: data.accentHex || '#2563EB',
              description: data.description || '',
              decimals: data.decimals ?? 8,
              supportedNetworks: data.supportedNetworks || [],
              networkContracts: data.networkContracts || [],
              minTradeQuantityE8: data.minTradeQuantityE8 ?? E8_PER_COIN,
              maxTradeQuantityE8: data.maxTradeQuantityE8 ?? 1000 * E8_PER_COIN,
              minOrderInrPaise: data.minOrderInrPaise ?? 50_000,
              maxOrderInrPaise: data.maxOrderInrPaise ?? 50_000_000,
              tradingFeeBps: data.tradingFeeBps ?? 15,
              confirmationsRequired: data.confirmationsRequired ?? 12,
              depositEnabled: Boolean(data.depositEnabled),
              withdrawalEnabled: Boolean(data.withdrawalEnabled),
              tradingEnabled: Boolean(data.tradingEnabled),
              custodyApproved: Boolean(data.custodyApproved),
              isFeatured: Boolean(data.isFeatured),
              sortOrder: data.sortOrder ?? 99,
            };
          });
          setSupportedCoinsMap(next);
        },
        (e) => handleFirestoreError(e, OperationType.LIST, 'supported_coins')
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [isAdmin]);

  const analytics = useMemo(() => {
    const realUsers = users.filter((u) => !u.isDemo);
    const verifiedKycUsers = realUsers.filter((u) => isKycStatusVerified(u.kycStatus)).length;
    const kycConversionPct =
      realUsers.length > 0 ? ((verifiedKycUsers / realUsers.length) * 100).toFixed(1) : '0.0';

    const realMerchants = merchants.filter(
      (m) => !m.isDemo && m.verificationLevel !== 'SUSPENDED'
    );
    const activeDemoMerchants = merchants.filter((m) => m.isDemo && m.isAvailable);

    const completedOrders = orders.filter((o) => o.status === 'COMPLETED');
    const isDemoOrder = (o: P2POrderDoc) =>
      o.sellerUid.startsWith('demo_') || o.buyerUid.startsWith('demo_');

    const completedRealVolumePaise = completedOrders
      .filter((o) => !isDemoOrder(o) && !o.isSandbox)
      .reduce((acc, o) => acc + o.inrPaise, 0);
    const completedSandboxOrDemoVolumePaise = completedOrders
      .filter((o) => isDemoOrder(o) || o.isSandbox)
      .reduce((acc, o) => acc + o.inrPaise, 0);

    const feeRevenueUsdtMicro = completedOrders.reduce((acc, o) => acc + o.feeUsdtMicro, 0);
    const disputedCount = orders.filter((o) => o.status === 'DISPUTED').length;
    const disputeRatePct =
      orders.length > 0 ? ((disputedCount / orders.length) * 100).toFixed(1) : '0.0';

    const railBreakdown = PAYMENT_RAILS.map((rail) => {
      const matching = orders.filter((o) => o.paymentMethod === rail);
      const completedInrPaise = matching
        .filter((o) => o.status === 'COMPLETED')
        .reduce((acc, o) => acc + o.inrPaise, 0);
      return {
        rail,
        orderCount: matching.length,
        completedInrPaise,
      };
    });
    const maxRailOrders = Math.max(1, ...railBreakdown.map((r) => r.orderCount));

    return {
      realUsersCount: realUsers.length,
      verifiedKycUsers,
      kycConversionPct,
      realMerchantsCount: realMerchants.length,
      activeDemoMerchantsCount: activeDemoMerchants.length,
      completedRealVolumePaise,
      completedSandboxOrDemoVolumePaise,
      feeRevenueUsdtMicro,
      disputedCount,
      disputeRatePct,
      highRiskCount: risks.filter((r) => r.score >= 60).length,
      railBreakdown,
      maxRailOrders,
    };
  }, [users, merchants, orders, risks]);

  if (!hasTreasuryAccess || !user) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-red-700">
        Administrator or Treasury Admin authorization required.
      </div>
    );
  }

  const executeConfirm = async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    try {
      await pendingConfirm.run();
      setPendingConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const exportOrdersCsv = () => {
    const header = [
      'OrderCode',
      'Side',
      'Buyer',
      'Seller',
      'Rail',
      'INR',
      'USDT',
      'FeeUSDT',
      'RiskScore',
      'Sandbox',
      'Status',
    ];
    const rows = orders.map((o) => [
      o.orderCode,
      o.side,
      o.buyerUsername,
      o.sellerUsername,
      o.paymentMethod,
      (o.inrPaise / 100).toFixed(2),
      (o.usdtMicro / 1_000_000).toFixed(4),
      (o.feeUsdtMicro / 1_000_000).toFixed(4),
      String(o.riskScore),
      String(Boolean(o.isSandbox)),
      o.status,
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `coinbridge_orders_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await savePlatformSettingsAdmin(settingsForm, user.uid);
    setFeedbackMsg('Platform fees, limits, and sandbox configuration saved.');
  };

  const walletRecon = useMemo(() => {
    const totalAvail = wallets.reduce((a, w) => a + (w.availableUsdtMicro || 0), 0);
    const totalRes = wallets.reduce((a, w) => a + (w.reservedUsdtMicro || 0), 0);
    const creditedDeposits = deposits
      .filter((d) => d.status === 'CREDITED')
      .reduce((a, d) => a + d.amountMicro, 0);
    const completedWithdrawals = withdrawals
      .filter((w) => w.status === 'COMPLETED')
      .reduce((a, w) => a + w.totalDebitMicro, 0);
    const pendingDeposits = deposits.filter((d) =>
      ['AWAITING_DEPOSIT', 'DETECTED', 'CONFIRMING', 'UNDER_COMPLIANCE_REVIEW'].includes(d.status)
    ).length;
    const activeWithdrawals = withdrawals.filter((w) =>
      ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'BROADCASTED', 'CONFIRMING'].includes(
        w.status
      )
    ).length;
    return {
      totalAvail,
      totalRes,
      creditedDeposits,
      completedWithdrawals,
      pendingDeposits,
      activeWithdrawals,
    };
  }, [wallets, deposits, withdrawals]);

  const coinList = useMemo(
    () =>
      Object.values(supportedCoinsMap).sort(
        (a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.symbol.localeCompare(b.symbol)
      ),
    [supportedCoinsMap]
  );

  const coinOrderStats = useMemo(() => {
    const map: Record<string, { orderCount: number; completedInrPaise: number }> = {};
    for (const o of orders) {
      const sym = normalizeCoinSymbol(o.asset || 'USDT');
      if (!map[sym]) map[sym] = { orderCount: 0, completedInrPaise: 0 };
      map[sym].orderCount += 1;
      if (o.status === 'COMPLETED') {
        map[sym].completedInrPaise += o.inrPaise || 0;
      }
    }
    return map;
  }, [orders]);

  const navTabs: { id: AdminSection; label: string }[] = isAdmin
    ? [
        { id: 'overview', label: 'Overview' },
        { id: 'coins', label: `Coins (${coinList.length})` },
        {
          id: 'wallet_ops',
          label: `Wallet & Blockchain (${walletRecon.pendingDeposits + walletRecon.activeWithdrawals})`,
        },
        { id: 'integrations', label: 'API Integrations' },
        { id: 'users', label: `Users (${users.length})` },
        { id: 'kyc', label: `KYC (${kycs.filter((k) => k.status === 'PENDING').length})` },
        { id: 'merchants', label: `Merchants (${merchants.length})` },
        { id: 'orders', label: `Orders (${orders.length})` },
        { id: 'disputes', label: `Disputes (${disputes.filter((d) => d.status === 'OPEN').length})` },
        { id: 'risk', label: `Risk Engine (${risks.length})` },
        { id: 'settings', label: 'Fees & Limits' },
        { id: 'tickets', label: `Tickets (${tickets.length})` },
        { id: 'reviews', label: `Reviews (${reviews.length})` },
        { id: 'audit', label: 'Audit Logs' },
      ]
    : [
        {
          id: 'wallet_ops',
          label: `Wallet & Blockchain (${walletRecon.pendingDeposits + walletRecon.activeWithdrawals})`,
        },
      ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Administrator Governance Console
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Verified vs DEMO segregation, KYC conversion analytics, payment rail telemetry, schema
            maintenance, and role-restricted controls.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setPendingConfirm({
                title: 'Seed Labeled DEMO Merchants?',
                description:
                  'This populates 3 clearly labeled DEMO merchant fixtures and 6 sandbox offers for marketplace preview. Demo desks are never marked as genuinely KYC/KYB verified.',
                confirmLabel: 'Seed DEMO Merchants',
                tone: 'primary',
                run: async () => {
                  await seedSandboxMarketplaceAdmin(user.uid, account?.username || 'admin_desk');
                  setFeedbackMsg('Seeded 3 labeled DEMO merchants and 6 sandbox offers.');
                },
              })
            }
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            Seed DEMO Merchants
          </button>

          <button
            type="button"
            onClick={() =>
              setPendingConfirm({
                title: 'Replace DEMO Merchants with Verified Only?',
                description:
                  'This deactivates all isDemo=true marketplace offers and marks seeded demo merchant desks unavailable so only genuinely KYC/KYB verified merchants appear.',
                confirmLabel: 'Deactivate DEMO Fixtures',
                tone: 'danger',
                run: async () => {
                  const res = await replaceDemoMerchantsWithVerifiedAdmin(user.uid);
                  setFeedbackMsg(
                    `Deactivated ${res?.deactivatedOffers ?? 0} demo offers and ${
                      res?.deactivatedMerchants ?? 0
                    } demo merchant desks.`
                  );
                },
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Replace DEMO with Verified
          </button>

          <button
            type="button"
            onClick={() =>
              setPendingConfirm({
                title: 'Run Idempotent Schema Migration?',
                description:
                  'Backfills default security flags (isDemo=false, withdrawalLocked=false) on any legacy user documents missing those fields without overwriting existing records.',
                confirmLabel: 'Run Migration',
                tone: 'primary',
                run: async () => {
                  const res = await runSchemaMigrationAdmin(user.uid);
                  setFeedbackMsg(
                    `Idempotent schema migration complete: ${res?.updatedUsers ?? 0} user record(s) backfilled.`
                  );
                },
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <Database className="w-3.5 h-3.5" />
            Run Schema Migration
          </button>

          <button
            type="button"
            onClick={exportOrdersCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Orders CSV
          </button>

          <a
            href="/api/docs/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
          >
            OpenAPI
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {feedbackMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
          {feedbackMsg}
        </div>
      )}

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-xl">
        {navTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSection(t.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
              section === t.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === 'coins' && isAdmin && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                  Multi-Coin Registry &amp; Approval Governance
                </h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 max-w-3xl">
                Only USDT is enabled for trading, deposits, and withdrawals by default. Bitcoin,
                Ethereum, USDC, Solana, BNB, XRP, DOGE, and TRX remain gated until you explicitly
                enable both <strong>Trading</strong> and <strong>Custody Approval</strong> and
                verify chain contract addresses.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowAddCustomCoin((v) => !v);
                  setCustomCoinError(null);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                {showAddCustomCoin ? 'Close Custom Coin Form' : 'Add Custom Coin'}
              </button>
              <button
                type="button"
                onClick={() =>
                  setPendingConfirm({
                    title: 'Seed / Sync 9 Default Coins?',
                    description:
                      'Persists the 9 default assets (USDT enabled; BTC, ETH, USDC, SOL, BNB, XRP, DOGE, TRX disabled awaiting approval) into Firestore supported_coins and coin_trading_settings.',
                    confirmLabel: 'Sync 9 Default Coins',
                    tone: 'primary',
                    run: async () => {
                      await seedDefaultSupportedCoinsAdmin(user.uid);
                      setCoinDrafts({});
                      setFeedbackMsg(
                        'Synced 9 default cryptocurrency definitions into supported_coins (only USDT enabled by default).'
                      );
                    },
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Seed / Sync 9 Defaults ({DEFAULT_SUPPORTED_COINS.length})
              </button>
            </div>
          </div>

          {showAddCustomCoin && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setCustomCoinError(null);
                const sym = normalizeCoinSymbol(customCoinForm.symbol);
                if (!isValidCoinSymbol(sym)) {
                  setCustomCoinError('Symbol must be 2–12 uppercase alphanumeric characters.');
                  return;
                }
                if (!customCoinForm.name.trim() || !customCoinForm.coingeckoId.trim()) {
                  setCustomCoinError('Coin name and CoinGecko ID are required.');
                  return;
                }
                if (
                  !isValidContractOrNative(customCoinForm.network, customCoinForm.contractAddress)
                ) {
                  setCustomCoinError(
                    `Invalid contract address or "NATIVE" specifier for ${MULTI_COIN_NETWORKS[customCoinForm.network].label}.`
                  );
                  return;
                }
                const minUnits = Number(customCoinForm.minQtyUnits);
                const maxUnits = Number(customCoinForm.maxQtyUnits);
                if (!(minUnits > 0) || !(maxUnits >= minUnits)) {
                  setCustomCoinError('Max trade quantity must be greater than min trade quantity.');
                  return;
                }
                const newCoin: SupportedCoinConfig = {
                  id: sym,
                  symbol: sym,
                  name: customCoinForm.name.trim(),
                  coingeckoId: customCoinForm.coingeckoId.trim().toLowerCase(),
                  iconKey: sym.toLowerCase(),
                  accentHex: customCoinForm.accentHex || '#2563EB',
                  description:
                    customCoinForm.description.trim() ||
                    `${customCoinForm.name.trim()} (${sym}) custom P2P registry asset.`,
                  decimals: Math.max(0, Math.min(18, Number(customCoinForm.decimals) || 8)),
                  supportedNetworks: [customCoinForm.network],
                  networkContracts: [
                    {
                      network: customCoinForm.network,
                      contractAddress: customCoinForm.contractAddress.trim(),
                      confirmationsRequired: Math.max(1, Number(customCoinForm.confirmations) || 12),
                      depositEnabled: false,
                      withdrawalEnabled: false,
                    },
                  ],
                  minTradeQuantityE8: coinUnitsToE8(minUnits),
                  maxTradeQuantityE8: coinUnitsToE8(maxUnits),
                  minOrderInrPaise: 50_000,
                  maxOrderInrPaise: 50_000_000,
                  tradingFeeBps: Math.max(0, Math.min(1000, Number(customCoinForm.feeBps) || 15)),
                  confirmationsRequired: Math.max(1, Number(customCoinForm.confirmations) || 12),
                  depositEnabled: false,
                  withdrawalEnabled: false,
                  tradingEnabled: false,
                  custodyApproved: false,
                  isFeatured: false,
                  sortOrder: coinList.length + 1,
                };
                await saveSupportedCoinAdmin({ coin: newCoin, adminUid: user.uid });
                setShowAddCustomCoin(false);
                setFeedbackMsg(
                  `Registered custom asset ${sym} in pending governance state (disabled until approved).`
                );
                setCustomCoinForm({
                  symbol: '',
                  name: '',
                  coingeckoId: '',
                  accentHex: '#2563EB',
                  description: '',
                  network: 'ETHEREUM_ERC20',
                  contractAddress: 'NATIVE',
                  decimals: '8',
                  minQtyUnits: '1',
                  maxQtyUnits: '1000',
                  feeBps: '15',
                  confirmations: '12',
                });
              }}
              className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900 rounded-xl p-5 space-y-4"
            >
              <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Register Custom Cryptocurrency (Defaults Disabled Until Governance Approval)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Symbol</span>
                  <input
                    type="text"
                    required
                    placeholder="MATIC"
                    value={customCoinForm.symbol}
                    onChange={(e) =>
                      setCustomCoinForm((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono uppercase"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Coin Name</span>
                  <input
                    type="text"
                    required
                    placeholder="Polygon"
                    value={customCoinForm.name}
                    onChange={(e) => setCustomCoinForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    CoinGecko ID
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="matic-network"
                    value={customCoinForm.coingeckoId}
                    onChange={(e) =>
                      setCustomCoinForm((p) => ({ ...p, coingeckoId: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Primary Network
                  </span>
                  <select
                    value={customCoinForm.network}
                    onChange={(e) =>
                      setCustomCoinForm((p) => ({
                        ...p,
                        network: e.target.value as MultiCoinNetworkId,
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg"
                  >
                    {Object.values(MULTI_COIN_NETWORKS).map((net) => (
                      <option key={net.id} value={net.id}>
                        {net.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Token Contract Address (or NATIVE)
                  </span>
                  <input
                    type="text"
                    required
                    value={customCoinForm.contractAddress}
                    onChange={(e) =>
                      setCustomCoinForm((p) => ({ ...p, contractAddress: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Trading Fee (bps)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={customCoinForm.feeBps}
                    onChange={(e) => setCustomCoinForm((p) => ({ ...p, feeBps: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Confirmations
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={256}
                    value={customCoinForm.confirmations}
                    onChange={(e) =>
                      setCustomCoinForm((p) => ({ ...p, confirmations: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono"
                  />
                </label>
              </div>
              {customCoinError && (
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                  {customCoinError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                >
                  Register Coin (Pending Approval)
                </button>
              </div>
            </form>
          )}

          <div className="space-y-4">
            {coinList.map((baseCoin) => {
              const draft = coinDrafts[baseCoin.symbol] || baseCoin;
              const stats = coinOrderStats[baseCoin.symbol] || {
                orderCount: 0,
                completedInrPaise: 0,
              };
              const isApprovedForLiveP2P = draft.tradingEnabled && draft.custodyApproved;
              const err = coinErrors[baseCoin.symbol];

              const updateDraft = (updater: (prev: SupportedCoinConfig) => SupportedCoinConfig) => {
                setCoinDrafts((prev) => ({
                  ...prev,
                  [baseCoin.symbol]: updater(prev[baseCoin.symbol] || baseCoin),
                }));
              };

              return (
                <div
                  key={baseCoin.symbol}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div className="flex items-start gap-3">
                      <CoinBadge symbol={draft.symbol} size="md" accentHex={draft.accentHex} />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                            {draft.name} ({draft.symbol})
                          </span>
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            coingecko:{draft.coingeckoId}
                          </span>
                          <span
                            className={`text-xs font-semibold ${
                              isApprovedForLiveP2P
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {isApprovedForLiveP2P
                              ? 'P2P Trading Approved'
                              : 'Gated (Awaiting Admin Approval)'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          {draft.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-5 text-xs shrink-0">
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">P2P Orders</div>
                        <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {stats.orderCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Settled INR</div>
                        <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatInrFromPaise(stats.completedInrPaise)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={savingCoinSym === baseCoin.symbol}
                        onClick={async () => {
                          setCoinErrors((p) => {
                            const next = { ...p };
                            delete next[baseCoin.symbol];
                            return next;
                          });
                          for (const nc of draft.networkContracts) {
                            if (!isValidContractOrNative(nc.network, nc.contractAddress)) {
                              setCoinErrors((p) => ({
                                ...p,
                                [baseCoin.symbol]: `Invalid contract/NATIVE value on ${nc.network}: ${nc.contractAddress}`,
                              }));
                              return;
                            }
                          }
                          setSavingCoinSym(baseCoin.symbol);
                          try {
                            await saveSupportedCoinAdmin({ coin: draft, adminUid: user.uid });
                            setFeedbackMsg(
                              `Saved ${draft.symbol} governance settings (Trading=${draft.tradingEnabled}, Custody=${draft.custodyApproved}).`
                            );
                          } finally {
                            setSavingCoinSym(null);
                          }
                        }}
                        className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
                      >
                        {savingCoinSym === baseCoin.symbol ? 'Saving...' : 'Save Coin Governance'}
                      </button>
                    </div>
                  </div>

                  {/* Operational Governance Toggles & Fee/Confirmation Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
                    <label className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 cursor-pointer">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        P2P Trading
                      </span>
                      <input
                        type="checkbox"
                        checked={draft.tradingEnabled}
                        onChange={(e) =>
                          updateDraft((p) => ({ ...p, tradingEnabled: e.target.checked }))
                        }
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 cursor-pointer">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Custody Approved
                      </span>
                      <input
                        type="checkbox"
                        checked={draft.custodyApproved}
                        onChange={(e) =>
                          updateDraft((p) => ({ ...p, custodyApproved: e.target.checked }))
                        }
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 cursor-pointer">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Deposits Open
                      </span>
                      <input
                        type="checkbox"
                        checked={draft.depositEnabled}
                        onChange={(e) =>
                          updateDraft((p) => ({ ...p, depositEnabled: e.target.checked }))
                        }
                        className="h-4 w-4 accent-blue-600"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 cursor-pointer">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Withdrawals Open
                      </span>
                      <input
                        type="checkbox"
                        checked={draft.withdrawalEnabled}
                        onChange={(e) =>
                          updateDraft((p) => ({ ...p, withdrawalEnabled: e.target.checked }))
                        }
                        className="h-4 w-4 accent-blue-600"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        Fee (bps)
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        value={draft.tradingFeeBps}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            tradingFeeBps: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono tabular-nums"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        Min Confirmations
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={256}
                        value={draft.confirmationsRequired}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            confirmationsRequired: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                        className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono tabular-nums"
                      />
                    </label>
                  </div>

                  {/* Trade Limits */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Min Trade Qty
                      </div>
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                        {formatCoinQuantityFromE8(draft.minTradeQuantityE8, 6)} {draft.symbol}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Max Trade Qty
                      </div>
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                        {formatCoinQuantityFromE8(draft.maxTradeQuantityE8, 4)} {draft.symbol}
                      </div>
                    </div>
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        Min INR Order
                      </span>
                      <input
                        type="number"
                        min={100}
                        value={Math.round(draft.minOrderInrPaise / 100)}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            minOrderInrPaise: Math.max(100, Number(e.target.value) || 100) * 100,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono tabular-nums"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        Max INR Order
                      </span>
                      <input
                        type="number"
                        min={1000}
                        value={Math.round(draft.maxOrderInrPaise / 100)}
                        onChange={(e) =>
                          updateDraft((p) => ({
                            ...p,
                            maxOrderInrPaise: Math.max(1000, Number(e.target.value) || 1000) * 100,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-lg font-mono tabular-nums"
                      />
                    </label>
                  </div>

                  {/* Supported Networks & Token Contracts */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Supported Networks &amp; Token Contract Matrix
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                      {draft.networkContracts.map((nc, idx) => (
                        <div
                          key={nc.network}
                          className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {MULTI_COIN_NETWORKS[nc.network]?.label || nc.network}
                            </span>
                            <div className="flex items-center gap-3 text-[11px]">
                              <label className="inline-flex items-center gap-1 cursor-pointer text-slate-700 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={nc.depositEnabled}
                                  onChange={(e) =>
                                    updateDraft((p) => ({
                                      ...p,
                                      networkContracts: p.networkContracts.map((item, i) =>
                                        i === idx
                                          ? { ...item, depositEnabled: e.target.checked }
                                          : item
                                      ),
                                    }))
                                  }
                                />
                                Dep
                              </label>
                              <label className="inline-flex items-center gap-1 cursor-pointer text-slate-700 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={nc.withdrawalEnabled}
                                  onChange={(e) =>
                                    updateDraft((p) => ({
                                      ...p,
                                      networkContracts: p.networkContracts.map((item, i) =>
                                        i === idx
                                          ? { ...item, withdrawalEnabled: e.target.checked }
                                          : item
                                      ),
                                    }))
                                  }
                                />
                                Wd
                              </label>
                            </div>
                          </div>
                          <input
                            type="text"
                            aria-label={`${draft.symbol} ${nc.network} contract address`}
                            value={nc.contractAddress}
                            onChange={(e) =>
                              updateDraft((p) => ({
                                ...p,
                                networkContracts: p.networkContracts.map((item, i) =>
                                  i === idx ? { ...item, contractAddress: e.target.value } : item
                                ),
                              }))
                            }
                            className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded font-mono text-[11px]"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {err && (
                    <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                      {err}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {section === 'wallet_ops' && (
        <div className="space-y-6">
          {/* Reconciliation KPIs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                Wallet, Blockchain &amp; Treasury Operations
              </h3>
              <p className="text-xs text-slate-600">
                Approve flagged deposits, manage withdrawal lifecycle transitions, configure network
                thresholds, and reconcile aggregate ledger balances.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setPendingConfirm({
                  title: 'Sync Default Blockchain Networks & Security Policy?',
                  description:
                    'Seeds or resets default TRON, Ethereum, Polygon, and BSC USDT contract configs and global withdrawal security thresholds in Firestore.',
                  confirmLabel: 'Sync Wallet Defaults',
                  tone: 'primary',
                  run: async () => {
                    await seedWalletDefaultsAdmin(user.uid);
                    setFeedbackMsg('Synchronized default supported_networks, supported_tokens, and wallet_security_settings.');
                  },
                })
              }
              className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer self-start"
            >
              Sync Default Networks &amp; Policy
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              ['Total Wallet Available', formatUsdtFromMicro(walletRecon.totalAvail, 2)],
              ['Total Wallet Reserved', formatUsdtFromMicro(walletRecon.totalRes, 2)],
              ['Credited Deposits', formatUsdtFromMicro(walletRecon.creditedDeposits, 2)],
              ['Completed Withdrawals', formatUsdtFromMicro(walletRecon.completedWithdrawals, 2)],
              [
                'Open Review Queue',
                `${walletRecon.pendingDeposits} dep / ${walletRecon.activeWithdrawals} w/d`,
              ],
            ].map(([label, val]) => (
              <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums">
                  {val}
                </div>
              </div>
            ))}
          </div>

          {/* Deposit Review Queue */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h4 className="font-display text-base font-semibold text-slate-900">
              USDT Deposit Monitoring &amp; Compliance Queue ({deposits.length})
            </h4>
            {deposits.length === 0 ? (
              <p className="text-xs text-slate-500">No USDT deposit transactions recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {deposits.slice(0, 20).map((d) => {
                  const isFinal = d.status === 'CREDITED' || d.status === 'REJECTED';
                  return (
                    <div
                      key={d.id}
                      className="border border-slate-200 rounded-lg p-4 space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <div className="font-mono font-semibold text-slate-900">
                          @{d.username || d.uid.slice(0, 8)} · {d.network} ·{' '}
                          {formatUsdtFromMicro(d.amountMicro, 2)}
                          {d.isSandbox && (
                            <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 rounded">
                              SANDBOX
                            </span>
                          )}
                        </div>
                        <span className="font-mono font-semibold text-blue-700">{d.status}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-600 flex flex-wrap gap-4">
                        <span>Tx: {d.txHash.slice(0, 20)}...</span>
                        <span>
                          Confs: {d.confirmations}/{d.requiredConfirmations}
                        </span>
                        <span>Source: {d.verificationSource}</span>
                      </div>
                      {!isFinal && (
                        <div className="flex flex-col sm:flex-row gap-2 pt-1">
                          <input
                            type="text"
                            placeholder="Compliance / treasury review note"
                            value={depositNote[d.id] || ''}
                            onChange={(e) =>
                              setDepositNote((p) => ({ ...p, [d.id]: e.target.value }))
                            }
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setPendingConfirm({
                                title: `Approve & Credit ${formatUsdtFromMicro(d.amountMicro, 2)}?`,
                                description: `Credits available USDT balance for @${d.username || d.uid} and writes an immutable DEPOSIT_CREDIT ledger entry.`,
                                confirmLabel: 'Approve & Credit',
                                tone: 'primary',
                                run: async () => {
                                  await reviewDepositAdmin({
                                    depositId: d.id,
                                    decision: 'CREDITED',
                                    note: depositNote[d.id] || 'Verified by Treasury/Compliance',
                                    adminUid: user.uid,
                                  });
                                  setFeedbackMsg(`Credited deposit ${d.id}.`);
                                },
                              })
                            }
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 cursor-pointer"
                          >
                            Approve &amp; Credit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingConfirm({
                                title: 'Reject Deposit Record?',
                                description: `Marks deposit ${d.id} as REJECTED without crediting funds.`,
                                confirmLabel: 'Reject Deposit',
                                tone: 'danger',
                                run: async () => {
                                  await reviewDepositAdmin({
                                    depositId: d.id,
                                    decision: 'REJECTED',
                                    note: depositNote[d.id] || 'Rejected by Treasury/Compliance',
                                    adminUid: user.uid,
                                  });
                                  setFeedbackMsg(`Rejected deposit ${d.id}.`);
                                },
                              })
                            }
                            className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 font-semibold hover:bg-red-50 cursor-pointer"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Withdrawal Approval & Lifecycle Queue */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h4 className="font-display text-base font-semibold text-slate-900">
              USDT Withdrawal Approval &amp; Broadcast Queue ({withdrawals.length})
            </h4>
            {withdrawals.length === 0 ? (
              <p className="text-xs text-slate-500">No USDT withdrawal requests submitted yet.</p>
            ) : (
              <div className="space-y-3">
                {withdrawals.slice(0, 20).map((w) => {
                  const isTerminal = ['COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED'].includes(
                    w.status
                  );
                  return (
                    <div
                      key={w.id}
                      className="border border-slate-200 rounded-lg p-4 space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <div className="font-mono font-semibold text-slate-900">
                          @{w.username || w.uid.slice(0, 8)} · {w.network} · Net{' '}
                          {formatUsdtFromMicro(w.netSentMicro, 2)} (Debited{' '}
                          {formatUsdtFromMicro(w.totalDebitMicro, 2)})
                        </div>
                        <span className="font-mono font-semibold text-blue-700">{w.status}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-600 flex flex-wrap gap-4">
                        <span>To: {w.destinationAddress}</span>
                        <span>
                          Risk: {w.riskScore}/100 ({w.riskLevel})
                        </span>
                        <span>2FA: {w.twoFactorVerified ? 'Verified' : 'No'}</span>
                        {w.txHash && <span>Tx: {w.txHash.slice(0, 18)}...</span>}
                      </div>
                      {w.riskReasons?.length > 0 && (
                        <div className="text-[11px] text-slate-500">
                          Flags: {w.riskReasons.join(' | ')}
                        </div>
                      )}
                      {!isTerminal && (
                        <div className="space-y-2 pt-1">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              placeholder="Optional broadcast txHash override"
                              value={wdTxHash[w.id] || ''}
                              onChange={(e) =>
                                setWdTxHash((p) => ({ ...p, [w.id]: e.target.value }))
                              }
                              className="rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-xs"
                            />
                            <input
                              type="text"
                              placeholder="Treasury / compliance decision note"
                              value={wdNote[w.id] || ''}
                              onChange={(e) =>
                                setWdNote((p) => ({ ...p, [w.id]: e.target.value }))
                              }
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                            />
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              [
                                'APPROVED',
                                'PROCESSING',
                                'BROADCASTED',
                                'COMPLETED',
                                'FAILED',
                                'REJECTED',
                                'CANCELLED',
                              ] as WithdrawalStatus[]
                            ).map((nextSt) => {
                              const isRefundOrComplete = [
                                'COMPLETED',
                                'FAILED',
                                'REJECTED',
                                'CANCELLED',
                              ].includes(nextSt);
                              return (
                                <button
                                  key={nextSt}
                                  type="button"
                                  onClick={() => {
                                    const runTransition = async () => {
                                      await transitionWithdrawalAdmin({
                                        withdrawalId: w.id,
                                        nextStatus: nextSt,
                                        txHash: wdTxHash[w.id],
                                        note: wdNote[w.id] || `Marked ${nextSt} by Treasury`,
                                        adminUid: user.uid,
                                      });
                                      setFeedbackMsg(`Withdrawal ${w.id} updated to ${nextSt}.`);
                                    };
                                    if (isRefundOrComplete) {
                                      setPendingConfirm({
                                        title: `Mark Withdrawal ${nextSt}?`,
                                        description:
                                          nextSt === 'COMPLETED'
                                            ? `Finalizes outbound transfer of ${formatUsdtFromMicro(w.netSentMicro, 2)} and settles reserved funds.`
                                            : `Marks withdrawal ${nextSt} and refunds ${formatUsdtFromMicro(w.totalDebitMicro, 2)} back to user available balance.`,
                                        confirmLabel: `Confirm ${nextSt}`,
                                        tone: nextSt === 'COMPLETED' ? 'primary' : 'danger',
                                        run: runTransition,
                                      });
                                    } else {
                                      void runTransition();
                                    }
                                  }}
                                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                                    nextSt === 'COMPLETED'
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : ['FAILED', 'REJECTED', 'CANCELLED'].includes(nextSt)
                                        ? 'border-red-200 text-red-700 hover:bg-red-50'
                                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  {nextSt}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Supported Networks & Security Policy Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs">
              <h4 className="font-display text-base font-semibold text-slate-900">
                Supported Blockchain Networks
              </h4>
              <div className="space-y-3">
                {(Object.values(BLOCKCHAIN_NETWORKS) as BlockchainNetworkConfig[]).map((baseNet) => {
                  const ov = supportedNetworks[baseNet.id];
                  const net: BlockchainNetworkConfig = ov
                    ? {
                        ...baseNet,
                        requiredConfirmations: ov.requiredConfirmations,
                        estimatedNetworkFeeUsdtMicro: ov.estimatedNetworkFeeUsdtMicro,
                        platformWithdrawalFeeUsdtMicro: ov.platformWithdrawalFeeUsdtMicro,
                        depositsEnabled: ov.depositsEnabled,
                        withdrawalsEnabled: ov.withdrawalsEnabled,
                      }
                    : baseNet;
                  return (
                    <div
                      key={net.id}
                      className="border border-slate-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-semibold text-slate-900">
                          {net.name} ({net.tokenStandard})
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          Confs: {net.requiredConfirmations} · Fee:{' '}
                          {formatUsdtFromMicro(
                            net.estimatedNetworkFeeUsdtMicro + net.platformWithdrawalFeeUsdtMicro,
                            2
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void saveWalletNetworkAdmin({
                              networkConfig: { ...net, depositsEnabled: !net.depositsEnabled },
                              adminUid: user.uid,
                            })
                          }
                          className={`px-2.5 py-1 rounded font-mono font-semibold cursor-pointer ${
                            net.depositsEnabled
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          Dep: {net.depositsEnabled ? 'ON' : 'PAUSED'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void saveWalletNetworkAdmin({
                              networkConfig: {
                                ...net,
                                withdrawalsEnabled: !net.withdrawalsEnabled,
                              },
                              adminUid: user.uid,
                            })
                          }
                          className={`px-2.5 py-1 rounded font-mono font-semibold cursor-pointer ${
                            net.withdrawalsEnabled
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          W/D: {net.withdrawalsEnabled ? 'ON' : 'PAUSED'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await saveWalletSecuritySettingsAdmin({
                  settings: walletPolicy,
                  adminUid: user.uid,
                });
                setFeedbackMsg('Wallet security thresholds and cooldown policy updated.');
              }}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs"
            >
              <h4 className="font-display text-base font-semibold text-slate-900">
                Wallet Withdrawal Security Policy
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    New Address Cooldown (Hours)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={168}
                    value={walletPolicy.newAddressCooldownHours}
                    onChange={(e) =>
                      setWalletPolicy((p) => ({
                        ...p,
                        newAddressCooldownHours: Number(e.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Manual Review Threshold (USDT)
                  </label>
                  <input
                    type="number"
                    min={10}
                    value={Math.round(walletPolicy.manualReviewThresholdUsdtMicro / MICRO_PER_USDT)}
                    onChange={(e) =>
                      setWalletPolicy((p) => ({
                        ...p,
                        manualReviewThresholdUsdtMicro: Number(e.target.value) * MICRO_PER_USDT,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    24h Daily Limit (USDT)
                  </label>
                  <input
                    type="number"
                    min={100}
                    value={Math.round(walletPolicy.dailyWithdrawalLimitUsdtMicro / MICRO_PER_USDT)}
                    onChange={(e) =>
                      setWalletPolicy((p) => ({
                        ...p,
                        dailyWithdrawalLimitUsdtMicro: Number(e.target.value) * MICRO_PER_USDT,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={walletPolicy.require2faForWithdrawals}
                  onChange={(e) =>
                    setWalletPolicy((p) => ({ ...p, require2faForWithdrawals: e.target.checked }))
                  }
                />
                <span>Require RFC 6238 2FA Authenticator for all external withdrawals</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={walletPolicy.sandboxFaucetEnabled}
                  onChange={(e) =>
                    setWalletPolicy((p) => ({ ...p, sandboxFaucetEnabled: e.target.checked }))
                  }
                />
                <span>Enable Sandbox Testnet Faucet (sandboxMode only)</span>
              </label>
              <button
                type="submit"
                className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
              >
                Save Security Policy
              </button>
            </form>
          </div>

          {/* Wallet Audit Logs */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 font-display text-sm font-semibold text-slate-900">
              Wallet, Deposit, Withdrawal &amp; Denied Trading Access Audit Logs ({walletAudits.length})
            </div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {walletAudits.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">No wallet audit events logged yet.</div>
              ) : (
                walletAudits.map((wa) => (
                  <div key={wa.id} className="p-3.5 flex items-start justify-between gap-4 text-xs">
                    <div>
                      <span className="font-mono font-semibold text-slate-900">{wa.action}</span>
                      <span className="text-slate-500 ml-2">
                        ({wa.targetType}/{wa.targetId})
                      </span>
                      <p className="text-slate-600 mt-0.5">{wa.summary}</p>
                    </div>
                    <div className="font-mono text-slate-400 shrink-0">
                      {wa.createdAt?.toDate ? wa.createdAt.toDate().toLocaleString() : 'Now'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {section === 'overview' && (
        <div className="space-y-6">
          {/* Verified vs DEMO KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ['Verified KYC Users', `${analytics.verifiedKycUsers} / ${analytics.realUsersCount}`],
              ['KYC Conversion Rate', `${analytics.kycConversionPct}%`],
              ['Verified Real Merchants', analytics.realMerchantsCount],
              ['Labeled DEMO Merchants', `${analytics.activeDemoMerchantsCount} (DEMO)`],
              ['Completed Real INR Volume', formatInrFromPaise(analytics.completedRealVolumePaise)],
              [
                'Sandbox / DEMO INR Volume',
                formatInrFromPaise(analytics.completedSandboxOrDemoVolumePaise),
              ],
              ['Dispute Rate / Open Flags', `${analytics.disputeRatePct}% (${analytics.disputedCount})`],
              [
                'Fee Revenue / High Risk',
                `${formatUsdtFromMicro(analytics.feeRevenueUsdtMicro, 2)} · ${analytics.highRiskCount}`,
              ],
            ].map(([label, val]) => (
              <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {val}
                </div>
              </div>
            ))}
          </div>

          {/* Payment Rail Breakdown */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  INR Payment Rail Breakdown
                </h3>
                <p className="text-xs text-slate-500">
                  Distribution of order count and completed INR volume across supported domestic
                  settlement rails.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">
                Total Orders Analyzed: {orders.length}
              </span>
            </div>

            <div className="space-y-3">
              {analytics.railBreakdown.map((item) => {
                const widthPct = Math.round((item.orderCount / analytics.maxRailOrders) * 100);
                return (
                  <div key={item.rail} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-slate-900">{item.rail}</span>
                      <span className="font-mono text-slate-600 tabular-nums">
                        {item.orderCount} orders · Completed {formatInrFromPaise(item.completedInrPaise)}
                      </span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-sm overflow-hidden">
                      <div
                        style={{ width: `${item.orderCount > 0 ? Math.max(4, widthPct) : 0}%` }}
                        className="h-full bg-blue-600 transition-all"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {section === 'integrations' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Server-Side API Integrations & Sandbox Controls
              </h3>
              <p className="text-xs text-slate-600">
                All secret keys stay strictly on the backend via{' '}
                <span className="font-mono text-slate-800">process.env</span>. Configure API keys
                in the AI Studio <strong>Settings &gt; Secrets</strong> panel—never in frontend code.
              </p>
            </div>
            <button
              type="button"
              disabled={integrationLoading}
              onClick={() => void loadIntegrationHealth()}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap self-start"
            >
              {integrationLoading ? 'Checking...' : 'Refresh Connection Checks'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* CoinGecko */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-semibold text-slate-900">
                  1. CoinGecko API
                </span>
                <span
                  className={
                    integrationData.rate?.isLive
                      ? 'font-semibold text-emerald-700'
                      : 'font-semibold text-amber-700'
                  }
                >
                  {integrationData.rate?.isLive ? 'Live Price' : 'Fallback Rate'}
                </span>
              </div>
              <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                ₹{integrationData.rate ? integrationData.rate.rateInr.toFixed(2) : '—'} / USDT
              </div>
              <p className="text-slate-600">
                {integrationData.rate?.source || 'Checking rate endpoint...'}
              </p>
              <div className="pt-2 border-t border-slate-100 font-mono text-slate-500 space-y-0.5">
                <div>
                  COINGECKO_API_KEY:{' '}
                  {integrationData.summary?.coingecko.configured ? 'Configured' : 'Anonymous Free Tier'}
                </div>
                <div>
                  MARKET_RATE_FALLBACK_INR: ₹
                  {integrationData.summary?.marketRateFallbackInr ?? 91.85}
                </div>
              </div>
            </div>

            {/* TronGrid */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-semibold text-slate-900">
                  2. TronGrid API
                </span>
                <span
                  className={
                    integrationData.tron?.isLive
                      ? 'font-semibold text-emerald-700'
                      : 'font-semibold text-amber-700'
                  }
                >
                  {integrationData.tron?.isLive ? 'Live Testnet' : 'Fallback Monitor'}
                </span>
              </div>
              <div className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                {integrationData.tron?.latestBlockNumber !== null &&
                integrationData.tron?.latestBlockNumber !== undefined
                  ? `Block #${integrationData.tron.latestBlockNumber.toLocaleString()}`
                  : 'Testnet Read'}
              </div>
              <p className="text-slate-600">
                {integrationData.tron?.networkLabel || 'TRON Nile Testnet'}
              </p>
              <div className="pt-2 border-t border-slate-100 font-mono text-slate-500 space-y-0.5">
                <div>
                  TRONGRID_API_KEY:{' '}
                  {integrationData.summary?.trongrid.configured ? 'Configured' : 'Anonymous Free Tier'}
                </div>
                <div>
                  TRONGRID_NETWORK: {integrationData.summary?.trongrid.network || 'nile'}
                </div>
              </div>
            </div>

            {/* Supabase */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-semibold text-slate-900">
                  3. Supabase (DB &amp; Vault)
                </span>
                <span
                  className={
                    integrationData.supabaseHealth?.mode === 'LIVE_CONNECTED'
                      ? 'font-semibold text-emerald-700'
                      : 'font-semibold text-amber-700'
                  }
                >
                  {integrationData.supabaseHealth?.mode || 'DEMO_FALLBACK'}
                </span>
              </div>
              <div className="font-mono text-sm font-bold text-slate-900">
                Bucket: {integrationData.supabaseHealth?.bucketName || 'kyc-documents'}
              </div>
              <p className="text-slate-600">
                {integrationData.supabaseHealth?.message ||
                  'Checking Supabase server connectivity...'}
              </p>
              <div className="pt-2 border-t border-slate-100 font-mono text-slate-500 space-y-0.5">
                <div>
                  SUPABASE_URL: {integrationData.summary?.supabase.hasUrl ? 'Set' : 'Not set'}
                </div>
                <div>
                  SUPABASE_SERVICE_ROLE_KEY:{' '}
                  {integrationData.summary?.supabase.hasServiceRoleKey ? 'Set' : 'Not set'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {section === 'users' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3 px-4 font-medium">Username</th>
                <th className="py-3 px-4 font-medium">Role</th>
                <th className="py-3 px-4 font-medium">KYC</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Withdrawal Lock</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.uid}>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                    {u.username}
                    {u.isDemo && (
                      <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded">
                        DEMO
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={u.role}
                      onChange={(e) =>
                        void updateUserRoleOrStatusAdmin({
                          targetUid: u.uid,
                          role: e.target.value as UserRole,
                          adminUid: user.uid,
                        })
                      }
                      className="border border-slate-200 rounded px-2 py-1 text-xs bg-white"
                    >
                      {[
                        'BUYER',
                        'SELLER',
                        'MERCHANT',
                        'LIQUIDITY_PROVIDER',
                        'TREASURY_ADMIN',
                        'SUPPORT_AGENT',
                        'COMPLIANCE_OFFICER',
                        'ADMIN',
                      ].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4 font-mono">{u.kycStatus}</td>
                  <td className="py-3 px-4 font-mono">{u.accountStatus}</td>
                  <td className="py-3 px-4 font-mono">
                    {u.withdrawalLocked ? (
                      <span className="text-red-700 font-semibold">LOCKED</span>
                    ) : (
                      <span className="text-slate-500">OPEN</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() =>
                        setPendingConfirm({
                          title: `${u.withdrawalLocked ? 'Unlock' : 'Lock'} Withdrawals for @${u.username}?`,
                          description: u.withdrawalLocked
                            ? 'Allows outbound USDT withdrawals for this account subject to 2FA and whitelist policies.'
                            : 'Immediately blocks outbound USDT withdrawals while preserving read access for compliance review.',
                          confirmLabel: u.withdrawalLocked ? 'Unlock Withdrawals' : 'Lock Withdrawals',
                          tone: u.withdrawalLocked ? 'primary' : 'danger',
                          run: async () => {
                            await updateUserRoleOrStatusAdmin({
                              targetUid: u.uid,
                              withdrawalLocked: !u.withdrawalLocked,
                              restrictedReason: !u.withdrawalLocked
                                ? 'Locked by Administrator Governance Desk.'
                                : '',
                              adminUid: user.uid,
                            });
                            setFeedbackMsg(
                              `Updated withdrawal lock for @${u.username} (${!u.withdrawalLocked}).`
                            );
                          },
                        })
                      }
                      className="text-amber-700 font-semibold hover:underline cursor-pointer"
                    >
                      {u.withdrawalLocked ? 'Unlock' : 'Lock'}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setPendingConfirm({
                          title: `${u.accountStatus === 'ACTIVE' ? 'Suspend' : 'Reactivate'} Account @${u.username}?`,
                          description:
                            u.accountStatus === 'ACTIVE'
                              ? 'Suspending an account prevents new P2P orders and flags the profile in audit logs.'
                              : 'Restores active trading privileges for this account.',
                          confirmLabel:
                            u.accountStatus === 'ACTIVE' ? 'Suspend Account' : 'Reactivate Account',
                          tone: u.accountStatus === 'ACTIVE' ? 'danger' : 'primary',
                          run: async () => {
                            const nextStatus =
                              u.accountStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
                            await updateUserRoleOrStatusAdmin({
                              targetUid: u.uid,
                              accountStatus: nextStatus,
                              adminUid: user.uid,
                            });
                            setFeedbackMsg(`Set @${u.username} account status to ${nextStatus}.`);
                          },
                        })
                      }
                      className="text-blue-600 font-semibold hover:underline cursor-pointer"
                    >
                      {u.accountStatus === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section === 'kyc' && (
        <div className="space-y-4">
          {kycs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
              No KYC submissions yet.
            </div>
          ) : (
            kycs.map((k) => (
              <div
                key={k.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-sm text-slate-900">
                    {k.fullLegalName} · {k.idType} ({k.maskedIdNumber})
                  </div>
                  <span className="font-mono font-semibold text-blue-700">{k.status}</span>
                </div>
                <div className="text-slate-600 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    Bank: •••• {k.bankAccountLast4} · {k.bankIfsc}
                  </div>
                  <div>Holder: {k.accountHolderName}</div>
                  <div>
                    Source: {k.sourceOfFunds} · PEP: {k.pepDeclared ? 'Yes' : 'No'}
                  </div>
                </div>
                {(k.videoStatus || k.livenessScore !== undefined) && (
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 font-mono text-[11px] text-slate-700 flex flex-wrap gap-4">
                    <span>Video: {k.videoStatus || 'NOT_STARTED'}</span>
                    {k.livenessScore !== undefined && <span>Liveness: {k.livenessScore}/100</span>}
                    {k.faceMatchScore !== undefined && (
                      <span>Face Match: {k.faceMatchScore}/100</span>
                    )}
                    {k.documentExpiry && <span>Doc Expiry: {k.documentExpiry}</span>}
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                  <input
                    type="text"
                    placeholder="Reviewer note"
                    value={kycNote[k.id] || ''}
                    onChange={(e) => setKycNote((p) => ({ ...p, [k.id]: e.target.value }))}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                  {(['APPROVED', 'REJECTED', 'ADDITIONAL_INFO_REQUIRED', 'EXPIRED'] as KycStatus[]).map(
                    (decision) => (
                      <button
                        key={decision}
                        type="button"
                        onClick={() =>
                          void reviewKycAdmin({
                            submissionId: k.id,
                            targetUid: k.uid,
                            decision,
                            reviewerNote: kycNote[k.id] || `Set ${decision}`,
                            existingHistory: k.verificationHistory,
                            adminUid: user.uid,
                          })
                        }
                        className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold hover:bg-slate-50 cursor-pointer"
                      >
                        {decision.replace(/_/g, ' ')}
                      </button>
                    )
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'merchants' && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {merchants.length === 0 ? (
            <div className="p-8 text-sm text-slate-500">No merchants registered yet.</div>
          ) : (
            merchants.map((m) => (
              <div
                key={m.id}
                className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-900 flex items-center gap-2">
                    <span>
                      {m.businessName} ({m.merchantType})
                    </span>
                    {m.isDemo ? (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded">
                        DEMO {m.demoMerchantCode || 'FIXTURE'}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 rounded">
                        REAL KYB DESK
                      </span>
                    )}
                    {!m.isAvailable && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600 rounded">
                        OFFLINE / REPLACED
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-slate-500 tabular-nums mt-0.5">
                    Liquidity: {formatUsdtFromMicro(m.declaredLiquidityUsdtMicro, 0)} · Commission:{' '}
                    {(m.commissionBps / 100).toFixed(2)}% · Orders: {m.completedOrders}
                  </div>
                </div>
                <select
                  value={m.verificationLevel}
                  onChange={async (e) => {
                    await updateDoc(doc(db, 'merchants', m.id), {
                      verificationLevel: e.target.value,
                      updatedAt: serverTimestamp(),
                    });
                    await logAuditEvent({
                      actorUid: user.uid,
                      action: 'MERCHANT_TIER_UPDATED',
                      targetType: 'merchant',
                      targetId: m.id,
                      summary: `Set verificationLevel=${e.target.value}`,
                    });
                  }}
                  className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                >
                  <option value="BASIC">BASIC</option>
                  <option value="VERIFIED">VERIFIED</option>
                  <option value="PREMIUM">PREMIUM</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </select>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'orders' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3 px-4 font-medium">Order</th>
                <th className="py-3 px-4 font-medium">Parties</th>
                <th className="py-3 px-4 font-medium">Rail</th>
                <th className="py-3 px-4 font-medium text-right">INR / USDT</th>
                <th className="py-3 px-4 font-medium">Risk</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                    {o.orderCode}
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    {o.buyerUsername} → {o.sellerUsername}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">{o.paymentMethod}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {formatInrFromPaise(o.inrPaise)} / {formatUsdtFromMicro(o.usdtMicro, 2)}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums">
                    {o.riskScore}/100 ({o.riskLevel})
                  </td>
                  <td className="py-3 px-4">{o.status}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenOrder(o.id)}
                      className="text-blue-600 font-semibold hover:underline cursor-pointer"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section === 'disputes' && (
        <div className="space-y-4">
          {disputes.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-sm text-slate-500 dark:text-slate-400">
              No disputes in queue.
            </div>
          ) : (
            disputes.map((d) => (
              <div
                key={d.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {d.orderCode} · {d.category}
                  </span>
                  <div className="flex items-center gap-2 font-mono">
                    {d.escalatedToCompliance && (
                      <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 rounded-sm font-semibold">
                        ESCALATED TO COMPLIANCE
                      </span>
                    )}
                    <span className="font-semibold text-blue-700 dark:text-blue-400">{d.status}</span>
                  </div>
                </div>
                <p className="text-slate-600 dark:text-slate-400">{d.description}</p>
                {d.evidenceSummary && (
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                    <strong>Submitted Evidence:</strong> {d.evidenceSummary}
                  </div>
                )}
                {d.evidenceItems && d.evidenceItems.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                    {d.evidenceItems.map((item) => (
                      <span
                        key={item}
                        className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  <span>
                    Assigned Officer:{' '}
                    {d.assignedOfficerUid ? d.assignedOfficerUid.slice(0, 12) : 'Unassigned'}
                  </span>
                  {d.resolutionNote && <span>Latest Note: {d.resolutionNote}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="Resolution note or evidence request"
                    value={disputeNote[d.id] || ''}
                    onChange={(e) => setDisputeNote((p) => ({ ...p, [d.id]: e.target.value }))}
                    className="flex-1 min-w-[200px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs"
                  />
                  {(
                    [
                      'UNDER_REVIEW',
                      'AWAITING_EVIDENCE',
                      'ESCALATED',
                      'RESOLVED',
                      'REJECTED',
                    ] as const
                  ).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={async () => {
                        await updateDisputeAdmin({
                          disputeId: d.id,
                          status: st,
                          assignedOfficerUid: user.uid,
                          resolutionNote: disputeNote[d.id] || `Marked ${st} by admin`,
                        });
                        setFeedbackMsg(`Dispute ${d.orderCode} assigned and marked ${st}.`);
                      }}
                      className={`px-3 py-1.5 rounded-lg border font-semibold cursor-pointer ${
                        st === 'ESCALATED'
                          ? 'border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                          : 'border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {st.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'risk' && (
        <div className="space-y-3">
          {risks.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
              No risk assessments recorded yet.
            </div>
          ) : (
            risks.map((r) => (
              <div
                key={r.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-2 text-xs"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-mono font-bold text-slate-900 inline-flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                    Score {r.score}/100 ({r.level}) · Recommended: {r.recommendedAction}
                  </span>
                  <span className="text-slate-600">Human Decision: {r.humanDecision}</span>
                </div>
                <ul className="list-disc pl-5 text-slate-600 space-y-0.5">
                  {r.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <div className="flex gap-2 pt-2">
                  {(['APPROVED', 'HELD', 'ESCALATED', 'BLOCKED'] as const).map((dec) => (
                    <button
                      key={dec}
                      type="button"
                      onClick={async () => {
                        await updateDoc(doc(db, 'risk_assessments', r.id), {
                          humanDecision: dec,
                          reviewedByUid: user.uid,
                          updatedAt: serverTimestamp(),
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold hover:bg-slate-50 cursor-pointer"
                    >
                      {dec}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'settings' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 max-w-3xl"
        >
          <h3 className="font-display text-base font-semibold text-slate-900">
            Configurable Fees, Limits & Sandbox Controls
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Brand Name</label>
              <input
                type="text"
                value={settingsForm.brandName}
                onChange={(e) => setSettingsForm({ ...settingsForm, brandName: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Base Reference Rate (INR Paise, 9185 = ₹91.85)
              </label>
              <input
                type="number"
                value={settingsForm.baseUsdtInrPaise}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, baseUsdtInrPaise: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Buyer Fee (bps, 25 = 0.25%)
              </label>
              <input
                type="number"
                value={settingsForm.buyerFeeBps}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, buyerFeeBps: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Seller Fee (bps)</label>
              <input
                type="number"
                value={settingsForm.sellerFeeBps}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, sellerFeeBps: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Sec 194S TDS Rate (bps, 100 = 1.00%)
              </label>
              <input
                type="number"
                value={settingsForm.tdsRateBps}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, tdsRateBps: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Merchant Commission (bps)
              </label>
              <input
                type="number"
                value={settingsForm.merchantCommissionBps}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    merchantCommissionBps: Number(e.target.value),
                  })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Min Order (INR Paise)
              </label>
              <input
                type="number"
                value={settingsForm.minOrderInrPaise}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, minOrderInrPaise: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Max Order (INR Paise)
              </label>
              <input
                type="number"
                value={settingsForm.maxOrderInrPaise}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, maxOrderInrPaise: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={settingsForm.sandboxMode}
              onChange={(e) => setSettingsForm({ ...settingsForm, sandboxMode: e.target.checked })}
              className="rounded border-slate-300 text-blue-600"
            />
            <span>
              Sandbox Mode Enabled (Keep active until legal, compliance & contract audits)
            </span>
          </label>

          <button
            type="submit"
            className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
          >
            Save Configuration
          </button>
        </form>
      )}

      {section === 'tickets' && (
        <div className="space-y-4">
          {/* Support Desk KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              ['Total Tickets', tickets.length],
              ['Open Queue', tickets.filter((t) => t.status === 'OPEN').length],
              ['In Progress', tickets.filter((t) => t.status === 'IN_PROGRESS').length],
              ['Resolved', tickets.filter((t) => t.status === 'RESOLVED').length],
              [
                'Escalated to Compliance',
                tickets.filter((t) => Boolean(t.escalatedToCompliance)).length,
              ],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5"
              >
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
                <div className="mt-0.5 font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {val}
                </div>
              </div>
            ))}
          </div>

          {tickets.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-sm text-slate-500 dark:text-slate-400">
              No support tickets submitted yet.
            </div>
          ) : (
            <div className="space-y-3">
              {tickets.map((t) => {
                const isExpanded = expandedTicketId === t.id;
                const selectedPriority = ticketPriorityDraft[t.id] || t.priority || 'NORMAL';
                return (
                  <div
                    key={t.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {t.subject} ({t.name} · {t.email})
                      </span>
                      <div className="flex items-center gap-2 font-mono">
                        {t.escalatedToCompliance && (
                          <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 rounded-sm font-semibold">
                            COMPLIANCE ESCALATED
                          </span>
                        )}
                        <span className="text-slate-600 dark:text-slate-300">
                          {selectedPriority} · {t.status}
                        </span>
                      </div>
                    </div>

                    <p className="text-slate-600 dark:text-slate-400">{t.message}</p>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <select
                        value={selectedPriority}
                        onChange={async (e) => {
                          const nextP = e.target.value as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
                          setTicketPriorityDraft((p) => ({ ...p, [t.id]: nextP }));
                          await updateSupportTicketAdmin({
                            ticketId: t.id,
                            status: t.status === 'OPEN' ? 'IN_PROGRESS' : t.status,
                            adminUid: user.uid,
                            priority: nextP,
                          });
                        }}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs font-mono"
                      >
                        <option value="LOW">LOW</option>
                        <option value="NORMAL">NORMAL</option>
                        <option value="HIGH">HIGH</option>
                        <option value="URGENT">URGENT</option>
                      </select>

                      <button
                        type="button"
                        onClick={async () => {
                          await updateSupportTicketAdmin({
                            ticketId: t.id,
                            status: t.status === 'RESOLVED' ? 'RESOLVED' : 'IN_PROGRESS',
                            adminUid: user.uid,
                            escalatedToCompliance: !t.escalatedToCompliance,
                            priority: !t.escalatedToCompliance ? 'HIGH' : selectedPriority,
                          });
                          setFeedbackMsg(
                            `Ticket "${t.subject}" compliance escalation=${String(!t.escalatedToCompliance)}.`
                          );
                        }}
                        className={`px-3 py-1.5 rounded-lg border font-semibold cursor-pointer ${
                          t.escalatedToCompliance
                            ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                            : 'border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                        }`}
                      >
                        {t.escalatedToCompliance ? 'Clear Escalation' : 'Escalate to Compliance'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setExpandedTicketId(isExpanded ? null : t.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        {isExpanded ? 'Hide Live Chat' : 'Open Live Chat'}
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Write official reply & resolve"
                        value={ticketReply[t.id] || ''}
                        onChange={(e) => setTicketReply((p) => ({ ...p, [t.id]: e.target.value }))}
                        className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          await updateSupportTicketAdmin({
                            ticketId: t.id,
                            status: 'RESOLVED',
                            adminUid: user.uid,
                            adminReply: ticketReply[t.id] || 'Resolved by support.',
                            priority: selectedPriority,
                          });
                          setFeedbackMsg(`Ticket "${t.subject}" marked RESOLVED.`);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
                      >
                        Reply &amp; Resolve
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-2 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                        <div className="max-h-52 overflow-y-auto space-y-2 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                          {ticketMessages.length === 0 ? (
                            <div className="text-slate-500 dark:text-slate-400">
                              No live chat messages yet. Send an officer update below.
                            </div>
                          ) : (
                            ticketMessages.map((msg) => (
                              <div
                                key={msg.id}
                                className={`p-2 rounded-lg ${
                                  msg.senderRole === 'ADMIN' || msg.senderRole === 'SUPPORT'
                                    ? 'bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-slate-900 dark:text-slate-100'
                                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                                }`}
                              >
                                <div className="flex justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400 mb-0.5">
                                  <span>
                                    {msg.senderName} ({msg.senderRole})
                                  </span>
                                  <span>
                                    {msg.createdAt?.toDate
                                      ? msg.createdAt.toDate().toLocaleTimeString()
                                      : 'Now'}
                                  </span>
                                </div>
                                <div>{msg.body}</div>
                              </div>
                            ))
                          )}
                        </div>
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!ticketChatInput.trim()) return;
                            await sendSupportMessage({
                              ticketId: t.id,
                              senderUid: user.uid,
                              senderName: account?.displayName || 'Support Admin',
                              senderRole: 'ADMIN',
                              body: ticketChatInput,
                            });
                            if (t.status === 'OPEN') {
                              await updateSupportTicketAdmin({
                                ticketId: t.id,
                                status: 'IN_PROGRESS',
                                adminUid: user.uid,
                              });
                            }
                            setTicketChatInput('');
                          }}
                          className="flex gap-2"
                        >
                          <input
                            type="text"
                            placeholder="Send live support message to user..."
                            value={ticketChatInput}
                            onChange={(e) => setTicketChatInput(e.target.value)}
                            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs"
                          />
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white font-semibold hover:bg-slate-800 cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            Send
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {section === 'reviews' && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {reviews.length === 0 ? (
            <div className="p-8 text-sm text-slate-500">No trader reviews submitted yet.</div>
          ) : (
            reviews.map((r) => (
              <div key={r.id} className="p-4 flex items-center justify-between gap-4 text-xs">
                <div>
                  <div className="font-semibold text-slate-900">
                    {r.authorName} · {r.rating}/5
                  </div>
                  <p className="text-slate-600 mt-0.5">{r.comment}</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await updateDoc(doc(db, 'reviews', r.id), {
                      approved: !r.approved,
                    });
                  }}
                  className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                    r.approved
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {r.approved ? 'Approved (Hide)' : 'Approve for Homepage'}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {audits.map((a) => (
            <div key={a.id} className="p-3.5 flex items-start justify-between gap-4 text-xs">
              <div>
                <span className="font-mono font-semibold text-slate-900">{a.action}</span>
                <span className="text-slate-500 ml-2">
                  ({a.targetType}/{a.targetId})
                </span>
                <p className="text-slate-600 mt-0.5">{a.summary}</p>
              </div>
              <div className="font-mono text-slate-400 shrink-0">
                {a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString() : 'Now'}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        title={pendingConfirm?.title || ''}
        description={pendingConfirm?.description || ''}
        confirmLabel={pendingConfirm?.confirmLabel || 'Confirm'}
        tone={pendingConfirm?.tone || 'primary'}
        busy={confirmBusy}
        onCancel={() => !confirmBusy && setPendingConfirm(null)}
        onConfirm={executeConfirm}
      />
    </div>
  );
}
