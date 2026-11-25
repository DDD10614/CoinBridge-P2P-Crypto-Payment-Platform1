export type UserRole =
  | 'BUYER'
  | 'SELLER'
  | 'MERCHANT'
  | 'LIQUIDITY_PROVIDER'
  | 'TREASURY_ADMIN'
  | 'SUPPORT_AGENT'
  | 'COMPLIANCE_OFFICER'
  | 'ADMIN'
  | 'SUPER_ADMIN';

export type KycStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'ADDITIONAL_INFO_REQUIRED'
  | 'SUSPENDED'
  | 'EXPIRED';

export type DepositStatus =
  | 'AWAITING_DEPOSIT'
  | 'DETECTED'
  | 'CONFIRMING'
  | 'UNDER_COMPLIANCE_REVIEW'
  | 'CREDITED'
  | 'FAILED'
  | 'REJECTED';

export type WithdrawalStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'PROCESSING'
  | 'BROADCASTED'
  | 'CONFIRMING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED';

export type WalletLedgerEntryType =
  | 'DEPOSIT_CREDIT'
  | 'WITHDRAWAL_RESERVE'
  | 'WITHDRAWAL_SETTLE'
  | 'WITHDRAWAL_REFUND'
  | 'P2P_ESCROW_LOCK'
  | 'P2P_ESCROW_RELEASE'
  | 'P2P_ESCROW_REFUND'
  | 'ADMIN_ADJUSTMENT';

export type PaymentMethodType = 'UPI' | 'IMPS' | 'NEFT' | 'RTGS' | 'BANK_TRANSFER';

export type BlockchainNetworkId = 'TRON_TRC20' | 'ETHEREUM_ERC20' | 'POLYGON' | 'BSC';

export type OrderStatus =
  | 'CREATED'
  | 'AWAITING_ACCEPTANCE'
  | 'ACCEPTED'
  | 'ESCROW_RESERVED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_SUBMITTED'
  | 'PAYMENT_VERIFIED'
  | 'SETTLING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'DISPUTED'
  | 'REFUNDED';

export type EscrowStatus = 'NONE' | 'RESERVED' | 'RELEASED' | 'REFUNDED';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface PlatformSettings {
  brandName: string;
  buyerFeeBps: number;
  sellerFeeBps: number;
  merchantCommissionBps: number;
  tdsRateBps: number;
  depositFeeUsdtMicro: number;
  withdrawalFeeUsdtMicro: number;
  minOrderInrPaise: number;
  maxOrderInrPaise: number;
  dailyLimitInrPaise: number;
  monthlyLimitInrPaise: number;
  baseUsdtInrPaise: number;
  sandboxMode: boolean;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  brandName: 'CoinBridge P2P',
  buyerFeeBps: 25, // 0.25%
  sellerFeeBps: 25, // 0.25%
  merchantCommissionBps: 15, // 0.15%
  tdsRateBps: 100, // 1.00% Section 194S VDA TDS disclosure
  depositFeeUsdtMicro: 0,
  withdrawalFeeUsdtMicro: 1_000_000, // 1.00 USDT
  minOrderInrPaise: 100_000, // ₹1,000
  maxOrderInrPaise: 50_000_000, // ₹5,00,000
  dailyLimitInrPaise: 100_000_000, // ₹10,00,000
  monthlyLimitInrPaise: 1_000_000_000, // ₹1,00,00,000
  baseUsdtInrPaise: 9185, // ₹91.85 illustrative rate
  sandboxMode: true,
};

export interface BlockchainNetworkConfig {
  id: BlockchainNetworkId;
  name: string;
  tokenStandard: string;
  usdtContractAddress: string;
  testnetName: string;
  testnetContractAddress: string;
  requiredConfirmations: number;
  estimatedNetworkFeeUsdtMicro: number;
  platformWithdrawalFeeUsdtMicro: number;
  minDepositUsdtMicro: number;
  minWithdrawalUsdtMicro: number;
  maxWithdrawalUsdtMicro: number;
  dailyWithdrawalLimitUsdtMicro: number;
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  addressFormatHint: string;
  explorerTxBaseUrl: string;
  explorerAddressBaseUrl: string;
  chainIdHex?: string;
}

