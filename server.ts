import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import {
  BLOCKCHAIN_NETWORKS,
  BlockchainNetworkId,
  computeDeterministicRisk,
  DEFAULT_WALLET_SECURITY_POLICY,
  deriveDeterministicDepositAddress,
  EXTERNAL_EXCHANGE_GUIDES,
  KycStatus,
  PaymentMethodType,
} from './src/lib/domain.ts';
import {
  getIntegrationSummaryStatus,
  getSupabaseHealth,
  getTronAccountRead,
  getTronTestnetStatus,
  getUsdtInrMarketRate,
  syncOrderToSupabasePostgres,
  uploadKycDocumentToSupabase,
  verifyTronTxViaTronGrid,
} from './src/server/integrations.ts';
import {
  buildOtpAuthUri,
  evaluateLoginContext,
  generateBase32Secret,
  issueVideoKycChallenge,
  sealTotpSecret,
  unsealTotpSecret,
  verifyTotpToken,
  verifyVideoKycSubmission,
} from './src/server/security.ts';
import crypto from 'node:crypto';
import {
  authorizeTradingOperation,
  fetchCallerUserAccount,
  validateAndExecuteWithdrawalServer,
  verifyAndPrepareDeposit,
} from './src/server/wallet.ts';
import {
  getAllCoinMarkets,
  getCoinHistoricalCandles,
  getSingleCoinMarket,
  isValidChartInterval,
  validateAssetNetworkPayload,
} from './src/server/markets.ts';
import { generateMarketIntelligenceResponse } from './src/server/intelligence.ts';
import {
  authenticateMerchantApiKey,
  dispatchSignedWebhookTest,
  generateMerchantApiKeyBundle,
  generateWebhookSigningSecret,
  getMerchantApiUsageStats,
  revokeMerchantApiKeyInRegistry,
  syncMerchantApiKeyEntry,
  validateWebhookUrlSafe,
} from './src/server/merchantApi.ts';
import { screenWalletAddressRisk } from './src/server/fraud.ts';
import { isKycStatusVerified } from './src/lib/domain.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}
const adminAuth = getAuth();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SANDBOX_MODE = process.env.EXCHANGE_SANDBOX_MODE !== 'false';

app.set('trust proxy', 1);
app.use('/api/integrations/supabase/kyc-upload', express.json({ limit: '4mb' }));
app.use('/api/kyc/video/verify', express.json({ limit: '4mb' }));
app.use(express.json({ limit: '512kb' }));

// Security headers (iframe-compatible; camera/mic scoped to self for Video KYC)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  next();
});

// Simple sliding-window API rate limiter per IP
const rateBucket = new Map<string, { count: number; resetAt: number }>();
function apiRateLimiter(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api/')) return next();
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = rateBucket.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateBucket.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  entry.count += 1;
  if (entry.count > 120) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please retry in a minute.' });
  }
  return next();
}
app.use(apiRateLimiter);

interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required (missing Bearer token).' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication required (empty token).' });
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;
    return next();
  } catch (err) {
    console.error('Firebase ID token verification failed:', err);
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

// --- In-memory Idempotency & Duplicate UTR Ledger (Sandbox Payment Simulator) ---
const processedSandboxPayments = new Map<
  string,
  {
    referenceId: string;
    orderId: string;
    inrPaise: number;
    method: PaymentMethodType;
    verifiedAt: string;
    uid: string;
  }
>();
const usedIdempotencyKeys = new Map<string, unknown>();

// --- API Routes ---

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    sandboxMode: SANDBOX_MODE,
    projectId: firebaseConfig.projectId,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/rates/usdt-inr', async (_req, res) => {
  const rate = await getUsdtInrMarketRate();
  res.json(rate);
});

app.get('/api/markets', async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const extraRaw = String(req.query.extra || '').trim();
  const extraCoins: Array<{ symbol: string; name: string; coingeckoId: string }> = [];
  if (extraRaw) {
    for (const part of extraRaw.split(',').slice(0, 20)) {
      const [sym, cgId, name] = part.split(':');
      if (sym && cgId && /^[a-zA-Z0-9]{2,12}$/.test(sym) && /^[a-z0-9-]{2,64}$/.test(cgId)) {
        extraCoins.push({
          symbol: sym.toUpperCase(),
          coingeckoId: cgId,
          name: (name || sym).slice(0, 40),
        });
      }
    }
  }
  const markets = await getAllCoinMarkets({ refresh, extraCoins });
  res.json(markets);
});

app.get('/api/markets/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid cryptocurrency symbol.' });
  }
  const coingeckoId = req.query.coingeckoId
    ? String(req.query.coingeckoId).trim().toLowerCase()
    : undefined;
  if (coingeckoId && !/^[a-z0-9-]{2,64}$/.test(coingeckoId)) {
    return res.status(400).json({ error: 'Invalid CoinGecko ID format.' });
  }
  const detail = await getSingleCoinMarket({
    symbol,
    coingeckoId,
    name: req.query.name ? String(req.query.name).slice(0, 60) : undefined,
  });
  return res.json(detail);
});

app.get('/api/markets/:symbol/history', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid cryptocurrency symbol.' });
  }
  const intervalParam = String(req.query.interval || '1h').trim();
  if (!isValidChartInterval(intervalParam)) {
    return res.status(400).json({
      error: 'Unsupported chart interval. Allowed: 1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M, 1y.',
    });
  }
  const coingeckoId = req.query.coingeckoId
    ? String(req.query.coingeckoId).trim().toLowerCase()
    : undefined;
  if (coingeckoId && !/^[a-z0-9-]{2,64}$/.test(coingeckoId)) {
    return res.status(400).json({ error: 'Invalid CoinGecko ID format.' });
  }
  const history = await getCoinHistoricalCandles({
    symbol,
    interval: intervalParam,
    coingeckoId,
  });
  return res.json(history);
});

