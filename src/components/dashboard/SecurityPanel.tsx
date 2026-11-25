import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  BellRing,
  CheckCircle2,
  Clock,
  KeyRound,
  Laptop,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  BLOCKCHAIN_NETWORKS,
  BlockchainNetworkId,
  formatRateInr,
  isValidWalletAddress,
  PAISE_PER_INR,
} from '../../lib/domain';
import {
  addWithdrawalWhitelistAddress,
  createPriceAlert,
  createUserNotification,
  deletePriceAlert,
  markPriceAlertTriggered,
  removeWithdrawalWhitelistAddress,
  saveTotpEnrollment,
  saveWhitelistOnlySetting,
  toggleUserWithdrawalLock,
  updateSecuritySession,
} from '../../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { useAuth } from '../../context/AuthContext';
import {
  PriceAlertDoc,
  SecuritySessionDoc,
  WithdrawalWhitelistDoc,
} from '../../types/models';
import { ConfirmDialog } from '../ConfirmDialog';

const COOLDOWN_HOURS = 24;

export function SecurityPanel() {
  const { user, account, privateProfile, currentDeviceSessionId, getIdToken } = useAuth();

  // 2FA state
  const [enrollData, setEnrollData] = useState<{
    secret: string;
    sealedSecret: string;
    otpauthUri: string;
    qrDataUrl: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);

  // Devices / Whitelist / Alerts
  const [sessions, setSessions] = useState<SecuritySessionDoc[]>([]);
  const [whitelist, setWhitelist] = useState<WithdrawalWhitelistDoc[]>([]);
  const [alerts, setAlerts] = useState<PriceAlertDoc[]>([]);
  const [spotRate, setSpotRate] = useState<{ rateInr: number; isLive: boolean } | null>(null);

  // Forms
  const [wlLabel, setWlLabel] = useState('');
  const [wlNetwork, setWlNetwork] = useState<BlockchainNetworkId>('TRON_TRC20');
  const [wlAddress, setWlAddress] = useState('');

  const [alertInr, setAlertInr] = useState('92.50');
  const [alertCondition, setAlertCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const u1 = onSnapshot(
      query(collection(db, 'security_sessions'), where('uid', '==', user.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<SecuritySessionDoc, 'id'>) }))
          .sort((a, b) => (b.lastActiveAt?.toMillis?.() || 0) - (a.lastActiveAt?.toMillis?.() || 0));
        setSessions(list);
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'security_sessions')
    );

    const u2 = onSnapshot(
      query(collection(db, 'withdrawal_whitelist'), where('uid', '==', user.uid)),
      (snap) => {
        setWhitelist(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WithdrawalWhitelistDoc, 'id'>) }))
        );
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'withdrawal_whitelist')
    );

    const u3 = onSnapshot(
      query(collection(db, 'price_alerts'), where('uid', '==', user.uid)),
      (snap) => {
        setAlerts(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PriceAlertDoc, 'id'>) }))
        );
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'price_alerts')
    );

    return () => {
      u1();
      u2();
      u3();
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/rates/usdt-inr')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.rateInr === 'number') {
          setSpotRate({ rateInr: data.rateInr, isLive: Boolean(data.isLive) });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Evaluate active price alerts against spot rate
  useEffect(() => {
    if (!user || !spotRate || alerts.length === 0) return;
    const spotPaise = Math.round(spotRate.rateInr * PAISE_PER_INR);
    for (const alert of alerts) {
      if (!alert.isActive || alert.triggered) continue;
      const crossed =
        (alert.condition === 'ABOVE' && spotPaise >= alert.targetRateInrPaise) ||
        (alert.condition === 'BELOW' && spotPaise <= alert.targetRateInrPaise);
      if (crossed) {
        void markPriceAlertTriggered(alert.id);
        void createUserNotification({
          uid: user.uid,
          type: 'SECURITY',
          title: `USDT/INR Alert Triggered (${alert.condition})`,
          body: `Spot rate ₹${spotRate.rateInr.toFixed(2)} crossed your ${alert.condition.toLowerCase()} target of ${formatRateInr(alert.targetRateInrPaise)}.`,
        });
      }
    }
  }, [user, spotRate, alerts]);

  const handleStartEnroll2FA = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/security/2fa/enroll', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json()) as {
        secret: string;
        sealedSecret: string;
        otpauthUri: string;
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || 'Could not initiate 2FA enrollment.');
      const qrDataUrl = await QRCode.toDataURL(data.otpauthUri, { width: 180, margin: 1 });
      setEnrollData({ ...data, qrDataUrl });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to initialize 2FA.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyAndActivate2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !enrollData) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const token = await getIdToken();
      const resp = await fetch('/api/security/2fa/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: totpCode.trim(),
          sealedSecret: enrollData.sealedSecret,
        }),
      });
      const data = (await resp.json()) as { verified?: boolean; error?: string };
      if (!resp.ok || !data.verified) {
        throw new Error(data.error || 'Invalid 6-digit authenticator code.');
      }
      await saveTotpEnrollment({
        uid: user.uid,
        enabled: true,
        sealedSecret: enrollData.sealedSecret,
      });
      setEnrollData(null);
      setTotpCode('');
      setStatusMsg('RFC 6238 TOTP Two-Factor Authentication is now active on your account.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '2FA activation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await saveTotpEnrollment({ uid: user.uid, enabled: false });
      setDisableConfirmOpen(false);
      setStatusMsg('Two-factor authentication disabled.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to disable 2FA.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleWithdrawalLock = async () => {
    if (!user || !account) return;
    setBusy(true);
    try {
      const nextLocked = !account.withdrawalLocked;
      await toggleUserWithdrawalLock({
        uid: user.uid,
        locked: nextLocked,
        reason: nextLocked ? 'Self-activated account protection lock' : 'Self-unlocked',
        actorUid: user.uid,
      });
      setLockConfirmOpen(false);
      setStatusMsg(
        nextLocked
          ? 'Self-service withdrawal freeze enabled. Outbound USDT transfers are blocked.'
          : 'Withdrawal freeze lifted.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update withdrawal lock.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddWhitelist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setErrorMsg(null);
    if (!isValidWalletAddress(wlAddress, wlNetwork)) {
      setErrorMsg(`Invalid ${BLOCKCHAIN_NETWORKS[wlNetwork].name} address format.`);
      return;
    }
    setBusy(true);
    try {
      await addWithdrawalWhitelistAddress({
        uid: user.uid,
        label: wlLabel.trim() || `${BLOCKCHAIN_NETWORKS[wlNetwork].name} Address`,
        network: wlNetwork,
        address: wlAddress.trim(),
      });
      setWlLabel('');
      setWlAddress('');
      setStatusMsg(
        `Whitelisted withdrawal address added (${COOLDOWN_HOURS}h security cooldown active before auto-release).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add whitelist entry.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePriceAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const paise = Math.round((Number(alertInr) || 0) * PAISE_PER_INR);
    if (paise <= 0) return;
    setBusy(true);
    try {
      await createPriceAlert({
        uid: user.uid,
        targetRateInrPaise: paise,
        condition: alertCondition,
      });
      setStatusMsg(`Price alert saved for ${alertCondition} ${formatRateInr(paise)}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create alert.');
    } finally {
      setBusy(false);
    }
  };

  const is2FAEnabled = Boolean(privateProfile?.twoFactorEnabled && privateProfile.totpSealedSecret);
  const nowMs = Date.now();
  const cooldownMs = COOLDOWN_HOURS * 3_600_000;
  const coolingWhitelistEntries = whitelist.filter((w) => {
    const createdMs = w.createdAt?.toMillis?.() || 0;
    return createdMs > 0 && nowMs - createdMs < cooldownMs;
  });
  const activeSuspiciousSessions = sessions.filter((s) => s.suspicious && !s.revoked);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          Account Security, 2FA, Whitelists &amp; Price Alerts
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage RFC 6238 authenticator 2FA, 24h new-address withdrawal cooldowns, device sign-in
          alerts, and live USDT/INR threshold monitors.
        </p>
      </div>

      {/* Withdrawal Security Posture Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1 text-xs">
          <div>
            <div className="text-slate-500 dark:text-slate-400">2FA Withdrawal Gate</div>
            <div
              className={`mt-0.5 font-mono font-bold ${
                is2FAEnabled
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {is2FAEnabled ? 'ACTIVE (TOTP)' : 'OFF'}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Whitelist Policy</div>
            <div className="mt-0.5 font-mono font-bold text-slate-900 dark:text-slate-100">
              {privateProfile?.whitelistOnlyWithdrawals ? 'STRICT ONLY' : 'FLEXIBLE'}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">24h Address Cooldowns</div>
            <div className="mt-0.5 font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {coolingWhitelistEntries.length} active
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">New-Device Alerts</div>
            <div
              className={`mt-0.5 font-mono font-bold tabular-nums ${
                activeSuspiciousSessions.length > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {activeSuspiciousSessions.length} flagged
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setLockConfirmOpen(true)}
          className={`px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer shrink-0 ${
            account?.withdrawalLocked
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-slate-900 dark:bg-red-950/60 dark:border dark:border-red-800 text-white dark:text-red-200 hover:bg-slate-800'
          }`}
        >
          {account?.withdrawalLocked ? 'Emergency Freeze Active (Lift)' : 'Emergency Freeze Account'}
        </button>
      </div>

      {statusMsg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-900 dark:text-red-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 2FA & Account Freeze Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TOTP 2FA */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <KeyRound className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Two-Factor Authentication (TOTP)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Required before escrow release and USDT withdrawals when active.
                </p>
              </div>
            </div>
            <span
              className={`font-mono text-xs font-semibold ${
                is2FAEnabled
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {is2FAEnabled ? 'ACTIVE' : 'NOT ENABLED'}
            </span>
          </div>

          {is2FAEnabled ? (
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200">
                Authenticator app enrolled ({privateProfile?.twoFactorMethod || 'TOTP'}). Your
                secret is sealed server-side with AES-256-GCM.
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDisableConfirmOpen(true)}
                className="px-3.5 py-2 text-xs font-semibold text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
              >
                Disable 2FA
              </button>
            </div>
          ) : enrollData ? (
            <form onSubmit={handleVerifyAndActivate2FA} className="space-y-3 text-xs">
              <div className="flex flex-col sm:flex-row gap-4 items-center bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
                <img
                  src={enrollData.qrDataUrl}
                  alt="TOTP Authenticator QR Code"
                  className="w-36 h-36 rounded-lg border border-slate-200 dark:border-slate-700 bg-white p-1"
                />
                <div className="space-y-2 min-w-0">
                  <p className="text-slate-700 dark:text-slate-300">
                    Scan with Google Authenticator, 1Password, or Authy, or enter the Base32 key:
                  </p>
                  <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded break-all">
                    {enrollData.secret}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  maxLength={6}
                  inputMode="numeric"
                  placeholder="Enter 6-digit code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono tracking-widest"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
                >
                  Verify &amp; Activate
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleStartEnroll2FA()}
              className="px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-700 cursor-pointer"
            >
              Generate 2FA Authenticator QR
            </button>
          )}
        </div>

        {/* Account Protection & Withdrawal Freeze */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Lock className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Withdrawal Protection Controls
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Lock outbound wallet withdrawals immediately or restrict transfers solely to your
                  saved address whitelist.
                </p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            <div className="py-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Emergency Withdrawal Freeze
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  {account?.withdrawalLocked
                    ? 'All outbound USDT withdrawals are currently frozen.'
                    : 'Outbound wallet withdrawals are permitted.'}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setLockConfirmOpen(true)}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  account?.withdrawalLocked
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {account?.withdrawalLocked ? 'Frozen (Unlock)' : 'Freeze Withdrawals'}
              </button>
            </div>

            <div className="py-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Whitelist-Only Withdrawals
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  Only allow transfers to explicitly whitelisted wallet addresses below.
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  user &&
                  void saveWhitelistOnlySetting(user.uid, !privateProfile?.whitelistOnlyWithdrawals)
                }
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  privateProfile?.whitelistOnlyWithdrawals
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {privateProfile?.whitelistOnlyWithdrawals ? 'Enforced' : 'Off'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Withdrawal Address Whitelist */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Withdrawal Address Whitelist ({whitelist.length})
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {COOLDOWN_HOURS}h new-address cooldown enforced
          </span>
        </div>

        <form onSubmit={handleAddWhitelist} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <input
            type="text"
            required
            placeholder="Label (e.g. Ledger TRON Vault)"
            value={wlLabel}
            onChange={(e) => setWlLabel(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2"
          />
          <select
            value={wlNetwork}
            onChange={(e) => setWlNetwork(e.target.value as BlockchainNetworkId)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            {Object.values(BLOCKCHAIN_NETWORKS).map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} ({n.tokenStandard})
              </option>
            ))}
          </select>
          <input
            type="text"
            required
            placeholder="Destination public address"
            value={wlAddress}
            onChange={(e) => setWlAddress(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
          >
            Add Whitelist Address
          </button>
        </form>

        {whitelist.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No whitelisted addresses saved yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {whitelist.map((w) => {
              const createdMs = w.createdAt?.toMillis?.() || 0;
              const remainingMs = createdMs > 0 ? cooldownMs - (nowMs - createdMs) : 0;
              const inCooldown = remainingMs > 0;
              const hrs = Math.floor(remainingMs / 3_600_000);
              const mins = Math.max(1, Math.floor((remainingMs % 3_600_000) / 60_000));
              return (
                <div key={w.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                      <span>
                        {w.label} · {BLOCKCHAIN_NETWORKS[w.network].name}
                      </span>
                      {inCooldown ? (
                        <span className="px-1.5 py-0.5 rounded-sm bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-mono text-[10px] tabular-nums">
                          COOLDOWN {hrs}h {mins}m LEFT
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded-sm bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-mono text-[10px]">
                          TRUSTED
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-slate-500 dark:text-slate-400 truncate">
                      {w.address}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeWithdrawalWhitelistAddress(w.id)}
                    aria-label="Remove whitelist address"
                    className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Price Alerts */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              USDT / INR Price Alerts
            </h3>
          </div>
          {spotRate && (
            <div className="text-xs font-mono text-slate-600 dark:text-slate-400 tabular-nums">
              Spot:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                ₹{spotRate.rateInr.toFixed(2)}
              </strong>{' '}
              · {spotRate.isLive ? 'Live CoinGecko' : 'Fallback Rate'}
            </div>
          )}
        </div>

        <form onSubmit={handleCreatePriceAlert} className="flex flex-wrap gap-3 text-xs items-center">
          <select
            value={alertCondition}
            onChange={(e) => setAlertCondition(e.target.value as 'ABOVE' | 'BELOW')}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            <option value="ABOVE">Notify when rate rises ABOVE</option>
            <option value="BELOW">Notify when rate drops BELOW</option>
          </select>
          <input
            type="number"
            step="0.05"
            min="10"
            required
            value={alertInr}
            onChange={(e) => setAlertInr(e.target.value)}
            className="w-36 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-700 cursor-pointer"
          >
            Create Alert
          </button>
        </form>

        {alerts.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {alerts.map((a) => (
              <div key={a.id} className="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {a.condition} {formatRateInr(a.targetRateInrPaise)}
                  </span>
                  <span className="mx-2 text-slate-300 dark:text-slate-700">·</span>
                  <span
                    className={
                      a.triggered
                        ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                        : 'text-slate-500 dark:text-slate-400'
                    }
                  >
                    {a.triggered ? 'Triggered (Notification Sent)' : 'Monitoring'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void deletePriceAlert(a.id)}
                  aria-label="Delete price alert"
                  className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Device Management & Login History */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <Laptop className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Authorized Devices &amp; Sign-In History ({sessions.length})
          </h3>
        </div>
        {sessions.length === 0 ? (
          <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
            No session history recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {s.deviceLabel}
                    {s.id === currentDeviceSessionId && (
                      <span className="ml-2 font-mono text-blue-700 dark:text-blue-400">
                        (Current Device)
                      </span>
                    )}
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 font-mono">
                    Timezone: {s.timezone} · Last active:{' '}
                    {s.lastActiveAt?.toDate ? s.lastActiveAt.toDate().toLocaleString() : 'Now'}
                  </div>
                  {s.suspicious && (
                    <div className="text-amber-800 dark:text-amber-300 font-medium">
                      Flagged: {s.suspiciousReason || 'Unrecognized device or timezone'}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!s.trusted && !s.revoked && (
                    <button
                      type="button"
                      onClick={() => void updateSecuritySession({ sessionId: s.id, trusted: true })}
                      className="px-3 py-1.5 font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-lg cursor-pointer"
                    >
                      Trust Device
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={s.revoked}
                    onClick={() => void updateSecuritySession({ sessionId: s.id, revoked: true })}
                    className="px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                  >
                    {s.revoked ? 'Revoked' : 'Revoke'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={disableConfirmOpen}
        title="Disable TOTP 2FA?"
        description="Disabling Two-Factor Authentication removes authenticator confirmation before escrow release and USDT withdrawals."
        confirmLabel="Disable 2FA"
        tone="danger"
        busy={busy}
        onConfirm={handleDisable2FA}
        onCancel={() => setDisableConfirmOpen(false)}
      />

      <ConfirmDialog
        open={lockConfirmOpen}
        title={account?.withdrawalLocked ? 'Lift Withdrawal Freeze?' : 'Freeze All Withdrawals?'}
        description={
          account?.withdrawalLocked
            ? 'Re-enables outbound USDT withdrawal requests from your wallet ledger.'
            : 'Immediately blocks all outbound USDT wallet withdrawals until you unlock your account.'
        }
        confirmLabel={account?.withdrawalLocked ? 'Unlock Withdrawals' : 'Freeze Withdrawals'}
        tone={account?.withdrawalLocked ? 'primary' : 'danger'}
        busy={busy}
        onConfirm={handleToggleWithdrawalLock}
        onCancel={() => setLockConfirmOpen(false)}
      />
    </div>
  );
}