export const BLOCKCHAIN_NETWORKS: Record<BlockchainNetworkId, BlockchainNetworkConfig> = {
  TRON_TRC20: {
    id: 'TRON_TRC20',
    name: 'TRON',
    tokenStandard: 'TRC-20',
    usdtContractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    testnetName: 'TRON Nile Testnet',
    testnetContractAddress: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    requiredConfirmations: 19,
    estimatedNetworkFeeUsdtMicro: 1_000_000, // 1.00 USDT
    platformWithdrawalFeeUsdtMicro: 500_000, // 0.50 USDT
    minDepositUsdtMicro: 5_000_000, // 5.00 USDT
    minWithdrawalUsdtMicro: 10_000_000, // 10.00 USDT
    maxWithdrawalUsdtMicro: 25_000_000_000, // 25,000 USDT
    dailyWithdrawalLimitUsdtMicro: 50_000_000_000, // 50,000 USDT
    depositsEnabled: true,
    withdrawalsEnabled: true,
    addressFormatHint: 'Starts with T (34 Base58 characters)',
    explorerTxBaseUrl: 'https://nile.tronscan.org/#/transaction/',
    explorerAddressBaseUrl: 'https://nile.tronscan.org/#/address/',
  },
  ETHEREUM_ERC20: {
    id: 'ETHEREUM_ERC20',
    name: 'Ethereum',
    tokenStandard: 'ERC-20',
    usdtContractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    testnetName: 'Ethereum Sepolia Testnet',
    testnetContractAddress: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
    requiredConfirmations: 12,
    estimatedNetworkFeeUsdtMicro: 4_500_000, // 4.50 USDT
    platformWithdrawalFeeUsdtMicro: 1_000_000, // 1.00 USDT
    minDepositUsdtMicro: 10_000_000, // 10.00 USDT
    minWithdrawalUsdtMicro: 20_000_000, // 20.00 USDT
    maxWithdrawalUsdtMicro: 25_000_000_000,
    dailyWithdrawalLimitUsdtMicro: 50_000_000_000,
    depositsEnabled: true,
    withdrawalsEnabled: true,
    addressFormatHint: '0x followed by 40 hexadecimal characters',
    explorerTxBaseUrl: 'https://etherscan.io/tx/',
    explorerAddressBaseUrl: 'https://etherscan.io/address/',
    chainIdHex: '0x1',
  },
  POLYGON: {
    id: 'POLYGON',
    name: 'Polygon PoS',
    tokenStandard: 'ERC-20',
    usdtContractAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    testnetName: 'Polygon Amoy Testnet',
    testnetContractAddress: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    requiredConfirmations: 32,
    estimatedNetworkFeeUsdtMicro: 250_000, // 0.25 USDT
    platformWithdrawalFeeUsdtMicro: 250_000, // 0.25 USDT
    minDepositUsdtMicro: 2_000_000, // 2.00 USDT
    minWithdrawalUsdtMicro: 5_000_000, // 5.00 USDT
    maxWithdrawalUsdtMicro: 25_000_000_000,
    dailyWithdrawalLimitUsdtMicro: 50_000_000_000,
    depositsEnabled: true,
    withdrawalsEnabled: true,
    addressFormatHint: '0x followed by 40 hexadecimal characters',
    explorerTxBaseUrl: 'https://polygonscan.com/tx/',
    explorerAddressBaseUrl: 'https://polygonscan.com/address/',
    chainIdHex: '0x89',
  },
  BSC: {
    id: 'BSC',
    name: 'BNB Smart Chain',
    tokenStandard: 'BEP-20',
    usdtContractAddress: '0x55d398326f99059fF775485246999027B3197955',
    testnetName: 'BSC Testnet',
    testnetContractAddress: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
    requiredConfirmations: 15,
    estimatedNetworkFeeUsdtMicro: 500_000, // 0.50 USDT
    platformWithdrawalFeeUsdtMicro: 250_000, // 0.25 USDT
    minDepositUsdtMicro: 5_000_000, // 5.00 USDT
    minWithdrawalUsdtMicro: 5_000_000, // 5.00 USDT
    maxWithdrawalUsdtMicro: 25_000_000_000,
    dailyWithdrawalLimitUsdtMicro: 50_000_000_000,
    depositsEnabled: true,
    withdrawalsEnabled: true,
    addressFormatHint: '0x followed by 40 hexadecimal characters',
    explorerTxBaseUrl: 'https://bscscan.com/tx/',
    explorerAddressBaseUrl: 'https://bscscan.com/address/',
    chainIdHex: '0x38',
  },
};

export interface WalletSecurityPolicy {
  newAddressCooldownHours: number;
  manualReviewThresholdUsdtMicro: number;
  dailyWithdrawalLimitUsdtMicro: number;
  require2faForWithdrawals: boolean;
  sandboxFaucetEnabled: boolean;
}

export const DEFAULT_WALLET_SECURITY_POLICY: WalletSecurityPolicy = {
  newAddressCooldownHours: 24,
  manualReviewThresholdUsdtMicro: 2_500_000_000, // 2,500 USDT
  dailyWithdrawalLimitUsdtMicro: 50_000_000_000, // 50,000 USDT
  require2faForWithdrawals: true,
  sandboxFaucetEnabled: true,
};

export interface ExternalExchangeCompatibilityGuide {
  exchangeName: string;
  recommendedNetworks: BlockchainNetworkId[];
  memoRequired: boolean;
  exampleSteps: string[];
  disclaimer: string;
}