app.post('/api/markets/validate-asset-network', requireAuth, (req: AuthRequest, res: Response) => {
  const body = (req.body || {}) as {
    symbol?: string;
    network?: string;
    contractAddress?: string;
    destinationAddress?: string;
    coinOverride?: Record<string, unknown>;
  };
  const result = validateAssetNetworkPayload({
    symbol: String(body.symbol || ''),
    network: String(body.network || ''),
    contractAddress: body.contractAddress !== undefined ? String(body.contractAddress) : undefined,
    destinationAddress:
      body.destinationAddress !== undefined ? String(body.destinationAddress) : undefined,
    coinOverride: body.coinOverride,
  });
  if (!result.valid) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

app.get('/api/tron/status', async (_req, res) => {
  const status = await getTronTestnetStatus(SANDBOX_MODE);
  res.json(status);
});

app.get('/api/tron/account/:address', requireAuth, async (req: AuthRequest, res: Response) => {
  const address = String(req.params.address || '').trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid TRON Base58 address format (must start with T and be 34 chars).' });
  }
  const accountData = await getTronAccountRead(address);
  return res.json(accountData);
});

app.get('/api/integrations/status', requireAuth, (_req: AuthRequest, res: Response) => {
  res.json(getIntegrationSummaryStatus(SANDBOX_MODE));
});

app.get('/api/integrations/supabase/health', requireAuth, async (_req: AuthRequest, res: Response) => {
  const health = await getSupabaseHealth();
  res.json(health);
});

app.post('/api/integrations/supabase/kyc-upload', requireAuth, async (req: AuthRequest, res: Response) => {
  const body = req.body as {
    docType?: string;
    fileName?: string;
    contentType?: string;
    base64Data?: string;
  };
  const docType = body?.docType;
  if (docType !== 'ID_FRONT' && docType !== 'ID_BACK' && docType !== 'SELFIE') {
    return res.status(400).json({ error: 'Invalid docType. Must be ID_FRONT, ID_BACK, or SELFIE.' });
  }
  if (!body?.fileName || !body?.contentType || !body?.base64Data) {
    return res.status(400).json({ error: 'fileName, contentType, and base64Data are required.' });
  }
  try {
    const result = await uploadKycDocumentToSupabase({
      uid: req.user!.uid,
      docType,
      fileName: String(body.fileName),
      contentType: String(body.contentType),
      base64Data: String(body.base64Data),
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : 'Unable to upload KYC document.',
    });
  }
});

app.post('/api/integrations/supabase/sync-order', requireAuth, async (req: AuthRequest, res: Response) => {
  const body = req.body as {
    orderCode?: string;
    side?: string;
    inrPaise?: number;
    usdtMicro?: number;
    status?: string;
    isSandbox?: boolean;
  };
  if (
    !body?.orderCode ||
    !body?.side ||
    typeof body.inrPaise !== 'number' ||
    typeof body.usdtMicro !== 'number' ||
    !body?.status
  ) {
    return res.status(400).json({ error: 'Valid order summary payload required.' });
  }
  const result = await syncOrderToSupabasePostgres({
    orderCode: String(body.orderCode),
    side: String(body.side),
    inrPaise: Math.round(body.inrPaise),
    usdtMicro: Math.round(body.usdtMicro),
    status: String(body.status),
    isSandbox: Boolean(body.isSandbox ?? SANDBOX_MODE),
  });
  return res.json(result);
});

app.post('/api/risk/assess', requireAuth, async (req: AuthRequest, res: Response) => {
  const body = req.body as {
    orderId?: string;
    inrPaise?: number;
    kycStatus?: KycStatus;
    completedTrades?: number;
    disputedCount?: number;
    cancelledCount?: number;
    newPaymentAccount?: boolean;
    paymentMethod?: PaymentMethodType;
    network?: BlockchainNetworkId;
  };

  if (
    !body ||
    typeof body.inrPaise !== 'number' ||
    !Number.isFinite(body.inrPaise) ||
    body.inrPaise <= 0
  ) {
    return res.status(400).json({ error: 'Valid positive inrPaise is required for risk assessment.' });
  }

  const deterministic = computeDeterministicRisk({
    inrPaise: Math.round(body.inrPaise),
    kycStatus: body.kycStatus || 'NOT_STARTED',
    completedTrades: Math.max(0, Math.round(body.completedTrades || 0)),
    disputedCount: Math.max(0, Math.round(body.disputedCount || 0)),
    cancelledCount: Math.max(0, Math.round(body.cancelledCount || 0)),
    newPaymentAccount: Boolean(body.newPaymentAccount),
  });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.json({
      ...deterministic,
      aiAssisted: false,
      aiProviderStatus: 'UNCONFIGURED_DETERMINISTIC_ONLY',
      advisoryNotice:
        'AI risk scores support human compliance review only and never automatically establish criminal conduct or guarantee fraud prevention.',
    });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const prompt = [
      'Evaluate this P2P USDT/INR order signal for compliance triage (India PMLA / VDA context).',
      `INR Amount (paise): ${Math.round(body.inrPaise)}`,
      `KYC Status: ${body.kycStatus || 'NOT_STARTED'}`,
      `Completed Trades: ${body.completedTrades || 0}`,
      `Prior Disputes: ${body.disputedCount || 0}`,
      `Prior Cancellations: ${body.cancelledCount || 0}`,
      `New Payment Account: ${Boolean(body.newPaymentAccount)}`,
      `Payment Method: ${body.paymentMethod || 'UPI'}`,
      `Network: ${body.network || 'TRON_TRC20'}`,
      `Baseline Deterministic Score: ${deterministic.score}/100 (${deterministic.level})`,
      `Baseline Signals: ${deterministic.reasons.join(' | ')}`,
      'Provide a concise compliance review note and up to 4 clear risk reasons.',
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a FinTech AML/Fraud triage analyst. Produce objective, non-accusatory risk indicators strictly for human compliance review. Never assert criminal guilt.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            adjustedScore: { type: Type.INTEGER },
            summaryNote: { type: Type.STRING },
            reasons: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim()) as {
      adjustedScore?: number;
      summaryNote?: string;
      reasons?: string[];
    };

    const blendedScore =
      typeof parsed.adjustedScore === 'number' && Number.isFinite(parsed.adjustedScore)
        ? Math.min(100, Math.max(0, Math.round((deterministic.score + parsed.adjustedScore) / 2)))
        : deterministic.score;

    const level =
      blendedScore >= 80
        ? 'CRITICAL'
        : blendedScore >= 60
        ? 'HIGH'
        : blendedScore >= 30
        ? 'MEDIUM'
        : 'LOW';

    const mergedReasons =
      Array.isArray(parsed.reasons) && parsed.reasons.length > 0
        ? parsed.reasons.slice(0, 4)
        : deterministic.reasons;

    return res.json({
      score: blendedScore,
      level,
      reasons: mergedReasons,
      recommendedAction: deterministic.recommendedAction,
      summaryNote: parsed.summaryNote || 'Reviewed with baseline compliance heuristics and AI triage.',
      aiAssisted: true,
      aiProviderStatus: 'GEMINI_ACTIVE',
      advisoryNotice:
        'AI risk scores support human compliance review only and never automatically establish criminal conduct or guarantee fraud prevention.',
    });
  } catch (err) {
    console.error('Gemini risk assessment error:', err);
    return res.json({
      ...deterministic,
      aiAssisted: false,
      aiProviderStatus: 'FALLBACK_DETERMINISTIC_ONLY',
      advisoryNotice:
        'AI model unavailable; deterministic risk rules applied. Scores support human review only.',
    });
  }
});

