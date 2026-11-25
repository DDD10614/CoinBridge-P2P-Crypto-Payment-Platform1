export type ChartInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M' | '1y';

export type ChartDisplayType = 'CANDLESTICK' | 'LINE' | 'AREA';

export interface OhlcBar {
  time: number; // Unix timestamp in seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface LinePoint {
  time: number;
  value: number;
}

export interface BollingerPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export interface MacdPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

export const TECHNICAL_ANALYSIS_DISCLAIMER =
  'Technical indicators (RSI, MACD, EMA, SMA, Bollinger Bands, Volume) are deterministic historical calculations for informational chart analysis only. They do not constitute financial advice or predictive buy/sell signals.';

export function calculateSMA(bars: OhlcBar[], period: number): LinePoint[] {
  if (period <= 0 || bars.length < period) return [];
  const results: LinePoint[] = [];
  let rollingSum = 0;

  for (let i = 0; i < bars.length; i++) {
    rollingSum += bars[i].close;
    if (i >= period) {
      rollingSum -= bars[i - period].close;
    }
    if (i >= period - 1) {
      results.push({
        time: bars[i].time,
        value: Number((rollingSum / period).toFixed(6)),
      });
    }
  }
  return results;
}

export function calculateEMA(bars: OhlcBar[], period: number): LinePoint[] {
  if (period <= 0 || bars.length < period) return [];
  const k = 2 / (period + 1);
  let seedSum = 0;
  for (let i = 0; i < period; i++) {
    seedSum += bars[i].close;
  }
  let ema = seedSum / period;
  const results: LinePoint[] = [
    {
      time: bars[period - 1].time,
      value: Number(ema.toFixed(6)),
    },
  ];

  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    results.push({
      time: bars[i].time,
      value: Number(ema.toFixed(6)),
    });
  }
  return results;
}

export function calculateRSI(bars: OhlcBar[], period = 14): LinePoint[] {
  if (period <= 0 || bars.length <= period) return [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const diff = bars[i].close - bars[i - 1].close;
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  const toRsi = (g: number, l: number): number => {
    if (l === 0 && g === 0) return 50;
    if (l === 0) return 100;
    const rs = g / l;
    return Number((100 - 100 / (1 + rs)).toFixed(4));
  };

  const results: LinePoint[] = [
    {
      time: bars[period].time,
      value: toRsi(avgGain, avgLoss),
    },
  ];

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    results.push({
      time: bars[i + 1].time,
      value: toRsi(avgGain, avgLoss),
    });
  }

  return results;
}

function calculateEmaFromSeries(points: LinePoint[], period: number): LinePoint[] {
  if (period <= 0 || points.length < period) return [];
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += points[i].value;
  }
  let ema = sum / period;
  const out: LinePoint[] = [{ time: points[period - 1].time, value: ema }];
  for (let i = period; i < points.length; i++) {
    ema = points[i].value * k + ema * (1 - k);
    out.push({ time: points[i].time, value: ema });
  }
  return out;
}

export function calculateMACD(
  bars: OhlcBar[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MacdPoint[] {
  if (bars.length < slowPeriod + signalPeriod) return [];
  const fastEma = calculateEMA(bars, fastPeriod);
  const slowEma = calculateEMA(bars, slowPeriod);
  const fastByTime = new Map(fastEma.map((p) => [p.time, p.value]));

  const macdLine: LinePoint[] = [];
  for (const slow of slowEma) {
    const fastVal = fastByTime.get(slow.time);
    if (fastVal !== undefined) {
      macdLine.push({
        time: slow.time,
        value: fastVal - slow.value,
      });
    }
  }

  const signalLine = calculateEmaFromSeries(macdLine, signalPeriod);
  const signalByTime = new Map(signalLine.map((p) => [p.time, p.value]));

  const results: MacdPoint[] = [];
  for (const m of macdLine) {
    const sig = signalByTime.get(m.time);
    if (sig !== undefined) {
      results.push({
        time: m.time,
        macd: Number(m.value.toFixed(6)),
        signal: Number(sig.toFixed(6)),
        histogram: Number((m.value - sig).toFixed(6)),
      });
    }
  }
  return results;
}

export function calculateBollingerBands(
  bars: OhlcBar[],
  period = 20,
  multiplier = 2
): BollingerPoint[] {
  if (period <= 1 || bars.length < period) return [];
  const results: BollingerPoint[] = [];

  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += bars[j].close;
    }
    const mean = sum / period;
    let sqDiffSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = bars[j].close - mean;
      sqDiffSum += diff * diff;
    }
    const stdDev = Math.sqrt(sqDiffSum / period);
    results.push({
      time: bars[i].time,
      upper: Number((mean + multiplier * stdDev).toFixed(6)),
      middle: Number(mean.toFixed(6)),
      lower: Number((mean - multiplier * stdDev).toFixed(6)),
    });
  }

  return results;
}

export function aggregateOhlcBars(bars: OhlcBar[], bucketSeconds: number): OhlcBar[] {
  if (bucketSeconds <= 0 || bars.length === 0) return [];
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  const buckets = new Map<number, OhlcBar>();

  for (const bar of sorted) {
    const bucketTime = Math.floor(bar.time / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume ?? 0,
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume = (existing.volume ?? 0) + (bar.volume ?? 0);
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

export function aggregatePriceTicksToOhlc(
  ticks: Array<{ timeSec: number; price: number; volume?: number }>,
  bucketSeconds: number
): OhlcBar[] {
  if (bucketSeconds <= 0 || ticks.length === 0) return [];
  const sorted = [...ticks].sort((a, b) => a.timeSec - b.timeSec);
  const buckets = new Map<number, OhlcBar>();

  for (const tick of sorted) {
    if (!Number.isFinite(tick.price) || tick.price <= 0) continue;
    const bucketTime = Math.floor(tick.timeSec / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume ?? 0,
      });
    } else {
      existing.high = Math.max(existing.high, tick.price);
      existing.low = Math.min(existing.low, tick.price);
      existing.close = tick.price;
      if (tick.volume !== undefined) {
        existing.volume = Math.max(existing.volume ?? 0, tick.volume);
      }
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}
