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
import {
  Activity,
  AlertTriangle,
  FileCheck2,
  Radar,
  Search,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react';
import { db } from '../../lib/firebase';
import {
  BLOCKCHAIN_NETWORKS,
  BlockchainNetworkId,
  formatUsdtFromMicro,
  getKycExpiryStatus,
  KycStatus,
  MICRO_PER_USDT,
  PAYMENT_METHOD_LABELS,
  RiskLevel,
} from '../../lib/domain';
import {
  createComplianceCaseAdmin,
  reviewKycAdmin,
  toggleUserWithdrawalLock,
  updateComplianceCaseAdmin,
  verifyPaymentAccountAdmin,
} from '../../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { useAuth } from '../../context/AuthContext';
import {
  ComplianceCaseDoc,
  DisputeCaseDoc,
  KycSubmissionDoc,
  MerchantProfileDoc,
  PaymentAccountDoc,
  RiskAssessmentDoc,
  SecuritySessionDoc,
  UserAccountDoc,
  WithdrawalTransactionDoc,
} from '../../types/models';
import { ConfirmDialog } from '../ConfirmDialog';

type ComplianceSection =
  | 'video_kyc'
  | 'aml_risk'
  | 'fraud_intel'
  | 'sessions'
  | 'payment_rails'
  | 'cases';

interface WalletScreenResult {
  address: string;
  network: BlockchainNetworkId;
  validFormat: boolean;
  riskScore: number;
  riskLevel: RiskLevel;
  recommendation: 'ALLOW' | 'ENHANCED_REVIEW' | 'BLOCK';
  flags: string[];
  screenedAt: string;
}

export function CompliancePanel() {
  const { user, isComplianceOfficer, getIdToken } = useAuth();
  const [section, setSection] = useState<ComplianceSection>('video_kyc');

  const [kycs, setKycs] = useState<KycSubmissionDoc[]>([]);
  const [risks, setRisks] = useState<RiskAssessmentDoc[]>([]);
  const [sessions, setSessions] = useState<SecuritySessionDoc[]>([]);
  const [payAccounts, setPayAccounts] = useState<PaymentAccountDoc[]>([]);
  const [cases, setCases] = useState<ComplianceCaseDoc[]>([]);
  const [users, setUsers] = useState<UserAccountDoc[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalTransactionDoc[]>([]);
  const [merchants, setMerchants] = useState<MerchantProfileDoc[]>([]);
  const [disputes, setDisputes] = useState<DisputeCaseDoc[]>([]);

  const [kycNotes, setKycNotes] = useState<Record<string, string>>({});
  const [caseNotes, setCaseNotes] = useState<Record<string, string>>({});

  // Wallet Screening state
  const [screenAddress, setScreenAddress] = useState('');
  const [screenNetwork, setScreenNetwork] = useState<BlockchainNetworkId>('TRON_TRC20');
  const [screenAmountUsdt, setScreenAmountUsdt] = useState('');
  const [screenVelocity24h, setScreenVelocity24h] = useState('');
  const [screenLoading, setScreenLoading] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [screenResult, setScreenResult] = useState<WalletScreenResult | null>(null);

  // New Case form
  const [newCaseUid, setNewCaseUid] = useState('');
  const [newCaseType, setNewCaseType] =
    useState<ComplianceCaseDoc['caseType']>('VIDEO_KYC_ESCALATION');
  const [newCaseSeverity, setNewCaseSeverity] = useState<RiskLevel>('MEDIUM');
  const [newCaseSummary, setNewCaseSummary] = useState('');

  const [pendingLockTarget, setPendingLockTarget] = useState<{
    uid: string;
    username: string;
    nextLocked: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!isComplianceOfficer) return;
    const unsubs = [
      onSnapshot(
        query(collection(db, 'kyc_submissions'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setKycs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<KycSubmissionDoc, 'id'>) }))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'kyc_submissions')
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
        query(collection(db, 'security_sessions'), orderBy('lastActiveAt', 'desc'), limit(80)),
        (s) =>
          setSessions(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SecuritySessionDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'security_sessions')
      ),
      onSnapshot(
        query(collection(db, 'payment_accounts'), limit(100)),
        (s) =>
          setPayAccounts(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PaymentAccountDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'payment_accounts')
      ),
      onSnapshot(
        query(collection(db, 'compliance_cases'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setCases(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ComplianceCaseDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'compliance_cases')
      ),
      onSnapshot(
        query(collection(db, 'users'), limit(100)),
        (s) => setUsers(s.docs.map((d) => d.data() as UserAccountDoc)),
        (e) => handleFirestoreError(e, OperationType.LIST, 'users')
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
        query(collection(db, 'merchants'), limit(100)),
        (s) =>
          setMerchants(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MerchantProfileDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'merchants')
      ),
      onSnapshot(
        query(collection(db, 'disputes'), orderBy('createdAt', 'desc'), limit(100)),
        (s) =>
          setDisputes(
            s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DisputeCaseDoc, 'id'>) }))
          ),
        (e) => handleFirestoreError(e, OperationType.LIST, 'disputes')
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [isComplianceOfficer]);

  // Deterministic Fraud & Anomaly Clustering
  const fraudSignals = useMemo(() => {
    const userByUid = new Map<string, UserAccountDoc>(users.map((u) => [u.uid, u]));

    // 1. Duplicate Identity / Bank / UPI Clusters across distinct UIDs
    const idClusters = new Map<string, Set<string>>();
    const bankClusters = new Map<string, Set<string>>();
    for (const k of kycs) {
      const maskedId = (k.maskedIdNumber || '').trim();
      if (maskedId && maskedId.length >= 4 && k.uid) {
        const key = `${k.idType}:${maskedId}`;
        if (!idClusters.has(key)) idClusters.set(key, new Set());
        idClusters.get(key)!.add(k.uid);
      }
      const bankLast4 = (k.bankAccountLast4 || '').trim();
      const ifsc = (k.bankIfsc || '').trim().toUpperCase();
      if (bankLast4 && ifsc && k.uid) {
        const key = `${bankLast4}_${ifsc}`;
        if (!bankClusters.has(key)) bankClusters.set(key, new Set());
        bankClusters.get(key)!.add(k.uid);
      }
    }

    const upiClusters = new Map<string, Set<string>>();
    for (const pa of payAccounts) {
      const upi = (pa.upiId || '').trim().toLowerCase();
      if (upi && pa.uid) {
        if (!upiClusters.has(upi)) upiClusters.set(upi, new Set());
        upiClusters.get(upi)!.add(pa.uid);
      }
      const acctMask = (pa.maskedAccountNumber || '').trim();
      const ifsc = (pa.ifsc || '').trim().toUpperCase();
      if (acctMask && ifsc && pa.uid) {
        const key = `${acctMask}_${ifsc}`;
        if (!bankClusters.has(key)) bankClusters.set(key, new Set());
        bankClusters.get(key)!.add(pa.uid);
      }
    }

    const duplicateClusters: {
      clusterType: 'SHARED_ID_DOC' | 'SHARED_BANK_RAIL' | 'SHARED_UPI';
      identifier: string;
      uids: string[];
      usernames: string[];
    }[] = [];

    for (const [identifier, set] of idClusters.entries()) {
      if (set.size >= 2) {
        const uids = Array.from(set);
        duplicateClusters.push({
          clusterType: 'SHARED_ID_DOC',
          identifier,
          uids,
          usernames: uids.map((id) => userByUid.get(id)?.username || id.slice(0, 8)),
        });
      }
    }
    for (const [identifier, set] of bankClusters.entries()) {
      if (set.size >= 2) {
        const uids = Array.from(set);
        duplicateClusters.push({
          clusterType: 'SHARED_BANK_RAIL',
          identifier,
          uids,
          usernames: uids.map((id) => userByUid.get(id)?.username || id.slice(0, 8)),
        });
      }
    }
    for (const [identifier, set] of upiClusters.entries()) {
      if (set.size >= 2) {
        const uids = Array.from(set);
        duplicateClusters.push({
          clusterType: 'SHARED_UPI',
          identifier,
          uids,
          usernames: uids.map((id) => userByUid.get(id)?.username || id.slice(0, 8)),
        });
      }
    }

    // 2. Unusual Withdrawal Velocity & Risk Score Signals
    const wdByUid = new Map<
      string,
      {
        uid: string;
        username: string;
        count: number;
        totalMicro: number;
        maxRiskScore: number;
        flags: string[];
      }
    >();
    for (const w of withdrawals) {
      const entry = wdByUid.get(w.uid) || {
        uid: w.uid,
        username: w.username || userByUid.get(w.uid)?.username || w.uid.slice(0, 8),
        count: 0,
        totalMicro: 0,
        maxRiskScore: 0,
        flags: [],
      };
      entry.count += 1;
      entry.totalMicro += w.requestedAmountMicro || 0;
      if (w.riskScore > entry.maxRiskScore) {
        entry.maxRiskScore = w.riskScore;
        entry.flags = w.riskReasons || [];
      }
      wdByUid.set(w.uid, entry);
    }

    const withdrawalAnomalies = Array.from(wdByUid.values())
      .filter(
        (x) =>
          x.count >= 3 ||
          x.totalMicro >= 5_000 * MICRO_PER_USDT ||
          x.maxRiskScore >= 60
      )
      .sort((a, b) => b.maxRiskScore - a.maxRiskScore || b.totalMicro - a.totalMicro);

    // 3. Merchant Behavioral Anomalies
    const merchantAnomalies = merchants
      .map((m) => {
        const total = Math.max(1, m.completedOrders + (m.disputedOrders || 0));
        const disputeRatePct = Number((((m.disputedOrders || 0) / total) * 100).toFixed(1));
        const reasons: string[] = [];
        if ((m.disputedOrders || 0) >= 2) {
          reasons.push(`${m.disputedOrders} disputed orders`);
        }
        if (disputeRatePct >= 10 && (m.disputedOrders || 0) >= 1) {
          reasons.push(`Elevated ${disputeRatePct}% dispute rate`);
        }
        if (m.verificationLevel === 'SUSPENDED') {
          reasons.push('Desk currently SUSPENDED');
        }
        if (!m.isDemo && !m.isAvailable && m.completedOrders >= 5) {
          reasons.push('Verified active desk went offline');
        }
        return { merchant: m, disputeRatePct, reasons };
      })
      .filter((x) => x.reasons.length > 0);

    const openEscalatedDisputes = disputes.filter(
      (d) => d.escalatedToCompliance || d.status === 'ESCALATED'
    ).length;

    return {
      duplicateClusters,
      withdrawalAnomalies,
      merchantAnomalies,
      openEscalatedDisputes,
      totalSignals:
        duplicateClusters.length + withdrawalAnomalies.length + merchantAnomalies.length,
    };
  }, [kycs, payAccounts, users, withdrawals, merchants, disputes]);

  if (!isComplianceOfficer || !user) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-sm text-red-700 dark:text-red-400">
        Compliance Officer or Administrator privileges required.
      </div>
    );
  }

  const pendingKycCount = kycs.filter((k) => k.status === 'PENDING').length;
  const suspiciousLoginCount = sessions.filter((s) => s.suspicious).length;
  const pendingPayCount = payAccounts.filter((p) => p.verificationStatus === 'PENDING').length;
  const openCasesCount = cases.filter((c) => c.status !== 'CLOSED').length;

  const handleConfirmWithdrawalLock = async () => {
    if (!pendingLockTarget) return;
    setBusy(true);
    try {
      await toggleUserWithdrawalLock({
        uid: pendingLockTarget.uid,
        locked: pendingLockTarget.nextLocked,
        reason: pendingLockTarget.nextLocked
          ? 'Compliance Officer preventive withdrawal freeze'
          : 'Cleared by Compliance Officer',
        actorUid: user.uid,
      });
      setFeedback(
        `Updated withdrawal lock=${pendingLockTarget.nextLocked} for @${pendingLockTarget.username}.`
      );
      setPendingLockTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetUser = users.find((u) => u.uid === newCaseUid) || users[0];
    if (!targetUser || newCaseSummary.trim().length < 5) return;
    setBusy(true);
    try {
      await createComplianceCaseAdmin({
        subjectUid: targetUser.uid,
        subjectUsername: targetUser.username,
        caseType: newCaseType,
        severity: newCaseSeverity,
        summary: newCaseSummary,
        adminUid: user.uid,
      });
      setNewCaseSummary('');
      setFeedback(`Compliance case created for @${targetUser.username}.`);
    } finally {
      setBusy(false);
    }
  };

  const handleScreenWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!screenAddress.trim()) return;
    setScreenLoading(true);
    setScreenError(null);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/fraud/screen-wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          address: screenAddress.trim(),
          network: screenNetwork,
          amountUsdt: screenAmountUsdt ? Number(screenAmountUsdt) : undefined,
          recentWithdrawals24h: screenVelocity24h ? Number(screenVelocity24h) : undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Wallet screening failed.');
      }
      setScreenResult(data as WalletScreenResult);
    } catch (err) {
      setScreenError(err instanceof Error ? err.message : 'Unable to screen wallet address.');
    } finally {
      setScreenLoading(false);
    }
  };

  const handleQuickCase = async (params: {
    subjectUid: string;
    subjectUsername: string;
    caseType: ComplianceCaseDoc['caseType'];
    severity: RiskLevel;
    summary: string;
  }) => {
    setBusy(true);
    try {
      await createComplianceCaseAdmin({
        ...params,
        adminUid: user.uid,
      });
      setFeedback(`Opened ${params.caseType} case for @${params.subjectUsername}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          Compliance Officer &amp; AML Fraud Desk
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manual Video KYC review, duplicate cluster &amp; velocity fraud detection, on-chain
          wallet address screening, suspicious device monitoring, and payment rail verification.
        </p>
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200">
          {feedback}
        </div>
      )}

      {/* Compliance KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Pending Video KYC</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {pendingKycCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Fraud &amp; Anomaly Signals</div>
          <div className="mt-1 font-mono text-xl font-bold text-red-700 dark:text-red-400 tabular-nums">
            {fraudSignals.totalSignals}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Suspicious Sign-Ins</div>
          <div className="mt-1 font-mono text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">
            {suspiciousLoginCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Pending Payment Rails</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {pendingPayCount}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Open Cases ({fraudSignals.openEscalatedDisputes} disp.)
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {openCasesCount}
          </div>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-xl">
        {(
          [
            ['video_kyc', `Video KYC (${kycs.length})`],
            ['fraud_intel', `Fraud & Wallet Intel (${fraudSignals.totalSignals})`],
            ['aml_risk', `AML Triage (${risks.length})`],
            ['sessions', `Login Anomalies (${suspiciousLoginCount})`],
            ['payment_rails', `Payment Rails (${payAccounts.length})`],
            ['cases', `Compliance Cases (${cases.length})`],
          ] as [ComplianceSection, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
              section === id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'fraud_intel' && (
        <div className="space-y-6">
          {/* Wallet Address Risk Screener */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <Radar className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Wallet Address Risk &amp; Sanctions Screener
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Run server-side format checksum, OFAC/illicit pattern watch, zero-entropy sink,
                  travel-rule threshold, and 24h outbound velocity checks before approving
                  withdrawals.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleScreenWallet}
              className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs"
            >
              <div className="md:col-span-5">
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Destination Wallet Address
                </label>
                <input
                  type="text"
                  required
                  placeholder="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t or 0x..."
                  value={screenAddress}
                  onChange={(e) => setScreenAddress(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Network
                </label>
                <select
                  value={screenNetwork}
                  onChange={(e) => setScreenNetwork(e.target.value as BlockchainNetworkId)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  {Object.values(BLOCKCHAIN_NETWORKS).map((net) => (
                    <option key={net.id} value={net.id}>
                      {net.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Amount (USDT)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 12000"
                  value={screenAmountUsdt}
                  onChange={(e) => setScreenAmountUsdt(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                />
              </div>
              <div className="md:col-span-2 flex flex-col justify-end">
                <button
                  type="submit"
                  disabled={screenLoading}
                  className="inline-flex items-center justify-center gap-1.5 w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5" />
                  {screenLoading ? 'Screening...' : 'Screen Address'}
                </button>
              </div>
              <div className="md:col-span-4">
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  24h Outbound Withdrawals (Optional Velocity Input)
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 4"
                  value={screenVelocity24h}
                  onChange={(e) => setScreenVelocity24h(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                />
              </div>
            </form>

            {screenError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300">
                {screenError}
              </div>
            )}

            {screenResult && (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                    Risk Score: <span className="tabular-nums">{screenResult.riskScore}/100</span> (
                    {screenResult.riskLevel}) · Format:{' '}
                    {screenResult.validFormat ? 'VALID' : 'INVALID'}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-sm font-mono font-bold ${
                      screenResult.recommendation === 'BLOCK'
                        ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                        : screenResult.recommendation === 'ENHANCED_REVIEW'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                          : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                    }`}
                  >
                    {screenResult.recommendation}
                  </span>
                </div>
                <ul className="list-disc pl-5 text-slate-700 dark:text-slate-300 space-y-0.5">
                  {screenResult.flags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 3-Column Fraud Telemetry Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Duplicate Account Clusters */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Users className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span>
                    Duplicate Identity / Bank / UPI Clusters ({fraudSignals.duplicateClusters.length})
                  </span>
                </div>
              </div>
              {fraudSignals.duplicateClusters.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400">
                  No shared PAN/ID documents, bank accounts, or UPI handles detected across multiple
                  accounts.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {fraudSignals.duplicateClusters.map((c) => {
                    const primaryUid = c.uids[0];
                    const primaryUser = users.find((u) => u.uid === primaryUid);
                    return (
                      <div
                        key={`${c.clusterType}_${c.identifier}`}
                        className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 space-y-2"
                      >
                        <div className="flex flex-wrap justify-between gap-2 font-mono">
                          <span className="font-bold text-amber-900 dark:text-amber-300">
                            {c.clusterType} · {c.identifier}
                          </span>
                          <span className="text-slate-700 dark:text-slate-300 tabular-nums">
                            {c.uids.length} linked accounts
                          </span>
                        </div>
                        <div className="text-slate-700 dark:text-slate-300 font-mono">
                          Accounts: {c.usernames.map((n) => `@${n}`).join(', ')}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleQuickCase({
                                subjectUid: primaryUid,
                                subjectUsername: c.usernames[0],
                                caseType: 'FRAUD_CLUSTER',
                                severity: 'HIGH',
                                summary: `Detected ${c.clusterType} overlap (${c.identifier}) across ${c.uids.length} accounts: ${c.usernames.join(', ')}`,
                              })
                            }
                            className="px-2.5 py-1 rounded bg-slate-900 dark:bg-blue-600 text-white font-semibold hover:bg-slate-800 cursor-pointer"
                          >
                            Open FRAUD_CLUSTER Case
                          </button>
                          {primaryUser && (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingLockTarget({
                                  uid: primaryUser.uid,
                                  username: primaryUser.username,
                                  nextLocked: !primaryUser.withdrawalLocked,
                                })
                              }
                              className="px-2.5 py-1 rounded border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                            >
                              {primaryUser.withdrawalLocked ? 'Unlock W/D' : 'Lock Withdrawals'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Unusual Withdrawal Velocity */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
              <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Activity className="w-4 h-4 text-red-600 dark:text-red-400" />
                <span>
                  Unusual Withdrawal Velocity &amp; Risk Flags (
                  {fraudSignals.withdrawalAnomalies.length})
                </span>
              </div>
              {fraudSignals.withdrawalAnomalies.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400">
                  No accounts currently exceed withdrawal velocity (&ge;3 requests), high-volume
                  (&ge;5,000 USDT), or high-risk score (&ge;60) thresholds.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {fraudSignals.withdrawalAnomalies.map((w) => {
                    const acct = users.find((u) => u.uid === w.uid);
                    return (
                      <div
                        key={w.uid}
                        className="p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 space-y-2"
                      >
                        <div className="flex flex-wrap justify-between gap-2 font-mono">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            @{w.username}
                          </span>
                          <span className="font-bold text-red-700 dark:text-red-400 tabular-nums">
                            {w.count} w/d · {formatUsdtFromMicro(w.totalMicro, 2)} · Max Risk{' '}
                            {w.maxRiskScore}/100
                          </span>
                        </div>
                        {w.flags.length > 0 && (
                          <div className="text-slate-600 dark:text-slate-400">
                            {w.flags.slice(0, 2).join(' · ')}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleQuickCase({
                                subjectUid: w.uid,
                                subjectUsername: w.username,
                                caseType: 'AML_ALERT',
                                severity: w.maxRiskScore >= 80 ? 'CRITICAL' : 'HIGH',
                                summary: `Withdrawal anomaly: ${w.count} requests totaling ${formatUsdtFromMicro(w.totalMicro, 2)} (max risk ${w.maxRiskScore}/100).`,
                              })
                            }
                            className="px-2.5 py-1 rounded bg-slate-900 dark:bg-blue-600 text-white font-semibold hover:bg-slate-800 cursor-pointer"
                          >
                            Open AML Case
                          </button>
                          {acct && (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingLockTarget({
                                  uid: acct.uid,
                                  username: acct.username,
                                  nextLocked: !acct.withdrawalLocked,
                                })
                              }
                              className="px-2.5 py-1 rounded border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                            >
                              {acct.withdrawalLocked ? 'Unlock W/D' : 'Lock Withdrawals'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Merchant Behavioral Anomalies */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
            <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>
                Merchant Desk Behavioral Anomalies ({fraudSignals.merchantAnomalies.length})
              </span>
            </div>
            {fraudSignals.merchantAnomalies.length === 0 ? (
              <p className="text-slate-500 dark:text-slate-400">
                All active merchant desks are operating within normal dispute and availability
                thresholds.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {fraudSignals.merchantAnomalies.map(({ merchant, disputeRatePct, reasons }) => {
                  const acct = users.find((u) => u.uid === merchant.uid);
                  return (
                    <div
                      key={merchant.id}
                      className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {merchant.businessName} ({merchant.isDemo ? 'DEMO' : 'KYB DESK'})
                        </span>
                        <span className="font-mono text-amber-700 dark:text-amber-400 tabular-nums">
                          Dispute {disputeRatePct}% ({merchant.disputedOrders || 0}/
                          {merchant.completedOrders})
                        </span>
                      </div>
                      <div className="text-slate-600 dark:text-slate-400">
                        Signals: {reasons.join(' · ')}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void handleQuickCase({
                              subjectUid: merchant.uid,
                              subjectUsername: merchant.businessName,
                              caseType: 'MERCHANT_ANOMALY',
                              severity: disputeRatePct >= 15 ? 'HIGH' : 'MEDIUM',
                              summary: `Merchant desk anomaly (${merchant.businessName}): ${reasons.join('; ')}`,
                            })
                          }
                          className="px-2.5 py-1 rounded bg-slate-900 dark:bg-blue-600 text-white font-semibold hover:bg-slate-800 cursor-pointer"
                        >
                          Open MERCHANT_ANOMALY Case
                        </button>
                        {acct && (
                          <button
                            type="button"
                            onClick={() =>
                              setPendingLockTarget({
                                uid: acct.uid,
                                username: acct.username,
                                nextLocked: !acct.withdrawalLocked,
                              })
                            }
                            className="px-2.5 py-1 rounded border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                          >
                            {acct.withdrawalLocked ? 'Unlock W/D' : 'Lock Withdrawals'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {section === 'video_kyc' && (
        <div className="space-y-4">
          {kycs.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-sm text-slate-500 dark:text-slate-400">
              No Video KYC dossiers submitted yet.
            </div>
          ) : (
            kycs.map((k) => {
              const expiry = getKycExpiryStatus({
                documentExpiry: k.documentExpiry,
                kycExpiresAtMs: k.kycExpiresAtMs,
              });
              const ownerUser = users.find((u) => u.uid === k.uid);
              return (
                <div
                  key={k.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
                      <FileCheck2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>
                        {k.fullLegalName} · {k.idType} ({k.maskedIdNumber})
                      </span>
                    </div>
                    <div className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                      {k.status} · {k.videoStatus || 'LEGACY'}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg p-3 font-mono tabular-nums">
                    <div>Liveness: {k.livenessScore ?? '—'}%</div>
                    <div>Face Match: {k.faceMatchScore ?? '—'}%</div>
                    <div>
                      Expiry: {expiry.status} ({expiry.daysRemaining ?? '—'}d)
                    </div>
                    <div>
                      Bank: •••• {k.bankAccountLast4} · {k.bankIfsc}
                    </div>
                    <div>PEP: {k.pepDeclared ? 'Yes' : 'No'}</div>
                    <div>Adapter: {k.providerMode || k.livenessMethod}</div>
                  </div>

                  {k.videoChallengePrompt && (
                    <div className="text-slate-600 dark:text-slate-400">
                      <strong>Challenge Issued:</strong> {k.videoChallengePrompt}
                    </div>
                  )}

                  {k.verificationHistory && k.verificationHistory.length > 0 && (
                    <div className="text-slate-500 dark:text-slate-400 space-y-0.5">
                      <div className="font-semibold text-slate-700 dark:text-slate-300">
                        Verification History
                      </div>
                      {k.verificationHistory.slice(-3).map((entry) => (
                        <div key={entry} className="font-mono">
                          • {entry}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <input
                      type="text"
                      placeholder="Compliance officer review note"
                      value={kycNotes[k.id] || ''}
                      onChange={(e) => setKycNotes((p) => ({ ...p, [k.id]: e.target.value }))}
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs"
                    />
                    {(
                      ['APPROVED', 'ADDITIONAL_INFO_REQUIRED', 'REJECTED', 'EXPIRED'] as KycStatus[]
                    ).map((decision) => (
                      <button
                        key={decision}
                        type="button"
                        onClick={() =>
                          void reviewKycAdmin({
                            submissionId: k.id,
                            targetUid: k.uid,
                            decision,
                            reviewerNote: kycNotes[k.id] || `Set ${decision} by Compliance`,
                            existingHistory: k.verificationHistory,
                            adminUid: user.uid,
                          })
                        }
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        {decision.replace(/_/g, ' ')}
                      </button>
                    ))}
                    {ownerUser && (
                      <button
                        type="button"
                        onClick={() =>
                          setPendingLockTarget({
                            uid: ownerUser.uid,
                            username: ownerUser.username,
                            nextLocked: !ownerUser.withdrawalLocked,
                          })
                        }
                        className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                      >
                        {ownerUser.withdrawalLocked ? 'Unlock W/D' : 'Lock W/D'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {section === 'aml_risk' && (
        <div className="space-y-3">
          {risks.map((r) => (
            <div
              key={r.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2 text-xs"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  Score {r.score}/100 ({r.level}) · Recommended: {r.recommendedAction}
                </span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Decision: {r.humanDecision}
                </span>
              </div>
              <ul className="list-disc pl-5 text-slate-600 dark:text-slate-400 space-y-0.5">
                {r.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 pt-2">
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
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {dec}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {section === 'sessions' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {sessions.length === 0 ? (
            <div className="p-8 text-slate-500 dark:text-slate-400">
              No login sessions recorded yet.
            </div>
          ) : (
            sessions.map((s) => {
              const u = users.find((x) => x.uid === s.uid);
              return (
                <div key={s.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      {s.suspicious && (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      )}
                      <span>
                        @{u?.username || s.uid.slice(0, 8)} · {s.deviceLabel}
                      </span>
                    </div>
                    <div className="font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                      TZ: {s.timezone} · Trusted: {String(s.trusted)} · Revoked: {String(s.revoked)}
                    </div>
                    {s.suspiciousReason && (
                      <div className="text-amber-800 dark:text-amber-300 mt-0.5">
                        {s.suspiciousReason}
                      </div>
                    )}
                  </div>
                  {u && (
                    <button
                      type="button"
                      onClick={() =>
                        setPendingLockTarget({
                          uid: u.uid,
                          username: u.username,
                          nextLocked: !u.withdrawalLocked,
                        })
                      }
                      className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                    >
                      {u.withdrawalLocked ? 'Unlock Withdrawals' : 'Freeze Withdrawals'}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {section === 'payment_rails' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {payAccounts.length === 0 ? (
            <div className="p-8 text-slate-500 dark:text-slate-400">
              No user payment accounts registered yet.
            </div>
          ) : (
            payAccounts.map((acc) => (
              <div key={acc.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {PAYMENT_METHOD_LABELS[acc.methodType]} · {acc.accountHolderName}
                  </div>
                  <div className="font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    {acc.upiId ||
                      `${acc.bankName || 'Bank'} · ${acc.maskedAccountNumber || ''} · ${acc.ifsc || ''}`}
                    {' · '}Status: {acc.verificationStatus}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void verifyPaymentAccountAdmin({
                        accountId: acc.id,
                        verificationStatus: 'VERIFIED',
                        adminUid: user.uid,
                      })
                    }
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-semibold cursor-pointer"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    Verify
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void verifyPaymentAccountAdmin({
                        accountId: acc.id,
                        verificationStatus: 'REJECTED',
                        adminUid: user.uid,
                      })
                    }
                    className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 font-semibold cursor-pointer"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'cases' && (
        <div className="space-y-4">
          <form
            onSubmit={handleCreateCase}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs"
          >
            <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              <ShieldAlert className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Open New Compliance Investigation Case
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                value={newCaseUid}
                onChange={(e) => setNewCaseUid(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="">Select subject account...</option>
                {users.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    @{u.username} ({u.kycStatus})
                  </option>
                ))}
              </select>
              <select
                value={newCaseType}
                onChange={(e) => setNewCaseType(e.target.value as ComplianceCaseDoc['caseType'])}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="VIDEO_KYC_ESCALATION">Video KYC Escalation</option>
                <option value="AML_ALERT">AML Alert</option>
                <option value="SUSPICIOUS_LOGIN">Suspicious Login</option>
                <option value="DUPLICATE_UTR">Duplicate UTR</option>
                <option value="ACCOUNT_RESTRICTION">Account Restriction</option>
                <option value="FRAUD_CLUSTER">Fraud Cluster</option>
                <option value="MERCHANT_ANOMALY">Merchant Anomaly</option>
              </select>
              <select
                value={newCaseSeverity}
                onChange={(e) => setNewCaseSeverity(e.target.value as RiskLevel)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                required
                minLength={5}
                placeholder="Case summary / compliance rationale"
                value={newCaseSummary}
                onChange={(e) => setNewCaseSummary(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-700 cursor-pointer"
              >
                Create Case
              </button>
            </div>
          </form>

          <div className="space-y-3">
            {cases.map((c) => (
              <div
                key={c.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 text-xs"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    @{c.subjectUsername} · {c.caseType} ({c.severity})
                  </span>
                  <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                    {c.status}
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-400">{c.summary}</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="Resolution note"
                    value={caseNotes[c.id] || ''}
                    onChange={(e) => setCaseNotes((p) => ({ ...p, [c.id]: e.target.value }))}
                    className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5"
                  />
                  {(['INVESTIGATING', 'ESCALATED', 'CLOSED'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() =>
                        void updateComplianceCaseAdmin({
                          caseId: c.id,
                          status: st,
                          resolutionNote: caseNotes[c.id] || `Marked ${st} by compliance`,
                          adminUid: user.uid,
                        })
                      }
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingLockTarget)}
        title={pendingLockTarget?.nextLocked ? 'Freeze User Withdrawals?' : 'Unlock User Withdrawals?'}
        description={
          pendingLockTarget
            ? `Toggle outbound withdrawal lock=${String(pendingLockTarget.nextLocked)} on @${pendingLockTarget.username}. All changes are written to the immutable audit log.`
            : ''
        }
        confirmLabel={pendingLockTarget?.nextLocked ? 'Freeze Withdrawals' : 'Unlock'}
        tone={pendingLockTarget?.nextLocked ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={handleConfirmWithdrawalLock}
        onCancel={() => setPendingLockTarget(null)}
      />
    </div>
  );
}
