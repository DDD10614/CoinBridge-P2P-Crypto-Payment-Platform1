import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PAISE_PER_INR } from '../lib/domain.ts';

// --- Allowlisted Hosts (SSRF Prevention) ---
const ALLOWED_COINGECKO_BASES = new Set([
  'https://api.coingecko.com/api/v3',
  'https://pro-api.coingecko.com/api/v3',
]);

const ALLOWED_TRONGRID_BASES: Record<string, string> = {
  nile: 'https://nile.trongrid.io',
  shasta: 'https://api.shasta.trongrid.io',
  mainnet: 'https://api.trongrid.io',
};

const TRON_USDT_CONTRACTS: Record<string, string> = {
  nile: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
  shasta: 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
  mainnet: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
};

function getCoinGeckoBase(): string {
  const configured = (process.env.COINGECKO_API_BASE_URL || '').trim().replace(/\/+$/, '');
  return ALLOWED_COINGECKO_BASES.has(configured)
    ? configured
    : 'https://api.coingecko.com/api/v3';
}

export function getTronNetworkName(): 'nile' | 'shasta' | 'mainnet' {
  const raw = (process.env.TRONGRID_NETWORK || 'nile').trim().toLowerCase();
  if (raw === 'shasta' || raw === 'mainnet' || raw === 'nile') return raw;
  return 'nile';
}

function getTronGridBase(): string {
  const net = getTronNetworkName();
  const configured = (process.env.TRONGRID_BASE_URL || '').trim().replace(/\/+$/, '');
  const allowlisted = Object.values(ALLOWED_TRONGRID_BASES);
  if (allowlisted.includes(configured)) return configured;
  return ALLOWED_TRONGRID_BASES[net];
}

// --- 1. CoinGecko Market Price Integration (with 60s TTL Cache & Fallback) ---
export interface MarketRatePayload {
  rateInr: number;
  rateInrPaise: number;
  change24hPct: number | null;
  source: string;
  isLive: boolean;
  isIllustrative: boolean;
  cached: boolean;
  apiKeyConfigured: boolean;
  fetchedAt: string;
  fallbackReason?: string;
}

let rateCache: { payload: MarketRatePayload; expiresAt: number } | null = null;