app.post('/api/payments/sandbox-verify', requireAuth, (req: AuthRequest, res: Response) => {
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  if (idempotencyKey && usedIdempotencyKeys.has(idempotencyKey)) {
    return res.json(usedIdempotencyKeys.get(idempotencyKey));
  }

  const body = req.body as {
    orderId?: string;
    inrPaise?: number;
    method?: PaymentMethodType;
    referenceId?: string;
    screenshotOnly?: boolean;
  };

  if (body?.screenshotOnly) {
    return res.status(400).json({
      error:
        'Payment screenshots alone are never accepted as proof of INR settlement. Enter the bank UTR / UPI reference ID and verify receipt in your bank account.',
    });
  }

  const orderId = String(body?.orderId || '').trim();
  const referenceId = String(body?.referenceId || '').trim().toUpperCase();
  const method = body?.method || 'UPI';
  const inrPaise = Number(body?.inrPaise || 0);

  if (!orderId || !referenceId || referenceId.length < 8 || referenceId.length > 40) {
    return res.status(400).json({
      error: 'Valid orderId and 8–40 character UTR / IMPS / UPI reference ID are required.',
    });
  }
  if (!Number.isFinite(inrPaise) || inrPaise <= 0) {
    return res.status(400).json({ error: 'Valid positive INR amount is required.' });
  }

  // Duplicate transaction reference check
  const existing = processedSandboxPayments.get(referenceId);
  if (existing && existing.orderId !== orderId) {
    return res.status(409).json({
      error: `Duplicate UTR / reference detected (${referenceId}) already linked to order ${existing.orderId}. Escalate for manual reconciliation.`,
    });
  }

  const result = {
    verified: true,
    mode: 'SANDBOX_PAYMENT_SIMULATOR',
    notice:
      'Sandbox verification only. Live INR settlement requires authorized Payment Aggregator / bank reconciliation APIs and independent recipient confirmation.',
    referenceId,
    orderId,
    inrPaise: Math.round(inrPaise),
    method,
    verifiedAt: new Date().toISOString(),
  };

  processedSandboxPayments.set(referenceId, {
    referenceId,
    orderId,
    inrPaise: Math.round(inrPaise),
    method,
    verifiedAt: result.verifiedAt,
    uid: req.user?.uid || 'unknown',
  });
  if (idempotencyKey) {
    usedIdempotencyKeys.set(idempotencyKey, result);
  }
  return res.json(result);
});

app.post('/api/blockchain/verify-tx', requireAuth, async (req: AuthRequest, res: Response) => {
  const body = req.body as {
    network?: BlockchainNetworkId;
    txHash?: string;
    isSandbox?: boolean;
  };
  const network = body?.network;
  const txHash = String(body?.txHash || '').trim();

  if (!network || !(network in BLOCKCHAIN_NETWORKS)) {
    return res.status(400).json({ error: 'Unsupported blockchain network.' });
  }
  const netConfig = BLOCKCHAIN_NETWORKS[network];

  if (!txHash || txHash.length < 16 || txHash.length > 128) {
    return res.status(400).json({ error: 'Invalid transaction hash format.' });
  }

  const isEvmHash = /^0x[a-fA-F0-9]{64}$/.test(txHash);
  const isTronHash = /^[a-fA-F0-9]{64}$/.test(txHash);

  if (network === 'TRON_TRC20' && !isTronHash) {
    return res.status(400).json({ error: 'TRON transaction hashes must be 64 hexadecimal characters.' });
  }
  if (network !== 'TRON_TRC20' && !isEvmHash) {
    return res.status(400).json({ error: 'EVM transaction hashes must be 0x followed by 64 hexadecimal characters.' });
  }

  const tronGridCheck =
    network === 'TRON_TRC20' ? await verifyTronTxViaTronGrid(txHash) : null;

  // In sandbox mode, return clearly labeled sandbox verification + read-only TronGrid check
  return res.json({
    network,
    networkName: netConfig.name,
    tokenStandard: netConfig.tokenStandard,
    usdtContractAddress: netConfig.usdtContractAddress,
    txHash,
    explorerUrl: `${netConfig.explorerTxBaseUrl}${txHash}`,
    requiredConfirmations: netConfig.requiredConfirmations,
    tronGridCheck,
    mode: SANDBOX_MODE || body?.isSandbox ? 'SANDBOX_ESCROW_SIMULATOR' : 'CONFIGURED_RPC_CHECK',
    status: tronGridCheck?.foundOnChain ? 'FOUND_ON_TRONGRID_TESTNET' : 'CONFIRMED_SANDBOX',
    notice:
      'Sandbox transaction verification record. Real-money on-chain settlement is disabled until audited smart contract escrow and live RPC indexing are configured.',
    checkedAt: new Date().toISOString(),
  });
});

