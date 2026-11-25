import { jsPDF } from 'jspdf';
import type { PortfolioAnalyticsResult, TaxSummaryReport } from './portfolioAndTax';

export interface ReceiptPdfPayload {
  kind: 'P2P_ORDER' | 'DEPOSIT' | 'WITHDRAWAL';
  transactionId: string;
  orderId?: string;
  asset: string;
  cryptoAmount: string;
  inrAmount: string;
  exchangeRate: string;
  feesSummary: string;
  tdsSummary?: string;
  dateIso: string;
  status: string;
  counterpartyOrAddress: string;
  network: string;
  blockchainTxHash?: string;
  isSandbox: boolean;
}

function addDocumentHeader(doc: jsPDF, title: string, subtitle: string) {
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('CoinBridge P2P Exchange', 16, 14);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(title, 16, 21);
  doc.text(subtitle, 16, 27);
  doc.setTextColor(15, 23, 42);
}

export function downloadTransactionReceiptPdf(payload: ReceiptPdfPayload): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const kindLabel =
    payload.kind === 'P2P_ORDER'
      ? 'P2P Order Settlement Receipt'
      : payload.kind === 'DEPOSIT'
        ? 'Crypto Deposit Receipt'
        : 'Crypto Withdrawal Receipt';

  addDocumentHeader(
    doc,
    kindLabel,
    `Generated ${new Date().toISOString()} · ${payload.isSandbox ? 'SANDBOX LEDGER' : 'LIVE SETTLEMENT'}`
  );

  let y = 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Transaction Details', 16, y);
  y += 6;

  doc.setDrawColor(226, 232, 240);
  doc.line(16, y, 194, y);
  y += 8;

  const rows: [string, string][] = [
    ['Transaction ID', payload.transactionId],
    ...(payload.orderId ? [['Order ID', payload.orderId] as [string, string]] : []),
    ['Asset Symbol', payload.asset],
    ['Crypto Amount', payload.cryptoAmount],
    ['INR Amount', payload.inrAmount],
    ['Exchange Rate', payload.exchangeRate],
    ['Platform & Network Fees', payload.feesSummary],
    ...(payload.tdsSummary ? [['Section 194S 1% TDS', payload.tdsSummary] as [string, string]] : []),
    ['Network', payload.network],
    ['Counterparty / Wallet', payload.counterpartyOrAddress],
    ['Date (UTC)', payload.dateIso],
    ['Settlement Status', payload.status],
    ['Blockchain Tx Hash', payload.blockchainTxHash || 'Off-chain / Sandbox Escrow Ledger'],
  ];

  doc.setFontSize(9.5);
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(label, 16, y);
    doc.setFont('courier', 'normal');
    doc.setTextColor(15, 23, 42);
    const wrapped = doc.splitTextToSize(String(value || '—'), 115);
    doc.text(wrapped, 75, y);
    y += Math.max(7, wrapped.length * 5);
  }

  y += 6;
  doc.setDrawColor(226, 232, 240);
  doc.line(16, y, 194, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const disclaimer =
    'This digital transaction receipt reflects verified ledger records on CoinBridge P2P Exchange. ' +
    (payload.isSandbox
      ? 'SANDBOX MODE NOTICE: Figures represent simulated testnet/escrow operations and not real fiat or mainnet transfers.'
      : 'Subject to Indian VDA compliance (PMLA, FIU-IND, and Income Tax Section 194S).');
  doc.text(doc.splitTextToSize(disclaimer, 178), 16, y);

  const safeId = payload.transactionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  doc.save(`CoinBridge_Receipt_${safeId}.pdf`);
}