export async function getUsdtInrMarketRate(): Promise<MarketRatePayload> {
  const now = Date.now();
  if (rateCache && rateCache.expiresAt > now) {
    return { ...rateCache.payload, cached: true };
  }

  const fallbackInr = Number(process.env.MARKET_RATE_FALLBACK_INR || 91.85);
  const safeFallback = Number.isFinite(fallbackInr) && fallbackInr > 10 ? fallbackInr : 91.85;
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

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(
      `${baseUrl}/simple/price?ids=tether&vs_currencies=inr&include_24hr_change=true&include_last_updated_at=true`,
      { signal: controller.signal, headers }
    );
    clearTimeout(timer);

    if (!resp.ok) {
      throw new Error(`CoinGecko HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as {
      tether?: { inr?: number; inr_24h_change?: number };
    };
    const spotInr = data?.tether?.inr;
    if (typeof spotInr !== 'number' || !Number.isFinite(spotInr) || spotInr <= 10) {
      throw new Error('Malformed CoinGecko price payload');
    }

    const payload: MarketRatePayload = {
      rateInr: Number(spotInr.toFixed(2)),
      rateInrPaise: Math.round(spotInr * PAISE_PER_INR),
      change24hPct:
        typeof data.tether?.inr_24h_change === 'number'
          ? Number(data.tether.inr_24h_change.toFixed(2))
          : null,
      source: 'CoinGecko API (USDT/INR)',
      isLive: true,
      isIllustrative: false,
      cached: false,
      apiKeyConfigured: Boolean(apiKey),
      fetchedAt: new Date().toISOString(),
    };

    rateCache = { payload, expiresAt: now + 60_000 };
    return payload;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'CoinGecko request failed';
    const fallbackPayload: MarketRatePayload = {
      rateInr: Number(safeFallback.toFixed(2)),
      rateInrPaise: Math.round(safeFallback * PAISE_PER_INR),
      change24hPct: null,
      source: 'Fallback Reference (MARKET_RATE_FALLBACK_INR)',
      isLive: false,
      isIllustrative: true,
      cached: false,
      apiKeyConfigured: Boolean(apiKey),
      fetchedAt: new Date().toISOString(),
      fallbackReason: reason,
    };
    rateCache = { payload: fallbackPayload, expiresAt: now + 20_000 };
    return fallbackPayload;
  }
}

// --- 2. TronGrid API (TRON Testnet Read Operations & Caching) ---
export interface TronStatusPayload {
  network: 'nile' | 'shasta' | 'mainnet';
  networkLabel: string;
  baseUrl: string;
  usdtContract: string;
  latestBlockNumber: number | null;
  blockTimestampMs: number | null;
  isLive: boolean;
  apiKeyConfigured: boolean;
  sandboxMode: boolean;
  notice: string;
  fetchedAt: string;
}

let tronStatusCache: { payload: TronStatusPayload; expiresAt: number } | null = null;
const tronAccountCache = new Map<string, { payload: unknown; expiresAt: number }>();

function buildTronHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const key = (process.env.TRONGRID_API_KEY || '').trim();
  if (key) {
    headers['TRON-PRO-API-KEY'] = key;
  }
  return headers;
}

export async function getTronTestnetStatus(sandboxMode: boolean): Promise<TronStatusPayload> {
  const now = Date.now();
  if (tronStatusCache && tronStatusCache.expiresAt > now) {
    return tronStatusCache.payload;
  }

  const network = getTronNetworkName();
  const baseUrl = getTronGridBase();
  const networkLabel =
    network === 'nile'
      ? 'TRON Nile Testnet'
      : network === 'shasta'
        ? 'TRON Shasta Testnet'
        : 'TRON Mainnet (Read-Only)';
  const apiKeyConfigured = Boolean((process.env.TRONGRID_API_KEY || '').trim());

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(`${baseUrl}/wallet/getnowblock`, {
      method: 'POST',
      headers: buildTronHeaders(),
      body: '{}',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      throw new Error(`TronGrid HTTP ${resp.status}`);
    }

    const blockData = (await resp.json()) as {
      block_header?: { raw_data?: { number?: number; timestamp?: number } };
    };
    const blockNum = blockData?.block_header?.raw_data?.number ?? null;
    const blockTs = blockData?.block_header?.raw_data?.timestamp ?? null;

    const payload: TronStatusPayload = {
      network,
      networkLabel,
      baseUrl,
      usdtContract: TRON_USDT_CONTRACTS[network],
      latestBlockNumber: blockNum,
      blockTimestampMs: blockTs,
      isLive: blockNum !== null,
      apiKeyConfigured,
      sandboxMode,
      notice:
        'Read-only TronGrid testnet monitor. Real-money USDT transfers are disabled in sandbox mode.',
      fetchedAt: new Date().toISOString(),
    };
    tronStatusCache = { payload, expiresAt: now + 30_000 };
    return payload;
  } catch {
    const fallback: TronStatusPayload = {
      network,
      networkLabel,
      baseUrl,
      usdtContract: TRON_USDT_CONTRACTS[network],
      latestBlockNumber: null,
      blockTimestampMs: null,
      isLive: false,
      apiKeyConfigured,
      sandboxMode,
      notice:
        'TronGrid endpoint unreachable or rate-limited; operating with local sandbox monitor fallback.',
      fetchedAt: new Date().toISOString(),
    };
    tronStatusCache = { payload: fallback, expiresAt: now + 15_000 };
    return fallback;
  }
}

export async function getTronAccountRead(address: string) {
  const now = Date.now();
  const cached = tronAccountCache.get(address);
  if (cached && cached.expiresAt > now) {
    return { ...(cached.payload as Record<string, unknown>), cached: true };
  }

  const network = getTronNetworkName();
  const baseUrl = getTronGridBase();
  const usdtContract = TRON_USDT_CONTRACTS[network];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const [acctResp, trc20Resp] = await Promise.all([
      fetch(`${baseUrl}/v1/accounts/${address}`, {
        headers: buildTronHeaders(),
        signal: controller.signal,
      }),
      fetch(`${baseUrl}/v1/accounts/${address}/transactions/trc20?limit=5`, {
        headers: buildTronHeaders(),
        signal: controller.signal,
      }),
    ]);
    clearTimeout(timer);

    if (!acctResp.ok) {
      throw new Error(`TronGrid Account HTTP ${acctResp.status}`);
    }

    const acctJson = (await acctResp.json()) as {
      data?: Array<{
        balance?: number;
        trc20?: Array<Record<string, string>>;
      }>;
    };
    const trc20Json = trc20Resp.ok
      ? ((await trc20Resp.json()) as {
          data?: Array<{
            transaction_id?: string;
            token_info?: { symbol?: string; decimals?: number };
            from?: string;
            to?: string;
            value?: string;
            block_timestamp?: number;
          }>;
        })
      : { data: [] };

    const record = acctJson.data?.[0];
    const trxSun = record?.balance ?? 0;
    let usdtRaw = '0';
    if (Array.isArray(record?.trc20)) {
      for (const tokenObj of record.trc20) {
        if (tokenObj[usdtContract]) {
          usdtRaw = tokenObj[usdtContract];
          break;
        }
      }
    }

    const payload = {
      address,
      network,
      isLive: true,
      cached: false,
      trxBalance: (trxSun / 1_000_000).toFixed(6),
      usdtTestnetBalance: (Number(usdtRaw) / 1_000_000).toFixed(2),
      recentTrc20: (trc20Json.data || []).slice(0, 5).map((tx) => ({
        txId: tx.transaction_id || '',
        symbol: tx.token_info?.symbol || 'TRC20',
        from: tx.from || '',
        to: tx.to || '',
        amount: tx.value
          ? (Number(tx.value) / Math.pow(10, tx.token_info?.decimals ?? 6)).toFixed(2)
          : '0',
        timestampMs: tx.block_timestamp || 0,
      })),
      fetchedAt: new Date().toISOString(),
    };

    tronAccountCache.set(address, { payload, expiresAt: now + 20_000 });
    return payload;
  } catch (err) {
    return {
      address,
      network,
      isLive: false,
      cached: false,
      trxBalance: '0.000000',
      usdtTestnetBalance: '0.00',
      recentTrc20: [],
      notice:
        err instanceof Error
          ? `TronGrid read fallback (${err.message}). Demo balance shown.`
          : 'TronGrid unavailable; demo balance shown.',
      fetchedAt: new Date().toISOString(),
    };
  }
}

export async function verifyTronTxViaTronGrid(txHash: string) {
  const network = getTronNetworkName();
  const baseUrl = getTronGridBase();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(`${baseUrl}/wallet/gettransactioninfobyid`, {
      method: 'POST',
      headers: buildTronHeaders(),
      body: JSON.stringify({ value: txHash }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) throw new Error(`TronGrid HTTP ${resp.status}`);
    const info = (await resp.json()) as {
      id?: string;
      blockNumber?: number;
      receipt?: { result?: string };
    };

    if (!info || !info.id) {
      return {
        foundOnChain: false,
        network,
        blockNumber: null,
        contractResult: null,
        isLive: true,
      };
    }

    return {
      foundOnChain: true,
      network,
      blockNumber: info.blockNumber ?? null,
      contractResult: info.receipt?.result || 'RECORDED',
      isLive: true,
    };
  } catch {
    return {
      foundOnChain: false,
      network,
      blockNumber: null,
      contractResult: null,
      isLive: false,
    };
  }
}

export interface ScannedTronDeposit {
  txHash: string;
  eventIndex: number;
  from: string;
  to: string;
  contractAddress: string;
  tokenSymbol: string;
  amountMicro: number;
  confirmations: number;
  requiredConfirmations: number;
  blockTimestampMs: number;
  isContractMatch: boolean;
}

export async function scanTronTrc20Deposits(address: string): Promise<{
  address: string;
  network: 'nile' | 'shasta' | 'mainnet';
  usdtContract: string;
  latestBlockNumber: number | null;
  isLive: boolean;
  deposits: ScannedTronDeposit[];
  notice: string;
}> {
  const network = getTronNetworkName();
  const baseUrl = getTronGridBase();
  const usdtContract = TRON_USDT_CONTRACTS[network];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const [blockResp, txResp] = await Promise.all([
      fetch(`${baseUrl}/wallet/getnowblock`, {
        method: 'POST',
        headers: buildTronHeaders(),
        body: '{}',
        signal: controller.signal,
      }),
      fetch(
        `${baseUrl}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?limit=20&only_to=true`,
        {
          headers: buildTronHeaders(),
          signal: controller.signal,
        }
      ),
    ]);
    clearTimeout(timer);

    const blockData = blockResp.ok
      ? ((await blockResp.json()) as {
          block_header?: { raw_data?: { number?: number; timestamp?: number } };
        })
      : {};
    const latestBlockNumber = blockData?.block_header?.raw_data?.number ?? null;

    if (!txResp.ok) {
      throw new Error(`TronGrid TRC20 scan HTTP ${txResp.status}`);
    }

    const txJson = (await txResp.json()) as {
      data?: Array<{
        transaction_id?: string;
        token_info?: { address?: string; symbol?: string; decimals?: number };
        from?: string;
        to?: string;
        value?: string;
        block_timestamp?: number;
      }>;
    };

    const rawList = Array.isArray(txJson.data) ? txJson.data : [];
    const deposits: ScannedTronDeposit[] = [];

    for (let i = 0; i < rawList.length; i++) {
      const tx = rawList[i];
      const txHash = String(tx.transaction_id || '').trim();
      if (!txHash) continue;
      const toAddr = String(tx.to || '').trim();
      if (toAddr !== address) continue;
      const contract = String(tx.token_info?.address || '').trim();
      const decimals = tx.token_info?.decimals ?? 6;
      const rawVal = BigInt(tx.value || '0');
      // Normalize to micro-USDT (6 decimals)
      const scale = decimals >= 6 ? BigInt(10 ** (decimals - 6)) : BigInt(1);
      const amountMicro =
        decimals >= 6
          ? Number(rawVal / scale)
          : Number(rawVal * BigInt(10 ** (6 - decimals)));

      const ageMs = Math.max(0, Date.now() - (tx.block_timestamp || Date.now()));
      // TRON produces ~1 block every 3 seconds
      const approxConfirmations = Math.min(999, Math.floor(ageMs / 3000));

      deposits.push({
        txHash,
        eventIndex: 0,
        from: String(tx.from || ''),
        to: toAddr,
        contractAddress: contract,
        tokenSymbol: String(tx.token_info?.symbol || 'TRC20'),
        amountMicro,
        confirmations: approxConfirmations,
        requiredConfirmations: 19,
        blockTimestampMs: tx.block_timestamp || Date.now(),
        isContractMatch: contract === usdtContract,
      });
    }

    return {
      address,
      network,
      usdtContract,
      latestBlockNumber,
      isLive: true,
      deposits,
      notice: 'Scanned via TronGrid TRC-20 endpoint with contract & recipient verification.',
    };
  } catch (err) {
    return {
      address,
      network,
      usdtContract,
      latestBlockNumber: null,
      isLive: false,
      deposits: [],
      notice:
        err instanceof Error
          ? `TronGrid unavailable (${err.message}); sandbox monitor active.`
          : 'TronGrid unavailable; sandbox monitor active.',
    };
  }
}

// --- 3. Supabase (PostgreSQL, Auth & Private Storage — Server-Side Only) ---
let supabaseClient: SupabaseClient | null = null;
let supabaseHealthCache: {
  payload: {
    configured: boolean;
    mode: string;
    bucketName: string;
    bucketExists?: boolean;
    hasServiceRole?: boolean;
    hasAnonKey?: boolean;
    message: string;
    checkedAt: string;
  };
  expiresAt: number;
} | null = null;

function isValidHttpsUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host === '169.254.169.254'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isSupabaseConfigured(): boolean {
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  return isValidHttpsUrl(url) && Boolean(serviceKey || anonKey);
}

function getSupabaseServerClient(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (!isValidHttpsUrl(url) || !key) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseClient;
}

export async function getSupabaseHealth() {
  const now = Date.now();
  if (supabaseHealthCache && supabaseHealthCache.expiresAt > now) {
    return supabaseHealthCache.payload;
  }

  const bucketName = (process.env.SUPABASE_KYC_BUCKET || 'kyc-documents').trim();
  const client = getSupabaseServerClient();

  if (!client) {
    const fallback = {
      configured: false,
      mode: 'DEMO_FALLBACK',
      bucketName,
      hasServiceRole: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
      hasAnonKey: Boolean((process.env.SUPABASE_ANON_KEY || '').trim()),
      message:
        'Supabase environment variables not set yet. App continues running on Firestore + Sandbox Vault.',
      checkedAt: new Date().toISOString(),
    };
    supabaseHealthCache = { payload: fallback, expiresAt: now + 15_000 };
    return fallback;
  }

  try {
    const { data: buckets, error: bucketErr } = await client.storage.listBuckets();
    const bucketExists = Boolean(buckets?.some((b) => b.name === bucketName));
    const result = {
      configured: true,
      mode: bucketErr ? 'CONNECTED_LIMITED' : 'LIVE_CONNECTED',
      bucketName,
      bucketExists,
      hasServiceRole: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
      hasAnonKey: Boolean((process.env.SUPABASE_ANON_KEY || '').trim()),
      message: bucketErr
        ? `Supabase reached with warning: ${bucketErr.message}`
        : `Supabase connected (KYC bucket '${bucketName}' ${bucketExists ? 'ready' : 'pending creation'}).`,
      checkedAt: new Date().toISOString(),
    };
    supabaseHealthCache = { payload: result, expiresAt: now + 30_000 };
    return result;
  } catch (err) {
    const fallback = {
      configured: true,
      mode: 'ERROR_FALLBACK',
      bucketName,
      message: err instanceof Error ? err.message : 'Unable to reach Supabase.',
      checkedAt: new Date().toISOString(),
    };
    supabaseHealthCache = { payload: fallback, expiresAt: now + 15_000 };
    return fallback;
  }
}

export async function uploadKycDocumentToSupabase(params: {
  uid: string;
  docType: 'ID_FRONT' | 'ID_BACK' | 'SELFIE';
  fileName: string;
  contentType: string;
  base64Data: string;
}) {
  const allowedMimes = new Set(['image/jpeg', 'image/png', 'application/pdf']);
  if (!allowedMimes.has(params.contentType)) {
    throw new Error('Only JPEG, PNG, or PDF files are permitted for KYC uploads.');
  }

  const rawBuffer = Buffer.from(params.base64Data, 'base64');
  if (rawBuffer.byteLength === 0 || rawBuffer.byteLength > 2 * 1024 * 1024) {
    throw new Error('KYC document must be between 1 byte and 2 MB.');
  }

  const safeUid = params.uid.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeBaseName = params.fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 64);
  const objectPath = `${safeUid}/${params.docType.toLowerCase()}_${Date.now()}_${safeBaseName}`;
  const bucketName = (process.env.SUPABASE_KYC_BUCKET || 'kyc-documents').trim();

  const client = getSupabaseServerClient();
  if (!client) {
    return {
      storedIn: 'DEMO_SANDBOX_VAULT',
      objectPath,
      docType: params.docType,
      bytes: rawBuffer.byteLength,
      signedUrl: null,
      notice:
        'Supabase keys are not configured yet; recorded sandbox KYC upload attestation without storing raw files externally.',
    };
  }

  const { error: uploadErr } = await client.storage.from(bucketName).upload(objectPath, rawBuffer, {
    contentType: params.contentType,
    upsert: false,
  });

  if (uploadErr) {
    return {
      storedIn: 'DEMO_SANDBOX_VAULT',
      objectPath,
      docType: params.docType,
      bytes: rawBuffer.byteLength,
      signedUrl: null,
      notice: `Supabase storage fallback (${uploadErr.message}). Ensure private bucket '${bucketName}' exists.`,
    };
  }

  const { data: signedData } = await client.storage
    .from(bucketName)
    .createSignedUrl(objectPath, 300);

  return {
    storedIn: 'SUPABASE_PRIVATE_STORAGE',
    objectPath,
    docType: params.docType,
    bytes: rawBuffer.byteLength,
    signedUrl: signedData?.signedUrl || null,
    notice: 'Uploaded to private Supabase Storage with 5-minute time-limited signed access.',
  };
}

export async function syncOrderToSupabasePostgres(params: {
  orderCode: string;
  side: string;
  inrPaise: number;
  usdtMicro: number;
  status: string;
  isSandbox: boolean;
}) {
  const client = getSupabaseServerClient();
  if (!client) {
    return { synced: false, mode: 'FIRESTORE_PRIMARY_FALLBACK' };
  }

  try {
    const { error } = await client.from('p2p_orders_mirror').upsert(
      {
        order_code: params.orderCode,
        side: params.side,
        inr_paise: params.inrPaise,
        usdt_micro: params.usdtMicro,
        status: params.status,
        is_sandbox: params.isSandbox,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'order_code' }
    );
    if (error) {
      return { synced: false, mode: 'SUPABASE_TABLE_OPTIONAL', reason: error.message };
    }
    return { synced: true, mode: 'SUPABASE_POSTGRES_MIRROR' };
  } catch (err) {
    return {
      synced: false,
      mode: 'FIRESTORE_PRIMARY_FALLBACK',
      reason: err instanceof Error ? err.message : 'Sync skipped',
    };
  }
}

export function getIntegrationSummaryStatus(sandboxMode: boolean) {
  return {
    sandboxMode,
    marketRateFallbackInr: Number(process.env.MARKET_RATE_FALLBACK_INR || 91.85),
    coingecko: {
      configured: Boolean((process.env.COINGECKO_API_KEY || '').trim()),
      baseUrl: getCoinGeckoBase(),
      supportsAnonymousFreeTier: true,
    },
    trongrid: {
      configured: Boolean((process.env.TRONGRID_API_KEY || '').trim()),
      network: getTronNetworkName(),
      baseUrl: getTronGridBase(),
      supportsAnonymousFreeTier: true,
    },
    supabase: {
      configured: isSupabaseConfigured(),
      hasUrl: isValidHttpsUrl((process.env.SUPABASE_URL || '').trim()),
      hasAnonKey: Boolean((process.env.SUPABASE_ANON_KEY || '').trim()),
      hasServiceRoleKey: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
      kycBucket: (process.env.SUPABASE_KYC_BUCKET || 'kyc-documents').trim(),
    },
  };
}