// --- Video KYC Provider Adapter Endpoints ---
app.post('/api/kyc/video/challenge', requireAuth, (req: AuthRequest, res: Response) => {
  const uid = req.user!.uid;
  const challenge = issueVideoKycChallenge(uid);
  return res.json({
    ...challenge,
    providerMode: process.env.GEMINI_API_KEY
      ? 'GEMINI_FRAME_TRIAGE_ADAPTER'
      : 'SANDBOX_VIDEO_KYC_ADAPTER',
    notice:
      'Complete the live prompt with your ID visible. Final KYC status always requires human compliance approval.',
  });
});

app.post('/api/kyc/video/verify', requireAuth, async (req: AuthRequest, res: Response) => {
  const uid = req.user!.uid;
  const body = req.body as {
    challengeId?: string;
    spokenDigits?: string;
    captureMethod?: 'WEBCAM_STREAM' | 'UPLOADED_CLIP' | 'SANDBOX_SIMULATOR';
    hasDocumentUploaded?: boolean;
    frameBase64?: string;
  };
  if (!body?.challengeId || !body?.spokenDigits) {
    return res.status(400).json({ error: 'challengeId and spokenDigits are required.' });
  }
  try {
    const result = await verifyVideoKycSubmission({
      uid,
      challengeId: String(body.challengeId),
      spokenDigits: String(body.spokenDigits),
      captureMethod: body.captureMethod || 'SANDBOX_SIMULATOR',
      hasDocumentUploaded: Boolean(body.hasDocumentUploaded),
      frameBase64: body.frameBase64 ? String(body.frameBase64) : undefined,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : 'Video KYC verification failed.',
    });
  }
});

// --- RFC 6238 TOTP Two-Factor Authentication Endpoints ---
app.post('/api/security/2fa/enroll', requireAuth, (req: AuthRequest, res: Response) => {
  const uid = req.user!.uid;
  const email = req.user?.email || `${uid}@coinbridge.local`;
  const secret = generateBase32Secret(20);
  const sealedSecret = sealTotpSecret(secret, uid);
  const otpauthUri = buildOtpAuthUri({
    accountName: email,
    issuer: 'CoinBridge P2P',
    secret,
  });
  return res.json({
    secret,
    sealedSecret,
    otpauthUri,
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
  });
});

app.post('/api/security/2fa/verify', requireAuth, (req: AuthRequest, res: Response) => {
  const uid = req.user!.uid;
  const body = req.body as {
    code?: string;
    sealedSecret?: string;
  };
  const code = String(body?.code || '').trim();
  const sealedSecret = String(body?.sealedSecret || '').trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter a valid 6-digit authenticator code.' });
  }
  if (!sealedSecret) {
    return res.status(400).json({ error: 'Missing sealed 2FA enrollment secret.' });
  }
  const secret = unsealTotpSecret(sealedSecret, uid);
  if (!secret) {
    return res.status(400).json({
      error: 'Unable to unseal 2FA secret (enrollment may have expired across server restart; re-enroll 2FA in Security).',
    });
  }
  const valid = verifyTotpToken(secret, code);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid or expired 6-digit authenticator code.' });
  }
  return res.json({
    verified: true,
    verifiedAt: new Date().toISOString(),
  });
});

// --- Login Context & Anomaly Evaluation ---
app.post('/api/security/analyze-login', requireAuth, (req: AuthRequest, res: Response) => {
  const body = req.body as {
    knownDevicesCount?: number;
    isNewDevice?: boolean;
    previousTimezones?: string[];
    currentTimezone?: string;
  };
  const result = evaluateLoginContext({
    knownDevicesCount: Math.max(0, Number(body?.knownDevicesCount || 0)),
    isNewDevice: Boolean(body?.isNewDevice),
    previousTimezones: Array.isArray(body?.previousTimezones)
      ? body.previousTimezones.slice(0, 10).map(String)
      : [],
    currentTimezone: String(body?.currentTimezone || 'UTC').slice(0, 64),
  });
  return res.json(result);
});

// --- Mandatory KYC & Asset Approval Trading Authorization Gate ---
app.post('/api/trading/authorize', requireAuth, async (req: AuthRequest, res: Response) => {
  const bearerToken = String(req.headers.authorization || '').slice('Bearer '.length).trim();
  const body = req.body as { action?: string; coinSymbol?: string; network?: string };
  const result = await authorizeTradingOperation({
    uid: req.user!.uid,
    bearerToken,
    action: body?.action ? String(body.action).slice(0, 64) : 'TRADE_EXECUTION',
    coinSymbol: body?.coinSymbol ? String(body.coinSymbol).slice(0, 12) : undefined,
    network: body?.network ? String(body.network).slice(0, 32) : undefined,
  });
  if (!result.authorized) {
    return res.status(403).json(result);
  }
  return res.json(result);
});

// --- Crypto Wallet Deposit & Withdrawal Endpoints ---
app.get('/api/wallet/networks', (_req: Request, res: Response) => {
  res.json({
    sandboxMode: SANDBOX_MODE,
    networks: Object.values(BLOCKCHAIN_NETWORKS),
    securityPolicy: DEFAULT_WALLET_SECURITY_POLICY,
    exchangeGuides: EXTERNAL_EXCHANGE_GUIDES,
  });
});

