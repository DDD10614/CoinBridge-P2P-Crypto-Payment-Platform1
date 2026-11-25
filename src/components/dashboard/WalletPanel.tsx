import React, { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  History,
  Info,
  Lock,
  Network,
  Plus,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  BLOCKCHAIN_NETWORKS,
  BlockchainNetworkConfig,
  BlockchainNetworkId,
  calculateWithdrawalBreakdown,
  DEFAULT_WALLET_SECURITY_POLICY,
  deriveDeterministicDepositAddress,
  evaluateWithdrawalRisk,
  EXTERNAL_EXCHANGE_GUIDES,
  formatUsdtFromMicro,
  isValidWalletAddress,
  MICRO_PER_USDT,
  WalletSecurityPolicy,
} from '../../lib/domain';
import {
  addWithdrawalWhitelistAddress,
  connectWalletAddress,
  ensureUserDepositAddress,
  logDeniedTradingAttempt,
  recordDepositTransaction,
  removeWithdrawalWhitelistAddress,
  submitWithdrawalRequest,
} from '../../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { downloadTransactionReceiptPdf } from '../../lib/pdfReports';
import { useAuth } from '../../context/AuthContext';
import {
  DepositTransactionDoc,
  SupportedNetworkDoc,
  WalletAddressDoc,
  WalletLedgerEntryDoc,
  WalletReservationDoc,
  WalletSecuritySettingsDoc,
  WalletTransactionDoc,
  WithdrawalTransactionDoc,
  WithdrawalWhitelistDoc,
} from '../../types/models';
import { ConfirmDialog } from '../ConfirmDialog';
import { KycRestrictionModal } from '../KycRestrictionModal';

type WalletSubView = 'overview' | 'deposit' | 'withdraw' | 'history' | 'addresses' | 'networks';
type HistoryFilter = 'ALL' | 'DEPOSITS' | 'WITHDRAWALS' | 'ESCROW' | 'LEDGER';

interface WalletPanelProps {
  onGoToKyc?: () => void;
  onGoToSecurity?: () => void;
}

function toMillis(ts?: { toMillis?: () => number }): number {
  return ts?.toMillis ? ts.toMillis() : 0;
}

