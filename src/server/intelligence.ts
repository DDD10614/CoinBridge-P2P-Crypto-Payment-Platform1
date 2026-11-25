import { GoogleGenAI } from '@google/genai';
import type { OhlcBar } from '../lib/technicalAnalysis.ts';
import { getAllCoinMarkets, getCoinHistoricalCandles, CoinMarketQuote } from './markets.ts';

export interface QuantitativeCoinSnapshot {
  symbol: string;
  name: string;
  inrPrice: number | null;
  change24hPct: number | null;
  volume24hInr: number | null;
  high24hInr: number | null;
  low24hInr: number | null;
  range24hPct: number | null;
  annualizedVolatilityPct: number | null;
  trendSignal: 'UPTREND' | 'DOWNTREND' | 'CONSOLIDATION' | 'INSUFFICIENT_DATA';
  drawdownFromPeriodHighPct: number | null;
  freshnessStatus: string;
}

export function computeCoinVolatilityMetrics(
  quote: CoinMarketQuote,
  bars: OhlcBar[]
): QuantitativeCoinSnapshot {
  const high24 = quote.high24hInr;
  const low24 = quote.low24hInr;
  const range24hPct =
    high24 && low24 && low24 > 0
      ? Number((((high24 - low24) / low24) * 100).toFixed(2))
      : null;

  let annualizedVolatilityPct: number | null = null;
  let trendSignal: QuantitativeCoinSnapshot['trendSignal'] = 'INSUFFICIENT_DATA';
  let drawdownFromPeriodHighPct: number | null = null;

  if (bars.length >= 6) {
    const logReturns: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1].close;
      const curr = bars[i].close;
      if (prev > 0 && curr > 0) {
        logReturns.push(Math.log(curr / prev));
      }
    }
    if (logReturns.length >= 3) {
      const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
      const variance =
        logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, logReturns.length - 1);
      const stdDev = Math.sqrt(variance);
      // 7D/30D candles ~ hourly/4h bars; scale conservatively to annualized %
      const annualFactor = Math.sqrt(365);
      annualizedVolatilityPct = Number((stdDev * annualFactor * 100).toFixed(2));
    }

    const closes = bars.map((b) => b.close);
    const shortWin = closes.slice(-5);
    const longWin = closes.slice(-Math.min(20, closes.length));
    const smaShort = shortWin.reduce((s, v) => s + v, 0) / shortWin.length;
    const smaLong = longWin.reduce((s, v) => s + v, 0) / longWin.length;
    const diffPct = smaLong > 0 ? ((smaShort - smaLong) / smaLong) * 100 : 0;
    if (diffPct > 1.2) trendSignal = 'UPTREND';
    else if (diffPct < -1.2) trendSignal = 'DOWNTREND';
    else trendSignal = 'CONSOLIDATION';

    const maxHigh = Math.max(...bars.map((b) => b.high));
    const latestClose = closes[closes.length - 1];
    if (maxHigh > 0) {
      drawdownFromPeriodHighPct = Number((((latestClose - maxHigh) / maxHigh) * 100).toFixed(2));
    }
  }

  return {
    symbol: quote.symbol,
    name: quote.name,
    inrPrice: quote.inrPrice,
    change24hPct: quote.change24hPct,
    volume24hInr: quote.volume24hInr,
    high24hInr: quote.high24hInr,
    low24hInr: quote.low24hInr,
    range24hPct,
    annualizedVolatilityPct,
    trendSignal,
    drawdownFromPeriodHighPct,
    freshnessStatus: quote.inrPrice ? 'LIVE_OR_CACHED' : 'UNAVAILABLE',
  };
}

