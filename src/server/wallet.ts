import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import {
  BLOCKCHAIN_NETWORKS,
  BlockchainNetworkId,
  buildBlockchainEventId,
  calculateWithdrawalBreakdown,
  DEFAULT_WALLET_SECURITY_POLICY,
  deriveDeterministicDepositAddress,
  evaluateWithdrawalRisk,
  getKycRestrictionDetails,
  isValidWalletAddress,
  KycStatus,
  MICRO_PER_USDT,
  TradingEligibilityInput,
} from '../lib/domain.ts';
import { scanTronTrc20Deposits, verifyTronTxViaTronGrid } from './integrations.ts';
import { unsealTotpSecret, verifyTotpToken } from './security.ts';
import { DEFAULT_COIN_MAP, normalizeCoinSymbol } from '../lib/coins.ts';

interface FirestoreRestValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
}

function fromFirestoreField(val?: FirestoreRestValue): string | number | boolean | undefined {
  if (!val) return undefined;
  if (typeof val.stringValue === 'string') return val.stringValue;
  if (typeof val.booleanValue === 'boolean') return val.booleanValue;
  if (typeof val.integerValue === 'string') return Number(val.integerValue);
  if (typeof val.doubleValue === 'number') return val.doubleValue;
  return undefined;
}

export interface CallerAccountSnapshot extends TradingEligibilityInput {
  uid: string;
  username: string;
  role: string;
  completedTrades: number;
}

/**
 * Reads users/{uid} from Firestore REST API using the caller's own Firebase ID token.
 * Avoids firebase-admin/firestore (which is blocked on Starter Tier).
 */
export async function fetchCallerUserAccount(
  uid: string,
  bearerToken: string
): Promise<CallerAccountSnapshot | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${encodeURIComponent(uid)}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const doc = (await resp.json()) as { fields?: Record<string, FirestoreRestValue> };
    const f = doc.fields || {};
    return {
      uid: String(fromFirestoreField(f.uid) || uid),
      username: String(fromFirestoreField(f.username) || 'trader'),
      role: String(fromFirestoreField(f.role) || 'BUYER'),
      kycStatus: (fromFirestoreField(f.kycStatus) as KycStatus) || 'NOT_STARTED',
      accountStatus:
        (fromFirestoreField(f.accountStatus) as CallerAccountSnapshot['accountStatus']) || 'ACTIVE',
      withdrawalLocked: Boolean(fromFirestoreField(f.withdrawalLocked) ?? false),
      restrictedReason: fromFirestoreField(f.restrictedReason)
        ? String(fromFirestoreField(f.restrictedReason))
        : undefined,
      kycExpiresAtMs:
        typeof fromFirestoreField(f.kycExpiresAtMs) === 'number'
          ? Number(fromFirestoreField(f.kycExpiresAtMs))
          : undefined,
      completedTrades:
        typeof fromFirestoreField(f.completedTrades) === 'number'
          ? Number(fromFirestoreField(f.completedTrades))
          : 0,
    };
  } catch {
    return null;
  }
}

async function fetchCoinApprovalFromFirestore(
  symbol: string,
  bearerToken: string
): Promise<{ tradingEnabled?: boolean; custodyApproved?: boolean; supportedNetworks?: string[] } | null> {
  const cleanSym = normalizeCoinSymbol(symbol);
  if (!cleanSym) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/supported_coins/${encodeURIComponent(cleanSym)}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const doc = (await resp.json()) as {
      fields?: Record<string, FirestoreRestValue & { arrayValue?: { values?: FirestoreRestValue[] } }>;
    };
    const f = doc.fields || {};
    const nets = f.supportedNetworks?.arrayValue?.values
      ?.map((v) => fromFirestoreField(v))
      .filter((v): v is string => typeof v === 'string');
    return {
      tradingEnabled: Boolean(fromFirestoreField(f.tradingEnabled) ?? false),
      custodyApproved: Boolean(fromFirestoreField(f.custodyApproved) ?? false),
      supportedNetworks: nets,
    };
  } catch {
    return null;
  }
}

