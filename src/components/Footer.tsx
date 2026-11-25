import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { AppRoute } from './Header';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

interface FooterProps {
  onNavigate: (route: AppRoute) => void;
}

export function Footer({ onNavigate }: FooterProps) {
  const { platformSettings } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <footer className="bg-slate-900 dark:bg-slate-950 text-slate-300 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="space-y-3">
            <div className="font-display text-lg font-bold text-white">
              {platformSettings.brandName}
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">
              Multi-coin peer-to-peer INR digital asset desk engineered with verified counterparty
              checks, live market charting, escrow workflows, and compliance-first transaction
              monitoring for India.
            </p>
            <p className="text-xs text-slate-400">
              Mode:{' '}
              {platformSettings.sandboxMode
                ? 'Sandbox Environment (Non-Real-Money Testing)'
                : 'Configured Settlement'}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Marketplace &amp; Markets</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('markets')}
                  className="hover:text-white cursor-pointer"
                >
                  Live Crypto Markets &amp; Charts
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('buy')}
                  className="hover:text-white cursor-pointer"
                >
                  Buy Crypto (INR)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('sell')}
                  className="hover:text-white cursor-pointer"
                >
                  Sell Crypto (INR)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('merchants')}
                  className="hover:text-white cursor-pointer"
                >
                  Merchant &amp; Liquidity Program
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('fees')}
                  className="hover:text-white cursor-pointer"
                >
                  Fees &amp; Order Limits
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Security &amp; Governance</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('how-it-works')}
                  className="hover:text-white cursor-pointer"
                >
                  How P2P Escrow Works
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('security')}
                  className="hover:text-white cursor-pointer"
                >
                  Security &amp; Risk Architecture
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('faq')}
                  className="hover:text-white cursor-pointer"
                >
                  Frequently Asked Questions
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('contact')}
                  className="hover:text-white cursor-pointer"
                >
                  Contact &amp; Support Tickets
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('status')}
                  className="hover:text-white cursor-pointer"
                >
                  Platform System Status
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">India VDA &amp; Legal Notice</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Virtual Digital Asset (VDA) transfers in India are subject to applicable PMLA,
              FIU-IND, DPDP, RBI payment-rail, and Income Tax Section 194S (1% TDS) obligations.
              Peer-to-peer transactions involve counterparty and market risks; no platform can
              guarantee zero fraud.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a
                href="/api/docs/openapi.json"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                OpenAPI Specification (JSON)
              </a>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md cursor-pointer"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="w-3.5 h-3.5" /> Light Mode
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5" /> Dark Mode
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-400">
          <span>
            © {new Date().getFullYear()} {platformSettings.brandName}. All rights reserved.
          </span>
          <span>
            Assets: BTC · ETH · USDT · USDC · SOL · BNB · XRP · DOGE · TRX (Admin-Governed INR Settlement)
          </span>
        </div>
      </div>
    </footer>
  );
}
