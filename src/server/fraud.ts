import {
  BlockchainNetworkId,
  getRiskLevelFromScore,
  isValidWalletAddress,
  RiskLevel,
} from '../lib/domain.ts';

// Well-known public OFAC/sanctioned sample test patterns (non-exhaustive screening list)
const HIGH_RISK_TEST_PREFIXES = [
  '0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c',
  '0xd882cfc20f52f2599d84b8e8d58c7fb62cfe344b',
  '0x7f367cc41522ce07553e823bf3be79a889debe1b',
  'TJ9t5d7Q6f8s9K1x2Y3z4A5b6C7d8E9f0g',
];

export interface WalletRiskScreeningResult {
  address: string;
  network: BlockchainNetworkId;
  validFormat: boolean;
  riskScore: number;
  riskLevel: RiskLevel;
  recommendation: 'ALLOW' | 'ENHANCED_REVIEW' | 'BLOCK';
  flags: string[];
  screenedAt: string;
}

export function screenWalletAddressRisk(params: {
  address: string;
  network: BlockchainNetworkId;
  amountUsdt?: number;
  recentWithdrawals24h?: number;
}): WalletRiskScreeningResult {
  const clean = params.address.trim();
  const validFormat = isValidWalletAddress(clean, params.network);
  const flags: string[] = [];
  let score = 8;

  if (!validFormat) {
    score += 75;
    flags.push(`Invalid ${params.network} destination address checksum/format.`);
  }

  const lower = clean.toLowerCase();
  if (HIGH_RISK_TEST_PREFIXES.some((p) => lower === p.toLowerCase())) {
    score = 98;
    flags.push('Matched high-risk sanctions/illicit cluster watch address.');
  }

  if (/^0x0{10,}/.test(lower) || /^T1{10,}/.test(clean)) {
    score += 65;
    flags.push('Burn / zero-entropy sink address pattern detected.');
  }

  if (typeof params.amountUsdt === 'number' && params.amountUsdt >= 10_000) {
    score += 24;
    flags.push('High-value single transfer (>= 10,000 USDT) triggers travel-rule screening.');
  }

  if (typeof params.recentWithdrawals24h === 'number' && params.recentWithdrawals24h >= 4) {
    score += 22;
    flags.push(`Elevated 24h outbound velocity (${params.recentWithdrawals24h} withdrawals).`);
  }

  if (flags.length === 0) {
    flags.push('Valid network format with no sanctions/mixer cluster matches.');
  }

  const clamped = Math.min(100, Math.max(0, score));
  const riskLevel = getRiskLevelFromScore(clamped);
  const recommendation: WalletRiskScreeningResult['recommendation'] =
    clamped >= 75 ? 'BLOCK' : clamped >= 40 ? 'ENHANCED_REVIEW' : 'ALLOW';

  return {
    address: clean,
    network: params.network,
    validFormat,
    riskScore: clamped,
    riskLevel,
    recommendation,
    flags,
    screenedAt: new Date().toISOString(),
  };
}