app.post('/api/wallet/deposit-address', requireAuth, (req: AuthRequest, res: Response) => {
  const body = req.body as { network?: BlockchainNetworkId };
  const network = body?.network || 'TRON_TRC20';
  const netCfg = BLOCKCHAIN_NETWORKS[network];
  if (!netCfg) {
    return res.status(400).json({ error: 'Unsupported blockchain network.' });
  }
  const address = deriveDeterministicDepositAddress(req.user!.uid, network);
  return res.json({
    uid: req.user!.uid,
    network,
    networkName: netCfg.name,
    tokenStandard: netCfg.tokenStandard,
    address,
    contractAddress: SANDBOX_MODE ? netCfg.testnetContractAddress : netCfg.usdtContractAddress,
    requiredConfirmations: netCfg.requiredConfirmations,
    minDepositUsdtMicro: netCfg.minDepositUsdtMicro,
    isSandbox: SANDBOX_MODE,
    explorerAddressUrl: `${netCfg.explorerAddressBaseUrl}${address}`,
  });
});

app.post('/api/wallet/deposits/monitor', requireAuth, async (req: AuthRequest, res: Response) => {
  const body = req.body as {
    network?: BlockchainNetworkId;
    txHash?: string;
    eventIndex?: number;
    amountUsdt?: number;
    screenshotOnly?: boolean;
    sandboxFaucet?: boolean;
  };
  const network = (body?.network || 'TRON_TRC20') as BlockchainNetworkId;
  const result = await verifyAndPrepareDeposit({
    uid: req.user!.uid,
    network,
    txHash: body?.txHash,
    eventIndex: body?.eventIndex,
    amountUsdt: body?.amountUsdt,
    screenshotOnly: Boolean(body?.screenshotOnly),
    sandboxFaucet: Boolean(body?.sandboxFaucet),
    sandboxMode: SANDBOX_MODE,
  });
  if ('error' in result) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json(result.payload);
});

app.post('/api/wallet/withdraw/validate', requireAuth, async (req: AuthRequest, res: Response) => {
  const bearerToken = String(req.headers.authorization || '').slice('Bearer '.length).trim();
  const result = await validateAndExecuteWithdrawalServer({
    uid: req.user!.uid,
    bearerToken,
    body: (req.body || {}) as Record<string, unknown>,
    idempotencyKeyHeader: '',
    sandboxMode: SANDBOX_MODE,
    dryRunOnly: true,
  });
  if ('error' in result) {
    return res.status(result.status).json(result);
  }
  return res.json(result.payload);
});

app.post('/api/wallet/withdraw/submit', requireAuth, async (req: AuthRequest, res: Response) => {
  const bearerToken = String(req.headers.authorization || '').slice('Bearer '.length).trim();
  const idempotencyKeyHeader = String(req.headers['idempotency-key'] || '').trim();
  const result = await validateAndExecuteWithdrawalServer({
    uid: req.user!.uid,
    bearerToken,
    body: (req.body || {}) as Record<string, unknown>,
    idempotencyKeyHeader,
    sandboxMode: SANDBOX_MODE,
    dryRunOnly: false,
  });
  if ('error' in result) {
    return res.status(result.status).json(result);
  }
  return res.json(result.payload);
});

// --- Temporary Price Lock Signing & Verification ---
const PRICE_LOCK_SECRET =
  process.env.PRICE_LOCK_HMAC_SECRET ||
  process.env.SESSION_SECRET ||
  crypto.randomBytes(32).toString('hex');

function signPriceLockPayload(payload: {
  lockId: string;
  uid: string;
  offerId: string;
  asset: string;
  rateInrPaise: number;
  expiresAtMs: number;
}): string {
  const canonical = `${payload.lockId}|${payload.uid}|${payload.offerId}|${payload.asset}|${payload.rateInrPaise}|${payload.expiresAtMs}`;
  return crypto.createHmac('sha256', PRICE_LOCK_SECRET).update(canonical).digest('hex');
}

app.post('/api/quotes/lock', requireAuth, (req: AuthRequest, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const offerId = String(body.offerId || '').trim();
  const asset = String(body.asset || 'USDT').trim().toUpperCase();
  const rateInrPaise = Math.round(Number(body.rateInrPaise || 0));
  const requestedTtl = Math.round(Number(body.ttlSeconds || 90));
  const ttlSeconds = [45, 90, 180].includes(requestedTtl) ? requestedTtl : 90;

  if (!offerId || rateInrPaise <= 0) {
    return res.status(400).json({ error: 'Valid offerId and positive rateInrPaise are required.' });
  }

  const nowMs = Date.now();
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  const lockId = `plk_${crypto.randomBytes(8).toString('hex')}`;
  const signature = signPriceLockPayload({
    lockId,
    uid: req.user!.uid,
    offerId,
    asset,
    rateInrPaise,
    expiresAtMs,
  });

  return res.json({
    lockId,
    uid: req.user!.uid,
    offerId,
    asset,
    rateInrPaise,
    ttlSeconds,
    lockedAtMs: nowMs,
    expiresAtMs,
    signature,
    expired: false,
  });
});

app.post('/api/quotes/verify', requireAuth, (req: AuthRequest, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const lockId = String(body.lockId || '');
  const offerId = String(body.offerId || '');
  const asset = String(body.asset || 'USDT').toUpperCase();
  const rateInrPaise = Math.round(Number(body.rateInrPaise || 0));
  const expiresAtMs = Math.round(Number(body.expiresAtMs || 0));
  const signature = String(body.signature || '');

  const expected = signPriceLockPayload({
    lockId,
    uid: req.user!.uid,
    offerId,
    asset,
    rateInrPaise,
    expiresAtMs,
  });
  const sigMatch =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!sigMatch) {
    return res.status(400).json({ valid: false, expired: false, error: 'Invalid price lock signature.' });
  }
  const expired = Date.now() > expiresAtMs;
  return res.json({
    valid: !expired,
    expired,
    remainingSeconds: Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)),
  });
});

