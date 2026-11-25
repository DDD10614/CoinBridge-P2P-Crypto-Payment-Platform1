import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  IChartApi,
  LineSeries,
  UTCTimestamp,
} from 'lightweight-charts';
import { AlertTriangle, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { formatSpotInr } from '../lib/coins';
import {
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  ChartDisplayType,
  ChartInterval,
  OhlcBar,
  TECHNICAL_ANALYSIS_DISCLAIMER,
} from '../lib/technicalAnalysis';
import { useTheme } from '../context/ThemeContext';

interface CryptoChartProps {
  symbol: string;
  coingeckoId: string;
  name: string;
  currentInrPrice?: number | null;
}

interface HistoryPayload {
  symbol: string;
  coingeckoId: string;
  interval: ChartInterval;
  currency: 'INR';
  bars: OhlcBar[];
  freshnessStatus: 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';
  cached: boolean;
  sourceGranularity: string;
  granularityNotice?: string;
  fetchedAt: string;
}

const INTERVAL_OPTIONS: ChartInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M', '1y'];

type IndicatorKey =
  | 'volume'
  | 'sma20'
  | 'sma50'
  | 'sma200'
  | 'ema9'
  | 'ema21'
  | 'ema50'
  | 'bollinger'
  | 'rsi14'
  | 'macd';

const INDICATOR_LABELS: { key: IndicatorKey; label: string }[] = [
  { key: 'volume', label: 'Volume' },
  { key: 'sma20', label: 'SMA 20' },
  { key: 'sma50', label: 'SMA 50' },
  { key: 'sma200', label: 'SMA 200' },
  { key: 'ema9', label: 'EMA 9' },
  { key: 'ema21', label: 'EMA 21' },
  { key: 'ema50', label: 'EMA 50' },
  { key: 'bollinger', label: 'BB (20,2)' },
  { key: 'rsi14', label: 'RSI (14)' },
  { key: 'macd', label: 'MACD (12,26,9)' },
];

export function CryptoChart({ symbol, coingeckoId, name, currentInrPrice }: CryptoChartProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [interval, setIntervalState] = useState<ChartInterval>('1h');
  const [chartType, setChartType] = useState<ChartDisplayType>('CANDLESTICK');
  const [fullScreen, setFullScreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [activeIndicators, setActiveIndicators] = useState<Record<IndicatorKey, boolean>>({
    volume: true,
    sma20: true,
    sma50: false,
    sma200: false,
    ema9: false,
    ema21: true,
    ema50: false,
    bollinger: false,
    rsi14: true,
    macd: false,
  });

  const [hoveredBar, setHoveredBar] = useState<OhlcBar | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const toggleIndicator = (key: IndicatorKey) => {
    setActiveIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    fetch(
      `/api/markets/${encodeURIComponent(symbol)}/history?interval=${encodeURIComponent(
        interval
      )}&coingeckoId=${encodeURIComponent(coingeckoId)}`
    )
      .then(async (resp) => {
        if (!resp.ok) {
          throw new Error(`Market history request returned HTTP ${resp.status}`);
        }
        return (await resp.json()) as HistoryPayload;
      })
      .then((data) => {
        if (cancelled) return;
        setHistory(data);
        setHoveredBar(data.bars.length > 0 ? data.bars[data.bars.length - 1] : null);
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : 'Unable to fetch historical price bars.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, coingeckoId, interval, reloadNonce]);

  const bars = history?.bars || [];

  const computedTa = useMemo(() => {
    return {
      sma20: activeIndicators.sma20 ? calculateSMA(bars, 20) : [],
      sma50: activeIndicators.sma50 ? calculateSMA(bars, 50) : [],
      sma200: activeIndicators.sma200 ? calculateSMA(bars, 200) : [],
      ema9: activeIndicators.ema9 ? calculateEMA(bars, 9) : [],
      ema21: activeIndicators.ema21 ? calculateEMA(bars, 21) : [],
      ema50: activeIndicators.ema50 ? calculateEMA(bars, 50) : [],
      bollinger: activeIndicators.bollinger ? calculateBollingerBands(bars, 20, 2) : [],
      rsi14: activeIndicators.rsi14 ? calculateRSI(bars, 14) : [],
      macd: activeIndicators.macd ? calculateMACD(bars, 12, 26, 9) : [],
    };
  }, [bars, activeIndicators]);

  // Render interactive TradingView Lightweight Charts v5 instance
  useEffect(() => {
    const el = containerRef.current;
    if (!el || bars.length === 0) {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      return;
    }

    const showRsiPane = activeIndicators.rsi14 && computedTa.rsi14.length > 0;
    const showMacdPane = activeIndicators.macd && computedTa.macd.length > 0;
    const extraPanes = (showRsiPane ? 1 : 0) + (showMacdPane ? 1 : 0);
    const baseHeight = fullScreen ? Math.max(460, window.innerHeight - 280) : 380;
    const totalHeight = baseHeight + extraPanes * 115;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: totalHeight,
      layout: {
        background: { type: ColorType.Solid, color: isDark ? '#0B1220' : '#FFFFFF' },
        textColor: isDark ? '#94A3B8' : '#475569',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isDark ? '#1E293B' : '#F1F5F9' },
        horzLines: { color: isDark ? '#1E293B' : '#F1F5F9' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: isDark ? '#1E293B' : '#E2E8F0',
      },
      timeScale: {
        borderColor: isDark ? '#1E293B' : '#E2E8F0',
        timeVisible: ['1m', '5m', '15m', '1h', '4h'].includes(interval),
        secondsVisible: false,
      },
    });
    chartRef.current = chart;

    const barMap = new Map<number, OhlcBar>(bars.map((b) => [b.time, b]));

    // Primary Price Series on Pane 0
    if (chartType === 'CANDLESTICK') {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#10B981',
        downColor: '#EF4444',
        borderVisible: false,
        wickUpColor: '#10B981',
        wickDownColor: '#EF4444',
      });
      candleSeries.setData(
        bars.map((b) => ({
          time: b.time as UTCTimestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );
    } else if (chartType === 'LINE') {
      const lineSeries = chart.addSeries(LineSeries, {
        color: '#2563EB',
        lineWidth: 2,
      });
      lineSeries.setData(
        bars.map((b) => ({
          time: b.time as UTCTimestamp,
          value: b.close,
        }))
      );
    } else {
      const areaSeries = chart.addSeries(AreaSeries, {
        lineColor: '#2563EB',
        topColor: isDark ? 'rgba(37, 99, 235, 0.35)' : 'rgba(37, 99, 235, 0.25)',
        bottomColor: isDark ? 'rgba(37, 99, 235, 0.02)' : 'rgba(37, 99, 235, 0.01)',
        lineWidth: 2,
      });
      areaSeries.setData(
        bars.map((b) => ({
          time: b.time as UTCTimestamp,
          value: b.close,
        }))
      );
    }

    // Volume Histogram Overlay
    if (activeIndicators.volume && bars.some((b) => (b.volume || 0) > 0)) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
      volumeSeries.setData(
        bars.map((b) => ({
          time: b.time as UTCTimestamp,
          value: b.volume || 0,
          color: b.close >= b.open ? 'rgba(16, 185, 129, 0.32)' : 'rgba(239, 68, 68, 0.32)',
        }))
      );
    }

    // Moving Averages & Bollinger Overlays on Pane 0
    const addOverlayLine = (points: { time: number; value: number }[], color: string) => {
      if (points.length === 0) return;
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    };

    addOverlayLine(computedTa.sma20, '#F59E0B');
    addOverlayLine(computedTa.sma50, '#EC4899');
    addOverlayLine(computedTa.sma200, '#8B5CF6');
    addOverlayLine(computedTa.ema9, '#06B6D4');
    addOverlayLine(computedTa.ema21, '#3B82F6');
    addOverlayLine(computedTa.ema50, '#F97316');

    if (computedTa.bollinger.length > 0) {
      addOverlayLine(
        computedTa.bollinger.map((b) => ({ time: b.time, value: b.upper })),
        '#64748B'
      );
      addOverlayLine(
        computedTa.bollinger.map((b) => ({ time: b.time, value: b.middle })),
        '#94A3B8'
      );
      addOverlayLine(
        computedTa.bollinger.map((b) => ({ time: b.time, value: b.lower })),
        '#64748B'
      );
    }

    // Pane 1: RSI (14)
    let nextPaneIndex = 1;
    if (showRsiPane) {
      const rsiPane = nextPaneIndex++;
      const rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: '#A855F7',
          lineWidth: 2,
          priceLineVisible: false,
        },
        rsiPane
      );
      rsiSeries.setData(
        computedTa.rsi14.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      );
    }

    // Pane 1 or 2: MACD (12, 26, 9)
    if (showMacdPane) {
      const macdPane = nextPaneIndex++;
      const histSeries = chart.addSeries(
        HistogramSeries,
        {
          priceLineVisible: false,
          lastValueVisible: false,
        },
        macdPane
      );
      histSeries.setData(
        computedTa.macd.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.histogram,
          color: p.histogram >= 0 ? 'rgba(16, 185, 129, 0.55)' : 'rgba(239, 68, 68, 0.55)',
        }))
      );

      const macdLine = chart.addSeries(
        LineSeries,
        { color: '#3B82F6', lineWidth: 2, priceLineVisible: false },
        macdPane
      );
      macdLine.setData(
        computedTa.macd.map((p) => ({ time: p.time as UTCTimestamp, value: p.macd }))
      );

      const signalLine = chart.addSeries(
        LineSeries,
        { color: '#F59E0B', lineWidth: 1, priceLineVisible: false },
        macdPane
      );
      signalLine.setData(
        computedTa.macd.map((p) => ({ time: p.time as UTCTimestamp, value: p.signal }))
      );
    }

    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || typeof param.time !== 'number') {
        setHoveredBar(bars[bars.length - 1] || null);
        return;
      }
      const matched = barMap.get(param.time);
      if (matched) setHoveredBar(matched);
    });

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, chartType, activeIndicators, computedTa, isDark, interval, fullScreen]);

  const latestRsi = computedTa.rsi14[computedTa.rsi14.length - 1]?.value;
  const latestMacd = computedTa.macd[computedTa.macd.length - 1];
  const latestSma20 = computedTa.sma20[computedTa.sma20.length - 1]?.value;
  const latestEma21 = computedTa.ema21[computedTa.ema21.length - 1]?.value;
  const latestBb = computedTa.bollinger[computedTa.bollinger.length - 1];

  const activeBar = hoveredBar || (bars.length > 0 ? bars[bars.length - 1] : null);

  const freshnessClass =
    history?.freshnessStatus === 'LIVE'
      ? 'text-emerald-700 dark:text-emerald-400'
      : history?.freshnessStatus === 'DELAYED' || history?.freshnessStatus === 'STALE'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-red-700 dark:text-red-400';

  const cardContent = (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4 ${
        fullScreen ? 'fixed inset-4 z-50 overflow-y-auto shadow-2xl' : ''
      }`}
    >
      {/* Chart Controls Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              {name} ({symbol}/INR) Interactive Chart
            </h3>
            {currentInrPrice !== undefined && currentInrPrice !== null && (
              <span className="font-mono text-sm font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                {formatSpotInr(currentInrPrice)}
              </span>
            )}
            {history && (
              <span className={`font-mono text-[11px] font-semibold uppercase ${freshnessClass}`}>
                {history.freshnessStatus}
              </span>
            )}
          </div>

          {activeBar && (
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
              <span>O: {formatSpotInr(activeBar.open)}</span>
              <span>H: {formatSpotInr(activeBar.high)}</span>
              <span>L: {formatSpotInr(activeBar.low)}</span>
              <span>C: {formatSpotInr(activeBar.close)}</span>
              {activeBar.volume !== undefined && activeBar.volume > 0 && (
                <span>Vol: ₹{Math.round(activeBar.volume).toLocaleString('en-IN')}</span>
              )}
              <span>{new Date(activeBar.time * 1000).toLocaleString('en-IN')}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Chart Types */}
          <div className="inline-flex p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {(
              [
                ['CANDLESTICK', 'Candles'],
                ['LINE', 'Line'],
                ['AREA', 'Area'],
              ] as [ChartDisplayType, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => setChartType(t)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                  chartType === t
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            title="Refresh historical bars"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setFullScreen((v) => !v)}
            title={fullScreen ? 'Exit full screen' : 'Expand full screen'}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {fullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Timeframes & Technical Analysis Toggles */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          {INTERVAL_OPTIONS.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setIntervalState(tf)}
              className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-md border cursor-pointer transition-colors ${
                interval === tf
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {INDICATOR_LABELS.map((ind) => {
            const on = activeIndicators[ind.key];
            return (
              <button
                key={ind.key}
                type="button"
                onClick={() => toggleIndicator(ind.key)}
                className={`px-2 py-1 text-[11px] font-medium rounded-md border cursor-pointer transition-colors ${
                  on
                    ? 'bg-slate-900 dark:bg-blue-600 text-white border-slate-900 dark:border-blue-600'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                {ind.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Upstream Granularity / Availability Notices */}
      {history?.granularityNotice && (
        <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{history.granularityNotice}</span>
        </div>
      )}

      {/* Chart Canvas Area */}
      {loading && bars.length === 0 ? (
        <div className="h-[380px] rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse flex items-center justify-center text-xs text-slate-500">
          Loading CoinGecko INR market history for {symbol}...
        </div>
      ) : fetchError || bars.length === 0 ? (
        <div className="h-[320px] rounded-lg border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center p-6 text-center space-y-2">
          <AlertTriangle className="w-7 h-7 text-amber-600" />
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Historical Chart Data Temporarily Unavailable
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md">
            {fetchError ||
              history?.granularityNotice ||
              'CoinGecko upstream market history did not return bars for this interval. CoinBridge P2P never fabricates synthetic candles.'}
          </p>
        </div>
      ) : (
        <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />
      )}

      {/* Live Computed Technical Analysis Summary Strip */}
      {bars.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
          <div>
            <div className="text-slate-500 dark:text-slate-400">Source Granularity</div>
            <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
              {history?.sourceGranularity || interval} ({bars.length} bars)
            </div>
          </div>
          {activeIndicators.sma20 && (
            <div>
              <div className="text-slate-500 dark:text-slate-400">SMA (20)</div>
              <div className="font-mono font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                {latestSma20 !== undefined ? formatSpotInr(latestSma20) : 'Insufficient bars'}
              </div>
            </div>
          )}
          {activeIndicators.ema21 && (
            <div>
              <div className="text-slate-500 dark:text-slate-400">EMA (21)</div>
              <div className="font-mono font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                {latestEma21 !== undefined ? formatSpotInr(latestEma21) : 'Insufficient bars'}
              </div>
            </div>
          )}
          {activeIndicators.rsi14 && (
            <div>
              <div className="text-slate-500 dark:text-slate-400">RSI (14)</div>
              <div className="font-mono font-semibold text-purple-600 dark:text-purple-400 tabular-nums">
                {latestRsi !== undefined ? latestRsi.toFixed(2) : 'Insufficient bars'}
              </div>
            </div>
          )}
          {activeIndicators.macd && (
            <div>
              <div className="text-slate-500 dark:text-slate-400">MACD (12,26,9)</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {latestMacd
                  ? `${latestMacd.macd.toFixed(2)} / Sig ${latestMacd.signal.toFixed(2)}`
                  : 'Insufficient bars'}
              </div>
            </div>
          )}
          {activeIndicators.bollinger && latestBb && (
            <div>
              <div className="text-slate-500 dark:text-slate-400">Bollinger (20,2)</div>
              <div className="font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                {formatSpotInr(latestBb.lower)} – {formatSpotInr(latestBb.upper)}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        {TECHNICAL_ANALYSIS_DISCLAIMER}
      </p>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs">
        {cardContent}
      </div>
    );
  }

  return cardContent;
}
