import { Timestamp } from 'firebase/firestore';
import {
  BlockchainNetworkId,
  DepositStatus,
  EscrowStatus,
  KycStatus,
  OrderStatus,
  PaymentMethodType,
  RiskLevel,
  UserRole,
  WalletLedgerEntryType,
  WithdrawalStatus,
} from '../lib/domain';
import type {
  CoinNetworkContract,
  CoinSymbol,
  MultiCoinNetworkId,
} from '../lib/coins';

export interface UserAccountDoc {
  uid: string;
  username: string;
  displayName: string;
  role: UserRole;
  kycStatus: KycStatus;
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'DELETION_REQUESTED';
  walletAddress?: string;
  isDemo?: boolean;
  withdrawalLocked?: boolean;
  restrictedReason?: string;
  kycExpiresAtMs?: number;
  completedTrades: number;
  completionRateBps: number;
  ratingAvgBps: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserPrivateProfileDoc {
  uid: string;
  fullLegalName: string;
  email: string;
  mobile?: string;
  country: string;
  residentialAddress?: string;
  dateOfBirth?: string;
  twoFactorEnabled: boolean;
  twoFactorMethod?: 'NONE' | 'TOTP';
  totpSealedSecret?: string;
  whitelistOnlyWithdrawals?: boolean;
  notifyEmail: boolean;
  notifyInApp: boolean;
  notifySecurityAlerts: boolean;
  updatedAt: Timestamp;
}

export interface P2POfferDoc {
  id: string;
  merchantUid: string;
  merchantUsername: string;
  verificationLevel: 'BASIC' | 'VERIFIED' | 'PREMIUM';
  side: 'SELL_USDT' | 'BUY_USDT' | 'SELL' | 'BUY';
  asset: CoinSymbol;
  fiatCurrency: 'INR';
  rateInrPaise: number;
  availableUsdtMicro: number;
  availableAssetE8?: number;
  minInrPaise: number;
  maxInrPaise: number;
  paymentMethods: PaymentMethodType[];
  network: BlockchainNetworkId | MultiCoinNetworkId;
  avgCompletionMins: number;
  completedTrades: number;
  completionRateBps: number;
  merchantRatingBps?: number;
  merchantVolumeUsdtMicro?: number;
  termsNote?: string;
  isActive: boolean;
  isSandbox: boolean;
  isDemo?: boolean;
  demoLabel?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface P2POrderDoc {
  id: string;
  orderCode: string;
  offerId: string;
  side: 'BUY_USDT' | 'SELL_USDT' | 'BUY' | 'SELL';
  asset?: CoinSymbol;
  buyerUid: string;
  sellerUid: string;
  buyerUsername: string;
  sellerUsername: string;
  usdtMicro: number;
  quantityE8?: number;
  inrPaise: number;
  rateInrPaise: number;
  feeUsdtMicro: number;
  feeE8?: number;
  tdsInrPaise: number;
  paymentMethod: PaymentMethodType;
  network: BlockchainNetworkId | MultiCoinNetworkId;
  buyerWalletAddress?: string;
  sellerWalletAddress?: string;
  paymentAccountSnapshot?: string;
  escrowStatus: EscrowStatus;
  escrowTxHash?: string;
  paymentRef?: string;
  paymentMode: 'SANDBOX' | 'PROVIDER_API';
  riskScore: number;
  riskLevel: RiskLevel;
  status: OrderStatus;
  buyerRating?: number;
  releaseConfirmed2FA?: boolean;
  completedAtMs?: number;
  isSandbox: boolean;
  expiresAtMs: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OrderEventDoc {
  id: string;
  orderId: string;
  actorUid: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  note: string;
  createdAt: Timestamp;
}

export interface OrderMessageDoc {
  id: string;
  orderId: string;
  senderUid: string;
  senderUsername: string;
  senderRole: 'BUYER' | 'SELLER' | 'ADMIN';
  body: string;
  createdAt: Timestamp;
}

export interface KycSubmissionDoc {
  id: string;
  uid: string;
  fullLegalName: string;
  dateOfBirth: string;
  country: string;
  residentialAddress: string;
  idType: 'PAN' | 'PASSPORT' | 'AADHAAR_MASKED' | 'DRIVING_LICENSE';
  maskedIdNumber: string;
  panMasked?: string;
  documentExpiry?: string;
  livenessMethod: 'SANDBOX_LIVENESS' | 'PROVIDER_API' | 'VIDEO_KYC_ADAPTER';
  videoStatus?: 'NOT_STARTED' | 'CHALLENGE_ISSUED' | 'LIVENESS_PASSED' | 'MANUAL_REVIEW';
  videoChallengePrompt?: string;
  livenessScore?: number;
  faceMatchScore?: number;
  providerMode?: string;
  kycExpiresAtMs?: number;
  verificationHistory?: string[];
  isDemoRecord?: boolean;
  bankAccountLast4: string;
  bankIfsc: string;
  accountHolderName: string;
  pepDeclared: boolean;
  sanctionsDeclaredClear: boolean;
  sourceOfFunds: string;
  status: KycStatus;
  reviewerNote?: string;
  reviewedByUid?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PaymentAccountDoc {
  id: string;
  uid: string;
  methodType: PaymentMethodType;
  accountHolderName: string;
  bankName?: string;
  maskedAccountNumber?: string;
  ifsc?: string;
  upiId?: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PaymentRecordDoc {
  id: string;
  uid: string;
  orderId: string;
  orderCode: string;
  method: PaymentMethodType;
  referenceId: string;
  inrPaise: number;
  status: 'PENDING' | 'VERIFIED' | 'DUPLICATE_FLAGGED' | 'FAILED';
  isSandbox: boolean;
  reconciliationNote: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WalletLedgerDoc {
  uid: string;
  availableUsdtMicro: number;
  reservedUsdtMicro: number;
  connectedAddress?: string;
  preferredNetwork: BlockchainNetworkId;
  updatedAt: Timestamp;
}

export interface WalletTransactionDoc {
  id: string;
  uid: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'ESCROW_LOCK' | 'ESCROW_RELEASE' | 'ESCROW_REFUND';
  network: BlockchainNetworkId;
  asset: 'USDT';
  amountMicro: number;
  networkFeeMicro: number;
  txHash?: string;
  toAddress?: string;
  isSandbox: boolean;
  status: 'PENDING' | 'CONFIRMING' | 'CONFIRMED' | 'FAILED';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MerchantProfileDoc {
  id: string;
  uid: string;
  businessName: string;
  merchantType: 'INDIVIDUAL' | 'BUSINESS';
  verificationLevel: 'BASIC' | 'VERIFIED' | 'PREMIUM' | 'SUSPENDED';
  declaredLiquidityUsdtMicro: number;
  commissionBps: number;
  minOrderInrPaise: number;
  maxOrderInrPaise: number;
  isAvailable: boolean;
  isDemo?: boolean;
  demoMerchantCode?: string;
  profileBio?: string;
  avgCompletionMins?: number;
  disputedOrders?: number;
  replacedByVerifiedAtMs?: number;
  completedOrders: number;
  totalVolumeUsdtMicro: number;
  ratingAvgBps: number;
  vipTier?: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';
  visibilityMode?: 'PUBLIC' | 'HIGH_VOLUME_ONLY' | 'HIDDEN';
  showVipBadge?: boolean;
  agreementAccepted: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DisputeCaseDoc {
  id: string;
  orderId: string;
  orderCode: string;
  raisedByUid: string;
  counterpartyUid: string;
  category:
    | 'PAYMENT_NOT_RECEIVED'
    | 'PAYMENT_NOT_ACKNOWLEDGED'
    | 'INCORRECT_AMOUNT'
    | 'SELLER_NOT_RELEASING'
    | 'BUYER_NOT_PAYING'
    | 'SUSPICIOUS_TRANSACTION'
    | 'DUPLICATE_PAYMENT'
    | 'OTHER';
  description: string;
  paymentRef?: string;
  evidenceSummary?: string;
  evidenceItems?: string[];
  escalatedToCompliance?: boolean;
  escalatedAtMs?: number;
  status: 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_EVIDENCE' | 'ESCALATED' | 'RESOLVED' | 'REJECTED';
  assignedOfficerUid?: string;
  resolutionNote?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RiskAssessmentDoc {
  id: string;
  orderId: string;
  subjectUid: string;
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
  humanDecision: 'PENDING_REVIEW' | 'APPROVED' | 'HELD' | 'ESCALATED' | 'BLOCKED';
  reviewedByUid?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SupportTicketDoc {
  id: string;
  uid?: string;
  name: string;
  email: string;
  category: 'GENERAL' | 'KYC' | 'PAYMENT' | 'ESCROW' | 'DISPUTE' | 'MERCHANT' | 'COMPLIANCE';
  subject: string;
  message: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  assignedAgentUid?: string;
  escalatedToCompliance?: boolean;
  adminReply?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserNotificationDoc {
  id: string;
  uid: string;
  type: 'KYC' | 'ORDER' | 'PAYMENT' | 'ESCROW' | 'DISPUTE' | 'SECURITY' | 'WALLET';
  title: string;
  body: string;
  read: boolean;
  createdAt: Timestamp;
}

export interface AuditLogDoc {
  id: string;
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: Timestamp;
}

export interface ReviewDoc {
  id: string;
  orderId: string;
  authorUid: string;
  authorName: string;
  roleLabel: string;
  rating: number;
  comment: string;
  approved: boolean;
  createdAt: Timestamp;
}

export interface SecuritySessionDoc {
  id: string;
  uid: string;
  deviceLabel: string;
  browser: string;
  os: string;
  timezone: string;
  suspicious: boolean;
  suspiciousReason?: string;
  trusted: boolean;
  revoked: boolean;
  createdAt: Timestamp;
  lastActiveAt: Timestamp;
}

export interface WithdrawalWhitelistDoc {
  id: string;
  uid: string;
  label: string;
  network: BlockchainNetworkId;
  address: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PriceAlertDoc {
  id: string;
  uid: string;
  targetRateInrPaise: number;
  condition: 'ABOVE' | 'BELOW';
  isActive: boolean;
  triggered: boolean;
  lastTriggeredAtMs?: number;
  createdAt: Timestamp;
}

export interface ComplianceCaseDoc {
  id: string;
  subjectUid: string;
  subjectUsername: string;
  caseType:
    | 'VIDEO_KYC_ESCALATION'
    | 'AML_ALERT'
    | 'SUSPICIOUS_LOGIN'
    | 'DUPLICATE_UTR'
    | 'ACCOUNT_RESTRICTION'
    | 'FRAUD_CLUSTER'
    | 'MERCHANT_ANOMALY';
  severity: RiskLevel;
  status: 'OPEN' | 'INVESTIGATING' | 'ESCALATED' | 'CLOSED';
  summary: string;
  assignedOfficerUid?: string;
  resolutionNote?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WalletAddressDoc {
  id: string;
  uid: string;
  network: BlockchainNetworkId;
  address: string;
  label?: string;
  isSandbox: boolean;
  createdAt: Timestamp;
}

export interface SupportedNetworkDoc {
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
  updatedAt: Timestamp;
}

export interface SupportedTokenDoc {
  id: string;
  symbol: 'USDT';
  name: string;
  network: BlockchainNetworkId;
  contractAddress: string;
  decimals: number;
  isActive: boolean;
  updatedAt: Timestamp;
}

export interface DepositTransactionDoc {
  id: string;
  uid: string;
  username?: string;
  network: BlockchainNetworkId;
  tokenSymbol: 'USDT';
  contractAddress: string;
  depositAddress: string;
  txHash: string;
  eventIndex: number;
  amountMicro: number;
  confirmations: number;
  requiredConfirmations: number;
  status: DepositStatus;
  verificationSource: 'TRONGRID_TESTNET' | 'SANDBOX_FAUCET' | 'ONCHAIN_VERIFIED';
  complianceNote?: string;
  reviewedByUid?: string;
  isSandbox: boolean;
  creditedAtMs?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WithdrawalTransactionDoc {
  id: string;
  uid: string;
  username?: string;
  network: BlockchainNetworkId;
  tokenSymbol: 'USDT';
  destinationAddress: string;
  requestedAmountMicro: number;
  networkFeeMicro: number;
  platformFeeMicro: number;
  totalDebitMicro: number;
  netSentMicro: number;
  status: WithdrawalStatus;
  riskScore: number;
  riskLevel: RiskLevel;
  riskReasons: string[];
  twoFactorVerified: boolean;
  idempotencyKey: string;
  txHash?: string;
  reviewedByUid?: string;
  reviewerNote?: string;
  failureReason?: string;
  isSandbox: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BlockchainEventDoc {
  id: string;
  uid: string;
  network: BlockchainNetworkId;
  txHash: string;
  eventIndex: number;
  direction: 'DEPOSIT' | 'WITHDRAWAL';
  contractAddress: string;
  amountMicro: number;
  confirmations: number;
  processedRecordId: string;
  createdAt: Timestamp;
}

export interface WalletLedgerEntryDoc {
  id: string;
  uid: string;
  entryType: WalletLedgerEntryType;
  network: BlockchainNetworkId;
  asset: 'USDT';
  deltaAvailableMicro: number;
  deltaReservedMicro: number;
  balanceBeforeMicro: number;
  balanceAfterMicro: number;
  referenceId: string;
  note: string;
  isSandbox: boolean;
  createdAt: Timestamp;
}

export interface WalletReservationDoc {
  id: string;
  uid: string;
  purpose: 'P2P_ESCROW' | 'WITHDRAWAL_PENDING';
  referenceId: string;
  amountMicro: number;
  status: 'ACTIVE' | 'RELEASED' | 'REFUNDED';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WalletSecuritySettingsDoc {
  id: string;
  newAddressCooldownHours: number;
  manualReviewThresholdUsdtMicro: number;
  dailyWithdrawalLimitUsdtMicro: number;
  require2faForWithdrawals: boolean;
  sandboxFaucetEnabled: boolean;
  updatedAt: Timestamp;
}

export interface WalletAuditLogDoc {
  id: string;
  actorUid: string;
  subjectUid: string;
  action: string;
  targetType:
    | 'DEPOSIT'
    | 'WITHDRAWAL'
    | 'WHITELIST'
    | 'NETWORK'
    | 'SECURITY_POLICY'
    | 'TRADING_ACCESS'
    | 'COIN_GOVERNANCE';
  targetId: string;
  summary: string;
  createdAt: Timestamp;
}

export interface SupportedCoinDoc {
  id: string;
  symbol: CoinSymbol;
  name: string;
  coingeckoId: string;
  iconKey: string;
  accentHex: string;
  description: string;
  decimals: number;
  supportedNetworks: MultiCoinNetworkId[];
  networkContracts: CoinNetworkContract[];
  minTradeQuantityE8: number;
  maxTradeQuantityE8: number;
  minOrderInrPaise: number;
  maxOrderInrPaise: number;
  tradingFeeBps: number;
  confirmationsRequired: number;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  tradingEnabled: boolean;
  custodyApproved: boolean;
  isFeatured: boolean;
  sortOrder: number;
  updatedByUid?: string;
  updatedAt: Timestamp;
}

export interface CoinTradingSettingsDoc {
  id: string;
  symbol: CoinSymbol;
  tradingEnabled: boolean;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  custodyApproved: boolean;
  minTradeQuantityE8: number;
  maxTradeQuantityE8: number;
  tradingFeeBps: number;
  confirmationsRequired: number;
  updatedByUid?: string;
  updatedAt: Timestamp;
}

export interface CoinMarketDataDoc {
  id: string;
  symbol: CoinSymbol;
  coingeckoId: string;
  inrPrice: number;
  usdPrice: number;
  change24hPct: number;
  volume24hInr: number;
  marketCapInr: number;
  high24hInr: number;
  low24hInr: number;
  circulatingSupply: number;
  freshnessStatus: 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';
  updatedAt: Timestamp;
}

export interface CoinPriceHistoryDoc {
  id: string;
  symbol: CoinSymbol;
  interval: string;
  currency: 'INR';
  barCount: number;
  lastCloseInr: number;
  sourceGranularity: string;
  updatedAt: Timestamp;
}

export interface CoinMarketCacheDoc {
  id: string;
  freshnessStatus: 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';
  coinCount: number;
  fetchedAtIso: string;
  updatedAt: Timestamp;
}

export interface CoinWatchlistDoc {
  id: string;
  uid: string;
  symbol: CoinSymbol;
  createdAt: Timestamp;
}

export interface CoinPriceAlertDoc {
  id: string;
  uid: string;
  symbol: CoinSymbol;
  targetInrPaise: number;
  condition: 'ABOVE' | 'BELOW';
  isActive: boolean;
  triggered: boolean;
  lastTriggeredAtMs?: number;
  createdAt: Timestamp;
}

export interface MultiCoinOrderDoc {
  id: string;
  orderId: string;
  orderCode: string;
  symbol: CoinSymbol;
  side: 'BUY' | 'SELL';
  buyerUid: string;
  sellerUid: string;
  quantityE8: number;
  rateInrPaise: number;
  inrPaise: number;
  feeE8: number;
  network: MultiCoinNetworkId;
  status: OrderStatus;
  isSandbox: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PriceLockDoc {
  id: string;
  lockId: string;
  uid: string;
  offerId: string;
  asset: string;
  side: 'BUY' | 'SELL';
  rateInrPaise: number;
  ttlSeconds: number;
  expiresAtMs: number;
  signature: string;
  status: 'LOCKED' | 'CONSUMED' | 'EXPIRED';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SupportMessageDoc {
  id: string;
  ticketId: string;
  senderUid: string;
  senderName: string;
  senderRole: 'USER' | 'SUPPORT' | 'ADMIN';
  body: string;
  createdAt: Timestamp;
}

export interface MerchantApiKeyDoc {
  id: string;
  uid: string;
  keyHash: string;
  keyPrefix: string;
  label: string;
  scopes: string[];
  rateLimitPerMin: number;
  revoked: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MerchantWebhookDoc {
  id: string;
  uid: string;
  url: string;
  events: string[];
  secretMasked: string;
  isActive: boolean;
  lastTestStatus?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MaintenanceWindowDoc {
  id: string;
  title: string;
  description: string;
  affectedServices: string[];
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
  scheduledStartIso: string;
  scheduledEndIso: string;
  createdByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}



