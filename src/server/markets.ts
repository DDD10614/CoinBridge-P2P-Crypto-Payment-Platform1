import {
  DEFAULT_COIN_MAP,
  DEFAULT_SUPPORTED_COINS,
  isValidContractOrNative,
  isValidMultiChainAddress,
  MultiCoinNetworkId,
  normalizeCoinSymbol,
  SupportedCoinConfig,
} from '../lib/coins.ts';
import {
  aggregateOhlcBars,
  aggregatePriceTicksToOhlc,
  ChartInterval,
  OhlcBar,
} from '../lib/technicalAnalysis.ts';

const ALLOWED_COINGECKO_BASES = new Set([
  'https://api.coingecko.com/api/v3',
  'https://pro-api.coingecko.com/api/v3',
]);

function getCoinGeckoBase(): string {
  const configured = (process.env.COINGECKO_API_BASE_URL || '').trim().replace(/\/+$/, '');
  return ALLOWED_COINGECKO_BASES.has(configured)
    ? configured
    : 'https://api.coingecko.com/api/v3';
}

function buildCoinGeckoHeaders(): Record<string, string> {
  const apiKey = (process.env.COINGECKO_API_KEY || '').trim();
  const baseUrl = getCoinGeckoBase();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    if (baseUrl.includes('pro-api.coingecko.com')) {
      headers['x-cg-pro-api-key'] = apiKey;
    } else {
      headers['x-cg-demo-api-key'] = apiKey;
    }
  }
  return headers;
}

export type MarketFreshnessStatus = 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';

export interface CoinMarketQuote {
  symbol: string;
  coingeckoId: string;
  name: string;
  inrPrice: number | null;
  usdPrice: number | null;
  change24hPct: number | null;
  volume24hInr: number | null;
  marketCapInr: number | null;
  high24hInr: number | null;
  low24hInr: number | null;
  circulatingSupply: number | null;
  lastUpdatedAt: string | null;
  isAvailable: boolean;
}

export interface AllMarketsResponse {
  coins: CoinMarketQuote[];
  freshnessStatus: MarketFreshnessStatus;
  cached: boolean;
  cacheAgeSeconds: number;
  rateLimited: boolean;
  fetchedAt: string;
  notice: string;
}

export interface CoinHistoryResponse {
  symbol: string;
  coingeckoId: string;
  interval: ChartInterval;
  currency: 'INR';
  bars: OhlcBar[];
  freshnessStatus: MarketFreshnessStatus;
  cached: boolean;
  sourceGranularity: string;
  granularityNotice?: string;
  fetchedAt: string;
}

// Server-side rate-limit cooldown & caches
let coingeckoRateLimitedUntilMs = 0;

interface CachedMarketsEntry {
  coinsById: Record<string, CoinMarketQuote>;
  fetchedAtMs: number;
}
let marketsCache: CachedMarketsEntry | null = null;

interface CachedHistoryEntry {
  payload: Omit<CoinHistoryResponse, 'cached'>;
  fetchedAtMs: number;
}
const historyCache = new Map<string, CachedHistoryEntry>();

const MARKETS_FRESH_TTL_MS = 60_000;
const MARKETS_DELAYED_TTL_MS = 180_000;