// --- Public Platform Status Probe ---
app.get('/api/status', async (_req: Request, res: Response) => {
  const [marketsRes, tronRes, supabaseRes] = await Promise.allSettled([
    getAllCoinMarkets({ refresh: false }),
    getTronTestnetStatus(SANDBOX_MODE),
    getSupabaseHealth(),
  ]);

  const markets = marketsRes.status === 'fulfilled' ? marketsRes.value : null;
  const tron = tronRes.status === 'fulfilled' ? tronRes.value : null;
  const supabase = supabaseRes.status === 'fulfilled' ? supabaseRes.value : null;

  const services = [
    {
      id: 'website',
      name: 'Website & Client Portal',
      status: 'OPERATIONAL',
      detail: 'Serving React SPA & authenticated API gateway on port 3000.',
    },
    {
      id: 'trading',
      name: 'P2P Trading & Escrow Engine',
      status: 'OPERATIONAL',
      detail: SANDBOX_MODE
        ? 'Sandbox escrow ledger & smart matching active.'
        : 'Configured P2P order matching & escrow state machine active.',
    },
    {
      id: 'market_data',
      name: 'CoinGecko Market Data Feed',
      status:
        markets?.freshnessStatus === 'LIVE'
          ? 'OPERATIONAL'
          : markets?.freshnessStatus === 'DELAYED' || markets?.freshnessStatus === 'STALE'
            ? 'DEGRADED'
            : 'DEGRADED',
      detail: markets
        ? `Freshness: ${markets.freshnessStatus} (${markets.coins.length} coins, cache age ${markets.cacheAgeSeconds}s).`
        : 'Market feed probe failed; fallback quotes active.',
    },
    {
      id: 'blockchain',
      name: 'TRON Nile & Multi-Chain Monitors',
      status: tron?.isLive ? 'OPERATIONAL' : 'DEGRADED',
      detail: tron
        ? `${tron.network} · Block #${tron.latestBlockNumber ?? 'N/A'} (${tron.isLive ? 'Live' : 'Fallback'})`
        : 'TronGrid status probe unavailable.',
    },
    {
      id: 'deposits',
      name: 'Crypto Deposit Monitor',
      status: 'OPERATIONAL',
      detail: 'Idempotent event verification & compliance hold queue operational.',
    },
    {
      id: 'withdrawals',
      name: 'Crypto Withdrawal Security Gate',
      status: 'OPERATIONAL',
      detail: 'Mandatory KYC + 2FA TOTP + 24h whitelist cooldown gate operational.',
    },
    {
      id: 'notifications',
      name: 'Alerts & Notifications Pipeline',
      status: supabase?.configured ? 'OPERATIONAL' : 'OPERATIONAL',
      detail: 'In-app security, KYC, order, and price alert listeners active.',
    },
  ];

  const hasDegraded = services.some((s) => s.status !== 'OPERATIONAL');
  res.json({
    overallStatus: hasDegraded ? 'PARTIAL_DEGRADATION' : 'ALL_SYSTEMS_OPERATIONAL',
    sandboxMode: SANDBOX_MODE,
    checkedAt: new Date().toISOString(),
    services,
  });
});

// --- Fraud Wallet Screening ---
app.post('/api/fraud/screen-wallet', requireAuth, (req: AuthRequest, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const address = String(body.address || '').trim();
  const network = String(body.network || 'TRON_TRC20') as BlockchainNetworkId;
  const amountUsdt =
    typeof body.amountUsdt === 'number' ? body.amountUsdt : Number(body.amountUsdt || 0);
  const recentWithdrawals24h =
    typeof body.recentWithdrawals24h === 'number' ? body.recentWithdrawals24h : 0;

  if (!address) {
    return res.status(400).json({ error: 'Wallet address is required for risk screening.' });
  }
  if (!BLOCKCHAIN_NETWORKS[network]) {
    return res.status(400).json({ error: 'Unsupported blockchain network.' });
  }

  const result = screenWalletAddressRisk({
    address,
    network,
    amountUsdt: Number.isFinite(amountUsdt) ? amountUsdt : undefined,
    recentWithdrawals24h,
  });
  return res.json(result);
});

// --- Advanced Market Intelligence (Gemini + CoinGecko) ---
app.post('/api/intelligence/analyze', requireAuth, async (req: AuthRequest, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const symbols = Array.isArray(body.symbols)
    ? body.symbols.map((s) => String(s))
    : ['BTC', 'ETH', 'USDT', 'SOL'];
  const watchlistSymbols = Array.isArray(body.watchlistSymbols)
    ? body.watchlistSymbols.map((s) => String(s))
    : [];
  const question = typeof body.question === 'string' ? body.question.trim() : undefined;

  const result = await generateMarketIntelligenceResponse({
    symbols,
    question,
    watchlistSymbols,
  });
  return res.json(result);
});

// --- Merchant Developer Portal & API Key Management ---
app.post('/api/merchant/api-keys/generate', requireAuth, async (req: AuthRequest, res: Response) => {
  const bearerToken = String(req.headers.authorization || '').slice('Bearer '.length).trim();
  const account = await fetchCallerUserAccount(req.user!.uid, bearerToken);
  if (!account || !isKycStatusVerified(account.kycStatus) || account.accountStatus !== 'ACTIVE') {
    return res.status(403).json({
      error: 'Merchant API keys require a KYC-verified, ACTIVE account.',
    });
  }
  const body = (req.body || {}) as Record<string, unknown>;
  const label = String(body.label || 'Production Integration').trim();
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.map((s) => String(s))
    : ['markets:read', 'offers:read', 'orders:read'];
  const rateLimitPerMin = Number(body.rateLimitPerMin || 60);

  const bundle = generateMerchantApiKeyBundle({
    merchantUid: req.user!.uid,
    label,
    scopes,
    rateLimitPerMin,
    isSandbox: SANDBOX_MODE,
  });
  return res.json(bundle);
});

