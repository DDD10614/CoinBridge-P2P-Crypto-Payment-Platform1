import { MICRO_PER_USDT, PAISE_PER_INR } from './domain';
import { E8_PER_COIN, type CoinMarketQuote } from './coins';
import type {
  DepositTransactionDoc,
  MerchantProfileDoc,
  P2POfferDoc,
  P2POrderDoc,
  WalletLedgerDoc,
  WithdrawalTransactionDoc,
} from '../types/models';

export interface AssetHoldingSummary {
  symbol: string;
  quantity: number;
  avgCostInr: number;
  currentPriceInr: number;
  marketValueInr: number;
  costBasisInr: number;
  unrealizedPnlInr: number;
  unrealizedPnlPct: number;
  realizedPnlInr: number;
  allocationPct: number;
  totalBoughtQty: number;
  totalSoldQty: number;
}

export interface PortfolioHistoryPoint {
  dateLabel: string;
  timestampMs: number;
  costBasisInr: number;
  marketValueInr: number;
}

export interface PortfolioAnalyticsResult {
  totalValueInr: number;
  totalCostBasisInr: number;
  totalUnrealizedPnlInr: number;
  totalRealizedPnlInr: number;
  totalTdsPaidInr: number;
  holdings: AssetHoldingSummary[];
  history: PortfolioHistoryPoint[];
}

function getOrderTimestampMs(order: P2POrderDoc): number {
  if (typeof order.completedAtMs === 'number' && order.completedAtMs > 0) return order.completedAtMs;
  return order.updatedAt?.toMillis?.() || order.createdAt?.toMillis?.() || Date.now();
}

function getOrderAssetQty(order: P2POrderDoc): number {
  if (typeof order.quantityE8 === 'number' && order.quantityE8 > 0) {
    return order.quantityE8 / E8_PER_COIN;
  }
  return (order.usdtMicro || 0) / MICRO_PER_USDT;
}

/**
 * Computes portfolio valuation, weighted-average cost basis, realized P&L,
 * unrealized P&L, asset allocation, and chronological valuation curve
 * strictly from the user's real completed P2P orders, credited deposits,
 * completed withdrawals, and live CoinGecko INR quotes.
 */