async function fetchCoinGeckoJson<T>(urlPath: string, timeoutMs = 6000): Promise<T> {
  const now = Date.now();
  if (now < coingeckoRateLimitedUntilMs) {
    const secs = Math.ceil((coingeckoRateLimitedUntilMs - now) / 1000);
    throw new Error(`COINGECKO_RATE_LIMITED: Cooldown active (${secs}s remaining)`);
  }

  const baseUrl = getCoinGeckoBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${baseUrl}${urlPath}`, {
      headers: buildCoinGeckoHeaders(),
      signal: controller.signal,
    });
    if (resp.status === 429) {
      const retryAfterSec = Number(resp.headers.get('retry-after') || 75);
      const backoffMs = Math.min(180_000, Math.max(30_000, retryAfterSec * 1000));
      coingeckoRateLimitedUntilMs = Date.now() + backoffMs;
      throw new Error(`COINGECKO_RATE_LIMITED: HTTP 429 (cooldown ${Math.round(backoffMs / 1000)}s)`);
    }
    if (!resp.ok) {
      throw new Error(`CoinGecko HTTP ${resp.status}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function buildUnavailableMarketList(
  coinsInput: Array<{ symbol: string; name: string; coingeckoId: string }>
): CoinMarketQuote[] {
  return coinsInput.map((c) => ({
    symbol: c.symbol,
    coingeckoId: c.coingeckoId,
    name: c.name,
    inrPrice: null,
    usdPrice: null,
    change24hPct: null,
    volume24hInr: null,
    marketCapInr: null,
    high24hInr: null,
    low24hInr: null,
    circulatingSupply: null,
    lastUpdatedAt: null,
    isAvailable: false,
  }));
}

export async function getAllCoinMarkets(params?: {
  refresh?: boolean;
  extraCoins?: Array<{ symbol: string; name: string; coingeckoId: string }>;
}): Promise<AllMarketsResponse> {
  const now = Date.now();
  const baseList = DEFAULT_SUPPORTED_COINS.map((c) => ({
    symbol: c.symbol,
    name: c.name,
    coingeckoId: c.coingeckoId,
  }));

  if (params?.extraCoins?.length) {
    for (const extra of params.extraCoins) {
      const sym = normalizeCoinSymbol(extra.symbol);
      if (sym && extra.coingeckoId && !baseList.some((b) => b.symbol === sym)) {
        baseList.push({
          symbol: sym,
          name: extra.name || sym,
          coingeckoId: extra.coingeckoId.trim().toLowerCase(),
        });
      }
    }
  }

  const allIds = Array.from(new Set(baseList.map((c) => c.coingeckoId))).filter(Boolean);
  const cacheCoversAll =
    marketsCache !== null && allIds.every((id) => Boolean(marketsCache!.coinsById[id]));

  if (!params?.refresh && marketsCache && cacheCoversAll) {
    const ageMs = now - marketsCache.fetchedAtMs;
    if (ageMs <= MARKETS_FRESH_TTL_MS) {
      return {
        coins: baseList.map(
          (c) =>
            marketsCache!.coinsById[c.coingeckoId] || {
              symbol: c.symbol,
              coingeckoId: c.coingeckoId,
              name: c.name,
              inrPrice: null,
              usdPrice: null,
              change24hPct: null,
              volume24hInr: null,
              marketCapInr: null,
              high24hInr: null,
              low24hInr: null,
              circulatingSupply: null,
              lastUpdatedAt: null,
              isAvailable: false,
            }
        ),
        freshnessStatus: 'LIVE',
        cached: true,
        cacheAgeSeconds: Math.round(ageMs / 1000),
        rateLimited: now < coingeckoRateLimitedUntilMs,
        fetchedAt: new Date(marketsCache.fetchedAtMs).toISOString(),
        notice: 'Live CoinGecko INR & USD market snapshot (server-cached within 60s TTL).',
      };
    }
  }

  try {
    const idsParam = encodeURIComponent(allIds.join(','));
    const [inrMarkets, usdPrices] = await Promise.all([
      fetchCoinGeckoJson<
        Array<{
          id: string;
          symbol?: string;
          name?: string;
          current_price?: number | null;
          market_cap?: number | null;
          total_volume?: number | null;
          high_24h?: number | null;
          low_24h?: number | null;
          price_change_percentage_24h?: number | null;
          circulating_supply?: number | null;
          last_updated?: string | null;
        }>
      >(
        `/coins/markets?vs_currency=inr&ids=${idsParam}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h`
      ),
      fetchCoinGeckoJson<Record<string, { usd?: number }>>(
        `/simple/price?ids=${idsParam}&vs_currencies=usd`
      ).catch(() => ({} as Record<string, { usd?: number }>)),
    ]);

    if (!Array.isArray(inrMarkets) || inrMarkets.length === 0) {
      throw new Error('CoinGecko returned empty market list');
    }

    const byId = new Map(inrMarkets.map((item) => [item.id, item]));
    const coinsById: Record<string, CoinMarketQuote> = {};
    const resultList: CoinMarketQuote[] = baseList.map((coin) => {
      const row = byId.get(coin.coingeckoId);
      const usdRow = usdPrices[coin.coingeckoId];
      const inrPrice =
        typeof row?.current_price === 'number' && Number.isFinite(row.current_price)
          ? row.current_price
          : null;

      const quote: CoinMarketQuote = {
        symbol: coin.symbol,
        coingeckoId: coin.coingeckoId,
        name: row?.name || coin.name,
        inrPrice,
        usdPrice:
          typeof usdRow?.usd === 'number' && Number.isFinite(usdRow.usd) ? usdRow.usd : null,
        change24hPct:
          typeof row?.price_change_percentage_24h === 'number' &&
          Number.isFinite(row.price_change_percentage_24h)
            ? Number(row.price_change_percentage_24h.toFixed(2))
            : null,
        volume24hInr:
          typeof row?.total_volume === 'number' && Number.isFinite(row.total_volume)
            ? row.total_volume
            : null,
        marketCapInr:
          typeof row?.market_cap === 'number' && Number.isFinite(row.market_cap)
            ? row.market_cap
            : null,
        high24hInr:
          typeof row?.high_24h === 'number' && Number.isFinite(row.high_24h) ? row.high_24h : null,
        low24hInr:
          typeof row?.low_24h === 'number' && Number.isFinite(row.low_24h) ? row.low_24h : null,
        circulatingSupply:
          typeof row?.circulating_supply === 'number' && Number.isFinite(row.circulating_supply)
            ? row.circulating_supply
            : null,
        lastUpdatedAt: row?.last_updated || new Date(now).toISOString(),
        isAvailable: inrPrice !== null,
      };
      coinsById[coin.coingeckoId] = quote;
      return quote;
    });

    marketsCache = {
      coinsById: {
        ...(marketsCache?.coinsById || {}),
        ...coinsById,
      },
      fetchedAtMs: now,
    };

    return {
      coins: resultList,
      freshnessStatus: 'LIVE',
      cached: false,
      cacheAgeSeconds: 0,
      rateLimited: false,
      fetchedAt: new Date(now).toISOString(),
      notice: 'Live market prices fetched from CoinGecko API (INR & USD).',
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'CoinGecko fetch failed';
    const rateLimited = reason.includes('COINGECKO_RATE_LIMITED') || now < coingeckoRateLimitedUntilMs;

    if (marketsCache) {
      const ageMs = now - marketsCache.fetchedAtMs;
      const status: MarketFreshnessStatus =
        ageMs <= MARKETS_DELAYED_TTL_MS ? 'DELAYED' : 'STALE';
      return {
        coins: baseList.map(
          (c) =>
            marketsCache!.coinsById[c.coingeckoId] || {
              symbol: c.symbol,
              coingeckoId: c.coingeckoId,
              name: c.name,
              inrPrice: null,
              usdPrice: null,
              change24hPct: null,
              volume24hInr: null,
              marketCapInr: null,
              high24hInr: null,
              low24hInr: null,
              circulatingSupply: null,
              lastUpdatedAt: null,
              isAvailable: false,
            }
        ),
        freshnessStatus: status,
        cached: true,
        cacheAgeSeconds: Math.round(ageMs / 1000),
        rateLimited,
        fetchedAt: new Date(marketsCache.fetchedAtMs).toISOString(),
        notice: rateLimited
          ? `CoinGecko rate limit active; displaying last cached snapshot (${Math.round(ageMs / 1000)}s old). No synthetic prices generated.`
          : `CoinGecko temporarily unreachable (${reason}); showing cached market snapshot.`,
      };
    }

    return {
      coins: buildUnavailableMarketList(baseList),
      freshnessStatus: 'UNAVAILABLE',
      cached: false,
      cacheAgeSeconds: 0,
      rateLimited,
      fetchedAt: new Date(now).toISOString(),
      notice: `CoinGecko market feed unavailable (${reason}). Real-time prices are marked Unavailable instead of displaying fabricated prices.`,
    };
  }
}

export async function getSingleCoinMarket(params: {
  symbol: string;
  coingeckoId?: string;
  name?: string;
}): Promise<{
  coin: CoinMarketQuote;
  freshnessStatus: MarketFreshnessStatus;
  cached: boolean;
  fetchedAt: string;
  notice: string;
}> {
  const sym = normalizeCoinSymbol(params.symbol);
  const preset = DEFAULT_COIN_MAP[sym];
  const cgId = (params.coingeckoId || preset?.coingeckoId || '').trim().toLowerCase();
  const extraCoins =
    !preset && cgId ? [{ symbol: sym, name: params.name || sym, coingeckoId: cgId }] : undefined;

  const all = await getAllCoinMarkets({ extraCoins });
  const matched =
    all.coins.find((c) => c.symbol === sym) ||
    buildUnavailableMarketList([{ symbol: sym, name: params.name || sym, coingeckoId: cgId }])[0];

  return {
    coin: matched,
    freshnessStatus: matched.isAvailable ? all.freshnessStatus : 'UNAVAILABLE',
    cached: all.cached,
    fetchedAt: all.fetchedAt,
    notice: all.notice,
  };
}

function attachVolumeToOhlc(
  bars: OhlcBar[],
  volumeSeries: Array<[number, number]>,
  bucketSeconds: number
): OhlcBar[] {
  if (bars.length === 0) return bars;
  if (!Array.isArray(volumeSeries) || volumeSeries.length === 0) return bars;

  const volumeByBucket = new Map<number, number>();
  for (const [ms, vol] of volumeSeries) {
    if (!Number.isFinite(ms) || !Number.isFinite(vol)) continue;
    const bucket = Math.floor(Math.floor(ms / 1000) / bucketSeconds) * bucketSeconds;
    volumeByBucket.set(bucket, Math.max(volumeByBucket.get(bucket) || 0, vol));
  }

  const volSorted = volumeSeries
    .filter(([ms, vol]) => Number.isFinite(ms) && Number.isFinite(vol))
    .map(([ms, vol]) => ({ sec: Math.floor(ms / 1000), vol }));

  return bars.map((b) => {
    const exact = volumeByBucket.get(b.time);
    if (exact !== undefined) {
      return { ...b, volume: exact };
    }
    let nearestVol = 0;
    let bestDiff = Infinity;
    for (const v of volSorted) {
      const diff = Math.abs(v.sec - b.time);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearestVol = v.vol;
      }
    }
    return {
      ...b,
      volume: bestDiff <= bucketSeconds * 2 ? nearestVol : 0,
    };
  });
}

const VALID_INTERVALS = new Set<ChartInterval>([
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
  '1w',
  '1M',
  '1y',
]);

export function isValidChartInterval(val: string): val is ChartInterval {
  return VALID_INTERVALS.has(val as ChartInterval);
}

export async function getCoinHistoricalCandles(params: {
  symbol: string;
  interval: ChartInterval;
  coingeckoId?: string;
}): Promise<CoinHistoryResponse> {
  const now = Date.now();
  const sym = normalizeCoinSymbol(params.symbol);
  const preset = DEFAULT_COIN_MAP[sym];
  const coingeckoId = (params.coingeckoId || preset?.coingeckoId || '').trim().toLowerCase();

  if (!coingeckoId) {
    return {
      symbol: sym,
      coingeckoId: '',
      interval: params.interval,
      currency: 'INR',
      bars: [],
      freshnessStatus: 'UNAVAILABLE',
      cached: false,
      sourceGranularity: 'UNMAPPED_COINGECKO_ID',
      granularityNotice: `No CoinGecko ID mapped for ${sym}. Configure CoinGecko ID in Admin Coin Management.`,
      fetchedAt: new Date(now).toISOString(),
    };
  }

  const cacheKey = `${coingeckoId}:${params.interval}`;
  const isIntraday = ['1m', '5m', '15m', '1h'].includes(params.interval);
  const freshTtl = isIntraday ? 90_000 : 300_000;

  const cachedEntry = historyCache.get(cacheKey);
  if (cachedEntry && now - cachedEntry.fetchedAtMs <= freshTtl) {
    return {
      ...cachedEntry.payload,
      cached: true,
    };
  }

  try {
    let bars: OhlcBar[] = [];
    let sourceGranularity = '';
    let granularityNotice: string | undefined;

    if (params.interval === '1m' || params.interval === '5m' || params.interval === '15m') {
      const chartData = await fetchCoinGeckoJson<{
        prices?: Array<[number, number]>;
        total_volumes?: Array<[number, number]>;
      }>(`/coins/${encodeURIComponent(coingeckoId)}/market_chart?vs_currency=inr&days=1`);

      const prices = Array.isArray(chartData.prices) ? chartData.prices : [];
      const volumes = Array.isArray(chartData.total_volumes) ? chartData.total_volumes : [];

      const ticks = prices.map(([ms, price]) => ({
        timeSec: Math.floor(ms / 1000),
        price,
      }));

      const bucketSeconds = params.interval === '15m' ? 900 : 300;
      const rawBars = aggregatePriceTicksToOhlc(ticks, bucketSeconds);
      bars = attachVolumeToOhlc(rawBars, volumes, bucketSeconds);

      if (params.interval === '1m') {
        sourceGranularity = '5m_TICK_UPSTREAM';
        granularityNotice =
          'CoinGecko public REST feeds update at ~5-minute granularity rather than 1-minute ticks. Displaying genuine 5-minute intervals without fabricating 1-minute bars.';
      } else if (params.interval === '5m') {
        sourceGranularity = '5m_COINGECKO_CHART';
      } else {
        sourceGranularity = '15m_AGGREGATED_FROM_5M';
      }
    } else {
      const daysParam =
        params.interval === '1h'
          ? '1'
          : params.interval === '4h'
            ? '14'
            : params.interval === '1d'
              ? '90'
              : '365';

      const [ohlcRaw, chartRaw] = await Promise.all([
        fetchCoinGeckoJson<Array<[number, number, number, number, number]>>(
          `/coins/${encodeURIComponent(coingeckoId)}/ohlc?vs_currency=inr&days=${daysParam}`
        ),
        fetchCoinGeckoJson<{
          prices?: Array<[number, number]>;
          total_volumes?: Array<[number, number]>;
        }>(`/coins/${encodeURIComponent(coingeckoId)}/market_chart?vs_currency=inr&days=${daysParam}`).catch(
          () => ({ prices: [], total_volumes: [] })
        ),
      ]);

      const rawBars: OhlcBar[] = Array.isArray(ohlcRaw)
        ? ohlcRaw
            .filter(
              (row) =>
                Array.isArray(row) &&
                row.length >= 5 &&
                Number.isFinite(row[0]) &&
                Number.isFinite(row[1]) &&
                Number.isFinite(row[2]) &&
                Number.isFinite(row[3]) &&
                Number.isFinite(row[4])
            )
            .map(([ms, open, high, low, close]) => ({
              time: Math.floor(ms / 1000),
              open,
              high,
              low,
              close,
            }))
        : [];

      const bucketSeconds =
        params.interval === '1h'
          ? 3600
          : params.interval === '4h'
            ? 14_400
            : params.interval === '1d'
              ? 86_400
              : params.interval === '1w'
                ? 7 * 86_400
                : params.interval === '1M'
                  ? 30 * 86_400
                  : 4 * 86_400; // 1y full-year view uses genuine 4-day CoinGecko OHLC bars

      const aggregated =
        params.interval === '4h' || params.interval === '1y'
          ? aggregateOhlcBars(rawBars, bucketSeconds)
          : aggregateOhlcBars(rawBars, bucketSeconds);

      const volumes = Array.isArray(chartRaw?.total_volumes) ? chartRaw.total_volumes : [];
      bars = attachVolumeToOhlc(aggregated, volumes, bucketSeconds);

      sourceGranularity =
        params.interval === '1h'
          ? '1h_FROM_30M_OHLC'
          : params.interval === '4h'
            ? '4h_NATIVE_OHLC'
            : params.interval === '1d'
              ? '1d_DAILY_OHLC'
              : params.interval === '1w'
                ? '1w_WEEKLY_OHLC'
                : params.interval === '1M'
                  ? '1M_MONTHLY_OHLC'
                  : '1y_365D_4D_OHLC';
    }

    if (bars.length === 0) {
      throw new Error('No historical OHLCV bars returned by CoinGecko');
    }

    const payload: Omit<CoinHistoryResponse, 'cached'> = {
      symbol: sym,
      coingeckoId,
      interval: params.interval,
      currency: 'INR',
      bars,
      freshnessStatus: 'LIVE',
      sourceGranularity,
      granularityNotice,
      fetchedAt: new Date(now).toISOString(),
    };

    historyCache.set(cacheKey, { payload, fetchedAtMs: now });
    return {
      ...payload,
      cached: false,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unable to load CoinGecko history';
    if (cachedEntry) {
      return {
        ...cachedEntry.payload,
        freshnessStatus: 'STALE',
        cached: true,
        granularityNotice: `Upstream feed rate-limited or unavailable (${reason}); showing cached historical candles.`,
      };
    }

    return {
      symbol: sym,
      coingeckoId,
      interval: params.interval,
      currency: 'INR',
      bars: [],
      freshnessStatus: 'UNAVAILABLE',
      cached: false,
      sourceGranularity: 'UNAVAILABLE',
      granularityNotice: `Historical chart data unavailable (${reason}). Synthetic candles are never generated.`,
      fetchedAt: new Date(now).toISOString(),
    };
  }
}

export function validateAssetNetworkPayload(input: {
  symbol: string;
  network: MultiCoinNetworkId | string;
  contractAddress?: string;
  destinationAddress?: string;
  coinOverride?: Partial<SupportedCoinConfig>;
}): {
  valid: boolean;
  symbol: string;
  network: string;
  errors: string[];
  approvalRequired: boolean;
  approvedForTrading: boolean;
} {
  const sym = normalizeCoinSymbol(input.symbol || '');
  const preset = DEFAULT_COIN_MAP[sym];
  const merged: SupportedCoinConfig | undefined = preset
    ? { ...preset, ...(input.coinOverride || {}) }
    : input.coinOverride && input.coinOverride.symbol
      ? (input.coinOverride as SupportedCoinConfig)
      : undefined;

  const errors: string[] = [];
  if (!sym || !merged) {
    errors.push(`Unsupported cryptocurrency symbol: ${sym || 'EMPTY'}.`);
    return {
      valid: false,
      symbol: sym,
      network: String(input.network || ''),
      errors,
      approvalRequired: true,
      approvedForTrading: false,
    };
  }

  const network = String(input.network || '').trim() as MultiCoinNetworkId;
  if (!merged.supportedNetworks.includes(network)) {
    errors.push(
      `${sym} does not support network ${network}. Allowed networks: ${merged.supportedNetworks.join(', ')}.`
    );
  }

  if (input.contractAddress !== undefined) {
    if (!isValidContractOrNative(network, input.contractAddress)) {
      errors.push(`Invalid contract or native identifier '${input.contractAddress}' for ${network}.`);
    }
  }

  if (input.destinationAddress !== undefined) {
    if (!isValidMultiChainAddress(network, input.destinationAddress)) {
      errors.push(`Invalid wallet address format for ${network}.`);
    }
  }

  const approvedForTrading = Boolean(merged.tradingEnabled && merged.custodyApproved);
  if (!approvedForTrading) {
    errors.push(
      `${sym} is not yet approved for real P2P trading or custody settlement. Admin approval is required.`
    );
  }

  return {
    valid: errors.length === 0,
    symbol: sym,
    network,
    errors,
    approvalRequired: !approvedForTrading,
    approvedForTrading,
  };
}