app.post('/api/merchant/api-keys/sync', requireAuth, (req: AuthRequest, res: Response) => {
  const body = (req.body || {}) as {
    keys?: Array<{
      keyHash: string;
      keyPrefix: string;
      label: string;
      scopes: string[];
      rateLimitPerMin: number;
      revoked: boolean;
    }>;
  };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  for (const k of keys.slice(0, 20)) {
    if (k.keyHash && k.keyPrefix) {
      syncMerchantApiKeyEntry({
        keyHash: String(k.keyHash),
        keyPrefix: String(k.keyPrefix),
        merchantUid: req.user!.uid,
        label: String(k.label || 'Merchant Key'),
        scopes: Array.isArray(k.scopes) ? k.scopes.map(String) : ['markets:read'],
        rateLimitPerMin: Number(k.rateLimitPerMin || 60),
        revoked: Boolean(k.revoked),
      });
    }
  }
  return res.json({ synced: keys.length });
});

app.post('/api/merchant/api-keys/revoke', requireAuth, (req: AuthRequest, res: Response) => {
  const keyHash = String((req.body as Record<string, unknown>)?.keyHash || '');
  if (!keyHash) return res.status(400).json({ error: 'keyHash is required.' });
  revokeMerchantApiKeyInRegistry(keyHash);
  return res.json({ revoked: true, keyHash });
});

app.get('/api/merchant/api-keys/usage', requireAuth, (req: AuthRequest, res: Response) => {
  return res.json(getMerchantApiUsageStats(req.user!.uid));
});

app.post('/api/merchant/webhooks/validate', requireAuth, (req: AuthRequest, res: Response) => {
  const url = String((req.body as Record<string, unknown>)?.url || '');
  const validation = validateWebhookUrlSafe(url);
  if (!validation.valid) {
    return res.status(400).json({ valid: false, error: validation.reason });
  }
  const signingSecret = generateWebhookSigningSecret();
  return res.json({
    valid: true,
    normalizedUrl: validation.normalizedUrl,
    signingSecret,
  });
});

app.post('/api/merchant/webhooks/test', requireAuth, async (req: AuthRequest, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const url = String(body.url || '');
  const secret = String(body.secret || 'whsec_sandbox_test');
  const eventType = String(body.eventType || 'order.settlement.ping');
  const result = await dispatchSignedWebhookTest({
    url,
    secret,
    merchantUid: req.user!.uid,
    eventType,
    sandboxMode: SANDBOX_MODE,
  });
  return res.json(result);
});

// --- External Merchant Partner REST v1 Endpoints (Authenticated via X-CB-API-Key) ---
function requireMerchantApiKey(req: Request, res: Response, next: NextFunction) {
  const rawKey = String(req.headers['x-cb-api-key'] || '');
  const auth = authenticateMerchantApiKey(rawKey, req.path);
  if (!auth.ok || !auth.keyEntry) {
    return res.status(auth.status).json({ error: auth.error });
  }
  (req as Request & { merchantApi?: typeof auth.keyEntry }).merchantApi = auth.keyEntry;
  return next();
}

app.get('/api/v1/merchant/profile', requireMerchantApiKey, (req: Request, res: Response) => {
  const entry = (req as Request & { merchantApi: NonNullable<ReturnType<typeof authenticateMerchantApiKey>['keyEntry']> }).merchantApi;
  return res.json({
    merchantUid: entry.merchantUid,
    keyPrefix: entry.keyPrefix,
    label: entry.label,
    scopes: entry.scopes,
    rateLimitPerMin: entry.rateLimitPerMin,
    totalRequests: entry.totalRequests,
    sandboxMode: SANDBOX_MODE,
  });
});

app.get('/api/v1/merchant/markets', requireMerchantApiKey, async (_req: Request, res: Response) => {
  const markets = await getAllCoinMarkets({ refresh: false });
  return res.json({
    freshnessStatus: markets.freshnessStatus,
    fetchedAt: markets.fetchedAt,
    coins: markets.coins,
  });
});

app.post('/api/v1/merchant/quotes/verify', requireMerchantApiKey, async (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const symbol = String(body.symbol || 'USDT').toUpperCase();
  const offeredRateInr = Number(body.offeredRateInr || 0);
  const quote = await getSingleCoinMarket({ symbol });
  const spotInr = quote.coin?.inrPrice ?? null;
  const spreadPct =
    spotInr && spotInr > 0 && offeredRateInr > 0
      ? Number((((offeredRateInr - spotInr) / spotInr) * 100).toFixed(3))
      : null;
  return res.json({
    symbol,
    offeredRateInr,
    spotInr,
    spreadPct,
    freshnessStatus: quote.freshnessStatus,
  });
});

