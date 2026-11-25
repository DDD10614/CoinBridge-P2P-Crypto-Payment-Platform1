import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppRoute, Header } from './components/Header';
import { Footer } from './components/Footer';
import { HomePage } from './components/HomePage';
import { MarketplacePage } from './components/MarketplacePage';
import { CryptoMarketsPage } from './components/CryptoMarketsPage';
import { CoinDetailPage } from './components/CoinDetailPage';
import {
  FaqAndContactPage,
  FeesAndLimitsPage,
  HowItWorksPage,
  SecurityPage,
} from './components/PublicPages';
import { DashboardShell, DashboardTab } from './components/DashboardShell';
import { OrderWorkspaceModal } from './components/OrderWorkspaceModal';
import { StatusPage } from './components/StatusPage';

function AppShell() {
  const { authError, clearAuthError } = useAuth();
  const [route, setRoute] = useState<AppRoute>('home');
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('overview');
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [selectedCoinSymbol, setSelectedCoinSymbol] = useState<string>('BTC');
  const [selectedMarketAsset, setSelectedMarketAsset] = useState<string>('USDT');

  const navigate = (next: AppRoute) => {
    if (next === 'merchants') {
      setDashboardTab('merchant');
      setRoute('dashboard');
    } else if (next === 'dashboard') {
      setDashboardTab('overview');
      setRoute('dashboard');
    } else {
      setRoute(next);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateToDashboardTab = (tab: DashboardTab) => {
    setDashboardTab(tab);
    setRoute('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openCoinDetail = (symbol: string) => {
    setSelectedCoinSymbol(symbol.trim().toUpperCase());
    setRoute('coin-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openMarketplace = (mode: 'buy' | 'sell', symbol?: string) => {
    if (symbol) {
      setSelectedMarketAsset(symbol.trim().toUpperCase());
    }
    setRoute(mode);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 transition-colors">
      <Header route={route} onNavigate={navigate} />

      {authError && (
        <div className="bg-red-50 dark:bg-red-950/60 border-b border-red-200 dark:border-red-900 px-4 py-2.5 text-xs text-red-900 dark:text-red-200 flex items-center justify-between max-w-7xl mx-auto w-full">
          <span>{authError}</span>
          <button
            type="button"
            onClick={clearAuthError}
            className="font-semibold underline cursor-pointer ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="flex-1">
        {route === 'home' && (
          <HomePage
            onNavigate={navigate}
            onOpenCoinDetail={openCoinDetail}
            onOpenMarketplace={openMarketplace}
          />
        )}
        {route === 'markets' && (
          <CryptoMarketsPage
            onOpenCoinDetail={openCoinDetail}
            onOpenMarketplace={openMarketplace}
          />
        )}
        {route === 'coin-detail' && (
          <CoinDetailPage
            symbol={selectedCoinSymbol}
            onBackToMarkets={() => navigate('markets')}
            onOpenMarketplace={openMarketplace}
          />
        )}
        {route === 'buy' && (
          <MarketplacePage
            mode="buy"
            initialAsset={selectedMarketAsset}
            onSelectAsset={setSelectedMarketAsset}
            onNavigate={navigate}
            onNavigateDashboardTab={navigateToDashboardTab}
            onOrderCreated={(orderId) => setActiveOrderId(orderId)}
            onOpenCoinDetail={openCoinDetail}
          />
        )}
        {route === 'sell' && (
          <MarketplacePage
            mode="sell"
            initialAsset={selectedMarketAsset}
            onSelectAsset={setSelectedMarketAsset}
            onNavigate={navigate}
            onNavigateDashboardTab={navigateToDashboardTab}
            onOrderCreated={(orderId) => setActiveOrderId(orderId)}
            onOpenCoinDetail={openCoinDetail}
          />
        )}
        {route === 'how-it-works' && <HowItWorksPage />}
        {route === 'security' && <SecurityPage />}
        {route === 'fees' && <FeesAndLimitsPage />}
        {route === 'faq' && <FaqAndContactPage initialTab="faq" />}
        {route === 'contact' && <FaqAndContactPage initialTab="contact" />}
        {route === 'status' && <StatusPage />}
        {route === 'dashboard' && (
          <DashboardShell
            initialTab={dashboardTab}
            onOpenOrder={(orderId) => setActiveOrderId(orderId)}
          />
        )}
      </main>

      <Footer onNavigate={navigate} />

      {activeOrderId && (
        <OrderWorkspaceModal
          orderId={activeOrderId}
          onClose={() => setActiveOrderId(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