export const EXTERNAL_EXCHANGE_GUIDES: ExternalExchangeCompatibilityGuide[] = [
  {
    exchangeName: 'Binance (Instructional Guide Only)',
    recommendedNetworks: ['TRON_TRC20', 'BSC', 'POLYGON', 'ETHEREUM_ERC20'],
    memoRequired: false,
    exampleSteps: [
      'In Binance Wallet > Withdraw > Select USDT.',
      'Select exact matching network (e.g. TRX Tron (TRC20) or BNB Smart Chain (BEP20)).',
      'Paste your CoinBridge deposit address above; verify the first and last 6 characters.',
      'Confirm withdrawal fees on Binance so the net arrival amount meets CoinBridge minimum deposit.',
    ],
    disclaimer:
      'Instructional example only. CoinBridge does not operate a live Binance API custody integration.',
  },
  {
    exchangeName: 'OKX (Instructional Guide Only)',
    recommendedNetworks: ['TRON_TRC20', 'POLYGON', 'ETHEREUM_ERC20', 'BSC'],
    memoRequired: false,
    exampleSteps: [
      'Open OKX Assets > Withdraw > USDT > On-chain.',
      'Choose USDT-TRC20, USDT-Polygon, or USDT-ERC20 matching the selected network tab here.',
      'Ensure the token contract matches Tether USD (USDT) on that chain before confirming.',
    ],
    disclaimer:
      'Instructional example only. CoinBridge does not maintain a live OKX API connection.',
  },
  {
    exchangeName: 'Bybit (Instructional Guide Only)',
    recommendedNetworks: ['TRON_TRC20', 'BSC', 'POLYGON', 'ETHEREUM_ERC20'],
    memoRequired: false,
    exampleSteps: [
      'Go to Bybit Assets > Withdraw > USDT.',
      'Pick the matching chain type (TRC20, BEP20, Polygon PoS, or ERC20).',
      'No Memo/Tag is needed for standard TRC-20/EVM USDT deposits; verify gas fee before sending.',
    ],
    disclaimer:
      'Instructional example only. CoinBridge does not claim live Bybit API integration.',
  },
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  UPI: 'UPI',
  IMPS: 'IMPS',
  NEFT: 'NEFT',
  RTGS: 'RTGS',
  BANK_TRANSFER: 'Bank Transfer',
};

// Monetary constants (decimal-safe integer math)
export const PAISE_PER_INR = 100;
export const MICRO_PER_USDT = 1_000_000;
export const BPS_DENOMINATOR = 10_000;

export interface BuyBreakdown {
  inrPaise: number;
  rateInrPaise: number;
  grossUsdtMicro: number;
  feeUsdtMicro: number;
  netUsdtMicro: number;
  tdsInrPaise: number;
}

export function calculateBuyBreakdown(params: {
  inrPaise: number;
  rateInrPaise: number;
  buyerFeeBps: number;
  tdsRateBps: number;
}): BuyBreakdown {
  const { inrPaise, rateInrPaise, buyerFeeBps, tdsRateBps } = params;
  if (inrPaise <= 0 || rateInrPaise <= 0) {
    return {
      inrPaise: 0,
      rateInrPaise: Math.max(0, rateInrPaise),
      grossUsdtMicro: 0,
      feeUsdtMicro: 0,
      netUsdtMicro: 0,
      tdsInrPaise: 0,
    };
  }
  // grossUsdtMicro = round((inrPaise * 1_000_000) / rateInrPaise) using BigInt for zero precision loss
  const grossUsdtMicro = Number(
    (BigInt(Math.round(inrPaise)) * BigInt(MICRO_PER_USDT) + BigInt(Math.round(rateInrPaise / 2))) /
      BigInt(Math.round(rateInrPaise))
  );
  const feeUsdtMicro = Number(
    (BigInt(grossUsdtMicro) * BigInt(Math.max(0, buyerFeeBps)) + BigInt(BPS_DENOMINATOR / 2)) /
      BigInt(BPS_DENOMINATOR)
  );
  const netUsdtMicro = Math.max(0, grossUsdtMicro - feeUsdtMicro);
  const tdsInrPaise = Number(
    (BigInt(Math.round(inrPaise)) * BigInt(Math.max(0, tdsRateBps)) + BigInt(BPS_DENOMINATOR / 2)) /
      BigInt(BPS_DENOMINATOR)
  );
  return {
    inrPaise: Math.round(inrPaise),
    rateInrPaise: Math.round(rateInrPaise),
    grossUsdtMicro,
    feeUsdtMicro,
    netUsdtMicro,
    tdsInrPaise,
  };
}

export interface SellBreakdown {
  usdtMicro: number;
  rateInrPaise: number;
  grossInrPaise: number;
  feeUsdtMicro: number;
  tdsInrPaise: number;
  netInrPaise: number;
}