export function computePortfolioAnalytics(params: {
  uid: string;
  orders: P2POrderDoc[];
  deposits: DepositTransactionDoc[];
  withdrawals: WithdrawalTransactionDoc[];
  walletLedger: WalletLedgerDoc | null;
  marketQuotes: Record<string, CoinMarketQuote>;
  fallbackUsdtInr: number;
}): PortfolioAnalyticsResult {
  const { uid, orders, deposits, withdrawals, walletLedger, marketQuotes, fallbackUsdtInr } = params;

  const getSpotInr = (sym: string): number => {
    const clean = sym.toUpperCase();
    const quote = marketQuotes[clean];
    if (quote && typeof quote.inrPrice === 'number' && quote.inrPrice > 0) return quote.inrPrice;
    if (clean === 'USDT' || clean === 'USDC') return fallbackUsdtInr;
    return 0;
  };

  interface LotAcc {
    qty: number;
    costInr: number;
    realizedPnlInr: number;
    totalBoughtQty: number;
    totalSoldQty: number;
    lastUnitPriceInr: number;
  }
  const accMap = new Map<string, LotAcc>();
  const ensureAcc = (sym: string): LotAcc => {
    const k = sym.toUpperCase();
    let existing = accMap.get(k);
    if (!existing) {
      existing = {
        qty: 0,
        costInr: 0,
        realizedPnlInr: 0,
        totalBoughtQty: 0,
        totalSoldQty: 0,
        lastUnitPriceInr: getSpotInr(k),
      };
      accMap.set(k, existing);
    }
    return existing;
  };

  type LedgerEvent = {
    ts: number;
    symbol: string;
    kind: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL';
    qty: number;
    inrValue: number;
    unitPriceInr: number;
  };

  const timeline: LedgerEvent[] = [];
  let totalTdsPaidInr = 0;

  for (const ord of orders) {
    if (ord.status !== 'COMPLETED') continue;
    const sym = (ord.asset || 'USDT').toUpperCase();
    const qty = getOrderAssetQty(ord);
    const inrValue = (ord.inrPaise || 0) / PAISE_PER_INR;
    const unitPriceInr = (ord.rateInrPaise || 0) / PAISE_PER_INR;
    totalTdsPaidInr += (ord.tdsInrPaise || 0) / PAISE_PER_INR;

    if (ord.buyerUid === uid) {
      timeline.push({
        ts: getOrderTimestampMs(ord),
        symbol: sym,
        kind: 'BUY',
        qty,
        inrValue,
        unitPriceInr,
      });
    } else if (ord.sellerUid === uid) {
      timeline.push({
        ts: getOrderTimestampMs(ord),
        symbol: sym,
        kind: 'SELL',
        qty,
        inrValue,
        unitPriceInr,
      });
    }
  }

  for (const dep of deposits) {
    if (dep.status !== 'CREDITED') continue;
    const qty = dep.amountMicro / MICRO_PER_USDT;
    const spot = getSpotInr('USDT');
    timeline.push({
      ts: dep.creditedAtMs || dep.updatedAt?.toMillis?.() || dep.createdAt?.toMillis?.() || Date.now(),
      symbol: 'USDT',
      kind: 'DEPOSIT',
      qty,
      inrValue: qty * spot,
      unitPriceInr: spot,
    });
  }

  for (const wd of withdrawals) {
    if (wd.status !== 'COMPLETED') continue;
    const qty = wd.totalDebitMicro / MICRO_PER_USDT;
    const spot = getSpotInr('USDT');
    timeline.push({
      ts: wd.updatedAt?.toMillis?.() || wd.createdAt?.toMillis?.() || Date.now(),
      symbol: 'USDT',
      kind: 'WITHDRAWAL',
      qty,
      inrValue: qty * spot,
      unitPriceInr: spot,
    });
  }

  timeline.sort((a, b) => a.ts - b.ts);

  const history: PortfolioHistoryPoint[] = [];

  for (const ev of timeline) {
    const acc = ensureAcc(ev.symbol);
    acc.lastUnitPriceInr = ev.unitPriceInr || getSpotInr(ev.symbol);

    if (ev.kind === 'BUY' || ev.kind === 'DEPOSIT') {
      acc.qty += ev.qty;
      acc.costInr += ev.inrValue;
      if (ev.kind === 'BUY') acc.totalBoughtQty += ev.qty;
    } else if (ev.kind === 'SELL' || ev.kind === 'WITHDRAWAL') {
      const avgCost = acc.qty > 0 ? acc.costInr / acc.qty : ev.unitPriceInr;
      const qtyReduced = Math.min(acc.qty, ev.qty);
      const removedCost = qtyReduced * avgCost;
      if (ev.kind === 'SELL') {
        acc.realizedPnlInr += ev.inrValue - ev.qty * avgCost;
        acc.totalSoldQty += ev.qty;
      }
      acc.qty = Math.max(0, acc.qty - qtyReduced);
      acc.costInr = Math.max(0, acc.costInr - removedCost);
    }

    let snapCost = 0;
    let snapValue = 0;
    for (const [sym, a] of accMap.entries()) {
      snapCost += a.costInr;
      snapValue += a.qty * (getSpotInr(sym) || a.lastUnitPriceInr);
    }
    history.push({
      dateLabel: new Date(ev.ts).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      timestampMs: ev.ts,
      costBasisInr: Number(snapCost.toFixed(2)),
      marketValueInr: Number(snapValue.toFixed(2)),
    });
  }

  // Reconcile USDT ledger available + reserved if on-chain/escrow wallet holds USDT
  if (walletLedger) {
    const ledgerUsdt =
      (walletLedger.availableUsdtMicro + walletLedger.reservedUsdtMicro) / MICRO_PER_USDT;
    if (ledgerUsdt > 0) {
      const usdtAcc = ensureAcc('USDT');
      if (ledgerUsdt > usdtAcc.qty) {
        const delta = ledgerUsdt - usdtAcc.qty;
        usdtAcc.qty = ledgerUsdt;
        usdtAcc.costInr += delta * getSpotInr('USDT');
      }
    }
  }

  const holdingsRaw: Omit<AssetHoldingSummary, 'allocationPct'>[] = [];
  let totalValueInr = 0;
  let totalCostBasisInr = 0;
  let totalUnrealizedPnlInr = 0;
  let totalRealizedPnlInr = 0;

  for (const [symbol, acc] of accMap.entries()) {
    const spot = getSpotInr(symbol);
    const marketValueInr = acc.qty * spot;
    const avgCostInr = acc.qty > 0 ? acc.costInr / acc.qty : 0;
    const unrealizedPnlInr = marketValueInr - acc.costInr;
    const unrealizedPnlPct = acc.costInr > 0 ? (unrealizedPnlInr / acc.costInr) * 100 : 0;

    totalValueInr += marketValueInr;
    totalCostBasisInr += acc.costInr;
    totalUnrealizedPnlInr += unrealizedPnlInr;
    totalRealizedPnlInr += acc.realizedPnlInr;

    if (acc.qty > 0 || acc.totalBoughtQty > 0 || acc.totalSoldQty > 0) {
      holdingsRaw.push({
        symbol,
        quantity: Number(acc.qty.toFixed(8)),
        avgCostInr: Number(avgCostInr.toFixed(2)),
        currentPriceInr: Number(spot.toFixed(2)),
        marketValueInr: Number(marketValueInr.toFixed(2)),
        costBasisInr: Number(acc.costInr.toFixed(2)),
        unrealizedPnlInr: Number(unrealizedPnlInr.toFixed(2)),
        unrealizedPnlPct: Number(unrealizedPnlPct.toFixed(2)),
        realizedPnlInr: Number(acc.realizedPnlInr.toFixed(2)),
        totalBoughtQty: Number(acc.totalBoughtQty.toFixed(8)),
        totalSoldQty: Number(acc.totalSoldQty.toFixed(8)),
      });
    }
  }

  const holdings: AssetHoldingSummary[] = holdingsRaw
    .map((h) => ({
      ...h,
      allocationPct:
        totalValueInr > 0 ? Number(((h.marketValueInr / totalValueInr) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.marketValueInr - a.marketValueInr);

  return {
    totalValueInr: Number(totalValueInr.toFixed(2)),
    totalCostBasisInr: Number(totalCostBasisInr.toFixed(2)),
    totalUnrealizedPnlInr: Number(totalUnrealizedPnlInr.toFixed(2)),
    totalRealizedPnlInr: Number(totalRealizedPnlInr.toFixed(2)),
    totalTdsPaidInr: Number(totalTdsPaidInr.toFixed(2)),
    holdings,
    history,
  };
}

export interface TaxSummaryReport {
  buyOrderCount: number;
  sellOrderCount: number;
  totalBuyInr: number;
  totalSellInr: number;
  totalFeesUsdtApproxInr: number;
  totalSection194STdsInr: number;
  realizedGainsInr: number;
  estimatedVdaTax30PctInr: number;
  depositCount: number;
  totalDepositedUsdt: number;
  withdrawalCount: number;
  totalWithdrawnUsdt: number;
}

export function computeTaxAndComplianceReport(params: {
  uid: string;
  orders: P2POrderDoc[];
  deposits: DepositTransactionDoc[];
  withdrawals: WithdrawalTransactionDoc[];
  portfolio: PortfolioAnalyticsResult;
}): TaxSummaryReport {
  const { uid, orders, deposits, withdrawals, portfolio } = params;

  let buyOrderCount = 0;
  let sellOrderCount = 0;
  let totalBuyInr = 0;
  let totalSellInr = 0;
  let totalFeesUsdtApproxInr = 0;
  let totalSection194STdsInr = 0;

  for (const o of orders) {
    if (o.status !== 'COMPLETED') continue;
    const inr = (o.inrPaise || 0) / PAISE_PER_INR;
    const tds = (o.tdsInrPaise || 0) / PAISE_PER_INR;
    const feeQty =
      typeof o.feeE8 === 'number'
        ? o.feeE8 / E8_PER_COIN
        : (o.feeUsdtMicro || 0) / MICRO_PER_USDT;
    totalFeesUsdtApproxInr += feeQty * ((o.rateInrPaise || 0) / PAISE_PER_INR);
    totalSection194STdsInr += tds;
    if (o.buyerUid === uid) {
      buyOrderCount += 1;
      totalBuyInr += inr;
    } else if (o.sellerUid === uid) {
      sellOrderCount += 1;
      totalSellInr += inr;
    }
  }

  const creditedDeposits = deposits.filter((d) => d.status === 'CREDITED');
  const completedWithdrawals = withdrawals.filter((w) => w.status === 'COMPLETED');

  const realizedGainsInr = portfolio.totalRealizedPnlInr;
  // Sec 115BBH informational estimate: 30% on positive realized VDA gains (no loss set-off assumed)
  const estimatedVdaTax30PctInr = realizedGainsInr > 0 ? realizedGainsInr * 0.3 : 0;

  return {
    buyOrderCount,
    sellOrderCount,
    totalBuyInr: Number(totalBuyInr.toFixed(2)),
    totalSellInr: Number(totalSellInr.toFixed(2)),
    totalFeesUsdtApproxInr: Number(totalFeesUsdtApproxInr.toFixed(2)),
    totalSection194STdsInr: Number(totalSection194STdsInr.toFixed(2)),
    realizedGainsInr: Number(realizedGainsInr.toFixed(2)),
    estimatedVdaTax30PctInr: Number(estimatedVdaTax30PctInr.toFixed(2)),
    depositCount: creditedDeposits.length,
    totalDepositedUsdt: Number(
      creditedDeposits.reduce((s, d) => s + d.amountMicro / MICRO_PER_USDT, 0).toFixed(2)
    ),
    withdrawalCount: completedWithdrawals.length,
    totalWithdrawnUsdt: Number(
      completedWithdrawals.reduce((s, w) => s + w.requestedAmountMicro / MICRO_PER_USDT, 0).toFixed(2)
    ),
  };
}

export interface CoinLiquidityDepth {
  symbol: string;
  sellLiquidityUnits: number;
  buyLiquidityUnits: number;
  sellLiquidityInr: number;
  buyLiquidityInr: number;
  activeOfferCount: number;
  verifiedOfferCount: number;
  demoOfferCount: number;
  bestAskInr: number | null;
  bestBidInr: number | null;
  spotInr: number | null;
  spreadPct: number | null;
}

export interface ExchangeLiquidityDashboardStats {
  totalSellLiquidityInr: number;
  totalBuyLiquidityInr: number;
  totalActiveOffers: number;
  verifiedMerchantCount: number;
  demoMerchantCount: number;
  buyOrderDemandCount: number;
  sellOrderDemandCount: number;
  avgMarketSpreadPct: number;
  coinBreakdown: CoinLiquidityDepth[];
}

export function computeExchangeLiquidityStats(params: {
  offers: P2POfferDoc[];
  orders: P2POrderDoc[];
  merchants: MerchantProfileDoc[];
  marketQuotes: Record<string, CoinMarketQuote>;
}): ExchangeLiquidityDashboardStats {
  const { offers, orders, merchants, marketQuotes } = params;

  const coinMap = new Map<
    string,
    {
      sellUnits: number;
      buyUnits: number;
      sellInr: number;
      buyInr: number;
      activeOfferCount: number;
      verifiedOfferCount: number;
      demoOfferCount: number;
      asks: number[];
      bids: number[];
    }
  >();

  const ensureCoin = (sym: string) => {
    const k = sym.toUpperCase();
    let entry = coinMap.get(k);
    if (!entry) {
      entry = {
        sellUnits: 0,
        buyUnits: 0,
        sellInr: 0,
        buyInr: 0,
        activeOfferCount: 0,
        verifiedOfferCount: 0,
        demoOfferCount: 0,
        asks: [],
        bids: [],
      };
      coinMap.set(k, entry);
    }
    return entry;
  };

  let totalSellLiquidityInr = 0;
  let totalBuyLiquidityInr = 0;
  let totalActiveOffers = 0;

  for (const off of offers) {
    if (!off.isActive) continue;
    totalActiveOffers += 1;
    const sym = (off.asset || 'USDT').toUpperCase();
    const bucket = ensureCoin(sym);
    const units =
      typeof off.availableAssetE8 === 'number'
        ? off.availableAssetE8 / E8_PER_COIN
        : (off.availableUsdtMicro || 0) / MICRO_PER_USDT;
    const rateInr = (off.rateInrPaise || 0) / PAISE_PER_INR;
    const valueInr = units * rateInr;

    bucket.activeOfferCount += 1;
    if (off.isDemo) bucket.demoOfferCount += 1;
    else bucket.verifiedOfferCount += 1;

    if (off.side === 'SELL_USDT' || off.side === 'SELL') {
      bucket.sellUnits += units;
      bucket.sellInr += valueInr;
      bucket.asks.push(rateInr);
      totalSellLiquidityInr += valueInr;
    } else {
      bucket.buyUnits += units;
      bucket.buyInr += valueInr;
      bucket.bids.push(rateInr);
      totalBuyLiquidityInr += valueInr;
    }
  }

  const spreads: number[] = [];
  const coinBreakdown: CoinLiquidityDepth[] = Array.from(coinMap.entries())
    .map(([symbol, b]) => {
      const bestAskInr = b.asks.length > 0 ? Math.min(...b.asks) : null;
      const bestBidInr = b.bids.length > 0 ? Math.max(...b.bids) : null;
      const spotInr = marketQuotes[symbol]?.inrPrice ?? null;
      let spreadPct: number | null = null;
      if (bestAskInr && bestBidInr && bestAskInr > 0) {
        spreadPct = Number((((bestAskInr - bestBidInr) / bestAskInr) * 100).toFixed(2));
        spreads.push(Math.abs(spreadPct));
      } else if (bestAskInr && spotInr && spotInr > 0) {
        spreadPct = Number((((bestAskInr - spotInr) / spotInr) * 100).toFixed(2));
        spreads.push(Math.abs(spreadPct));
      }
      return {
        symbol,
        sellLiquidityUnits: Number(b.sellUnits.toFixed(6)),
        buyLiquidityUnits: Number(b.buyUnits.toFixed(6)),
        sellLiquidityInr: Number(b.sellInr.toFixed(2)),
        buyLiquidityInr: Number(b.buyInr.toFixed(2)),
        activeOfferCount: b.activeOfferCount,
        verifiedOfferCount: b.verifiedOfferCount,
        demoOfferCount: b.demoOfferCount,
        bestAskInr,
        bestBidInr,
        spotInr,
        spreadPct,
      };
    })
    .sort((a, b) => b.sellLiquidityInr + b.buyLiquidityInr - (a.sellLiquidityInr + a.buyLiquidityInr));

  const buyOrderDemandCount = orders.filter(
    (o) => o.side === 'BUY_USDT' || o.side === 'BUY'
  ).length;
  const sellOrderDemandCount = orders.filter(
    (o) => o.side === 'SELL_USDT' || o.side === 'SELL'
  ).length;

  const verifiedMerchantCount = merchants.filter((m) => !m.isDemo && m.isAvailable).length;
  const demoMerchantCount = merchants.filter((m) => Boolean(m.isDemo) && m.isAvailable).length;
  const avgMarketSpreadPct =
    spreads.length > 0
      ? Number((spreads.reduce((s, v) => s + v, 0) / spreads.length).toFixed(2))
      : 0;

  return {
    totalSellLiquidityInr: Number(totalSellLiquidityInr.toFixed(2)),
    totalBuyLiquidityInr: Number(totalBuyLiquidityInr.toFixed(2)),
    totalActiveOffers,
    verifiedMerchantCount,
    demoMerchantCount,
    buyOrderDemandCount,
    sellOrderDemandCount,
    avgMarketSpreadPct,
    coinBreakdown,
  };
}

function escapeCsvCell(v: unknown): string {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function generatePortfolioCsv(portfolio: PortfolioAnalyticsResult): string {
  const header = [
    'Asset',
    'Quantity',
    'Avg Cost (INR)',
    'Live Spot (INR)',
    'Market Value (INR)',
    'Cost Basis (INR)',
    'Unrealized P&L (INR)',
    'Realized P&L (INR)',
    'Allocation %',
  ];
  const rows = portfolio.holdings.map((h) => [
    h.symbol,
    h.quantity,
    h.avgCostInr,
    h.currentPriceInr,
    h.marketValueInr,
    h.costBasisInr,
    h.unrealizedPnlInr,
    h.realizedPnlInr,
    h.allocationPct,
  ]);
  return [header, ...rows].map((r) => r.map(escapeCsvCell).join(',')).join('\n');
}

export function generateTaxTransactionsCsv(params: {
  uid: string;
  orders: P2POrderDoc[];
  deposits: DepositTransactionDoc[];
  withdrawals: WithdrawalTransactionDoc[];
}): string {
  const header = [
    'Type',
    'Reference / Order Code',
    'Asset',
    'Quantity',
    'INR Value',
    'Rate (INR)',
    'Sec 194S TDS (INR)',
    'Status',
    'Timestamp',
  ];
  const rows: (string | number)[][] = [];

  for (const o of params.orders) {
    const role = o.buyerUid === params.uid ? 'P2P_BUY' : 'P2P_SELL';
    const qty = getOrderAssetQty(o);
    rows.push([
      role,
      o.orderCode,
      o.asset || 'USDT',
      qty,
      (o.inrPaise / PAISE_PER_INR).toFixed(2),
      (o.rateInrPaise / PAISE_PER_INR).toFixed(2),
      (o.tdsInrPaise / PAISE_PER_INR).toFixed(2),
      o.status,
      o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : '',
    ]);
  }
  for (const d of params.deposits) {
    rows.push([
      'DEPOSIT',
      d.txHash,
      d.tokenSymbol,
      (d.amountMicro / MICRO_PER_USDT).toFixed(6),
      '',
      '',
      '0.00',
      d.status,
      d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : '',
    ]);
  }
  for (const w of params.withdrawals) {
    rows.push([
      'WITHDRAWAL',
      w.txHash || w.idempotencyKey,
      w.tokenSymbol,
      (w.requestedAmountMicro / MICRO_PER_USDT).toFixed(6),
      '',
      '',
      '0.00',
      w.status,
      w.createdAt?.toDate ? w.createdAt.toDate().toISOString() : '',
    ]);
  }

  return [header, ...rows].map((r) => r.map(escapeCsvCell).join(',')).join('\n');
}
