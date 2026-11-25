import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  CreditCard,
  FileSearch,
  KeyRound,
  LayoutDashboard,
  LogOut,
  PieChart,
  Scale,
  ShieldCheck,
  Store,
  UserCog,
  Wallet,
} from 'lucide-react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { useAuth } from '../context/AuthContext';
import { P2POrderDoc, UserNotificationDoc } from '../types/models';
import { OverviewPanel } from './dashboard/OverviewPanel';
import { KycPanel } from './dashboard/KycPanel';
import { WalletPanel } from './dashboard/WalletPanel';
import { PaymentMethodsPanel } from './dashboard/PaymentMethodsPanel';
import { MerchantPanel } from './dashboard/MerchantPanel';
import { DisputesPanel } from './dashboard/DisputesPanel';
import { SecurityPanel } from './dashboard/SecurityPanel';
import { CompliancePanel } from './dashboard/CompliancePanel';
import { AdminPanel } from './dashboard/AdminPanel';
import { PortfolioTaxPanel } from './dashboard/PortfolioTaxPanel';
import { LiquidityMarketsPanel } from './dashboard/LiquidityMarketsPanel';

export type DashboardTab =
  | 'overview'
  | 'portfolio'
  | 'liquidity'
  | 'kyc'
  | 'security'
  | 'wallet'
  | 'payments'
  | 'merchant'
  | 'disputes'
  | 'compliance'
  | 'admin';

interface DashboardShellProps {
  initialTab?: DashboardTab;
  onOpenOrder: (orderId: string) => void;
}

export function DashboardShell({ initialTab = 'overview', onOpenOrder }: DashboardShellProps) {
  const { user, account, isAdmin, isComplianceOfficer, isTreasuryAdmin, signOut, signInWithGoogle } =
    useAuth();
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [orders, setOrders] = useState<P2POrderDoc[]>([]);
  const [notifications, setNotifications] = useState<UserNotificationDoc[]>([]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!user) return;
    const orderMap = new Map<string, P2POrderDoc>();
    const sync = () => {
      const sorted = Array.from(orderMap.values()).sort(
        (a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
      );
      setOrders(sorted);
    };

    const qBuy = query(collection(db, 'p2p_orders'), where('buyerUid', '==', user.uid));
    const qSell = query(collection(db, 'p2p_orders'), where('sellerUid', '==', user.uid));
    const qNotif = query(
      collection(db, 'notifications'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const u1 = onSnapshot(
      qBuy,
      (snap) => {
        snap.forEach((d) =>
          orderMap.set(d.id, { id: d.id, ...(d.data() as Omit<P2POrderDoc, 'id'>) })
        );
        sync();
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'p2p_orders')
    );

    const u2 = onSnapshot(
      qSell,
      (snap) => {
        snap.forEach((d) =>
          orderMap.set(d.id, { id: d.id, ...(d.data() as Omit<P2POrderDoc, 'id'>) })
        );
        sync();
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'p2p_orders')
    );

    const u3 = onSnapshot(
      qNotif,
      (snap) => {
        const list: UserNotificationDoc[] = [];
        snap.forEach((d) =>
          list.push({ id: d.id, ...(d.data() as Omit<UserNotificationDoc, 'id'>) })
        );
        setNotifications(list);
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'notifications')
    );

    return () => {
      u1();
      u2();
      u3();
    };
  }, [user]);

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center space-y-5">
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          Sign In to Access Your Exchange Workspace
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage your Video KYC dossier, 2FA security, non-custodial wallet, UPI/IMPS payment
          rails, merchant desk, portfolio &amp; tax statements, and active escrow orders.
        </p>
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
        >
          Continue with Google
        </button>
      </div>
    );
  }

  const navItems: {
    id: DashboardTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'portfolio', label: 'Portfolio & Tax', icon: PieChart },
    { id: 'liquidity', label: 'Liquidity & AI Intel', icon: BarChart3 },
    { id: 'kyc', label: 'Video KYC & AML', icon: ShieldCheck },
    { id: 'security', label: 'Security & Alerts', icon: KeyRound },
    { id: 'wallet', label: 'My Crypto Wallet', icon: Wallet },
    { id: 'payments', label: 'Payment Rails', icon: CreditCard },
    { id: 'merchant', label: 'Merchant Desk', icon: Store },
    { id: 'disputes', label: 'Disputes & Tickets', icon: Scale },
    ...(isComplianceOfficer
      ? [{ id: 'compliance' as const, label: 'Compliance Desk', icon: FileSearch }]
      : []),
    ...(isAdmin || isTreasuryAdmin
      ? [
          {
            id: 'admin' as const,
            label: isAdmin ? 'Admin Console' : 'Treasury Wallet Ops',
            icon: UserCog,
          },
        ]
      : []),
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar */}
        <aside className="lg:w-64 shrink-0 space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">Signed in as</div>
            <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
              {account?.displayName || user.displayName}
            </div>
            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
              @{account?.username || '...'}
            </div>
          </div>

          <nav className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => void signOut()}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Sign Out</span>
              </button>
            </div>
          </nav>
        </aside>

        {/* Main Workspace Viewport */}
        <main className="flex-1 min-w-0">
          {tab === 'overview' && (
            <OverviewPanel
              orders={orders}
              notifications={notifications}
              onOpenOrder={onOpenOrder}
              onGoToKyc={() => setTab('kyc')}
              onGoToSecurity={() => setTab('security')}
              onNavigateTab={setTab}
            />
          )}
          {tab === 'portfolio' && <PortfolioTaxPanel orders={orders} />}
          {tab === 'liquidity' && <LiquidityMarketsPanel orders={orders} />}
          {tab === 'kyc' && <KycPanel />}
          {tab === 'security' && <SecurityPanel />}
          {tab === 'wallet' && (
            <WalletPanel
              onGoToKyc={() => setTab('kyc')}
              onGoToSecurity={() => setTab('security')}
            />
          )}
          {tab === 'payments' && <PaymentMethodsPanel />}
          {tab === 'merchant' && (
            <MerchantPanel
              orders={orders}
              onOpenOrder={onOpenOrder}
              onGoToKyc={() => setTab('kyc')}
            />
          )}
          {tab === 'disputes' && <DisputesPanel />}
          {tab === 'compliance' && <CompliancePanel />}
          {tab === 'admin' && <AdminPanel onOpenOrder={onOpenOrder} />}
        </main>
      </div>
    </div>
  );
}
