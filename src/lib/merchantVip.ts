import { MICRO_PER_USDT } from './domain';

export type MerchantVipTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface MerchantVipDefinition {
  tier: MerchantVipTier;
  label: string;
  minCompletedOrders: number;
  minVolumeUsdt: number;
  minCompletionRatePct: number;
  maxDisputeRatePct: number;
  feeRebateBps: number;
  apiRateLimitPerMin: number;
  rankingBoostPoints: number;
  privileges: string[];
}

export const MERCHANT_VIP_TIERS: MerchantVipDefinition[] = [
  {
    tier: 'BRONZE',
    label: 'Bronze',
    minCompletedOrders: 0,
    minVolumeUsdt: 0,
    minCompletionRatePct: 0,
    maxDisputeRatePct: 100,
    feeRebateBps: 0,
    apiRateLimitPerMin: 30,
    rankingBoostPoints: 0,
    privileges: ['Standard marketplace listing', '30 req/min API sandbox access'],
  },
  {
    tier: 'SILVER',
    label: 'Silver',
    minCompletedOrders: 15,
    minVolumeUsdt: 10_000,
    minCompletionRatePct: 95,
    maxDisputeRatePct: 5,
    feeRebateBps: 3,
    apiRateLimitPerMin: 60,
    rankingBoostPoints: 3,
    privileges: ['3 bps promotional fee rebate', '60 req/min Merchant REST API', 'Silver marketplace highlight'],
  },
  {
    tier: 'GOLD',
    label: 'Gold',
    minCompletedOrders: 75,
    minVolumeUsdt: 50_000,
    minCompletionRatePct: 97.5,
    maxDisputeRatePct: 2.5,
    feeRebateBps: 6,
    apiRateLimitPerMin: 120,
    rankingBoostPoints: 6,
    privileges: ['6 bps promotional fee rebate', '120 req/min API + HMAC webhooks', 'Priority dispute desk SLA'],
  },
  {
    tier: 'PLATINUM',
    label: 'Platinum',
    minCompletedOrders: 250,
    minVolumeUsdt: 250_000,
    minCompletionRatePct: 99,
    maxDisputeRatePct: 1,
    feeRebateBps: 10,
    apiRateLimitPerMin: 300,
    rankingBoostPoints: 10,
    privileges: ['10 bps promotional fee rebate', '300 req/min Institutional API', 'Top smart-match priority placement'],
  },
];

export interface MerchantVipEvaluation {
  tier: MerchantVipTier;
  definition: MerchantVipDefinition;
  nextTier: MerchantVipDefinition | null;
  completedOrders: number;
  totalVolumeUsdt: number;
  completionRatePct: number;
  disputeRatePct: number;
  progressToNextPct: number;
  /** Explicitly separates promotional VIP status from compliance KYC/KYB verification */
  verificationSummary: {
    kycKybStatus: 'DEMO_SIMULATION' | 'BASIC' | 'VERIFIED' | 'PREMIUM' | 'SUSPENDED';
    isGenuineVerified: boolean;
    disclaimer: string;
  };
}

export function evaluateMerchantVipProgram(input: {
  completedOrders: number;
  totalVolumeUsdtMicro: number;
  disputedOrders?: number;
  verificationLevel: 'BASIC' | 'VERIFIED' | 'PREMIUM' | 'SUSPENDED';
  isDemo?: boolean;
}): MerchantVipEvaluation {
  const completedOrders = Math.max(0, Math.round(input.completedOrders || 0));
  const disputedOrders = Math.max(0, Math.round(input.disputedOrders || 0));
  const totalAttempts = Math.max(1, completedOrders + disputedOrders);
  const completionRatePct =
    completedOrders === 0 && disputedOrders === 0
      ? 100
      : Number(((completedOrders / totalAttempts) * 100).toFixed(2));
  const disputeRatePct =
    completedOrders === 0 && disputedOrders === 0
      ? 0
      : Number(((disputedOrders / totalAttempts) * 100).toFixed(2));
  const totalVolumeUsdt = Number((Math.max(0, input.totalVolumeUsdtMicro || 0) / MICRO_PER_USDT).toFixed(2));

  // Promotional VIP tier strictly reflects actual completed trading metrics — never overrides KYC/KYB status
  let matchedIdx = 0;
  for (let i = MERCHANT_VIP_TIERS.length - 1; i >= 0; i--) {
    const def = MERCHANT_VIP_TIERS[i];
    if (
      completedOrders >= def.minCompletedOrders &&
      totalVolumeUsdt >= def.minVolumeUsdt &&
      completionRatePct >= def.minCompletionRatePct &&
      disputeRatePct <= def.maxDisputeRatePct
    ) {
      matchedIdx = i;
      break;
    }
  }

  const definition = MERCHANT_VIP_TIERS[matchedIdx];
  const nextTier = matchedIdx < MERCHANT_VIP_TIERS.length - 1 ? MERCHANT_VIP_TIERS[matchedIdx + 1] : null;

  let progressToNextPct = 100;
  if (nextTier) {
    const orderRatio = Math.min(1, completedOrders / Math.max(1, nextTier.minCompletedOrders));
    const volRatio = Math.min(1, totalVolumeUsdt / Math.max(1, nextTier.minVolumeUsdt));
    progressToNextPct = Math.round(((orderRatio + volRatio) / 2) * 100);
  }

  const isGenuineVerified =
    !input.isDemo && (input.verificationLevel === 'VERIFIED' || input.verificationLevel === 'PREMIUM');

  return {
    tier: definition.tier,
    definition,
    nextTier,
    completedOrders,
    totalVolumeUsdt,
    completionRatePct,
    disputeRatePct,
    progressToNextPct,
    verificationSummary: {
      kycKybStatus: input.isDemo ? 'DEMO_SIMULATION' : input.verificationLevel,
      isGenuineVerified,
      disclaimer: input.isDemo
        ? 'DEMO fixture metrics only. Not a genuinely KYC/KYB-verified merchant.'
        : 'VIP tier rewards trading performance and is independent of mandatory KYC/KYB compliance verification.',
    },
  };
}