export function calculateSellBreakdown(params: {
  usdtMicro: number;
  rateInrPaise: number;
  sellerFeeBps: number;
  tdsRateBps: number;
}): SellBreakdown {
  const { usdtMicro, rateInrPaise, sellerFeeBps, tdsRateBps } = params;
  if (usdtMicro <= 0 || rateInrPaise <= 0) {
    return {
      usdtMicro: 0,
      rateInrPaise: Math.max(0, rateInrPaise),
      grossInrPaise: 0,
      feeUsdtMicro: 0,
      tdsInrPaise: 0,
      netInrPaise: 0,
    };
  }
  const feeUsdtMicro = Number(
    (BigInt(Math.round(usdtMicro)) * BigInt(Math.max(0, sellerFeeBps)) + BigInt(BPS_DENOMINATOR / 2)) /
      BigInt(BPS_DENOMINATOR)
  );
  const netUsdtMicro = Math.max(0, Math.round(usdtMicro) - feeUsdtMicro);
  const grossInrPaise = Number(
    (BigInt(netUsdtMicro) * BigInt(Math.round(rateInrPaise)) + BigInt(MICRO_PER_USDT / 2)) /
      BigInt(MICRO_PER_USDT)
  );
  const tdsInrPaise = Number(
    (BigInt(grossInrPaise) * BigInt(Math.max(0, tdsRateBps)) + BigInt(BPS_DENOMINATOR / 2)) /
      BigInt(BPS_DENOMINATOR)
  );
  const netInrPaise = Math.max(0, grossInrPaise - tdsInrPaise);
  return {
    usdtMicro: Math.round(usdtMicro),
    rateInrPaise: Math.round(rateInrPaise),
    grossInrPaise,
    feeUsdtMicro,
    tdsInrPaise,
    netInrPaise,
  };
}

export function formatInrFromPaise(paise: number): string {
  const inr = (paise || 0) / PAISE_PER_INR;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(inr);
}

export function formatUsdtFromMicro(micro: number, decimals = 2): string {
  const usdt = (micro || 0) / MICRO_PER_USDT;
  return `${usdt.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: Math.max(decimals, 4),
  })} USDT`;
}

export function formatRateInr(paise: number): string {
  const inr = (paise || 0) / PAISE_PER_INR;
  return `₹${inr.toFixed(2)}`;
}

export function maskPan(pan: string): string {
  const clean = pan.trim().toUpperCase();
  if (clean.length < 6) return '******';
  return `${clean.slice(0, 2)}****${clean.slice(-4)}`;
}

export function maskAccountNumber(acct: string): string {
  const clean = acct.replace(/\s+/g, '');
  if (clean.length <= 4) return clean;
  return `•••• ${clean.slice(-4)}`;
}

export function isValidPan(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.trim().toUpperCase());
}

export function isValidIfsc(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

export function isValidUpi(upi: string): boolean {
  return /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z0-9]{2,32}$/.test(upi.trim());
}

