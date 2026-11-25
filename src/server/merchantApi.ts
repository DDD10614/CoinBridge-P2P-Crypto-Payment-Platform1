import crypto from 'node:crypto';
import net from 'node:net';

export interface RegisteredMerchantApiKey {
  keyHash: string;
  keyPrefix: string;
  merchantUid: string;
  label: string;
  scopes: string[];
  rateLimitPerMin: number;
  revoked: boolean;
  totalRequests: number;
  rateLimitedCount: number;
  lastUsedAtIso?: string;
  recentEndpoints: string[];
}

const keyRegistry = new Map<string, RegisteredMerchantApiKey>();
const keyRateBuckets = new Map<string, { count: number; resetAtMs: number }>();

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
}

export function generateMerchantApiKeyBundle(params: {
  merchantUid: string;
  label: string;
  scopes: string[];
  rateLimitPerMin: number;
  isSandbox: boolean;
}) {
  const prefixTag = params.isSandbox ? 'cb_test_' : 'cb_live_';
  const secretToken = crypto.randomBytes(24).toString('hex');
  const rawKey = `${prefixTag}${secretToken}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = `${rawKey.slice(0, 14)}...${rawKey.slice(-4)}`;

  const entry: RegisteredMerchantApiKey = {
    keyHash,
    keyPrefix,
    merchantUid: params.merchantUid,
    label: params.label.trim().slice(0, 64),
    scopes: params.scopes.slice(0, 8),
    rateLimitPerMin: Math.min(600, Math.max(10, Math.round(params.rateLimitPerMin))),
    revoked: false,
    totalRequests: 0,
    rateLimitedCount: 0,
    recentEndpoints: [],
  };
  keyRegistry.set(keyHash, entry);

  return {
    rawKey,
    keyHash,
    keyPrefix,
    rateLimitPerMin: entry.rateLimitPerMin,
    scopes: entry.scopes,
  };
}

export function syncMerchantApiKeyEntry(entry: {
  keyHash: string;
  keyPrefix: string;
  merchantUid: string;
  label: string;
  scopes: string[];
  rateLimitPerMin: number;
  revoked: boolean;
}) {
  const prev = keyRegistry.get(entry.keyHash);
  keyRegistry.set(entry.keyHash, {
    ...entry,
    totalRequests: prev?.totalRequests ?? 0,
    rateLimitedCount: prev?.rateLimitedCount ?? 0,
    lastUsedAtIso: prev?.lastUsedAtIso,
    recentEndpoints: prev?.recentEndpoints ?? [],
  });
}

export function revokeMerchantApiKeyInRegistry(keyHash: string) {
  const entry = keyRegistry.get(keyHash);
  if (entry) {
    entry.revoked = true;
  }
}

export function authenticateMerchantApiKey(rawKey: string, endpoint: string): {
  ok: boolean;
  status: number;
  error?: string;
  keyEntry?: RegisteredMerchantApiKey;
} {
  const clean = rawKey.trim();
  if (!clean || (!clean.startsWith('cb_test_') && !clean.startsWith('cb_live_'))) {
    return { ok: false, status: 401, error: 'Invalid Merchant API key format.' };
  }
  const keyHash = hashApiKey(clean);
  const entry = keyRegistry.get(keyHash);
  if (!entry) {
    return { ok: false, status: 401, error: 'Unknown or un-synced Merchant API key.' };
  }
  if (entry.revoked) {
    return { ok: false, status: 403, error: 'This Merchant API key has been revoked.' };
  }

  const now = Date.now();
  const bucket = keyRateBuckets.get(keyHash);
  if (!bucket || bucket.resetAtMs <= now) {
    keyRateBuckets.set(keyHash, { count: 1, resetAtMs: now + 60_000 });
  } else {
    bucket.count += 1;
    if (bucket.count > entry.rateLimitPerMin) {
      entry.rateLimitedCount += 1;
      return {
        ok: false,
        status: 429,
        error: `Merchant API rate limit exceeded (${entry.rateLimitPerMin} req/min).`,
      };
    }
  }

  entry.totalRequests += 1;
  entry.lastUsedAtIso = new Date().toISOString();
  entry.recentEndpoints = [endpoint, ...entry.recentEndpoints].slice(0, 10);

  return { ok: true, status: 200, keyEntry: entry };
}

export function getMerchantApiUsageStats(merchantUid: string) {
  const keys = Array.from(keyRegistry.values()).filter((k) => k.merchantUid === merchantUid);
  return {
    activeKeys: keys.filter((k) => !k.revoked).length,
    totalRequests: keys.reduce((s, k) => s + k.totalRequests, 0),
    rateLimitedCount: keys.reduce((s, k) => s + k.rateLimitedCount, 0),
    keys: keys.map((k) => ({
      keyHash: k.keyHash,
      keyPrefix: k.keyPrefix,
      label: k.label,
      totalRequests: k.totalRequests,
      rateLimitedCount: k.rateLimitedCount,
      lastUsedAtIso: k.lastUsedAtIso || null,
      recentEndpoints: k.recentEndpoints,
    })),
  };
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return true;
  }

  const ipType = net.isIP(host);
  if (ipType === 4) {
    const parts = host.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  } else if (ipType === 6) {
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
      return true;
    }
  }
  return false;
}

export function validateWebhookUrlSafe(urlString: string): {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
} {
  const trimmed = urlString.trim();
  if (!trimmed) return { valid: false, reason: 'Webhook URL is required.' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Malformed webhook URL.' };
  }
  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: 'Webhook endpoints must use HTTPS to protect HMAC-signed settlement payloads.',
    };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Webhook URL must not embed credentials.' };
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return {
      valid: false,
      reason: 'Private, loopback, link-local, and internal hostnames are blocked (SSRF protection).',
    };
  }
  return { valid: true, normalizedUrl: parsed.toString() };
}

export function signWebhookPayload(secret: string, bodyJson: string, timestampSec: number): string {
  const signedContent = `${timestampSec}.${bodyJson}`;
  const sig = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');
  return `t=${timestampSec},v1=${sig}`;
}

export function generateWebhookSigningSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

export async function dispatchSignedWebhookTest(params: {
  url: string;
  secret: string;
  merchantUid: string;
  eventType: string;
  sandboxMode: boolean;
}) {
  const check = validateWebhookUrlSafe(params.url);
  if (!check.valid || !check.normalizedUrl) {
    return { delivered: false, statusCode: 400, error: check.reason };
  }

  const ts = Math.floor(Date.now() / 1000);
  const payload = {
    id: `evt_${crypto.randomBytes(8).toString('hex')}`,
    eventType: params.eventType,
    merchantUid: params.merchantUid,
    sandbox: params.sandboxMode,
    createdAt: new Date().toISOString(),
    data: {
      note: 'CoinBridge signed webhook verification ping.',
    },
  };
  const bodyJson = JSON.stringify(payload);
  const signatureHeader = signWebhookPayload(params.secret, bodyJson, ts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(check.normalizedUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CoinBridge-Event': params.eventType,
        'X-CoinBridge-Signature': signatureHeader,
      },
      body: bodyJson,
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return {
      delivered: resp.ok,
      statusCode: resp.status,
      signaturePreview: signatureHeader.slice(0, 42) + '...',
      payload,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      delivered: false,
      statusCode: 0,
      signaturePreview: signatureHeader.slice(0, 42) + '...',
      error: err instanceof Error ? err.message : 'Webhook delivery timed out or failed.',
      payload,
    };
  }
}