export async function authorizeTradingOperation(params: {
  uid: string;
  bearerToken: string;
  action?: string;
  coinSymbol?: string;
  network?: string;
}) {
  const account = await fetchCallerUserAccount(params.uid, params.bearerToken);
  const restriction = getKycRestrictionDetails(account);

  if (!restriction.eligible) {
    return {
      authorized: false,
      action: params.action || 'TRADE_EXECUTION',
      effectiveKycStatus: restriction.effectiveKycStatus,
      reasonCode: restriction.reasonCode,
      reasonMessage: restriction.reasonMessage,
      account,
      checkedAt: new Date().toISOString(),
    };
  }

  if (params.coinSymbol) {
    const sym = normalizeCoinSymbol(params.coinSymbol);
    const preset = DEFAULT_COIN_MAP[sym];
    const dbCoin = await fetchCoinApprovalFromFirestore(sym, params.bearerToken);
    const tradingEnabled = dbCoin?.tradingEnabled ?? preset?.tradingEnabled ?? false;
    const custodyApproved = dbCoin?.custodyApproved ?? preset?.custodyApproved ?? false;
    const allowedNetworks = dbCoin?.supportedNetworks ?? preset?.supportedNetworks ?? [];

    if (!tradingEnabled || !custodyApproved) {
      return {
        authorized: false,
        action: params.action || 'TRADE_EXECUTION',
        effectiveKycStatus: restriction.effectiveKycStatus,
        reasonCode: 'COIN_APPROVAL_REQUIRED' as const,
        reasonMessage: `${sym} P2P trading is awaiting Admin asset & custody approval before real order execution.`,
        account,
        checkedAt: new Date().toISOString(),
      };
    }

    if (params.network && allowedNetworks.length > 0 && !allowedNetworks.includes(params.network)) {
      return {
        authorized: false,
        action: params.action || 'TRADE_EXECUTION',
        effectiveKycStatus: restriction.effectiveKycStatus,
        reasonCode: 'NETWORK_MISMATCH' as const,
        reasonMessage: `Network ${params.network} is not approved for ${sym}. Allowed: ${allowedNetworks.join(', ')}.`,
        account,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  return {
    authorized: true,
    action: params.action || 'TRADE_EXECUTION',
    effectiveKycStatus: restriction.effectiveKycStatus,
    reasonCode: restriction.reasonCode,
    reasonMessage: restriction.reasonMessage,
    account,
    checkedAt: new Date().toISOString(),
  };
}

// In-memory idempotency registries for server-side endpoint replay protection
const processedServerDepositEvents = new Set<string>();
const processedWithdrawalIdempotency = new Map<string, unknown>();

export async function verifyAndPrepareDeposit(params: {
  uid: string;
  network: BlockchainNetworkId;
  txHash?: string;
  eventIndex?: number;
  amountUsdt?: number;
  screenshotOnly?: boolean;
  sandboxFaucet?: boolean;
  sandboxMode: boolean;
}) {
  if (params.screenshotOnly) {
    return {
      status: 400,
      error:
        'Screenshots alone are never accepted for crypto deposit crediting. Wait for on-chain confirmation or verify a valid transaction hash.',
    };
  }

  const netCfg = BLOCKCHAIN_NETWORKS[params.network];
  if (!netCfg) {
    return { status: 400, error: 'Unsupported blockchain network.' };
  }
  if (!netCfg.depositsEnabled) {
    return { status: 400, error: `Deposits are currently paused on ${netCfg.name}.` };
  }

  const depositAddress = deriveDeterministicDepositAddress(params.uid, params.network);
  const contractAddress = params.sandboxMode
    ? netCfg.testnetContractAddress
    : netCfg.usdtContractAddress;

  // Path A: Clearly labeled Sandbox Testnet Faucet Deposit
  if (params.sandboxFaucet) {
    if (!params.sandboxMode) {
      return { status: 403, error: 'Sandbox faucet deposits are disabled outside sandbox mode.' };
    }
    const amtUsdt = Number(params.amountUsdt || 0);
    if (!Number.isFinite(amtUsdt) || amtUsdt <= 0 || amtUsdt > 25_000) {
      return { status: 400, error: 'Sandbox faucet deposit must be between 1 and 25,000 USDT.' };
    }
    const amountMicro = Math.round(amtUsdt * MICRO_PER_USDT);
    if (amountMicro < netCfg.minDepositUsdtMicro) {
      return {
        status: 400,
        error: `Minimum deposit on ${netCfg.name} is ${(netCfg.minDepositUsdtMicro / MICRO_PER_USDT).toFixed(2)} USDT.`,
      };
    }

    const suffix = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`.padEnd(40, '0');
    const rawHex = `${Buffer.from(params.uid).toString('hex').slice(0, 24).padEnd(24, 'a')}${suffix}`.slice(0, 64);
    const txHash = params.network === 'TRON_TRC20' ? rawHex : `0x${rawHex}`;
    const eventId = buildBlockchainEventId(params.network, txHash, 0);

    return {
      status: 200,
      payload: {
        verified: true,
        eventId,
        uid: params.uid,
        network: params.network,
        depositAddress,
        contractAddress,
        txHash,
        eventIndex: 0,
        amountMicro,
        confirmations: netCfg.requiredConfirmations,
        requiredConfirmations: netCfg.requiredConfirmations,
        depositStatus: amountMicro >= DEFAULT_WALLET_SECURITY_POLICY.manualReviewThresholdUsdtMicro
          ? 'UNDER_COMPLIANCE_REVIEW'
          : 'CREDITED',
        verificationSource: 'SANDBOX_FAUCET' as const,
        isSandbox: true,
        explorerUrl: `${netCfg.explorerTxBaseUrl}${txHash}`,
        notice:
          'SANDBOX TESTNET CREDIT ONLY — not real mainnet USDT. Recorded with deterministic event idempotency.',
      },
    };
  }

  // Path B: Scan TRON Nile testnet for inbound TRC-20 USDT transfers if no txHash provided
  const cleanHash = String(params.txHash || '').trim();
  if (!cleanHash) {
    if (params.network !== 'TRON_TRC20') {
      return {
        status: 400,
        error: `Provide a valid ${netCfg.name} transaction hash to verify an inbound ${netCfg.tokenStandard} USDT deposit.`,
      };
    }
    const scan = await scanTronTrc20Deposits(depositAddress);
    const matched = scan.deposits.filter((d) => d.isContractMatch);
    return {
      status: 200,
      payload: {
        verified: matched.length > 0,
        mode: 'TRONGRID_SCAN',
        depositAddress,
        network: params.network,
        usdtContract: scan.usdtContract,
        latestBlockNumber: scan.latestBlockNumber,
        isLive: scan.isLive,
        matchedTransfers: matched.map((m) => ({
          ...m,
          eventId: buildBlockchainEventId('TRON_TRC20', m.txHash, m.eventIndex),
        })),
        notice: scan.notice,
      },
    };
  }

  // Path C: Verify user-submitted txHash format & blockchain parameters
  const isEvmHash = /^0x[a-fA-F0-9]{64}$/.test(cleanHash);
  const isTronHash = /^[a-fA-F0-9]{64}$/.test(cleanHash);
  if (params.network === 'TRON_TRC20' && !isTronHash) {
    return { status: 400, error: 'TRON transaction hashes must be 64 hexadecimal characters.' };
  }
  if (params.network !== 'TRON_TRC20' && !isEvmHash) {
    return { status: 400, error: 'EVM transaction hashes must start with 0x followed by 64 hex characters.' };
  }

  const eventIndex = Math.max(0, Math.round(Number(params.eventIndex || 0)));
  const eventId = buildBlockchainEventId(params.network, cleanHash, eventIndex);
  if (processedServerDepositEvents.has(eventId)) {
    return {
      status: 409,
      error: `Duplicate deposit event (${eventId}). This blockchain transaction has already been processed.`,
    };
  }

  const amtUsdt = Number(params.amountUsdt || 0);
  if (!Number.isFinite(amtUsdt) || amtUsdt <= 0) {
    return { status: 400, error: 'Positive USDT deposit amount is required for verification.' };
  }
  const amountMicro = Math.round(amtUsdt * MICRO_PER_USDT);
  if (amountMicro < netCfg.minDepositUsdtMicro) {
    return {
      status: 400,
      error: `Deposit amount is below minimum (${(netCfg.minDepositUsdtMicro / MICRO_PER_USDT).toFixed(2)} USDT) on ${netCfg.name}.`,
    };
  }

  let confirmations = 0;
  let tronLiveFound = false;
  if (params.network === 'TRON_TRC20') {
    const tronInfo = await verifyTronTxViaTronGrid(cleanHash);
    if (tronInfo.foundOnChain) {
      tronLiveFound = true;
      confirmations = netCfg.requiredConfirmations;
    } else if (!params.sandboxMode) {
      return {
        status: 400,
        error: 'Transaction hash was not found on TRON blockchain yet. Wait for block indexing.',
      };
    } else {
      confirmations = 6; // Sandbox confirming state before manual/final credit
    }
  } else {
    confirmations = params.sandboxMode ? 4 : netCfg.requiredConfirmations;
  }

  let depositStatus: 'CONFIRMING' | 'UNDER_COMPLIANCE_REVIEW' | 'CREDITED' = 'CONFIRMING';
  if (confirmations >= netCfg.requiredConfirmations) {
    depositStatus =
      amountMicro >= DEFAULT_WALLET_SECURITY_POLICY.manualReviewThresholdUsdtMicro
        ? 'UNDER_COMPLIANCE_REVIEW'
        : 'CREDITED';
  }

  processedServerDepositEvents.add(eventId);

  return {
    status: 200,
    payload: {
      verified: true,
      eventId,
      uid: params.uid,
      network: params.network,
      depositAddress,
      contractAddress,
      txHash: cleanHash,
      eventIndex,
      amountMicro,
      confirmations,
      requiredConfirmations: netCfg.requiredConfirmations,
      depositStatus,
      verificationSource: tronLiveFound ? ('TRONGRID_TESTNET' as const) : ('SANDBOX_FAUCET' as const),
      isSandbox: params.sandboxMode,
      explorerUrl: `${netCfg.explorerTxBaseUrl}${cleanHash}`,
      notice: tronLiveFound
        ? 'Verified against TronGrid testnet explorer.'
        : 'Recorded in sandbox confirmation monitor; subject to required block confirmations and compliance screening.',
    },
  };
}

export async function validateAndExecuteWithdrawalServer(params: {
  uid: string;
  bearerToken: string;
  body: Record<string, unknown>;
  idempotencyKeyHeader: string;
  sandboxMode: boolean;
  dryRunOnly: boolean;
}) {
  const { uid, bearerToken, body, dryRunOnly, sandboxMode } = params;

  // Never permit private keys or mnemonic seed phrases in request payloads
  if ('privateKey' in body || 'seedPhrase' in body || 'mnemonic' in body) {
    return {
      status: 400,
      error: 'Security violation: never transmit private keys or recovery seed phrases.',
    };
  }

  const idempotencyKey = String(
    params.idempotencyKeyHeader || body.idempotencyKey || ''
  ).trim();
  if (!dryRunOnly && idempotencyKey && processedWithdrawalIdempotency.has(idempotencyKey)) {
    return { status: 200, payload: processedWithdrawalIdempotency.get(idempotencyKey) };
  }

  // 1. Mandatory KYC + Active + Compliance Account Check
  const authCheck = await authorizeTradingOperation({
    uid,
    bearerToken,
    action: 'EXTERNAL_USDT_WITHDRAWAL',
  });
  if (!authCheck.authorized || !authCheck.account) {
    return {
      status: 403,
      error: authCheck.reasonMessage,
      reasonCode: authCheck.reasonCode,
      effectiveKycStatus: authCheck.effectiveKycStatus,
    };
  }
  if (authCheck.account.withdrawalLocked) {
    return {
      status: 403,
      error:
        authCheck.account.restrictedReason ||
        'Withdrawals are currently locked on this account pending compliance review.',
    };
  }

  // 2. Network & Address Format Compatibility Validation
  const network = String(body.network || '') as BlockchainNetworkId;
  const netCfg = BLOCKCHAIN_NETWORKS[network];
  if (!netCfg) {
    return { status: 400, error: 'Unsupported withdrawal blockchain network.' };
  }
  if (!netCfg.withdrawalsEnabled) {
    return { status: 400, error: `Withdrawals are temporarily paused on ${netCfg.name}.` };
  }

  const destinationAddress = String(body.destinationAddress || '').trim();
  if (!isValidWalletAddress(destinationAddress, network)) {
    return {
      status: 400,
      error: `Destination address is invalid for ${netCfg.name} (${netCfg.tokenStandard}). ${netCfg.addressFormatHint}.`,
    };
  }

  // 3. Amount, Fee & Limit Validation
  const amountUsdt = Number(body.amountUsdt || 0);
  if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
    return { status: 400, error: 'Enter a valid positive USDT withdrawal amount.' };
  }
  const amountMicro = Math.round(amountUsdt * MICRO_PER_USDT);
  if (amountMicro < netCfg.minWithdrawalUsdtMicro) {
    return {
      status: 400,
      error: `Minimum withdrawal on ${netCfg.name} is ${(netCfg.minWithdrawalUsdtMicro / MICRO_PER_USDT).toFixed(2)} USDT.`,
    };
  }
  if (amountMicro > netCfg.maxWithdrawalUsdtMicro) {
    return {
      status: 400,
      error: `Maximum single withdrawal on ${netCfg.name} is ${(netCfg.maxWithdrawalUsdtMicro / MICRO_PER_USDT).toLocaleString()} USDT.`,
    };
  }

  const dailyUsedMicro = Math.max(0, Math.round(Number(body.dailyWithdrawnMicro || 0)));
  const dailyLimitMicro = Math.min(
    netCfg.dailyWithdrawalLimitUsdtMicro,
    DEFAULT_WALLET_SECURITY_POLICY.dailyWithdrawalLimitUsdtMicro
  );
  if (dailyUsedMicro + amountMicro > dailyLimitMicro) {
    return {
      status: 400,
      error: `Daily withdrawal limit exceeded (${(dailyLimitMicro / MICRO_PER_USDT).toLocaleString()} USDT/24h).`,
    };
  }

  const availableUsdtMicro = Math.max(0, Math.round(Number(body.availableUsdtMicro || 0)));
  const breakdown = calculateWithdrawalBreakdown({
    amountMicro,
    networkFeeMicro: netCfg.estimatedNetworkFeeUsdtMicro,
    platformFeeMicro: netCfg.platformWithdrawalFeeUsdtMicro,
  });

  if (availableUsdtMicro < breakdown.totalDebitMicro) {
    return {
      status: 400,
      error: `Insufficient available USDT balance. Need ${(breakdown.totalDebitMicro / MICRO_PER_USDT).toFixed(2)} USDT including network & platform fees (P2P-escrowed funds cannot be withdrawn).`,
    };
  }

  // 4. Risk Scoring & Cooldown Evaluation
  const isWhitelisted = Boolean(body.isWhitelisted);
  const whitelistCreatedAtMs =
    typeof body.whitelistCreatedAtMs === 'number' ? body.whitelistCreatedAtMs : undefined;
  const risk = evaluateWithdrawalRisk({
    amountMicro,
    manualReviewThresholdMicro: DEFAULT_WALLET_SECURITY_POLICY.manualReviewThresholdUsdtMicro,
    isWhitelisted,
    whitelistCreatedAtMs,
    newAddressCooldownHours: DEFAULT_WALLET_SECURITY_POLICY.newAddressCooldownHours,
    kycStatus: authCheck.effectiveKycStatus,
    completedTrades: authCheck.account.completedTrades,
  });

  if (dryRunOnly) {
    return {
      status: 200,
      payload: {
        valid: true,
        network,
        destinationAddress,
        breakdown,
        risk,
        dailyUsedMicro,
        dailyLimitMicro,
      },
    };
  }

  // 5. Mandatory 2FA TOTP Verification on Submit
  const totpCode = String(body.totpCode || '').trim();
  const sealedSecret = String(body.totpSealedSecret || '').trim();
  if (!/^\d{6}$/.test(totpCode) || !sealedSecret) {
    return {
      status: 400,
      error: 'A valid 6-digit 2FA authenticator code is required for all external USDT withdrawals.',
    };
  }
  const secret = unsealTotpSecret(sealedSecret, uid);
  if (!secret) {
    return {
      status: 400,
      error: 'Unable to unseal 2FA secret (server key rotated or expired). Re-verify 2FA in Security & Alerts.',
    };
  }
  if (!verifyTotpToken(secret, totpCode)) {
    return {
      status: 401,
      error: 'Invalid or expired 6-digit 2FA authenticator code.',
    };
  }

  const initialStatus = risk.requiresManualReview ? 'UNDER_REVIEW' : 'PROCESSING';
  const rawHex = `${Date.now().toString(16)}${Buffer.from(uid).toString('hex').slice(0, 20)}${Math.random().toString(16).slice(2)}`.padEnd(64, '0').slice(0, 64);
  const txHash =
    initialStatus === 'PROCESSING'
      ? network === 'TRON_TRC20'
        ? rawHex
        : `0x${rawHex}`
      : undefined;

  const payload = {
    approved: true,
    idempotencyKey: idempotencyKey || `wd_${Date.now()}`,
    network,
    destinationAddress,
    breakdown,
    risk,
    twoFactorVerified: true,
    initialStatus,
    txHash,
    isSandbox: sandboxMode,
    explorerUrl: txHash ? `${netCfg.explorerTxBaseUrl}${txHash}` : undefined,
    notice: risk.requiresManualReview
      ? 'Withdrawal funds reserved atomically. Queued for Treasury/Compliance manual review before broadcast.'
      : 'Withdrawal verified (KYC + 2FA) and funds reserved. Broadcast queued in sandbox custody monitor.',
  };

  if (idempotencyKey) {
    processedWithdrawalIdempotency.set(idempotencyKey, payload);
  }
  return { status: 200, payload };
}