export function isValidWalletAddress(address: string, network: BlockchainNetworkId): boolean {
  const clean = address.trim();
  if (network === 'TRON_TRC20') {
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(clean);
  }
  return /^0x[a-fA-F0-9]{40}$/.test(clean);
}

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ['AWAITING_ACCEPTANCE', 'ACCEPTED', 'ESCROW_RESERVED', 'CANCELLED', 'EXPIRED'],
  AWAITING_ACCEPTANCE: ['ACCEPTED', 'ESCROW_RESERVED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['ESCROW_RESERVED', 'PAYMENT_PENDING', 'CANCELLED', 'EXPIRED'],
  ESCROW_RESERVED: ['PAYMENT_PENDING', 'PAYMENT_SUBMITTED', 'CANCELLED', 'EXPIRED', 'REFUNDED'],
  PAYMENT_PENDING: ['PAYMENT_SUBMITTED', 'CANCELLED', 'EXPIRED', 'REFUNDED'],
  PAYMENT_SUBMITTED: ['PAYMENT_VERIFIED', 'DISPUTED'],
  PAYMENT_VERIFIED: ['SETTLING', 'COMPLETED', 'DISPUTED'],
  SETTLING: ['COMPLETED', 'DISPUTED', 'REFUNDED'],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  DISPUTED: ['COMPLETED', 'REFUNDED', 'CANCELLED'],
  REFUNDED: [],
};

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getRiskLevelFromScore(score: number): RiskLevel {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

export function computeDeterministicRisk(input: {
  inrPaise: number;
  kycStatus: KycStatus;
  completedTrades: number;
  disputedCount: number;
  cancelledCount: number;
  newPaymentAccount: boolean;
}): {
  score: number;
  level: RiskLevel;
  reasons: string[];
  recommendedAction:
    | 'ALLOW'
    | 'REQUEST_ADDITIONAL_VERIFICATION'
    | 'APPLY_LIMITS'
    | 'HOLD_MANUAL_REVIEW'
    | 'ESCALATE_COMPLIANCE'
    | 'BLOCK';
} {
  let score = 8;
  const reasons: string[] = [];

  if (input.kycStatus !== 'APPROVED' && input.kycStatus !== 'VERIFIED') {
    score += 32;
    reasons.push(`KYC verification status is ${input.kycStatus.replace(/_/g, ' ').toLowerCase()}.`);
  }
  if (input.inrPaise >= 20_000_000) {
    // >= ₹2,00,000
    score += 24;
    reasons.push('High-value INR order exceeding ₹2,00,000 threshold.');
  } else if (input.inrPaise >= 5_000_000) {
    // >= ₹50,000
    score += 12;
    reasons.push('Elevated order amount above ₹50,000.');
  }
  if (input.completedTrades === 0) {
    score += 14;
    reasons.push('First-time counterparty with zero completed platform trades.');
  }
  if (input.disputedCount > 0) {
    score += Math.min(25, input.disputedCount * 15);
    reasons.push(`Account has ${input.disputedCount} prior disputed order(s).`);
  }
  if (input.cancelledCount >= 3) {
    score += 12;
    reasons.push(`Elevated order cancellation history (${input.cancelledCount} cancelled).`);
  }
  if (input.newPaymentAccount) {
    score += 10;
    reasons.push('Unverified or recently added INR payment account.');
  }

  if (reasons.length === 0) {
    reasons.push('Verified account history within standard INR order thresholds.');
  }

  const clamped = Math.min(100, Math.max(0, score));
  const level = getRiskLevelFromScore(clamped);
  let recommendedAction:
    | 'ALLOW'
    | 'REQUEST_ADDITIONAL_VERIFICATION'
    | 'APPLY_LIMITS'
    | 'HOLD_MANUAL_REVIEW'
    | 'ESCALATE_COMPLIANCE'
    | 'BLOCK' = 'ALLOW';

  if (clamped >= 80) recommendedAction = 'ESCALATE_COMPLIANCE';
  else if (clamped >= 60) recommendedAction = 'HOLD_MANUAL_REVIEW';
  else if (clamped >= 30) recommendedAction = 'REQUEST_ADDITIONAL_VERIFICATION';

  return { score: clamped, level, reasons, recommendedAction };
}

export const VIDEO_KYC_CHALLENGES = [
  'Hold your photo ID beside your face, look straight, then turn your head slightly left and say the 4-digit code.',
  'Hold your photo ID below your chin, blink twice clearly, then tilt your head slightly right and read the verification code.',
  'Face the camera in bright light, hold your PAN/ID steady for 3 seconds, nod once, and state the challenge code.',
  'Keep your document unobscured beside your shoulder, look left then center, and speak the displayed security digits.',
] as const;

export function getKycExpiryStatus(params: {
  documentExpiry?: string;
  kycExpiresAtMs?: number;
  nowMs?: number;
}): {
  daysRemaining: number | null;
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNSET';
  message: string;
} {
  const now = params.nowMs ?? Date.now();
  let targetMs: number | null =
    typeof params.kycExpiresAtMs === 'number' && params.kycExpiresAtMs > 0
      ? params.kycExpiresAtMs
      : null;

  if (!targetMs && params.documentExpiry) {
    const parsed = Date.parse(params.documentExpiry);
    if (!Number.isNaN(parsed)) {
      targetMs = parsed;
    }
  }

  if (!targetMs) {
    return {
      daysRemaining: null,
      status: 'UNSET',
      message: 'No document expiry recorded yet.',
    };
  }

  const daysRemaining = Math.ceil((targetMs - now) / (24 * 60 * 60 * 1000));
  if (daysRemaining <= 0) {
    return {
      daysRemaining,
      status: 'EXPIRED',
      message: 'KYC verification or identity document has expired. Re-verification required.',
    };
  }
  if (daysRemaining <= 30) {
    return {
      daysRemaining,
      status: 'EXPIRING_SOON',
      message: `KYC / document expires in ${daysRemaining} day(s). Schedule renewal soon.`,
    };
  }
  return {
    daysRemaining,
    status: 'VALID',
    message: `Valid for ${daysRemaining} day(s).`,
  };
}

export function buildUpiPaymentUri(params: {
  upiId: string;
  payeeName: string;
  amountInrPaise: number;
  orderCode: string;
}): string {
  const cleanUpi = params.upiId.trim();
  const amountInr = (Math.max(0, params.amountInrPaise) / PAISE_PER_INR).toFixed(2);
  const query = new URLSearchParams({
    pa: cleanUpi,
    pn: params.payeeName.slice(0, 40),
    am: amountInr,
    cu: 'INR',
    tn: `CoinBridge ${params.orderCode}`,
  });
  return `upi://pay?${query.toString()}`;
}

export interface MatchableOffer {
  id: string;
  asset?: string;
  side: 'SELL_USDT' | 'BUY_USDT' | 'SELL' | 'BUY';
  rateInrPaise: number;
  availableUsdtMicro: number;
  availableAssetE8?: number;
  minInrPaise: number;
  maxInrPaise: number;
  paymentMethods: PaymentMethodType[];
  verificationLevel: 'BASIC' | 'VERIFIED' | 'PREMIUM';
  completionRateBps: number;
  completedTrades?: number;
  avgCompletionMins?: number;
  merchantRatingBps?: number;
  merchantVolumeUsdtMicro?: number;
  isActive: boolean;
  isDemo?: boolean;
}

export interface ScoredMatchedOffer<T extends MatchableOffer> {
  offer: T;
  matchScore: number; // 0..100
  rateCompetitivenessScore: number; // 0..45
  reputationScore: number; // 0..25
  liquidityFitScore: number; // 0..15
  speedAndRailScore: number; // 0..15
  reasons: string[];
}

export function matchBestOffersScored<T extends MatchableOffer>(
  offers: T[],
  criteria: {
    mode: 'buy' | 'sell';
    asset?: string;
    inrPaise: number;
    paymentMethod?: PaymentMethodType | 'ALL';
    verifiedOnly?: boolean;
    includeDemo?: boolean;
  }
): ScoredMatchedOffer<T>[] {
  const allowedSides = criteria.mode === 'buy' ? ['SELL_USDT', 'SELL'] : ['BUY_USDT', 'BUY'];
  const requestedAsset = criteria.asset ? criteria.asset.trim().toUpperCase() : null;

  const eligible = offers.filter((o) => {
    const offerAsset = (o.asset || 'USDT').toUpperCase();
    if (requestedAsset && offerAsset !== requestedAsset) return false;
    const availableE8 =
      typeof o.availableAssetE8 === 'number'
        ? o.availableAssetE8
        : Math.round((o.availableUsdtMicro || 0) * 100);
    if (!o.isActive || !allowedSides.includes(o.side) || availableE8 <= 0) return false;
    if (criteria.verifiedOnly && o.verificationLevel === 'BASIC') return false;
    if (criteria.includeDemo === false && o.isDemo) return false;
    if (
      criteria.paymentMethod &&
      criteria.paymentMethod !== 'ALL' &&
      !o.paymentMethods.includes(criteria.paymentMethod)
    ) {
      return false;
    }
    if (criteria.inrPaise > 0) {
      if (criteria.inrPaise < o.minInrPaise || criteria.inrPaise > o.maxInrPaise) return false;
      const neededE8 = Number(
        (BigInt(Math.round(criteria.inrPaise)) * BigInt(100_000_000)) /
          BigInt(Math.max(1, o.rateInrPaise))
      );
      if (neededE8 > availableE8) return false;
    }
    return true;
  });

  if (eligible.length === 0) return [];

  const rates = eligible.map((o) => o.rateInrPaise);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);
  const rateSpread = Math.max(1, maxRate - minRate);

  const scored = eligible.map((offer) => {
    const reasons: string[] = [];

    // 1. Exchange rate competitiveness (up to 45 pts)
    let rateNorm = 1;
    if (maxRate !== minRate) {
      rateNorm =
        criteria.mode === 'buy'
          ? (maxRate - offer.rateInrPaise) / rateSpread
          : (offer.rateInrPaise - minRate) / rateSpread;
    }
    const rateCompetitivenessScore = Math.round(rateNorm * 45);
    if (rateNorm >= 0.85) {
      reasons.push(criteria.mode === 'buy' ? 'Top lowest ask rate' : 'Top highest bid rate');
    }

    // 2. Merchant reputation & completion rate + verification tier (up to 25 pts)
    const compPct = Math.min(1, Math.max(0, (offer.completionRateBps || 0) / 10_000));
    const ratingPct = Math.min(1, Math.max(0, (offer.merchantRatingBps || 450) / 500));
    const verBonus =
      offer.verificationLevel === 'PREMIUM' ? 5 : offer.verificationLevel === 'VERIFIED' ? 3 : 0;
    const realNonDemoBonus = offer.isDemo ? 0 : 2;
    const reputationScore = Math.min(
      25,
      Math.round(compPct * 12 + ratingPct * 6 + verBonus + realNonDemoBonus)
    );
    if (offer.completionRateBps >= 9800) {
      reasons.push(`${(offer.completionRateBps / 100).toFixed(1)}% completion`);
    }
    if (!offer.isDemo && offer.verificationLevel !== 'BASIC') {
      reasons.push(`${offer.verificationLevel} KYC/KYB desk`);
    }

    // 3. Available liquidity depth vs requested amount (up to 15 pts)
    const availableE8 =
      typeof offer.availableAssetE8 === 'number'
        ? offer.availableAssetE8
        : Math.round((offer.availableUsdtMicro || 0) * 100);
    const estAvailInrPaise = Math.round((availableE8 / 100_000_000) * offer.rateInrPaise);
    const targetInr = Math.max(100_000, criteria.inrPaise || 1_000_000);
    const coverageRatio = Math.min(5, estAvailInrPaise / targetInr);
    const liquidityFitScore = Math.min(15, Math.round((coverageRatio / 5) * 15));
    if (coverageRatio >= 2.5) {
      reasons.push('Deep liquidity coverage');
    }

    // 4. Settlement speed & payment rail flexibility (up to 15 pts)
    const avgMins = offer.avgCompletionMins ?? 15;
    const speedPts = avgMins <= 6 ? 10 : avgMins <= 12 ? 7 : avgMins <= 20 ? 4 : 2;
    const railPts =
      criteria.paymentMethod && criteria.paymentMethod !== 'ALL'
        ? 5
        : Math.min(5, offer.paymentMethods.length * 2);
    const speedAndRailScore = Math.min(15, speedPts + railPts);
    if (avgMins <= 8) {
      reasons.push(`Fast avg ${avgMins}m release`);
    }

    const matchScore = Math.min(
      100,
      rateCompetitivenessScore + reputationScore + liquidityFitScore + speedAndRailScore
    );

    if (reasons.length === 0) {
      reasons.push('Meets INR limits & active payment rail');
    }

    return {
      offer,
      matchScore,
      rateCompetitivenessScore,
      reputationScore,
      liquidityFitScore,
      speedAndRailScore,
      reasons,
    };
  });

  return scored.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (a.offer.rateInrPaise !== b.offer.rateInrPaise) {
      return criteria.mode === 'buy'
        ? a.offer.rateInrPaise - b.offer.rateInrPaise
        : b.offer.rateInrPaise - a.offer.rateInrPaise;
    }
    return b.offer.completionRateBps - a.offer.completionRateBps;
  });
}