app.get('/api/docs/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'CoinBridge P2P Exchange API',
      version: '1.4.0',
      description:
        'Authenticated REST endpoints for mandatory KYC trading enforcement, temporary Price Locks, Fraud wallet screening, Gemini Market Intelligence, Merchant Partner v1 API & HMAC Webhooks, Platform Status telemetry, USDT multi-network deposits/withdrawals, CoinGecko rates, TronGrid monitoring, and Supabase private KYC storage.',
    },
    paths: {
      '/api/health': {
        get: { summary: 'Health & sandbox mode status', responses: { '200': { description: 'OK' } } },
      },
      '/api/trading/authorize': {
        post: {
          summary: 'Verify mandatory KYC approval & ACTIVE account status before P2P trading actions',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Authorized for trading' },
            '403': { description: 'Blocked — KYC unverified, expired, or account restricted' },
          },
        },
      },
      '/api/wallet/networks': {
        get: {
          summary: 'List supported USDT networks, contracts, confirmation thresholds, fees, limits, and compatibility guides',
          responses: { '200': { description: 'Supported wallet networks & policies' } },
        },
      },
      '/api/wallet/deposit-address': {
        post: {
          summary: 'Retrieve deterministic per-user per-network USDT deposit address',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Deposit address details' } },
        },
      },
      '/api/wallet/deposits/monitor': {
        post: {
          summary: 'Monitor/verify inbound USDT deposit transactions with TronGrid scan & duplicate event protection',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Deposit verification payload' } },
        },
      },
      '/api/wallet/withdraw/validate': {
        post: {
          summary: 'Validate external USDT withdrawal address, fee breakdown, limits, and automated risk score',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Withdrawal validation result' } },
        },
      },
      '/api/wallet/withdraw/submit': {
        post: {
          summary: 'Authorize & submit external USDT withdrawal with KYC check, 2FA TOTP verification, and idempotency',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Withdrawal reservation & status payload' } },
        },
      },
      '/api/rates/usdt-inr': {
        get: { summary: 'CoinGecko USDT/INR market rate with MARKET_RATE_FALLBACK_INR fallback', responses: { '200': { description: 'Rate payload' } } },
      },
      '/api/markets': {
        get: { summary: 'Live INR & USD market prices, 24h change, volume, market cap, and freshness indicators for all supported cryptocurrencies', responses: { '200': { description: 'Multi-coin market quotes' } } },
      },
      '/api/markets/{symbol}': {
        get: { summary: 'Single cryptocurrency live INR market quote and supply metadata', responses: { '200': { description: 'Coin market detail' } } },
      },
      '/api/markets/{symbol}/history': {
        get: { summary: 'Historical OHLCV candlestick and tick series in INR from CoinGecko API with server cache and rate-limit protection', responses: { '200': { description: 'Historical OHLCV bars' } } },
      },
      '/api/markets/validate-asset-network': {
        post: {
          summary: 'Validate cryptocurrency symbol, supported blockchain network, contract address format, and Admin trading approval',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Validation result' } },
        },
      },
      '/api/tron/status': {
        get: { summary: 'TronGrid testnet block monitor status', responses: { '200': { description: 'TRON block & network metadata' } } },
      },
      '/api/tron/account/{address}': {
        get: {
          summary: 'Read-only TronGrid account balance & TRC-20 transfer history',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Account read payload' } },
        },
      },
      '/api/integrations/status': {
        get: {
          summary: 'Summary of CoinGecko, TronGrid, and Supabase configuration state',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Integration status' } },
        },
      },
      '/api/integrations/supabase/health': {
        get: {
          summary: 'Supabase storage & database connectivity check',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Supabase health' } },
        },
      },
      '/api/integrations/supabase/kyc-upload': {
        post: {
          summary: 'Upload KYC document to private Supabase Storage bucket with sandbox fallback',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Upload receipt & signed URL' } },
        },
      },
      '/api/integrations/supabase/sync-order': {
        post: {
          summary: 'Mirror P2P order summary to Supabase PostgreSQL when configured',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Sync status' } },
        },
      },
      '/api/kyc/video/challenge': {
        post: {
          summary: 'Issue randomized Video KYC liveness challenge prompt & code',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Challenge prompt & session token' } },
        },
      },
      '/api/kyc/video/verify': {
        post: {
          summary: 'Submit Video KYC capture for liveness/frame triage before manual compliance review',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Liveness triage scores & status' } },
        },
      },
      '/api/security/2fa/enroll': {
        post: {
          summary: 'Generate RFC 6238 TOTP secret, otpauth URI, and sealed envelope',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: '2FA enrollment bundle' } },
        },
      },
      '/api/security/2fa/verify': {
        post: {
          summary: 'Verify a 6-digit TOTP authenticator code against a sealed enrollment secret',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Verification confirmation' } },
        },
      },
      '/api/security/analyze-login': {
        post: {
          summary: 'Evaluate browser/device/timezone login anomaly risk',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Login risk result' } },
        },
      },
      '/api/risk/assess': {
        post: {
          summary: 'Evaluate P2P order compliance & fraud risk signals',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Risk score (0-100) and human-review guidance' } },
        },
      },
      '/api/payments/sandbox-verify': {
        post: {
          summary: 'Sandbox UPI/IMPS/NEFT/RTGS reference verification with idempotency & duplicate UTR guard',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Verified sandbox payment record' } },
        },
      },
      '/api/blockchain/verify-tx': {
        post: {
          summary: 'Validate network transaction hash against configured USDT contracts & TronGrid',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Verification metadata' } },
        },
      },
      '/api/status': {
        get: { summary: 'Live aggregate platform health probe across market feed, blockchain, trading, and storage', responses: { '200': { description: 'Service status list' } } },
      },
      '/api/quotes/lock': {
        post: { summary: 'Issue signed temporary Price Lock quote with configurable expiration', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Signed price lock payload' } } },
      },
      '/api/quotes/verify': {
        post: { summary: 'Verify Price Lock HMAC signature and timeout expiration', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Verification state' } } },
      },
      '/api/fraud/screen-wallet': {
        post: { summary: 'Screen external wallet address format, burn sinks, and risk watchlists', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Wallet screening report' } } },
      },
      '/api/intelligence/analyze': {
        post: { summary: 'CoinGecko quantitative volatility metrics & Gemini Market Intelligence assistant', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Market analysis payload' } } },
      },
      '/api/v1/merchant/profile': {
        get: { summary: 'Merchant API Key authenticated partner profile & rate-limit quota', security: [{ merchantApiKey: [] }], responses: { '200': { description: 'Partner quota & scopes' } } },
      },
      '/api/v1/merchant/markets': {
        get: { summary: 'Merchant API Key authenticated live INR market quotes', security: [{ merchantApiKey: [] }], responses: { '200': { description: 'Live coin quotes' } } },
      },
      '/api/v1/merchant/quotes/verify': {
        post: { summary: 'Merchant API Key spread comparison against CoinGecko INR spot', security: [{ merchantApiKey: [] }], responses: { '200': { description: 'Spread report' } } },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'Firebase JWT' },
        merchantApiKey: { type: 'apiKey', in: 'header', name: 'X-CB-API-Key' },
      },
    },
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CoinBridge P2P server listening on http://0.0.0.0:${PORT} (sandbox=${SANDBOX_MODE})`);
  });
}

startServer();
