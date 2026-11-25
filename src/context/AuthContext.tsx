import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db, googleAuthProvider, testFirestoreConnection } from '../lib/firebase';
import {
  DEFAULT_PLATFORM_SETTINGS,
  getKycRestrictionDetails,
  PlatformSettings,
} from '../lib/domain';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { recordLoginSession } from '../lib/firestoreService';
import { UserAccountDoc, UserPrivateProfileDoc, WalletLedgerDoc } from '../types/models';

const BOOTSTRAP_ADMIN_EMAIL = 'dahikardilesh@gmail.com';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  account: UserAccountDoc | null;
  privateProfile: UserPrivateProfileDoc | null;
  wallet: WalletLedgerDoc | null;
  platformSettings: PlatformSettings;
  isAdmin: boolean;
  isComplianceOfficer: boolean;
  isTreasuryAdmin: boolean;
  isSupportAgent: boolean;
  isTradingEligible: boolean;
  kycRestriction: ReturnType<typeof getKycRestrictionDetails>;
  currentDeviceSessionId: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  authError: string | null;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sanitizeUsername(raw: string, uid: string): string {
  const base = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 20);
  const prefix = base.length >= 3 ? base : 'trader';
  return `${prefix}_${uid.slice(0, 5)}`.slice(0, 32);
}