export async function generateMarketIntelligenceResponse(params: {
  symbols: string[];
  question?: string;
  watchlistSymbols?: string[];
}) {
  const markets = await getAllCoinMarkets({ refresh: false });
  const targetSymbols = Array.from(
    new Set(
      (params.symbols.length > 0 ? params.symbols : ['BTC', 'ETH', 'USDT', 'SOL'])
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 6)
    )
  );

  const selectedQuotes = markets.coins.filter((c) => targetSymbols.includes(c.symbol));
  const snapshots: QuantitativeCoinSnapshot[] = [];

  for (const quote of selectedQuotes) {
    try {
      const history = await getCoinHistoricalCandles({ symbol: quote.symbol, interval: '4h' });
      snapshots.push(computeCoinVolatilityMetrics(quote, history.bars));
    } catch {
      snapshots.push(computeCoinVolatilityMetrics(quote, []));
    }
  }

  const volatilityAlerts = snapshots
    .filter(
      (s) =>
        (typeof s.range24hPct === 'number' && s.range24hPct >= 5) ||
        (typeof s.change24hPct === 'number' && Math.abs(s.change24hPct) >= 4)
    )
    .map(
      (s) =>
        `${s.symbol}: 24h change ${s.change24hPct?.toFixed(2) ?? 'N/A'}%, intraday range ${s.range24hPct?.toFixed(2) ?? 'N/A'}%, trend ${s.trendSignal}`
    );

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const modelName = 'gemini-4-hydrogen';

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return {
      aiAvailable: false,
      modelName,
      freshnessStatus: markets.freshnessStatus,
      fetchedAt: markets.fetchedAt,
      snapshots,
      volatilityAlerts,
      summary:
        'AI narrative assistant is awaiting server-side GEMINI_API_KEY configuration. Live CoinGecko market snapshots and deterministic volatility metrics above remain active and verified.',
      assistantReply: params.question
        ? 'Live CoinGecko market metrics are loaded above, but the natural-language Gemini market assistant requires GEMINI_API_KEY on the server.'
        : null,
      disclaimer:
        'Informational analytics only — CoinBridge never provides financial advice or guaranteed-return price predictions.',
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const dataContext = JSON.stringify({
      freshnessStatus: markets.freshnessStatus,
      fetchedAt: markets.fetchedAt,
      watchlist: params.watchlistSymbols || [],
      snapshots,
      volatilityAlerts,
    });

    const userPrompt = params.question
      ? `User question: "${params.question.slice(0, 400)}"\n\nAnswer concisely (max 180 words) strictly using the CoinGecko INR market data below. Do NOT invent prices, do NOT promise returns, and remind the user briefly that this is market information, not investment advice.\n\nMARKET_DATA:\n${dataContext}`
      : `Provide a concise institutional-style INR crypto market brief (max 160 words) comparing the assets, highlighting 24h momentum, volatility, and watchlist highlights strictly from the verified CoinGecko data below. Never fabricate prices or promise future returns.\n\nMARKET_DATA:\n${dataContext}`;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: userPrompt,
    });

    const text = (response.text || '').trim();
    return {
      aiAvailable: true,
      modelName,
      freshnessStatus: markets.freshnessStatus,
      fetchedAt: markets.fetchedAt,
      snapshots,
      volatilityAlerts,
      summary: text || 'Market summary unavailable for the current response window.',
      assistantReply: params.question ? text : null,
      disclaimer:
        'Grounded strictly in live CoinGecko INR market feeds and historical OHLCV volatility. Informational only — not financial advice.',
    };
  } catch (err) {
    console.error('Gemini market intelligence call failed:', err);
    return {
      aiAvailable: false,
      modelName,
      freshnessStatus: markets.freshnessStatus,
      fetchedAt: markets.fetchedAt,
      snapshots,
      volatilityAlerts,
      summary:
        'AI market summary temporarily unavailable; deterministic CoinGecko prices and volatility metrics above remain up to date.',
      assistantReply: params.question
        ? 'Unable to reach Gemini narrative service right now. Please review the verified CoinGecko snapshots above.'
        : null,
      disclaimer:
        'Informational analytics only — CoinBridge never provides financial advice or guaranteed-return price predictions.',
    };
  }
}