export function WalletPanel({ onGoToKyc, onGoToSecurity }: WalletPanelProps) {
  const {
    user,
    account,
    privateProfile,
    wallet,
    platformSettings,
    isTradingEligible,
    kycRestriction,
    getIdToken,
  } = useAuth();

  const [subView, setSubView] = useState<WalletSubView>('overview');
  const [selectedNetwork, setSelectedNetwork] = useState<BlockchainNetworkId>(
    wallet?.preferredNetwork || 'TRON_TRC20'
  );

  // Firestore synced collections
  const [walletAddresses, setWalletAddresses] = useState<WalletAddressDoc[]>([]);
  const [deposits, setDeposits] = useState<DepositTransactionDoc[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalTransactionDoc[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<WalletLedgerEntryDoc[]>([]);
  const [reservations, setReservations] = useState<WalletReservationDoc[]>([]);
  const [legacyTxs, setLegacyTxs] = useState<WalletTransactionDoc[]>([]);
  const [whitelist, setWhitelist] = useState<WithdrawalWhitelistDoc[]>([]);
  const [networkOverrides, setNetworkOverrides] = useState<Record<string, SupportedNetworkDoc>>({});
  const [policyDoc, setPolicyDoc] = useState<WalletSecuritySettingsDoc | null>(null);

  // Deposit state
  const [depositQrUrl, setDepositQrUrl] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [faucetUsdt, setFaucetUsdt] = useState('250');
  const [verifyTxHash, setVerifyTxHash] = useState('');
  const [verifyTxUsdt, setVerifyTxUsdt] = useState('50');
  const [verifyEventIndex, setVerifyEventIndex] = useState('0');
  const [tronScanResult, setTronScanResult] = useState<{
    isLive: boolean;
    latestBlockNumber: number | null;
    notice: string;
    matchedTransfers: Array<{
      txHash: string;
      eventIndex: number;
      amountMicro: number;
      confirmations: number;
      eventId: string;
    }>;
  } | null>(null);

  // Withdraw state
  const [withdrawTo, setWithdrawTo] = useState('');
  const [withdrawUsdt, setWithdrawUsdt] = useState('25');
  const [withdrawTotp, setWithdrawTotp] = useState('');
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [serverPreview, setServerPreview] = useState<{
    risk: { score: number; level: string; requiresManualReview: boolean; reasons: string[] };
  } | null>(null);

  // History filter
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('ALL');

  // Whitelist form
  const [wlLabel, setWlLabel] = useState('');
  const [wlNetwork, setWlNetwork] = useState<BlockchainNetworkId>('TRON_TRC20');
  const [wlAddress, setWlAddress] = useState('');

  // TronGrid Testnet Monitor
  const [tronStatus, setTronStatus] = useState<{
    network: string;
    networkLabel: string;
    usdtContract: string;
    latestBlockNumber: number | null;
    isLive: boolean;
    notice: string;
  } | null>(null);
  const [tronLookupAddr, setTronLookupAddr] = useState('TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf');
  const [tronLookupLoading, setTronLookupLoading] = useState(false);
  const [tronAccountData, setTronAccountData] = useState<{
    address: string;
    isLive: boolean;
    cached?: boolean;
    trxBalance: string;
    usdtTestnetBalance: string;
    recentTrc20: Array<{ txId: string; symbol: string; amount: string }>;
    notice?: string;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadTronStatus = async () => {
    try {
      const resp = await fetch('/api/tron/status');
      if (resp.ok) setTronStatus(await resp.json());
    } catch {
      // keep UI resilient
    }
  };

  useEffect(() => {
    void loadTronStatus();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubs = [
      onSnapshot(
        query(collection(db, 'wallet_addresses'), where('uid', '==', user.uid)),
        (s) =>
          setWalletAddresses(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WalletAddressDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'wallet_addresses')
      ),
      onSnapshot(
        query(collection(db, 'deposit_transactions'), where('uid', '==', user.uid)),
        (s) =>
          setDeposits(
            s.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<DepositTransactionDoc, 'id'>) }))
              .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'deposit_transactions')
      ),
      onSnapshot(
        query(collection(db, 'withdrawal_transactions'), where('uid', '==', user.uid)),
        (s) =>
          setWithdrawals(
            s.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<WithdrawalTransactionDoc, 'id'>) }))
              .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'withdrawal_transactions')
      ),
      onSnapshot(
        query(collection(db, 'wallet_ledger'), where('uid', '==', user.uid)),
        (s) =>
          setLedgerEntries(
            s.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<WalletLedgerEntryDoc, 'id'>) }))
              .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'wallet_ledger')
      ),
      onSnapshot(
        query(collection(db, 'wallet_reservations'), where('uid', '==', user.uid)),
        (s) =>
          setReservations(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WalletReservationDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'wallet_reservations')
      ),
      onSnapshot(
        query(collection(db, 'wallet_transactions'), where('uid', '==', user.uid)),
        (s) =>
          setLegacyTxs(
            s.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<WalletTransactionDoc, 'id'>) }))
              .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'wallet_transactions')
      ),
      onSnapshot(
        query(collection(db, 'withdrawal_whitelist'), where('uid', '==', user.uid)),
        (s) =>
          setWhitelist(
            s.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<WithdrawalWhitelistDoc, 'id'>) }))
              .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'withdrawal_whitelist')
      ),
      onSnapshot(
        collection(db, 'supported_networks'),
        (s) => {
          const map: Record<string, SupportedNetworkDoc> = {};
          s.docs.forEach((d) => {
            map[d.id] = { id: d.id as BlockchainNetworkId, ...(d.data() as Omit<SupportedNetworkDoc, 'id'>) };
          });
          setNetworkOverrides(map);
        },
        (e) => handleFirestoreError(e, OperationType.LIST, 'supported_networks')
      ),
      onSnapshot(
        doc(db, 'wallet_security_settings', 'default'),
        (s) => {
          if (s.exists()) {
            setPolicyDoc({
              id: s.id,
              ...(s.data() as Omit<WalletSecuritySettingsDoc, 'id'>),
            });
          }
        },
        (e) => handleFirestoreError(e, OperationType.GET, 'wallet_security_settings/default')
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [user]);

  const effectiveNetworks = useMemo(() => {
    const merged: Record<BlockchainNetworkId, BlockchainNetworkConfig> = { ...BLOCKCHAIN_NETWORKS };
    for (const id of Object.keys(BLOCKCHAIN_NETWORKS) as BlockchainNetworkId[]) {
      const ov = networkOverrides[id];
      if (ov) {
        merged[id] = {
          ...BLOCKCHAIN_NETWORKS[id],
          requiredConfirmations: ov.requiredConfirmations,
          estimatedNetworkFeeUsdtMicro: ov.estimatedNetworkFeeUsdtMicro,
          platformWithdrawalFeeUsdtMicro: ov.platformWithdrawalFeeUsdtMicro,
          minDepositUsdtMicro: ov.minDepositUsdtMicro,
          minWithdrawalUsdtMicro: ov.minWithdrawalUsdtMicro,
          maxWithdrawalUsdtMicro: ov.maxWithdrawalUsdtMicro,
          dailyWithdrawalLimitUsdtMicro: ov.dailyWithdrawalLimitUsdtMicro,
          depositsEnabled: ov.depositsEnabled,
          withdrawalsEnabled: ov.withdrawalsEnabled,
        };
      }
    }
    return merged;
  }, [networkOverrides]);

  const securityPolicy: WalletSecurityPolicy = useMemo(
    () =>
      policyDoc
        ? {
            newAddressCooldownHours: policyDoc.newAddressCooldownHours,
            manualReviewThresholdUsdtMicro: policyDoc.manualReviewThresholdUsdtMicro,
            dailyWithdrawalLimitUsdtMicro: policyDoc.dailyWithdrawalLimitUsdtMicro,
            require2faForWithdrawals: policyDoc.require2faForWithdrawals,
            sandboxFaucetEnabled: policyDoc.sandboxFaucetEnabled,
          }
        : DEFAULT_WALLET_SECURITY_POLICY,
    [policyDoc]
  );

  const netCfg = effectiveNetworks[selectedNetwork];
  const activeDepositAddress = useMemo(() => {
    if (!user) return '';
    const existing = walletAddresses.find((w) => w.network === selectedNetwork);
    return existing?.address || deriveDeterministicDepositAddress(user.uid, selectedNetwork);
  }, [user, walletAddresses, selectedNetwork]);

  // Persist deterministic deposit address record when visiting Deposit view
  useEffect(() => {
    if (!user || subView !== 'deposit') return;
    const hasDoc = walletAddresses.some((w) => w.network === selectedNetwork);
    if (!hasDoc) {
      void ensureUserDepositAddress({
        uid: user.uid,
        network: selectedNetwork,
        isSandbox: platformSettings.sandboxMode,
      });
    }
  }, [user, subView, selectedNetwork, walletAddresses, platformSettings.sandboxMode]);

  // Generate QR code for current deposit address
  useEffect(() => {
    if (!activeDepositAddress) {
      setDepositQrUrl('');
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(activeDepositAddress, {
      width: 200,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setDepositQrUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [activeDepositAddress]);

  // Balance & reservation analytics
  const avail = wallet?.availableUsdtMicro || 0;
  const reserved = wallet?.reservedUsdtMicro || 0;

  const reservationBreakdown = useMemo(() => {
    const active = reservations.filter((r) => r.status === 'ACTIVE');
    const withdrawalPendingMicro = active
      .filter((r) => r.purpose === 'WITHDRAWAL_PENDING')
      .reduce((acc, r) => acc + r.amountMicro, 0);
    const p2pEscrowMicro = active
      .filter((r) => r.purpose === 'P2P_ESCROW')
      .reduce((acc, r) => acc + r.amountMicro, 0);
    // Fallback if legacy P2P reservations existed prior to wallet_reservations
    const fallbackP2p = Math.max(0, reserved - withdrawalPendingMicro);
    return {
      withdrawalPendingMicro,
      p2pEscrowMicro: p2pEscrowMicro > 0 ? p2pEscrowMicro : fallbackP2p,
    };
  }, [reservations, reserved]);

  const walletStats = useMemo(() => {
    const pendingDepositsCount = deposits.filter((d) =>
      ['AWAITING_DEPOSIT', 'DETECTED', 'CONFIRMING', 'UNDER_COMPLIANCE_REVIEW'].includes(d.status)
    ).length;
    const pendingWithdrawalsCount = withdrawals.filter((w) =>
      ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'BROADCASTED', 'CONFIRMING'].includes(
        w.status
      )
    ).length;
    const totalCreditedDepositsMicro = deposits
      .filter((d) => d.status === 'CREDITED')
      .reduce((acc, d) => acc + d.amountMicro, 0);
    const totalCompletedWithdrawalsMicro = withdrawals
      .filter((w) => w.status === 'COMPLETED')
      .reduce((acc, w) => acc + w.requestedAmountMicro, 0);

    const nowMs = Date.now();
    const dayAgo = nowMs - 24 * 60 * 60 * 1000;
    const dailyWithdrawnMicro = withdrawals
      .filter(
        (w) =>
          !['FAILED', 'REJECTED', 'CANCELLED'].includes(w.status) &&
          toMillis(w.createdAt) >= dayAgo
      )
      .reduce((acc, w) => acc + w.requestedAmountMicro, 0);

    return {
      pendingDepositsCount,
      pendingWithdrawalsCount,
      totalCreditedDepositsMicro,
      totalCompletedWithdrawalsMicro,
      dailyWithdrawnMicro,
    };
  }, [deposits, withdrawals]);

  const copyValue = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // --- Browser Wallet Connection ---
  const handleConnectWeb3Wallet = async () => {
    if (!user) return;
    setErrorMsg(null);
    setStatusMsg(null);

    const eth = (window as unknown as { ethereum?: ethers.Eip1193Provider }).ethereum;
    if (!eth) {
      setErrorMsg(
        'No EIP-193 browser wallet detected (MetaMask/Rabby). You can still deposit to your CoinBridge address or whitelist external addresses without a browser extension.'
      );
      return;
    }
    setBusy(true);
    try {
      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      await signer.signMessage(
        `CoinBridge P2P Wallet Ownership Verification\nAccount: ${user.uid}\nTimestamp: ${new Date().toISOString()}`
      );
      await connectWalletAddress(user.uid, address, selectedNetwork);
      setStatusMsg(`Verified and linked external Web3 address ${address}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Wallet connection cancelled.');
    } finally {
      setBusy(false);
    }
  };

  // --- Deposit Actions ---
  const handleGenerateDepositAddress = async () => {
    if (!user) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const token = await getIdToken();
      await fetch('/api/wallet/deposit-address', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ network: selectedNetwork }),
      });
      const addr = await ensureUserDepositAddress({
        uid: user.uid,
        network: selectedNetwork,
        isSandbox: platformSettings.sandboxMode,
      });
      setStatusMsg(`Deposit address ready for ${netCfg.name}: ${addr}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to generate deposit address.');
    } finally {
      setBusy(false);
    }
  };

  const handleScanTronDeposits = async () => {
    if (!user) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/wallet/deposits/monitor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ network: 'TRON_TRC20' }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErrorMsg(data.error || 'TronGrid scan failed.');
      } else {
        setTronScanResult({
          isLive: Boolean(data.isLive),
          latestBlockNumber: data.latestBlockNumber ?? null,
          notice: String(data.notice || ''),
          matchedTransfers: Array.isArray(data.matchedTransfers) ? data.matchedTransfers : [],
        });
      }
    } catch {
      setErrorMsg('Unable to reach TronGrid deposit scanner.');
    } finally {
      setBusy(false);
    }
  };

  const handleSandboxFaucetDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/wallet/deposits/monitor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          network: selectedNetwork,
          amountUsdt: Number(faucetUsdt),
          sandboxFaucet: true,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Sandbox deposit check failed.');
      }
      await recordDepositTransaction({
        uid: user.uid,
        username: account?.username,
        network: selectedNetwork,
        contractAddress: data.contractAddress,
        depositAddress: data.depositAddress,
        txHash: data.txHash,
        eventIndex: data.eventIndex ?? 0,
        amountMicro: data.amountMicro,
        confirmations: data.confirmations,
        requiredConfirmations: data.requiredConfirmations,
        status: data.depositStatus,
        verificationSource: data.verificationSource,
        isSandbox: true,
      });
      setStatusMsg(
        data.depositStatus === 'CREDITED'
          ? `[SANDBOX TESTNET] +${faucetUsdt} USDT credited on ${netCfg.name}.`
          : `[SANDBOX TESTNET] ${faucetUsdt} USDT deposit queued under compliance review (exceeds threshold).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sandbox deposit failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyDepositHash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/wallet/deposits/monitor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          network: selectedNetwork,
          txHash: verifyTxHash.trim(),
          amountUsdt: Number(verifyTxUsdt),
          eventIndex: Number(verifyEventIndex || 0),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Deposit hash verification failed.');
      }
      await recordDepositTransaction({
        uid: user.uid,
        username: account?.username,
        network: selectedNetwork,
        contractAddress: data.contractAddress,
        depositAddress: data.depositAddress,
        txHash: data.txHash,
        eventIndex: data.eventIndex ?? 0,
        amountMicro: data.amountMicro,
        confirmations: data.confirmations,
        requiredConfirmations: data.requiredConfirmations,
        status: data.depositStatus,
        verificationSource: data.verificationSource,
        isSandbox: Boolean(data.isSandbox),
      });
      setVerifyTxHash('');
      setStatusMsg(
        `Recorded deposit ${data.eventId} with status ${data.depositStatus} (${data.confirmations}/${data.requiredConfirmations} confirmations).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not verify deposit hash.');
    } finally {
      setBusy(false);
    }
  };

  const handleClaimTronMatchedTransfer = async (transfer: {
    txHash: string;
    eventIndex: number;
    amountMicro: number;
    confirmations: number;
  }) => {
    if (!user) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const status =
        transfer.confirmations >= netCfg.requiredConfirmations
          ? transfer.amountMicro >= securityPolicy.manualReviewThresholdUsdtMicro
            ? 'UNDER_COMPLIANCE_REVIEW'
            : 'CREDITED'
          : 'CONFIRMING';
      await recordDepositTransaction({
        uid: user.uid,
        username: account?.username,
        network: 'TRON_TRC20',
        contractAddress: netCfg.testnetContractAddress,
        depositAddress: activeDepositAddress,
        txHash: transfer.txHash,
        eventIndex: transfer.eventIndex,
        amountMicro: transfer.amountMicro,
        confirmations: transfer.confirmations,
        requiredConfirmations: netCfg.requiredConfirmations,
        status,
        verificationSource: 'TRONGRID_TESTNET',
        isSandbox: true,
      });
      setStatusMsg(`Processed TronGrid deposit ${transfer.txHash.slice(0, 12)}... -> ${status}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to claim detected deposit.');
    } finally {
      setBusy(false);
    }
  };

  // --- Withdraw Calculations & Handlers ---
  const withdrawAmountMicro = Math.max(0, Math.round((Number(withdrawUsdt) || 0) * MICRO_PER_USDT));
  const withdrawBreakdown = useMemo(
    () =>
      calculateWithdrawalBreakdown({
        amountMicro: withdrawAmountMicro,
        networkFeeMicro: netCfg.estimatedNetworkFeeUsdtMicro,
        platformFeeMicro: netCfg.platformWithdrawalFeeUsdtMicro,
      }),
    [withdrawAmountMicro, netCfg.estimatedNetworkFeeUsdtMicro, netCfg.platformWithdrawalFeeUsdtMicro]
  );

  const matchedWhitelistEntry = useMemo(
    () =>
      whitelist.find(
        (w) => w.isActive && w.network === selectedNetwork && w.address.trim() === withdrawTo.trim()
      ),
    [whitelist, selectedNetwork, withdrawTo]
  );

  const localRiskPreview = useMemo(
    () =>
      evaluateWithdrawalRisk({
        amountMicro: withdrawAmountMicro,
        manualReviewThresholdMicro: securityPolicy.manualReviewThresholdUsdtMicro,
        isWhitelisted: Boolean(matchedWhitelistEntry),
        whitelistCreatedAtMs: matchedWhitelistEntry ? toMillis(matchedWhitelistEntry.createdAt) : undefined,
        newAddressCooldownHours: securityPolicy.newAddressCooldownHours,
        kycStatus: kycRestriction.effectiveKycStatus,
        completedTrades: account?.completedTrades || 0,
      }),
    [
      withdrawAmountMicro,
      securityPolicy.manualReviewThresholdUsdtMicro,
      securityPolicy.newAddressCooldownHours,
      matchedWhitelistEntry,
      kycRestriction.effectiveKycStatus,
      account?.completedTrades,
    ]
  );

  const effectiveDailyLimitMicro = Math.min(
    netCfg.dailyWithdrawalLimitUsdtMicro,
    securityPolicy.dailyWithdrawalLimitUsdtMicro
  );

  const runServerWithdrawalValidate = async () => {
    setErrorMsg(null);
    setServerPreview(null);
    if (!isTradingEligible) {
      if (user) {
        void logDeniedTradingAttempt({
          uid: user.uid,
          action: 'WITHDRAW_VALIDATE',
          kycStatus: kycRestriction.effectiveKycStatus,
          reasonCode: kycRestriction.reasonCode,
          reasonMessage: kycRestriction.reasonMessage,
        });
      }
      setKycModalOpen(true);
      return;
    }
    setBusy(true);
    try {
      const token = await getIdToken();
      const [wdResp, screenResp] = await Promise.all([
        fetch('/api/wallet/withdraw/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            network: selectedNetwork,
            destinationAddress: withdrawTo.trim(),
            amountUsdt: Number(withdrawUsdt),
            availableUsdtMicro: avail,
            dailyWithdrawnMicro: walletStats.dailyWithdrawnMicro,
            isWhitelisted: Boolean(matchedWhitelistEntry),
            whitelistCreatedAtMs: matchedWhitelistEntry
              ? toMillis(matchedWhitelistEntry.createdAt)
              : undefined,
          }),
        }),
        fetch('/api/fraud/screen-wallet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            address: withdrawTo.trim(),
            network: selectedNetwork,
            amountUsdt: Number(withdrawUsdt),
            recent24hCount: withdrawals.filter(
              (w) => Date.now() - toMillis(w.createdAt) < 86_400_000
            ).length,
          }),
        }),
      ]);
      const data = await wdResp.json();
      const screenData = screenResp.ok ? await screenResp.json() : null;
      if (!wdResp.ok) {
        setErrorMsg(data.error || 'Withdrawal pre-flight validation failed.');
      } else {
        const mergedReasons = [
          ...(data.risk?.reasons || []),
          ...(screenData?.flags?.length ? screenData.flags : []),
        ];
        setServerPreview({
          risk: {
            ...data.risk,
            score: Math.max(data.risk?.score || 0, screenData?.riskScore || 0),
            reasons: mergedReasons,
          },
        });
      }
    } catch {
      setErrorMsg('Unable to reach withdrawal validation service.');
    } finally {
      setBusy(false);
    }
  };

  const requestWithdrawConfirmation = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (!isTradingEligible) {
      if (user) {
        void logDeniedTradingAttempt({
          uid: user.uid,
          action: 'EXTERNAL_USDT_WITHDRAWAL',
          kycStatus: kycRestriction.effectiveKycStatus,
          reasonCode: kycRestriction.reasonCode,
          reasonMessage: kycRestriction.reasonMessage,
        });
      }
      setKycModalOpen(true);
      return;
    }
    if (account?.withdrawalLocked) {
      setErrorMsg(
        `Withdrawals are frozen (${account.restrictedReason || 'Security Lock'}). Review Security & Alerts or contact Compliance.`
      );
      return;
    }
    if (!netCfg.withdrawalsEnabled) {
      setErrorMsg(`Withdrawals on ${netCfg.name} are currently paused by Treasury Admin.`);
      return;
    }
    if (!isValidWalletAddress(withdrawTo, selectedNetwork)) {
      setErrorMsg(`Enter a valid ${netCfg.name} (${netCfg.tokenStandard}) address. ${netCfg.addressFormatHint}.`);
      return;
    }
    if (withdrawAmountMicro < netCfg.minWithdrawalUsdtMicro) {
      setErrorMsg(`Minimum withdrawal on ${netCfg.name} is ${formatUsdtFromMicro(netCfg.minWithdrawalUsdtMicro, 2)}.`);
      return;
    }
    if (withdrawAmountMicro > netCfg.maxWithdrawalUsdtMicro) {
      setErrorMsg(`Maximum single withdrawal on ${netCfg.name} is ${formatUsdtFromMicro(netCfg.maxWithdrawalUsdtMicro, 2)}.`);
      return;
    }
    if (walletStats.dailyWithdrawnMicro + withdrawAmountMicro > effectiveDailyLimitMicro) {
      setErrorMsg(`Exceeds 24h daily withdrawal limit (${formatUsdtFromMicro(effectiveDailyLimitMicro, 0)}).`);
      return;
    }
    if (avail < withdrawBreakdown.totalDebitMicro) {
      setErrorMsg(
        `Insufficient available balance. Need ${formatUsdtFromMicro(withdrawBreakdown.totalDebitMicro, 2)} (including fees). P2P-escrowed funds cannot be withdrawn.`
      );
      return;
    }
    if (privateProfile?.whitelistOnlyWithdrawals && !matchedWhitelistEntry) {
      setErrorMsg(
        `Strict whitelist mode is enabled. Add ${withdrawTo.trim()} under Saved Addresses first.`
      );
      return;
    }
    if (securityPolicy.require2faForWithdrawals) {
      if (!privateProfile?.twoFactorEnabled || !privateProfile.totpSealedSecret) {
        setErrorMsg('Enable RFC 6238 Authenticator 2FA in Security & Alerts before withdrawing USDT.');
        return;
      }
      if (!/^\d{6}$/.test(withdrawTotp.trim())) {
        setErrorMsg('Enter your 6-digit 2FA authenticator code before confirming.');
        return;
      }
    }

    setWithdrawConfirmOpen(true);
  };

  const handleConfirmWithdraw = async () => {
    if (!user) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication session expired. Sign in again.');
      const idempotencyKey = `wd_${user.uid.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const resp = await fetch('/api/wallet/withdraw/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          network: selectedNetwork,
          destinationAddress: withdrawTo.trim(),
          amountUsdt: Number(withdrawUsdt),
          availableUsdtMicro: avail,
          dailyWithdrawnMicro: walletStats.dailyWithdrawnMicro,
          isWhitelisted: Boolean(matchedWhitelistEntry),
          whitelistCreatedAtMs: matchedWhitelistEntry
            ? toMillis(matchedWhitelistEntry.createdAt)
            : undefined,
          totpCode: withdrawTotp.trim(),
          totpSealedSecret: privateProfile?.totpSealedSecret || '',
          idempotencyKey,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Server rejected withdrawal request.');
      }

      await submitWithdrawalRequest({
        uid: user.uid,
        username: account?.username,
        network: selectedNetwork,
        destinationAddress: data.destinationAddress,
        requestedAmountMicro: data.breakdown.requestedAmountMicro,
        networkFeeMicro: data.breakdown.networkFeeMicro,
        platformFeeMicro: data.breakdown.platformFeeMicro,
        totalDebitMicro: data.breakdown.totalDebitMicro,
        netSentMicro: data.breakdown.netReceivedMicro,
        initialStatus: data.initialStatus,
        riskScore: data.risk.score,
        riskLevel: data.risk.level,
        riskReasons: data.risk.reasons,
        twoFactorVerified: true,
        idempotencyKey: data.idempotencyKey,
        txHash: data.txHash,
        isSandbox: Boolean(data.isSandbox),
      });

      setWithdrawConfirmOpen(false);
      setWithdrawTotp('');
      setServerPreview(null);
      setStatusMsg(data.notice || 'Withdrawal submitted and funds atomically reserved.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Withdrawal failed.');
    } finally {
      setBusy(false);
    }
  };

  // --- Whitelist Handlers ---
  const handleAddWhitelist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setErrorMsg(null);
    setStatusMsg(null);
    if (!isValidWalletAddress(wlAddress, wlNetwork)) {
      setErrorMsg(`Invalid ${effectiveNetworks[wlNetwork].name} address format.`);
      return;
    }
    setBusy(true);
    try {
      await addWithdrawalWhitelistAddress({
        uid: user.uid,
        label: wlLabel,
        network: wlNetwork,
        address: wlAddress,
      });
      setWlLabel('');
      setWlAddress('');
      setStatusMsg(
        `Saved ${wlNetwork} address to whitelist. Note: newly added addresses trigger a ${securityPolicy.newAddressCooldownHours}h review cooldown.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save address.');
    } finally {
      setBusy(false);
    }
  };

  const handleTronAccountLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const token = await getIdToken();
    if (!token) return;
    setTronLookupLoading(true);
    try {
      const resp = await fetch(`/api/tron/account/${encodeURIComponent(tronLookupAddr.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await resp.json();
      if (!resp.ok) setErrorMsg(data.error || 'Failed to read TRON account.');
      else setTronAccountData(data);
    } catch {
      setErrorMsg('Unable to reach TronGrid read proxy.');
    } finally {
      setTronLookupLoading(false);
    }
  };

  const subTabs: { id: WalletSubView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Wallet Overview', icon: Wallet },
    { id: 'deposit', label: 'Deposit USDT', icon: ArrowDownLeft },
    { id: 'withdraw', label: 'Withdraw USDT', icon: ArrowUpRight },
    { id: 'history', label: 'Transaction History', icon: History },
    { id: 'addresses', label: `Saved Addresses (${whitelist.length})`, icon: ShieldCheck },
    { id: 'networks', label: 'Network Info & Guides', icon: Network },
  ];

  const networkWhitelist = whitelist.filter((w) => w.isActive && w.network === selectedNetwork);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-900">
            My Crypto Wallet (USDT)
          </h2>
          <p className="text-sm text-slate-600">
            Multi-chain USDT deposits, 2FA-protected withdrawals, escrow segregation, and immutable
            double-entry ledger tracking.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleConnectWeb3Wallet()}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer self-start"
        >
          <Wallet className="w-4 h-4" />
          {wallet?.connectedAddress ? 'Re-Verify Browser Wallet' : 'Connect Browser Wallet'}
        </button>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-1.5 bg-slate-100 p-1.5 rounded-xl">
        {subTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setSubView(t.id);
                setErrorMsg(null);
                setStatusMsg(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                subView === t.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Global Alerts */}
      {account?.withdrawalLocked && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-red-600 shrink-0" />
            <span>
              <strong>Withdrawals Locked:</strong>{' '}
              {account.restrictedReason || 'Security withdrawal freeze active.'}
            </span>
          </div>
          {onGoToSecurity && (
            <button
              type="button"
              onClick={onGoToSecurity}
              className="px-3 py-1.5 bg-white border border-red-200 rounded-lg font-semibold text-red-800 hover:bg-red-100 cursor-pointer shrink-0"
            >
              Security &amp; Alerts
            </button>
          )}
        </div>
      )}

      {statusMsg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
          {errorMsg}
        </div>
      )}

      {/* ================================================================ */}
      {/* 1. WALLET OVERVIEW */}
      {/* ================================================================ */}
      {subView === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500">
                Available USDT ({platformSettings.sandboxMode ? 'Sandbox' : 'Spot'})
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {formatUsdtFromMicro(avail, 2)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">Withdrawable &amp; sellable</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500">Reserved / Locked USDT</div>
              <div className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums">
                {formatUsdtFromMicro(reserved, 2)}
              </div>
              <div className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
                P2P Escrow: {formatUsdtFromMicro(reservationBreakdown.p2pEscrowMicro, 2)} · W/D:{' '}
                {formatUsdtFromMicro(reservationBreakdown.withdrawalPendingMicro, 2)}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500">Total Ledger Balance</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {formatUsdtFromMicro(avail + reserved, 2)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Pending: {walletStats.pendingDepositsCount} dep ·{' '}
                {walletStats.pendingWithdrawalsCount} w/d
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500">Cumulative Volume</div>
              <div className="mt-1 font-mono text-sm font-bold text-emerald-700 tabular-nums">
                +{formatUsdtFromMicro(walletStats.totalCreditedDepositsMicro, 2)} in
              </div>
              <div className="mt-0.5 font-mono text-sm font-bold text-slate-700 tabular-nums">
                -{formatUsdtFromMicro(walletStats.totalCompletedWithdrawalsMicro, 2)} out
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-slate-900">Quick Actions</div>
              <p className="text-slate-600">
                {wallet?.connectedAddress
                  ? `Connected Web3 Address: ${wallet.connectedAddress}`
                  : 'Deposit USDT on TRON, Ethereum, Polygon, or BSC or send verified withdrawals.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSubView('deposit')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <ArrowDownLeft className="w-3.5 h-3.5" />
                Deposit USDT
              </button>
              <button
                type="button"
                onClick={() => setSubView('withdraw')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                Withdraw USDT
              </button>
              <button
                type="button"
                onClick={() => setSubView('history')}
                className="px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Full Ledger History
              </button>
            </div>
          </div>

          {/* Recent Immutable Ledger Entries */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Recent Wallet Ledger Entries
              </h3>
              <button
                type="button"
                onClick={() => setSubView('history')}
                className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
              >
                View All
              </button>
            </div>
            {ledgerEntries.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No double-entry wallet ledger movements yet. Make a sandbox deposit or create a P2P
                escrow order to view balance snapshots.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2.5 px-4 font-medium">Entry</th>
                      <th className="py-2.5 px-4 font-medium">Network</th>
                      <th className="py-2.5 px-4 font-medium text-right">Available Delta</th>
                      <th className="py-2.5 px-4 font-medium text-right">Total After</th>
                      <th className="py-2.5 px-4 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledgerEntries.slice(0, 6).map((le) => (
                      <tr key={le.id}>
                        <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                          {le.entryType}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {effectiveNetworks[le.network]?.name || le.network}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                            le.deltaAvailableMicro >= 0 ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {le.deltaAvailableMicro >= 0 ? '+' : ''}
                          {formatUsdtFromMicro(le.deltaAvailableMicro, 2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800">
                          {formatUsdtFromMicro(le.balanceAfterMicro, 2)}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 max-w-xs truncate">
                          {le.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* 2. DEPOSIT USDT (RECEIVE) */}
      {/* ================================================================ */}
      {subView === 'deposit' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Deposit Address & QR */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Receive USDT Deposit Address
                </h3>
                <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-slate-100 text-slate-700">
                  {platformSettings.sandboxMode ? netCfg.testnetName : netCfg.name}
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  1. Select Deposit Network
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.values(effectiveNetworks) as BlockchainNetworkConfig[]).map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setSelectedNetwork(n.id)}
                      className={`p-2.5 rounded-lg border text-left text-xs cursor-pointer transition-colors ${
                        selectedNetwork === n.id
                          ? 'border-blue-600 bg-blue-50 text-blue-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="font-semibold">{n.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{n.tokenStandard}</div>
                    </button>
                  ))}
                </div>
              </div>

              {!netCfg.depositsEnabled && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
                  Deposits on {netCfg.name} are currently paused by Treasury Administration.
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="bg-white p-2 rounded-lg border border-slate-200 shrink-0">
                  {depositQrUrl ? (
                    <img
                      src={depositQrUrl}
                      alt={`${netCfg.name} USDT deposit QR`}
                      className="w-36 h-36"
                    />
                  ) : (
                    <div className="w-36 h-36 flex items-center justify-center text-slate-400">
                      <QrCode className="w-8 h-8" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-3 w-full">
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      Your CoinBridge {netCfg.name} ({netCfg.tokenStandard}) Deposit Address
                    </div>
                    <div className="mt-1 flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-2 font-mono text-xs text-slate-900">
                      <span className="truncate flex-1">{activeDepositAddress}</span>
                      <button
                        type="button"
                        onClick={() => void copyValue('depAddr', activeDepositAddress)}
                        className="text-blue-600 hover:text-blue-800 shrink-0 cursor-pointer"
                        title="Copy deposit address"
                      >
                        {copiedKey === 'depAddr' ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-500">Minimum Deposit:</span>
                      <div className="font-mono font-semibold text-slate-900">
                        {formatUsdtFromMicro(netCfg.minDepositUsdtMicro, 2)}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">Confirmations Required:</span>
                      <div className="font-mono font-semibold text-slate-900">
                        {netCfg.requiredConfirmations} blocks
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-600 space-y-1">
                    <div>
                      Token Contract ({platformSettings.sandboxMode ? 'Testnet' : 'Mainnet'}):{' '}
                      <span className="font-mono text-slate-900 break-all">
                        {platformSettings.sandboxMode
                          ? netCfg.testnetContractAddress
                          : netCfg.usdtContractAddress}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleGenerateDepositAddress()}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
                      >
                        Sync Address Record
                      </button>
                      {selectedNetwork === 'TRON_TRC20' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleScanTronDeposits()}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Scan TronGrid Nile Testnet
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Wrong-Network &amp; Security Policy Warning
                </div>
                <p>
                  Send only <strong>USDT ({netCfg.tokenStandard})</strong> matching the verified
                  contract address above on <strong>{netCfg.name}</strong>. Sending other tokens or
                  selecting the wrong blockchain may result in permanent loss. Screenshots alone are
                  never credited—deposits credit only after on-chain confirmation and duplicate-event
                  checks.
                </p>
              </div>

              {tronScanResult && (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">
                      TronGrid Nile Scan ({tronScanResult.isLive ? 'Live' : 'Fallback'})
                    </span>
                    <span className="font-mono text-slate-500">
                      Block #{tronScanResult.latestBlockNumber ?? 'N/A'}
                    </span>
                  </div>
                  <p className="text-slate-600">{tronScanResult.notice}</p>
                  {tronScanResult.matchedTransfers.length === 0 ? (
                    <div className="text-slate-500 italic">
                      No matching TRC-20 USDT transfers detected for {activeDepositAddress}.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tronScanResult.matchedTransfers.map((tr) => (
                        <div
                          key={tr.eventId}
                          className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-slate-200"
                        >
                          <div className="font-mono">
                            <div className="font-semibold text-slate-900">
                              +{formatUsdtFromMicro(tr.amountMicro, 2)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {tr.txHash.slice(0, 16)}... · {tr.confirmations} confs
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleClaimTronMatchedTransfer(tr)}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 cursor-pointer"
                          >
                            Record &amp; Credit
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Verify Tx Hash & Sandbox Faucet */}
            <div className="lg:col-span-5 space-y-5">
              <form
                onSubmit={handleVerifyDepositHash}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs"
              >
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Verify On-Chain Deposit Hash
                </h3>
                <p className="text-slate-600">
                  Already sent USDT from an external wallet or exchange? Submit the transaction hash
                  for idempotent verification ({netCfg.name}).
                </p>
                <input
                  type="text"
                  required
                  placeholder={
                    selectedNetwork === 'TRON_TRC20'
                      ? '64-char hex TRON txHash'
                      : '0x... 64-char EVM txHash'
                  }
                  value={verifyTxHash}
                  onChange={(e) => setVerifyTxHash(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Amount (USDT)</label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      required
                      value={verifyTxUsdt}
                      onChange={(e) => setVerifyTxUsdt(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Log Event Index</label>
                    <input
                      type="number"
                      min={0}
                      value={verifyEventIndex}
                      onChange={(e) => setVerifyEventIndex(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={busy || !netCfg.depositsEnabled}
                  className="w-full py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                >
                  Verify &amp; Record Deposit
                </button>
              </form>

              {platformSettings.sandboxMode && securityPolicy.sandboxFaucetEnabled && (
                <form
                  onSubmit={handleSandboxFaucetDeposit}
                  className="bg-amber-50/70 border border-amber-200 rounded-xl p-5 space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-amber-950">
                      Sandbox Testnet Faucet
                    </h3>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-200 text-amber-950 rounded">
                      TESTNET ONLY
                    </span>
                  </div>
                  <p className="text-amber-900">
                    Simulates a confirmed {netCfg.testnetName} USDT deposit with deterministic event
                    idempotency. Clearly marked sandbox funds—not real mainnet USDT.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={5}
                      max={25000}
                      step={5}
                      value={faucetUsdt}
                      onChange={(e) => setFaucetUsdt(e.target.value)}
                      className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-sm tabular-nums"
                    />
                    <button
                      type="submit"
                      disabled={busy || !netCfg.depositsEnabled}
                      className="px-4 py-2 text-xs font-semibold text-white bg-amber-700 rounded-lg hover:bg-amber-800 disabled:opacity-40 cursor-pointer"
                    >
                      Credit Testnet USDT
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Deposit History Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Your USDT Deposits ({deposits.length})
              </h3>
            </div>
            {deposits.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No USDT deposit records yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2.5 px-4 font-medium">Network</th>
                      <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                      <th className="py-2.5 px-4 font-medium">Confirmations</th>
                      <th className="py-2.5 px-4 font-medium">Tx Hash</th>
                      <th className="py-2.5 px-4 font-medium">Source</th>
                      <th className="py-2.5 px-4 font-medium">Status</th>
                      <th className="py-2.5 px-4 font-medium text-right">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {deposits.map((d) => {
                      const cfg = effectiveNetworks[d.network];
                      return (
                        <tr key={d.id}>
                          <td className="py-3 px-4 font-semibold text-slate-900">{cfg.name}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-700">
                            +{formatUsdtFromMicro(d.amountMicro, 2)}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-600">
                            {d.confirmations} / {d.requiredConfirmations}
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <a
                              href={`${cfg.explorerTxBaseUrl}${d.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                            >
                              {d.txHash.slice(0, 12)}...
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {d.verificationSource}
                            {d.isSandbox ? ' (SANDBOX)' : ''}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                            {d.status}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                downloadTransactionReceiptPdf({
                                  kind: 'DEPOSIT',
                                  transactionId: d.id,
                                  asset: 'USDT',
                                  cryptoAmount: formatUsdtFromMicro(d.amountMicro, 2),
                                  inrAmount: 'N/A (On-chain Deposit)',
                                  exchangeRate: 'Spot Index',
                                  feesSummary: '0.00 USDT (Deposit)',
                                  dateIso: d.createdAt?.toMillis
                                    ? new Date(d.createdAt.toMillis()).toISOString()
                                    : new Date().toISOString(),
                                  status: d.status,
                                  counterpartyOrAddress: d.depositAddress,
                                  network: cfg.name,
                                  blockchainTxHash: d.txHash,
                                  isSandbox: d.isSandbox,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-700 border border-blue-200 rounded hover:bg-blue-50 cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              PDF
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
        </div>
      )}

      {/* ================================================================ */}
      {/* 3. WITHDRAW USDT (SEND) */}
      {/* ================================================================ */}
      {subView === 'withdraw' && (
        <div className="space-y-6">
          {!isTradingEligible && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">
                    Verified KYC &amp; Active Account Required for External Withdrawals
                  </div>
                  <div className="mt-0.5 text-amber-900">{kycRestriction.reasonMessage}</div>
                </div>
              </div>
              {onGoToKyc && (
                <button
                  type="button"
                  onClick={onGoToKyc}
                  className="px-3.5 py-2 font-semibold text-white bg-amber-700 rounded-lg hover:bg-amber-800 cursor-pointer shrink-0 self-start"
                >
                  Complete KYC
                </button>
              )}
            </div>
          )}

          {securityPolicy.require2faForWithdrawals && !privateProfile?.twoFactorEnabled && (
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-blue-950">
              <div>
                <div className="font-semibold">2FA Authenticator Required</div>
                <div className="mt-0.5 text-blue-800">
                  Enable RFC 6238 Authenticator 2FA in Security &amp; Alerts before submitting
                  external USDT withdrawals.
                </div>
              </div>
              {onGoToSecurity && (
                <button
                  type="button"
                  onClick={onGoToSecurity}
                  className="px-3.5 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer shrink-0 self-start"
                >
                  Enable 2FA Now
                </button>
              )}
            </div>
          )}

          {/* Withdrawal Security Gate & Cooldown Status Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="text-slate-500">2FA Withdrawal Gate</div>
              <div
                className={`mt-1 font-mono font-bold ${
                  privateProfile?.twoFactorEnabled ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {privateProfile?.twoFactorEnabled ? 'TOTP ACTIVE' : '2FA REQUIRED'}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="text-slate-500">Address Whitelist Mode</div>
              <div className="mt-1 font-mono font-bold text-slate-900">
                {privateProfile?.whitelistOnlyWithdrawals ? 'STRICT WHITELIST' : 'STANDARD RISK CHECK'}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="text-slate-500">New-Address Cooldown</div>
              <div className="mt-1 font-mono font-bold text-slate-900 tabular-nums">
                {matchedWhitelistEntry &&
                toMillis(matchedWhitelistEntry.createdAt) > 0 &&
                Date.now() - toMillis(matchedWhitelistEntry.createdAt) <
                  securityPolicy.newAddressCooldownHours * 3_600_000
                  ? `${Math.max(
                      1,
                      Math.ceil(
                        (securityPolicy.newAddressCooldownHours * 3_600_000 -
                          (Date.now() - toMillis(matchedWhitelistEntry.createdAt))) /
                          3_600_000
                      )
                    )}h COOLDOWN LEFT`
                  : `${securityPolicy.newAddressCooldownHours}h POLICY CLEARED`}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between gap-2">
              <div>
                <div className="text-slate-500">Account Freeze</div>
                <div className="mt-1 font-mono font-bold text-slate-900">
                  {account?.withdrawalLocked ? 'FROZEN' : 'ACTIVE'}
                </div>
              </div>
              {onGoToSecurity && (
                <button
                  type="button"
                  onClick={onGoToSecurity}
                  className="px-2.5 py-1 text-[11px] font-semibold text-red-700 border border-red-200 rounded hover:bg-red-50 cursor-pointer shrink-0"
                >
                  Security Gate
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={requestWithdrawConfirmation}
              className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Send USDT to External Wallet / Exchange
                </h3>
                <span className="font-mono text-slate-500 tabular-nums">
                  Available: {formatUsdtFromMicro(avail, 2)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Network</label>
                  <select
                    value={selectedNetwork}
                    onChange={(e) => {
                      setSelectedNetwork(e.target.value as BlockchainNetworkId);
                      setServerPreview(null);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
                  >
                    {(Object.values(effectiveNetworks) as BlockchainNetworkConfig[]).map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} ({n.tokenStandard}){!n.withdrawalsEnabled ? ' — PAUSED' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Saved Whitelist Quick-Fill
                  </label>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        setWithdrawTo(e.target.value);
                        setServerPreview(null);
                      }
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-slate-50"
                  >
                    <option value="">
                      {networkWhitelist.length > 0
                        ? `Choose saved ${netCfg.name} address...`
                        : `No saved ${netCfg.name} addresses yet`}
                    </option>
                    {networkWhitelist.map((w) => (
                      <option key={w.id} value={w.address}>
                        {w.label} — {w.address}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Recipient {netCfg.name} ({netCfg.tokenStandard}) Address
                </label>
                <input
                  type="text"
                  required
                  placeholder={netCfg.addressFormatHint}
                  value={withdrawTo}
                  onChange={(e) => {
                    setWithdrawTo(e.target.value);
                    setServerPreview(null);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Format: {netCfg.addressFormatHint}. Never paste or share private keys or mnemonic
                  seed phrases.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between mb-1">
                    <label className="font-medium text-slate-700">Withdrawal Amount (USDT)</label>
                    <button
                      type="button"
                      onClick={() => {
                        const maxSendMicro = Math.max(
                          0,
                          avail -
                            netCfg.estimatedNetworkFeeUsdtMicro -
                            netCfg.platformWithdrawalFeeUsdtMicro
                        );
                        setWithdrawUsdt((maxSendMicro / MICRO_PER_USDT).toFixed(2));
                      }}
                      className="text-blue-600 font-semibold hover:underline cursor-pointer"
                    >
                      Max Available
                    </button>
                  </div>
                  <input
                    type="number"
                    min={netCfg.minWithdrawalUsdtMicro / MICRO_PER_USDT}
                    step="0.01"
                    required
                    value={withdrawUsdt}
                    onChange={(e) => {
                      setWithdrawUsdt(e.target.value);
                      setServerPreview(null);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-sm tabular-nums"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    6-Digit 2FA Authenticator Code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required={securityPolicy.require2faForWithdrawals}
                    placeholder="123456"
                    value={withdrawTotp}
                    onChange={(e) => setWithdrawTotp(e.target.value.replace(/\D/g, ''))}
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-sm tracking-widest"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runServerWithdrawalValidate()}
                  className="px-4 py-2.5 font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Run Risk &amp; Limit Pre-Check
                </button>
                <button
                  type="submit"
                  disabled={busy || Boolean(account?.withdrawalLocked) || !netCfg.withdrawalsEnabled}
                  className="flex-1 px-5 py-2.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 cursor-pointer"
                >
                  Review &amp; Submit Withdrawal
                </button>
              </div>
            </form>

            {/* Fee Breakdown & Security Policy Card */}
            <div className="lg:col-span-5 space-y-4 text-xs">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Transparent Fee &amp; Limit Breakdown
                </h3>
                <div className="space-y-2 font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-600 font-sans">Requested Transfer</span>
                    <span className="text-slate-900">
                      {formatUsdtFromMicro(withdrawBreakdown.requestedAmountMicro, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 font-sans">Network Fee ({netCfg.name})</span>
                    <span className="text-slate-700">
                      {formatUsdtFromMicro(withdrawBreakdown.networkFeeMicro, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600 font-sans">Platform Withdrawal Fee</span>
                    <span className="text-slate-700">
                      {formatUsdtFromMicro(withdrawBreakdown.platformFeeMicro, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-200 font-bold">
                    <span className="text-slate-900 font-sans">Total Reserved / Debited</span>
                    <span className="text-slate-900">
                      {formatUsdtFromMicro(withdrawBreakdown.totalDebitMicro, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-blue-700">
                    <span className="font-sans">Net Recipient Receives</span>
                    <span>{formatUsdtFromMicro(withdrawBreakdown.netReceivedMicro, 2)}</span>
                  </div>
                </div>

                {/* Daily limit progress */}
                <div className="pt-3 border-t border-slate-100 space-y-1.5">
                  <div className="flex justify-between text-[11px] text-slate-600">
                    <span>24h Withdrawal Limit Used</span>
                    <span className="font-mono tabular-nums">
                      {formatUsdtFromMicro(walletStats.dailyWithdrawnMicro, 0)} /{' '}
                      {formatUsdtFromMicro(effectiveDailyLimitMicro, 0)}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (walletStats.dailyWithdrawnMicro / Math.max(1, effectiveDailyLimitMicro)) *
                              100
                          )
                        )}%`,
                      }}
                      className="h-full bg-blue-600"
                    />
                  </div>
                </div>
              </div>

              {/* Risk Score Preview */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">
                    Automated Risk &amp; Cooldown Screening
                  </span>
                  <span className="font-mono font-bold text-slate-900">
                    {(serverPreview?.risk || localRiskPreview).score}/100 (
                    {(serverPreview?.risk || localRiskPreview).level})
                  </span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-slate-600">
                  {(serverPreview?.risk || localRiskPreview).reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {(serverPreview?.risk || localRiskPreview).requiresManualReview && (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
                    This request will enter <strong>UNDER_REVIEW</strong> for Treasury / Compliance
                    approval before on-chain broadcast.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Active & Recent Withdrawals */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Withdrawal Requests ({withdrawals.length})
              </h3>
            </div>
            {withdrawals.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No outbound USDT withdrawal requests yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2.5 px-4 font-medium">Network</th>
                      <th className="py-2.5 px-4 font-medium">Destination</th>
                      <th className="py-2.5 px-4 font-medium text-right">Net Sent</th>
                      <th className="py-2.5 px-4 font-medium text-right">Fees</th>
                      <th className="py-2.5 px-4 font-medium">Risk</th>
                      <th className="py-2.5 px-4 font-medium">Tx Hash</th>
                      <th className="py-2.5 px-4 font-medium">Status</th>
                      <th className="py-2.5 px-4 font-medium text-right">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {withdrawals.map((w) => {
                      const cfg = effectiveNetworks[w.network];
                      return (
                        <tr key={w.id}>
                          <td className="py-3 px-4 font-semibold text-slate-900">{cfg.name}</td>
                          <td className="py-3 px-4 font-mono text-slate-600">
                            {w.destinationAddress.slice(0, 12)}...{w.destinationAddress.slice(-6)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                            {formatUsdtFromMicro(w.netSentMicro, 2)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">
                            {formatUsdtFromMicro(w.networkFeeMicro + w.platformFeeMicro, 2)}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600">
                            {w.riskScore}/100 ({w.riskLevel})
                          </td>
                          <td className="py-3 px-4 font-mono">
                            {w.txHash ? (
                              <a
                                href={`${cfg.explorerTxBaseUrl}${w.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                              >
                                {w.txHash.slice(0, 10)}...
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              'Pending Broadcast'
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                            {w.status}
                            {w.isSandbox ? ' (SANDBOX)' : ''}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                downloadTransactionReceiptPdf({
                                  kind: 'WITHDRAWAL',
                                  transactionId: w.id,
                                  asset: 'USDT',
                                  cryptoAmount: formatUsdtFromMicro(w.netSentMicro, 2),
                                  inrAmount: 'N/A (External Withdrawal)',
                                  exchangeRate: 'Spot Index',
                                  feesSummary: formatUsdtFromMicro(
                                    w.networkFeeMicro + w.platformFeeMicro,
                                    2
                                  ),
                                  dateIso: w.createdAt?.toMillis
                                    ? new Date(w.createdAt.toMillis()).toISOString()
                                    : new Date().toISOString(),
                                  status: w.status,
                                  counterpartyOrAddress: w.destinationAddress,
                                  network: cfg.name,
                                  blockchainTxHash: w.txHash,
                                  isSandbox: w.isSandbox,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-700 border border-blue-200 rounded hover:bg-blue-50 cursor-pointer"
                            >
                              <Download className="w-3 h-3" />
                              PDF
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
        </div>
      )}

      {/* ================================================================ */}
      {/* 4. TRANSACTION HISTORY */}
      {/* ================================================================ */}
      {subView === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['ALL', 'All Activity'],
                ['DEPOSITS', `Deposits (${deposits.length})`],
                ['WITHDRAWALS', `Withdrawals (${withdrawals.length})`],
                ['ESCROW', 'P2P Escrow Events'],
                ['LEDGER', `Double-Entry Ledger (${ledgerEntries.length})`],
              ] as [HistoryFilter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setHistoryFilter(id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                  historyFilter === id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {(historyFilter === 'ALL' || historyFilter === 'LEDGER' || historyFilter === 'ESCROW') && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 font-display text-sm font-semibold text-slate-900">
                Immutable Wallet Ledger ({historyFilter === 'ESCROW' ? 'P2P Escrow Filter' : 'All Entries'})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2.5 px-4 font-medium">Entry Type</th>
                      <th className="py-2.5 px-4 font-medium">Network</th>
                      <th className="py-2.5 px-4 font-medium text-right">Available Δ</th>
                      <th className="py-2.5 px-4 font-medium text-right">Reserved Δ</th>
                      <th className="py-2.5 px-4 font-medium text-right">Before → After</th>
                      <th className="py-2.5 px-4 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledgerEntries
                      .filter((le) =>
                        historyFilter === 'ESCROW' ? le.entryType.startsWith('P2P_ESCROW') : true
                      )
                      .map((le) => (
                        <tr key={le.id}>
                          <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                            {le.entryType}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">{le.network}</td>
                          <td
                            className={`py-2.5 px-4 text-right font-mono tabular-nums ${
                              le.deltaAvailableMicro >= 0 ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {le.deltaAvailableMicro >= 0 ? '+' : ''}
                            {formatUsdtFromMicro(le.deltaAvailableMicro, 2)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-blue-700">
                            {le.deltaReservedMicro >= 0 ? '+' : ''}
                            {formatUsdtFromMicro(le.deltaReservedMicro, 2)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                            {formatUsdtFromMicro(le.balanceBeforeMicro, 2)} →{' '}
                            {formatUsdtFromMicro(le.balanceAfterMicro, 2)}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">{le.note}</td>
                        </tr>
                      ))}
                    {ledgerEntries.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-500">
                          No ledger entries recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(historyFilter === 'ALL' || historyFilter === 'DEPOSITS' || historyFilter === 'WITHDRAWALS') && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 font-display text-sm font-semibold text-slate-900">
                Blockchain Transfers &amp; Legacy Wallet Log
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2.5 px-4 font-medium">Direction / Type</th>
                      <th className="py-2.5 px-4 font-medium">Network</th>
                      <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                      <th className="py-2.5 px-4 font-medium">Tx Hash</th>
                      <th className="py-2.5 px-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {legacyTxs
                      .filter((t) => {
                        if (historyFilter === 'DEPOSITS') return t.type === 'DEPOSIT';
                        if (historyFilter === 'WITHDRAWALS') return t.type === 'WITHDRAWAL';
                        return true;
                      })
                      .map((t) => {
                        const cfg = effectiveNetworks[t.network];
                        return (
                          <tr key={t.id}>
                            <td className="py-2.5 px-4 font-semibold text-slate-900">{t.type}</td>
                            <td className="py-2.5 px-4 text-slate-600">{cfg.name}</td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900">
                              {formatUsdtFromMicro(t.amountMicro, 2)}
                            </td>
                            <td className="py-2.5 px-4 font-mono">
                              {t.txHash ? (
                                <a
                                  href={`${cfg.explorerTxBaseUrl}${t.txHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                                >
                                  {t.txHash.slice(0, 12)}...
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                'Internal'
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-slate-700">
                              {t.status} {t.isSandbox ? '(Sandbox)' : ''}
                            </td>
                          </tr>
                        );
                      })}
                    {legacyTxs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-500">
                          No wallet transfer records yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* 5. SAVED ADDRESSES (WITHDRAWAL WHITELIST) */}
      {/* ================================================================ */}
      {subView === 'addresses' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <div className="font-semibold text-slate-900">
                Withdrawal Whitelist Policy:{' '}
                <span
                  className={
                    privateProfile?.whitelistOnlyWithdrawals ? 'text-emerald-700' : 'text-slate-700'
                  }
                >
                  {privateProfile?.whitelistOnlyWithdrawals
                    ? 'STRICT WHITELIST-ONLY ENFORCED'
                    : 'OPTIONAL (Non-whitelisted addresses incur elevated risk score)'}
                </span>
              </div>
              <p className="text-slate-600 mt-0.5">
                Newly added addresses trigger a {securityPolicy.newAddressCooldownHours}-hour
                cooling-off period before instant withdrawal clearance.
              </p>
            </div>
            {onGoToSecurity && (
              <button
                type="button"
                onClick={onGoToSecurity}
                className="px-3.5 py-2 font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer shrink-0 self-start"
              >
                Configure Whitelist-Only Setting
              </button>
            )}
          </div>

          <form
            onSubmit={handleAddWhitelist}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs"
          >
            <h3 className="font-display text-base font-semibold text-slate-900">
              Add Trusted Withdrawal Address
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                minLength={2}
                placeholder="Label (e.g. Binance TRC20 Hot)"
                value={wlLabel}
                onChange={(e) => setWlLabel(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <select
                value={wlNetwork}
                onChange={(e) => setWlNetwork(e.target.value as BlockchainNetworkId)}
                className="rounded-lg border border-slate-300 px-3 py-2 bg-white"
              >
                {(Object.values(effectiveNetworks) as BlockchainNetworkConfig[]).map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.tokenStandard})
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                placeholder={effectiveNetworks[wlNetwork].addressFormatHint}
                value={wlAddress}
                onChange={(e) => setWlAddress(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Save Whitelist Address
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
            {whitelist.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                No saved withdrawal addresses yet.
              </div>
            ) : (
              whitelist.map((w) => {
                const ageMs = Date.now() - toMillis(w.createdAt);
                const cooldownMs = securityPolicy.newAddressCooldownHours * 3_600_000;
                const inCooldown = toMillis(w.createdAt) > 0 && ageMs < cooldownMs;
                const hoursLeft = Math.max(1, Math.ceil((cooldownMs - ageMs) / 3_600_000));
                return (
                  <div key={w.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-semibold text-slate-900 flex items-center gap-2">
                        <span>{w.label}</span>
                        <span className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 text-slate-700 rounded">
                          {effectiveNetworks[w.network]?.name || w.network}
                        </span>
                        {inCooldown ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono bg-amber-100 text-amber-800 rounded">
                            <Clock className="w-3 h-3" />
                            Cooldown ({hoursLeft}h left)
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono bg-emerald-50 text-emerald-700 rounded">
                            AGED &amp; READY
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-slate-600 break-all">{w.address}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedNetwork(w.network);
                          setWithdrawTo(w.address);
                          setSubView('withdraw');
                        }}
                        className="px-3 py-1.5 font-semibold text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 cursor-pointer"
                      >
                        Use for Withdrawal
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeWithdrawalWhitelistAddress(w.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                        title="Remove address"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* 6. NETWORK INFO & EXTERNAL EXCHANGE GUIDES */}
      {/* ================================================================ */}
      {subView === 'networks' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-600" />
              <h3 className="font-display text-base font-semibold text-slate-900">
                Supported USDT Networks, Fees &amp; Thresholds
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-4 font-medium">Network</th>
                    <th className="py-2.5 px-4 font-medium">Confirmations</th>
                    <th className="py-2.5 px-4 font-medium">Min Deposit</th>
                    <th className="py-2.5 px-4 font-medium">Min / Max W/D</th>
                    <th className="py-2.5 px-4 font-medium">Net + Platform Fee</th>
                    <th className="py-2.5 px-4 font-medium">USDT Contract</th>
                    <th className="py-2.5 px-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(Object.values(effectiveNetworks) as BlockchainNetworkConfig[]).map((n) => (
                    <tr key={n.id}>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {n.name} ({n.tokenStandard})
                      </td>
                      <td className="py-3 px-4 font-mono">{n.requiredConfirmations}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">
                        {formatUsdtFromMicro(n.minDepositUsdtMicro, 2)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums">
                        {formatUsdtFromMicro(n.minWithdrawalUsdtMicro, 0)} /{' '}
                        {formatUsdtFromMicro(n.maxWithdrawalUsdtMicro, 0)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums">
                        {formatUsdtFromMicro(n.estimatedNetworkFeeUsdtMicro, 2)} +{' '}
                        {formatUsdtFromMicro(n.platformWithdrawalFeeUsdtMicro, 2)}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                        {(platformSettings.sandboxMode
                          ? n.testnetContractAddress
                          : n.usdtContractAddress
                        ).slice(0, 14)}
                        ...
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px]">
                        Dep: {n.depositsEnabled ? 'ON' : 'PAUSED'} · W/D:{' '}
                        {n.withdrawalsEnabled ? 'ON' : 'PAUSED'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* External Exchange Compatibility Guide */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" />
              <h3 className="font-display text-base font-semibold text-slate-900">
                External Exchange Compatibility Guide (Instructional Examples Only)
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              {EXTERNAL_EXCHANGE_GUIDES.map((g) => (
                <div
                  key={g.exchangeName}
                  className="border border-slate-200 rounded-xl p-4 space-y-2.5 bg-slate-50/50"
                >
                  <div className="font-semibold text-slate-900">{g.exchangeName}</div>
                  <div className="text-[11px] font-mono text-blue-700">
                    Chains: {g.recommendedNetworks.join(', ')} · Memo:{' '}
                    {g.memoRequired ? 'Required' : 'Not Required'}
                  </div>
                  <ol className="list-decimal pl-4 space-y-1 text-slate-600">
                    {g.exampleSteps.map((st) => (
                      <li key={st}>{st}</li>
                    ))}
                  </ol>
                  <p className="text-[11px] text-amber-800 pt-1 border-t border-slate-200">
                    {g.disclaimer}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* TronGrid Read-Only Testnet Monitor */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  TronGrid Read-Only Testnet Monitor
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  {tronStatus
                    ? `${tronStatus.networkLabel} · Block ${
                        tronStatus.latestBlockNumber !== null
                          ? `#${tronStatus.latestBlockNumber.toLocaleString()}`
                          : 'Unavailable'
                      } · ${tronStatus.isLive ? 'Live (TronGrid API)' : 'Fallback Monitor'}`
                    : 'Connecting to TronGrid testnet read endpoint...'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadTronStatus()}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer self-start"
              >
                Refresh Block Height
              </button>
            </div>

            {tronStatus && (
              <div className="text-xs text-slate-500">
                {tronStatus.notice} Monitored USDT Contract:{' '}
                <span className="font-mono text-slate-800">{tronStatus.usdtContract}</span>
              </div>
            )}

            <form onSubmit={handleTronAccountLookup} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                required
                placeholder="Enter TRON Base58 address (starts with T...)"
                value={tronLookupAddr}
                onChange={(e) => setTronLookupAddr(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-mono"
              />
              <button
                type="submit"
                disabled={tronLookupLoading}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {tronLookupLoading ? 'Reading TronGrid...' : 'Inspect Testnet Address'}
              </button>
            </form>

            {tronAccountData && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900">
                    {tronAccountData.address}
                  </span>
                  <span
                    className={
                      tronAccountData.isLive
                        ? 'font-semibold text-emerald-700'
                        : 'font-semibold text-amber-700'
                    }
                  >
                    {tronAccountData.isLive ? 'Live TronGrid Read' : 'Fallback Demo Data'}
                    {tronAccountData.cached ? ' · Cached' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
                  <div>
                    <span className="text-slate-500">TRX Balance:</span>{' '}
                    <strong className="text-slate-900">{tronAccountData.trxBalance} TRX</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Testnet USDT:</span>{' '}
                    <strong className="text-slate-900">
                      {tronAccountData.usdtTestnetBalance} USDT
                    </strong>
                  </div>
                </div>
                {tronAccountData.recentTrc20.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 space-y-1">
                    <div className="font-medium text-slate-700">Recent TRC-20 Transfers</div>
                    {tronAccountData.recentTrc20.map((t) => (
                      <div key={t.txId} className="flex justify-between font-mono text-slate-600">
                        <span>{t.txId.slice(0, 14)}...</span>
                        <span className="tabular-nums">
                          {t.amount} {t.symbol}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={withdrawConfirmOpen}
        title="Confirm External USDT Withdrawal"
        description={`Withdraw ${withdrawUsdt} USDT via ${netCfg.name} (${netCfg.tokenStandard}) to ${withdrawTo.trim()}. Total debited including fees: ${formatUsdtFromMicro(withdrawBreakdown.totalDebitMicro, 2)}.`}
        confirmLabel="Confirm & Reserve Funds"
        tone="primary"
        busy={busy}
        onConfirm={handleConfirmWithdraw}
        onCancel={() => setWithdrawConfirmOpen(false)}
      />

      <KycRestrictionModal
        open={kycModalOpen}
        kycStatus={kycRestriction.effectiveKycStatus}
        reasonCode={kycRestriction.reasonCode}
        reasonMessage={kycRestriction.reasonMessage}
        onClose={() => setKycModalOpen(false)}
        onCompleteKyc={() => {
          setKycModalOpen(false);
          onGoToKyc?.();
        }}
        onViewStatus={() => {
          setKycModalOpen(false);
          onGoToKyc?.();
        }}
      />
    </div>
  );
}
