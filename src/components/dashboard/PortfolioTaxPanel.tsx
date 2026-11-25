import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  FileText,
  PieChart,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { CoinMarketQuote, formatCoinQuantityFromE8 } from '../../lib/coins';
import {
  formatInrFromPaise,
  formatRateInr,
  formatUsdtFromMicro,
  MICRO_PER_USDT,
  PAISE_PER_INR,
} from '../../lib/domain';
import {
  computePortfolioAnalytics,
  computeTaxAndComplianceReport,
  generatePortfolioCsv,
  generateTaxTransactionsCsv,
} from '../../lib/portfolioAndTax';
import {
  downloadPortfolioReportPdf,
  downloadTaxStatementPdf,
  downloadTransactionReceiptPdf,
} from '../../lib/pdfReports';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { useAuth } from '../../context/AuthContext';
import {
  DepositTransactionDoc,
  P2POrderDoc,
  WithdrawalTransactionDoc,
} from '../../types/models';
import { CoinBadge } from '../CoinBadge';

interface PortfolioTaxPanelProps {
  orders: P2POrderDoc[];
}

type StatementTab = 'TAX_SUMMARY' | 'P2P_TRADES' | 'WALLET_FLOWS';

function triggerCsvDownload(filename: string, csvText: string) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatInrNum(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PortfolioTaxPanel({ orders }: PortfolioTaxPanelProps) {
  const { user, account, wallet, platformSettings } = useAuth();
  const [deposits, setDeposits] = useState<DepositTransactionDoc[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalTransactionDoc[]>([]);
  const [marketQuotes, setMarketQuotes] = useState<Record<string, CoinMarketQuote>>({});
  const [freshness, setFreshness] = useState<string>('LOADING');
  const [statementTab, setStatementTab] = useState<StatementTab>('TAX_SUMMARY');
  const [loadingMarkets, setLoadingMarkets] = useState(false);

  const loadMarkets = async () => {
    setLoadingMarkets(true);
    try {
      const resp = await fetch('/api/markets');
      if (resp.ok) {
        const data = await resp.json();
        const map: Record<string, CoinMarketQuote> = {};
        for (const c of (data.coins || []) as CoinMarketQuote[]) {
          map[c.symbol.toUpperCase()] = c;
        }
        setMarketQuotes(map);
        setFreshness(data.freshnessStatus || 'LIVE');
      }
    } catch {
      setFreshness('FALLBACK');
    } finally {
      setLoadingMarkets(false);
    }
  };

  useEffect(() => {
    void loadMarkets();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubDep = onSnapshot(
      query(collection(db, 'deposit_transactions'), where('uid', '==', user.uid)),
      (snap) => {
        const list: DepositTransactionDoc[] = [];
        snap.forEach((d) =>
          list.push({ id: d.id, ...(d.data() as Omit<DepositTransactionDoc, 'id'>) })
        );
        setDeposits(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'deposit_transactions')
    );

    const unsubWd = onSnapshot(
      query(collection(db, 'withdrawal_transactions'), where('uid', '==', user.uid)),
      (snap) => {
        const list: WithdrawalTransactionDoc[] = [];
        snap.forEach((d) =>
          list.push({ id: d.id, ...(d.data() as Omit<WithdrawalTransactionDoc, 'id'>) })
        );
        setWithdrawals(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'withdrawal_transactions')
    );

    return () => {
      unsubDep();
      unsubWd();
    };
  }, [user]);

  const portfolio = useMemo(
    () =>
      computePortfolioAnalytics({
        uid: user?.uid || '',
        orders,
        deposits,
        withdrawals,
        walletLedger: wallet,
        marketQuotes,
        fallbackUsdtInr: 91.5,
      }),
    [user?.uid, orders, deposits, withdrawals, wallet, marketQuotes]
  );

  const taxReport = useMemo(
    () =>
      computeTaxAndComplianceReport({
        uid: user?.uid || '',
        orders,
        deposits,
        withdrawals,
        portfolio,
      }),
    [user?.uid, orders, deposits, withdrawals, portfolio]
  );

  // SVG Historical Performance Curve points
  const chartGeometry = useMemo(() => {
    const pts = portfolio.history;
    if (pts.length === 0) return null;
    const values = pts.flatMap((p) => [p.marketValueInr, p.costBasisInr]);
    const minVal = Math.min(...values, 0);
    const maxVal = Math.max(...values, 1);
    const span = Math.max(1, maxVal - minVal);
    const width = 640;
    const height = 170;
    const padX = 16;
    const padY = 18;

    const toCoord = (idx: number, val: number) => {
      const x =
        pts.length === 1
          ? width / 2
          : padX + (idx / Math.max(1, pts.length - 1)) * (width - padX * 2);
      const y = height - padY - ((val - minVal) / span) * (height - padY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };

    return {
      width,
      height,
      valuePoints: pts.map((p, i) => toCoord(i, p.marketValueInr)).join(' '),
      costPoints: pts.map((p, i) => toCoord(i, p.costBasisInr)).join(' '),
      minVal,
      maxVal,
    };
  }, [portfolio.history]);

  if (!user || !account) return null;

  const completedOrders = orders.filter((o) => o.status === 'COMPLETED');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Portfolio Tracker &amp; Tax Reporting Center
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Live INR valuation ({freshness} CoinGecko feed), weighted-average cost basis, realized &amp;
            unrealized P&amp;L, and Section 194S 1% TDS / Section 115BBH VDA statements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loadingMarkets}
            onClick={() => void loadMarkets()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMarkets ? 'animate-spin' : ''}`} />
            Refresh Spot
          </button>
          <button
            type="button"
            onClick={() =>
              triggerCsvDownload(
                `CoinBridge_Portfolio_${account.username}.csv`,
                generatePortfolioCsv(portfolio)
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Portfolio CSV
          </button>
          <button
            type="button"
            onClick={() =>
              downloadPortfolioReportPdf({
                username: account.username,
                portfolio,
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 dark:hover:bg-blue-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Portfolio PDF
          </button>
        </div>
      </div>

      {/* Portfolio KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Portfolio Value</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatInrNum(portfolio.totalValueInr)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Across {portfolio.holdings.length} active asset(s)
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Cost Basis</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatInrNum(portfolio.totalCostBasisInr)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Weighted-average entry
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Unrealized P&amp;L</div>
          <div
            className={`mt-1 font-mono text-xl font-bold tabular-nums ${
              portfolio.totalUnrealizedPnlInr >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {portfolio.totalUnrealizedPnlInr >= 0 ? '+' : ''}
            {formatInrNum(portfolio.totalUnrealizedPnlInr)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Mark-to-CoinGecko spot
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Realized P&amp;L</div>
          <div
            className={`mt-1 font-mono text-xl font-bold tabular-nums ${
              portfolio.totalRealizedPnlInr >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {portfolio.totalRealizedPnlInr >= 0 ? '+' : ''}
            {formatInrNum(portfolio.totalRealizedPnlInr)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            From settled sell orders
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Sec 194S 1% TDS</div>
          <div className="mt-1 font-mono text-xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">
            {formatInrNum(portfolio.totalTdsPaidInr)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Recorded across P2P trades
          </div>
        </div>
      </div>

      {/* Historical Portfolio Performance & Asset Allocation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Historical Portfolio Valuation vs. Cost Basis
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              {portfolio.history.length} ledger checkpoint(s)
            </span>
          </div>

          {!chartGeometry ? (
            <div className="h-44 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
              Complete a P2P order or sandbox USDT deposit to generate your chronological valuation curve.
            </div>
          ) : (
            <div className="space-y-2">
              <svg
                viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
                className="w-full h-44 overflow-visible"
              >
                <polyline
                  fill="none"
                  stroke="#94A3B8"
                  strokeDasharray="4 4"
                  strokeWidth="2"
                  points={chartGeometry.costPoints}
                />
                <polyline
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth="2.5"
                  points={chartGeometry.valuePoints}
                />
              </svg>
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span>Blue: Mark-to-Market Value (INR)</span>
                <span>Dashed: Cumulative Cost Basis (INR)</span>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <PieChart className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Asset-Wise Allocation
            </h3>
          </div>

          {portfolio.holdings.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No cryptocurrency holdings recorded in your ledger yet.
            </p>
          ) : (
            <div className="space-y-3">
              {portfolio.holdings.map((h) => (
                <div key={h.symbol} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                      <CoinBadge symbol={h.symbol} size="xs" />
                      <span>{h.symbol}</span>
                      <span className="font-mono text-slate-500 dark:text-slate-400 font-normal tabular-nums">
                        {h.quantity.toFixed(h.symbol === 'USDT' ? 2 : 6)}
                      </span>
                    </div>
                    <div className="font-mono tabular-nums text-slate-900 dark:text-slate-100 font-semibold">
                      {formatInrNum(h.marketValueInr)} ({h.allocationPct.toFixed(1)}%)
                    </div>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600"
                      style={{ width: `${Math.min(100, Math.max(2, h.allocationPct))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Holdings Breakdown Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Asset Cost Basis &amp; P&amp;L Breakdown
          </h3>
        </div>
        {portfolio.holdings.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No settled trades or credited deposits yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-medium">Asset</th>
                  <th className="py-2.5 px-4 font-medium text-right">Quantity</th>
                  <th className="py-2.5 px-4 font-medium text-right">Avg Purchase Price</th>
                  <th className="py-2.5 px-4 font-medium text-right">Live Spot INR</th>
                  <th className="py-2.5 px-4 font-medium text-right">Market Value</th>
                  <th className="py-2.5 px-4 font-medium text-right">Unrealized P&amp;L</th>
                  <th className="py-2.5 px-4 font-medium text-right">Realized P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {portfolio.holdings.map((h) => (
                  <tr key={h.symbol}>
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <CoinBadge symbol={h.symbol} size="xs" />
                        <span>{h.symbol}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {h.quantity.toFixed(6)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatInrNum(h.avgCostInr)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatInrNum(h.currentPriceInr)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {formatInrNum(h.marketValueInr)}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums font-semibold ${
                        h.unrealizedPnlInr >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {h.unrealizedPnlInr >= 0 ? '+' : ''}
                      {formatInrNum(h.unrealizedPnlInr)} ({h.unrealizedPnlPct.toFixed(1)}%)
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums font-semibold ${
                        h.realizedPnlInr >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {h.realizedPnlInr >= 0 ? '+' : ''}
                      {formatInrNum(h.realizedPnlInr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tax & Reporting Center */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Tax &amp; Reporting Center (India VDA / Sec 194S &amp; Sec 115BBH)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Download transaction statements, realized P&amp;L schedules, and Section 194S TDS summaries.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                triggerCsvDownload(
                  `CoinBridge_Tax_Statement_${account.username}.csv`,
                  generateTaxTransactionsCsv({
                    uid: user.uid,
                    orders,
                    deposits,
                    withdrawals,
                  })
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Export Statements CSV
            </button>
            <button
              type="button"
              onClick={() =>
                downloadTaxStatementPdf({
                  username: account.username,
                  tax: taxReport,
                  isSandbox: platformSettings.sandboxMode,
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              Download Tax &amp; TDS PDF
            </button>
          </div>
        </div>

        <div className="px-5 pt-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap gap-2">
          {(
            [
              ['TAX_SUMMARY', 'Tax & TDS Summary'],
              ['P2P_TRADES', `Buy / Sell Statement (${completedOrders.length})`],
              ['WALLET_FLOWS', `Deposits & Withdrawals (${deposits.length + withdrawals.length})`],
            ] as [StatementTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatementTab(id)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 cursor-pointer ${
                statementTab === id
                  ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {statementTab === 'TAX_SUMMARY' && (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500 dark:text-slate-400">Buy Volume ({taxReport.buyOrderCount} orders)</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatInrNum(taxReport.totalBuyInr)}
                </div>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500 dark:text-slate-400">Sell Volume ({taxReport.sellOrderCount} orders)</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatInrNum(taxReport.totalSellInr)}
                </div>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500 dark:text-slate-400">Section 194S 1% TDS</div>
                <div className="mt-1 font-mono text-base font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                  {formatInrNum(taxReport.totalSection194STdsInr)}
                </div>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="text-slate-500 dark:text-slate-400">Sec 115BBH 30% Estimate</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatInrNum(taxReport.estimatedVdaTax30PctInr)}
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Informational Tax Summary Only: Section 115BBH imposes a flat 30% tax on positive VDA gains without loss set-off, while Section 194S mandates 1% TDS on qualifying transfers. Consult a qualified Chartered Accountant prior to filing.
            </p>
          </div>
        )}

        {statementTab === 'P2P_TRADES' && (
          <div className="overflow-x-auto">
            {completedOrders.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No settled Buy/Sell P2P orders recorded yet.
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4 font-medium">Order</th>
                    <th className="py-2.5 px-4 font-medium">Side</th>
                    <th className="py-2.5 px-4 font-medium text-right">Quantity</th>
                    <th className="py-2.5 px-4 font-medium text-right">INR Value</th>
                    <th className="py-2.5 px-4 font-medium text-right">Sec 194S TDS</th>
                    <th className="py-2.5 px-4 font-medium text-right">PDF Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {completedOrders.map((o) => {
                    const sym = (o.asset || 'USDT').toUpperCase();
                    const qtyText =
                      typeof o.quantityE8 === 'number'
                        ? `${formatCoinQuantityFromE8(o.quantityE8, 6)} ${sym}`
                        : formatUsdtFromMicro(o.usdtMicro, 2);
                    const isBuy = o.buyerUid === user.uid;
                    return (
                      <tr key={o.id}>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {o.orderCode}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">
                          {isBuy ? `BUY ${sym}` : `SELL ${sym}`}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {qtyText}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatInrFromPaise(o.inrPaise)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {formatInrFromPaise(o.tdsInrPaise)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              downloadTransactionReceiptPdf({
                                kind: 'P2P_ORDER',
                                transactionId: o.id,
                                orderId: o.orderCode,
                                asset: sym,
                                cryptoAmount: qtyText,
                                inrAmount: formatInrFromPaise(o.inrPaise),
                                exchangeRate: formatRateInr(o.rateInrPaise),
                                feesSummary: `${((o.feeE8 ?? o.feeUsdtMicro * 100) / 1e8).toFixed(6)} ${sym}`,
                                tdsSummary: formatInrFromPaise(o.tdsInrPaise),
                                dateIso: o.createdAt?.toDate
                                  ? o.createdAt.toDate().toISOString()
                                  : new Date().toISOString(),
                                status: o.status,
                                counterpartyOrAddress: `@${isBuy ? o.sellerUsername : o.buyerUsername}`,
                                network: o.network,
                                blockchainTxHash: o.escrowTxHash || o.paymentRef,
                                isSandbox: o.isSandbox,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
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
            )}
          </div>
        )}

        {statementTab === 'WALLET_FLOWS' && (
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Credited Deposits ({taxReport.depositCount})
              </div>
              <div className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                +{taxReport.totalDepositedUsdt.toFixed(2)} USDT
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
                {deposits.map((d) => (
                  <div key={d.id} className="py-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-slate-600 dark:text-slate-400 truncate">
                      {d.network} · {d.txHash.slice(0, 12)}...
                    </span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                      +{(d.amountMicro / MICRO_PER_USDT).toFixed(2)} USDT ({d.status})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Completed Withdrawals ({taxReport.withdrawalCount})
              </div>
              <div className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                -{taxReport.totalWithdrawnUsdt.toFixed(2)} USDT
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
                {withdrawals.map((w) => (
                  <div key={w.id} className="py-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-slate-600 dark:text-slate-400 truncate">
                      {w.network} · {w.destinationAddress.slice(0, 12)}...
                    </span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                      -{(w.requestedAmountMicro / MICRO_PER_USDT).toFixed(2)} USDT ({w.status})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