export function matchBestOffers<T extends MatchableOffer>(
  offers: T[],
  criteria: {
    mode: 'buy' | 'sell';
    asset?: string;
    inrPaise: number;
    paymentMethod?: PaymentMethodType | 'ALL';
    verifiedOnly?: boolean;
    includeDemo?: boolean;
    prioritize?: 'SMART' | 'RATE';
  }
): T[] {
  const scored = matchBestOffersScored(offers, criteria);
  if (criteria.prioritize === 'RATE') {
    return scored
      .map((s) => s.offer)
      .sort((a, b) => {
        if (a.rateInrPaise !== b.rateInrPaise) {
          return criteria.mode === 'buy'
            ? a.rateInrPaise - b.rateInrPaise
            : b.rateInrPaise - a.rateInrPaise;
        }
        return b.completionRateBps - a.completionRateBps;
      });
  }
  return scored.map((s) => s.offer);
}

// --- Mandatory KYC Trading Eligibility ---
export interface TradingEligibilityInput {
  kycStatus?: KycStatus | null;
  accountStatus?: 'ACTIVE' | 'SUSPENDED' | 'DELETION_REQUESTED' | null;
  withdrawalLocked?: boolean;
  restrictedReason?: string;
  kycExpiresAtMs?: number;
}

export function isKycStatusVerified(status?: KycStatus | null): boolean {
  return status === 'APPROVED' || status === 'VERIFIED';
}