function getOrCreateDeviceToken(): string {
  try {
    const key = 'cb_device_token';
    const existing = window.localStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9_-]{6,32}$/.test(existing)) return existing;
    const created = `dev_${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return 'dev_browser';
  }
}

function detectClientMetadata() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  let os = 'Desktop';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let timezone = 'Asia/Kolkata';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    timezone = 'UTC';
  }

  return {
    browser,
    os,
    timezone,
    deviceLabel: `${browser} on ${os}`,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [account, setAccount] = useState<UserAccountDoc | null>(null);
  const [privateProfile, setPrivateProfile] = useState<UserPrivateProfileDoc | null>(null);
  const [wallet, setWallet] = useState<WalletLedgerDoc | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>(DEFAULT_PLATFORM_SETTINGS);
  const [isAdminDoc, setIsAdminDoc] = useState(false);
  const [currentDeviceSessionId, setCurrentDeviceSessionId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const loggedSessionUidRef = useRef<string | null>(null);

  useEffect(() => {
    void testFirestoreConnection();
    const unsubSettings = onSnapshot(
      doc(db, 'platform_settings', 'default'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<PlatformSettings>;
          setPlatformSettings({ ...DEFAULT_PLATFORM_SETTINGS, ...data });
        }
      },
      (err) => {
        console.warn('Could not subscribe to platform_settings/default:', err.message);
      }
    );
    return () => unsubSettings();
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setAccount(null);
        setPrivateProfile(null);
        setWallet(null);
        setIsAdminDoc(false);
        setCurrentDeviceSessionId(null);
        loggedSessionUidRef.current = null;
        return;
      }

      const uid = firebaseUser.uid;
      try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          const displayName = (firebaseUser.displayName || 'CoinBridge Trader').slice(0, 80);
          const username = sanitizeUsername(firebaseUser.email?.split('@')[0] || displayName, uid);
          await setDoc(userRef, {
            uid,
            username,
            displayName,
            role: 'BUYER',
            kycStatus: 'NOT_STARTED',
            accountStatus: 'ACTIVE',
            isDemo: false,
            withdrawalLocked: false,
            completedTrades: 0,
            completionRateBps: 10000,
            ratingAvgBps: 500,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        const privRef = doc(db, 'users', uid, 'private', 'profile');
        const privSnap = await getDoc(privRef);
        if (!privSnap.exists()) {
          await setDoc(privRef, {
            uid,
            fullLegalName: (firebaseUser.displayName || 'Pending Verification').slice(0, 120),
            email: firebaseUser.email || `${uid}@coinbridge.local`,
            country: 'India',
            twoFactorEnabled: false,
            twoFactorMethod: 'NONE',
            whitelistOnlyWithdrawals: false,
            notifyEmail: true,
            notifyInApp: true,
            notifySecurityAlerts: true,
            updatedAt: serverTimestamp(),
          });
        }

        const walletRef = doc(db, 'wallets', uid);
        const walletSnap = await getDoc(walletRef);
        if (!walletSnap.exists()) {
          await setDoc(walletRef, {
            uid,
            availableUsdtMicro: 0,
            reservedUsdtMicro: 0,
            preferredNetwork: 'TRON_TRC20',
            updatedAt: serverTimestamp(),
          });
        }

        const adminSnap = await getDoc(doc(db, 'admins', uid));
        setIsAdminDoc(adminSnap.exists());

        if (loggedSessionUidRef.current !== uid) {
          loggedSessionUidRef.current = uid;
          const deviceToken = getOrCreateDeviceToken();
          const sessionId = `${uid.slice(0, 14)}_${deviceToken}`.replace(/[^a-zA-Z0-9_-]/g, '_');
          setCurrentDeviceSessionId(sessionId);
          const meta = detectClientMetadata();

          try {
            const existingSessions = await getDocs(
              query(collection(db, 'security_sessions'), where('uid', '==', uid))
            );
            const knownIds = existingSessions.docs.map((d) => d.id);
            const previousTimezones = Array.from(
              new Set(existingSessions.docs.map((d) => String(d.data().timezone || '')).filter(Boolean))
            );
            const isNewDevice = !knownIds.includes(sessionId);

            let suspicious = false;
            let suspiciousReason: string | undefined;
            const token = await firebaseUser.getIdToken();
            if (token) {
              const resp = await fetch('/api/security/analyze-login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  knownDevicesCount: knownIds.length,
                  isNewDevice,
                  previousTimezones,
                  currentTimezone: meta.timezone,
                }),
              });
              if (resp.ok) {
                const resJson = (await resp.json()) as {
                  suspicious?: boolean;
                  suspiciousReason?: string;
                };
                suspicious = Boolean(resJson.suspicious);
                suspiciousReason = resJson.suspiciousReason || undefined;
              }
            }

            await recordLoginSession({
              sessionId,
              uid,
              deviceLabel: meta.deviceLabel,
              browser: meta.browser,
              os: meta.os,
              timezone: meta.timezone,
              suspicious,
              suspiciousReason,
            });
          } catch (sessionErr) {
            console.warn('Session telemetry check skipped:', sessionErr);
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
      }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    const uid = user.uid;

    const unsubAccount = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) setAccount(snap.data() as UserAccountDoc);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`)
    );

    const unsubPriv = onSnapshot(
      doc(db, 'users', uid, 'private', 'profile'),
      (snap) => {
        if (snap.exists()) setPrivateProfile(snap.data() as UserPrivateProfileDoc);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/private/profile`)
    );

    const unsubWallet = onSnapshot(
      doc(db, 'wallets', uid),
      (snap) => {
        if (snap.exists()) setWallet(snap.data() as WalletLedgerDoc);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `wallets/${uid}`)
    );

    return () => {
      unsubAccount();
      unsubPriv();
      unsubWallet();
    };
  }, [authReady, user]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to complete Google sign-in.';
      setAuthError(message);
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const getIdToken = useCallback(async () => {
    if (!auth.currentUser) return null;
    return await auth.currentUser.getIdToken();
  }, []);

  const isAdmin = Boolean(
    user?.emailVerified &&
      (isAdminDoc ||
        user?.email === BOOTSTRAP_ADMIN_EMAIL ||
        account?.role === 'ADMIN' ||
        account?.role === 'SUPER_ADMIN' ||
        account?.role === 'COMPLIANCE_OFFICER')
  );

  const isComplianceOfficer = Boolean(
    user?.emailVerified && (isAdmin || account?.role === 'COMPLIANCE_OFFICER')
  );

  const isTreasuryAdmin = Boolean(
    user?.emailVerified &&
      (isAdminDoc ||
        user?.email === BOOTSTRAP_ADMIN_EMAIL ||
        account?.role === 'ADMIN' ||
        account?.role === 'SUPER_ADMIN' ||
        account?.role === 'TREASURY_ADMIN')
  );

  const isSupportAgent = Boolean(
    user?.emailVerified && (isAdmin || account?.role === 'SUPPORT_AGENT')
  );

  const kycRestriction = getKycRestrictionDetails(account);
  const isTradingEligible = kycRestriction.eligible;

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        account,
        privateProfile,
        wallet,
        platformSettings,
        isAdmin,
        isComplianceOfficer,
        isTreasuryAdmin,
        isSupportAgent,
        isTradingEligible,
        kycRestriction,
        currentDeviceSessionId,
        signInWithGoogle,
        signOut,
        getIdToken,
        authError,
        clearAuthError: () => setAuthError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