export function downloadPortfolioReportPdf(params: {
  username: string;
  portfolio: PortfolioAnalyticsResult;
}): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  addDocumentHeader(
    doc,
    'Portfolio Valuation & P&L Statement',
    `Account @${params.username} · Generated ${new Date().toISOString()}`
  );

  let y = 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Portfolio Summary (INR)', 16, y);
  y += 8;

  const summaryRows: [string, string][] = [
    ['Total Market Value', `INR ${params.portfolio.totalValueInr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
    ['Total Cost Basis', `INR ${params.portfolio.totalCostBasisInr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
    ['Unrealized P&L', `INR ${params.portfolio.totalUnrealizedPnlInr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
    ['Realized P&L', `INR ${params.portfolio.totalRealizedPnlInr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
    ['Total Sec 194S TDS Recorded', `INR ${params.portfolio.totalTdsPaidInr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
  ];

  doc.setFontSize(9.5);
  for (const [k, v] of summaryRows) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(k, 16, y);
    doc.setFont('courier', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(v, 90, y);
    y += 7;
  }

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Asset-Wise Allocation', 16, y);
  y += 7;

  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Asset', 16, y);
  doc.text('Quantity', 38, y);
  doc.text('Avg Buy', 75, y);
  doc.text('Spot INR', 105, y);
  doc.text('Value INR', 138, y);
  doc.text('Alloc %', 175, y);
  y += 4;
  doc.line(16, y, 194, y);
  y += 6;

  doc.setFont('courier', 'normal');
  doc.setTextColor(15, 23, 42);
  for (const h of params.portfolio.holdings) {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.text(h.symbol, 16, y);
    doc.text(h.quantity.toFixed(6), 38, y);
    doc.text(h.avgCostInr.toFixed(2), 75, y);
    doc.text(h.currentPriceInr.toFixed(2), 105, y);
    doc.text(h.marketValueInr.toFixed(2), 138, y);
    doc.text(`${h.allocationPct.toFixed(1)}%`, 175, y);
    y += 6;
  }

  doc.save(`CoinBridge_Portfolio_${params.username}.pdf`);
}

export function downloadTaxStatementPdf(params: {
  username: string;
  tax: TaxSummaryReport;
  isSandbox: boolean;
}): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  addDocumentHeader(
    doc,
    'VDA Tax, P&L & Section 194S TDS Statement',
    `Account @${params.username} · ${params.isSandbox ? 'SANDBOX' : 'LIVE'} · ${new Date().toISOString()}`
  );

  let y = 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Trading & Tax Compliance Summary', 16, y);
  y += 8;

  const rows: [string, string][] = [
    ['Completed Buy Orders', `${params.tax.buyOrderCount} (INR ${params.tax.totalBuyInr.toFixed(2)})`],
    ['Completed Sell Orders', `${params.tax.sellOrderCount} (INR ${params.tax.totalSellInr.toFixed(2)})`],
    ['Estimated Platform Fees (INR eq.)', `INR ${params.tax.totalFeesUsdtApproxInr.toFixed(2)}`],
    ['Section 194S 1% TDS Recorded', `INR ${params.tax.totalSection194STdsInr.toFixed(2)}`],
    ['Weighted-Average Realized P&L', `INR ${params.tax.realizedGainsInr.toFixed(2)}`],
    ['Informational 30% VDA Tax (Sec 115BBH)', `INR ${params.tax.estimatedVdaTax30PctInr.toFixed(2)}`],
    ['Credited Deposits', `${params.tax.depositCount} (${params.tax.totalDepositedUsdt.toFixed(2)} USDT)`],
    ['Completed Withdrawals', `${params.tax.withdrawalCount} (${params.tax.totalWithdrawnUsdt.toFixed(2)} USDT)`],
  ];

  doc.setFontSize(9.5);
  for (const [k, v] of rows) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(k, 16, y);
    doc.setFont('courier', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(v, 95, y);
    y += 8;
  }

  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    doc.splitTextToSize(
      'Informational Summary Only: Consult a qualified Chartered Accountant before filing Income Tax returns under Section 115BBH and Section 194S.',
      178
    ),
    16,
    y
  );

  doc.save(`CoinBridge_Tax_TDS_Report_${params.username}.pdf`);
}