export function getKycRestrictionDetails(
  account: TradingEligibilityInput | null | undefined,
  nowMs = Date.now()
): {
  eligible: boolean;
  effectiveKycStatus: KycStatus;
  reasonCode:
    | 'ELIGIBLE'
    | 'UNAUTHENTICATED'
    | 'ACCOUNT_SUSPENDED'
    | 'COMPLIANCE_RESTRICTION'
    | 'KYC_EXPIRED'
    | 'KYC_NOT_VERIFIED';
  reasonMessage: string;
} {
  if (!account) {
    return {
      eligible: false,
      effectiveKycStatus: 'NOT_STARTED',
      reasonCode: 'UNAUTHENTICATED',
      reasonMessage: 'Sign in and complete KYC verification before buying or selling USDT.',
    };
  }

  const rawStatus: KycStatus = account.kycStatus || 'NOT_STARTED';
  const expiredByTimestamp =
    typeof account.kycExpiresAtMs === 'number' &&
    account.kycExpiresAtMs > 0 &&
    account.kycExpiresAtMs <= nowMs;

  const effectiveKycStatus: KycStatus =
    rawStatus === 'EXPIRED' || (isKycStatusVerified(rawStatus) && expiredByTimestamp)
      ? 'EXPIRED'
      : rawStatus;

  if (account.accountStatus === 'SUSPENDED' || rawStatus === 'SUSPENDED') {
    return {
      eligible: false,
      effectiveKycStatus: rawStatus === 'SUSPENDED' ? 'SUSPENDED' : effectiveKycStatus,
      reasonCode: 'ACCOUNT_SUSPENDED',
      reasonMessage:
        account.restrictedReason ||
        'Your account is currently suspended from trading operations. Contact Compliance.',
    };
  }

  if (account.accountStatus === 'DELETION_REQUESTED') {
    return {
      eligible: false,
      effectiveKycStatus,
      reasonCode: 'ACCOUNT_SUSPENDED',
      reasonMessage: 'Trading is disabled while an account deletion request is pending.',
    };
  }

  if (account.withdrawalLocked && account.restrictedReason) {
    return {
      eligible: false,
      effectiveKycStatus,
      reasonCode: 'COMPLIANCE_RESTRICTION',
      reasonMessage: account.restrictedReason,
    };
  }

  if (effectiveKycStatus === 'EXPIRED') {
    return {
      eligible: false,
      effectiveKycStatus: 'EXPIRED',
      reasonCode: 'KYC_EXPIRED',
      reasonMessage: 'Your KYC verification has expired. Please renew Video KYC before trading.',
    };
  }

  if (!isKycStatusVerified(effectiveKycStatus)) {
    return {
      eligible: false,
      effectiveKycStatus,
      reasonCode: 'KYC_NOT_VERIFIED',
      reasonMessage: `Current KYC status is ${effectiveKycStatus.replace(/_/g, ' ')}. Approved KYC is required before trading.`,
    };
  }

  if (account.accountStatus !== 'ACTIVE') {
    return {
      eligible: false,
      effectiveKycStatus,
      reasonCode: 'ACCOUNT_SUSPENDED',
      reasonMessage: 'Account must be ACTIVE to execute trading operations.',
    };
  }

  return {
    eligible: true,
    effectiveKycStatus,
    reasonCode: 'ELIGIBLE',
    reasonMessage: 'Verified & Active',
  };
}

export function isUserKycEligibleForTrading(
  account: TradingEligibilityInput | null | undefined,
  nowMs = Date.now()
): boolean {
  return getKycRestrictionDetails(account, nowMs).eligible;
}

// --- Crypto Wallet Deposit & Withdrawal Domain Helpers ---
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HEX_ALPHABET = '0123456789abcdef';

function deterministicHashBytes(seed: string, length: number): number[] {
  const out: number[] = [];
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) {
    h1 ^= seed.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= seed.charCodeAt(i) + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  for (let i = 0; i < length; i++) {
    h1 = Math.imul(h1 ^ (i + 17), 0x45d9f3b) >>> 0;
    h2 = Math.imul(h2 ^ (h1 >>> 3), 0x27d4eb2d) >>> 0;
    out.push(((h1 ^ h2) >>> (i % 16)) & 0xff);
  }
  return out;
}

export function deriveDeterministicDepositAddress(
  uid: string,
  network: BlockchainNetworkId
): string {
  const bytes = deterministicHashBytes(`${uid}:${network}:coinbridge_deposit_v1`, 40);
  if (network === 'TRON_TRC20') {
    let body = '';
    for (let i = 0; i < 33; i++) {
      body += BASE58_ALPHABET[bytes[i] % BASE58_ALPHABET.length];
    }
    return `T${body}`;
  }
  let hex = '';
  for (let i = 0; i < 40; i++) {
    hex += HEX_ALPHABET[bytes[i] % HEX_ALPHABET.length];
  }
  return `0x${hex}`;
}

export function buildBlockchainEventId(
  network: BlockchainNetworkId,
  txHash: string,
  eventIndex = 0
): string {
  const cleanHash = txHash.trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 72);
  const idx = Math.max(0, Math.round(eventIndex));
  return `${network}_${cleanHash}_${idx}`;
}

export interface WithdrawalBreakdown {
  requestedAmountMicro: number;
  networkFeeMicro: number;
  platformFeeMicro: number;
  totalFeeMicro: number;
  totalDebitMicro: number;
  netReceivedMicro: number;
}

export function calculateWithdrawalBreakdown(params: {
  amountMicro: number;
  networkFeeMicro: number;
  platformFeeMicro: number;
}): WithdrawalBreakdown {
  const amount = Math.max(0, Math.round(params.amountMicro));
  const netFee = Math.max(0, Math.round(params.networkFeeMicro));
  const platFee = Math.max(0, Math.round(params.platformFeeMicro));
  const totalFee = Number(BigInt(netFee) + BigInt(platFee));
  const totalDebit = Number(BigInt(amount) + BigInt(totalFee));
  return {
    requestedAmountMicro: amount,
    networkFeeMicro: netFee,
    platformFeeMicro: platFee,
    totalFeeMicro: totalFee,
    totalDebitMicro: totalDebit,
    netReceivedMicro: amount,
  };
}

export function evaluateWithdrawalRisk(params: {
  amountMicro: number;
  manualReviewThresholdMicro: number;
  isWhitelisted: boolean;
  whitelistCreatedAtMs?: number;
  newAddressCooldownHours: number;
  kycStatus: KycStatus;
  completedTrades: number;
  nowMs?: number;
}): {
  score: number;
  level: RiskLevel;
  requiresManualReview: boolean;
  reasons: string[];
} {
  const now = params.nowMs ?? Date.now();
  let score = 10;
  const reasons: string[] = [];

  if (!isKycStatusVerified(params.kycStatus)) {
    score += 50;
    reasons.push(`Account KYC is ${params.kycStatus}; withdrawals require verified KYC.`);
  }
  if (!params.isWhitelisted) {
    score += 24;
    reasons.push('Destination address is not in the saved withdrawal whitelist.');
  } else if (typeof params.whitelistCreatedAtMs === 'number' && params.whitelistCreatedAtMs > 0) {
    const cooldownMs = Math.max(0, params.newAddressCooldownHours) * 3_600_000;
    if (now - params.whitelistCreatedAtMs < cooldownMs) {
      score += 22;
      const hrsLeft = Math.max(1, Math.ceil((cooldownMs - (now - params.whitelistCreatedAtMs)) / 3_600_000));
      reasons.push(`Newly whitelisted address is within ${params.newAddressCooldownHours}h security delay (${hrsLeft}h left).`);
    }
  }
  if (params.amountMicro >= params.manualReviewThresholdMicro) {
    score += 32;
    reasons.push(
      `Withdrawal meets or exceeds manual compliance threshold (${formatUsdtFromMicro(params.manualReviewThresholdMicro, 0)}).`
    );
  }
  if (params.completedTrades === 0) {
    score += 12;
    reasons.push('Account has zero completed P2P trades prior to outbound transfer.');
  }

  if (reasons.length === 0) {
    reasons.push('Verified user withdrawing to aged whitelisted address within policy limits.');
  }

  const clamped = Math.min(100, Math.max(0, score));
  const level = getRiskLevelFromScore(clamped);
  const requiresManualReview = clamped >= 45 || params.amountMicro >= params.manualReviewThresholdMicro;

  return {
    score: clamped,
    level,
    requiresManualReview,
    reasons,
  };
}


