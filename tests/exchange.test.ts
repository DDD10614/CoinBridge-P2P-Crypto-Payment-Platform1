import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBlockchainEventId,
  buildUpiPaymentUri,
  calculateBuyBreakdown,
  calculateSellBreakdown,
  calculateWithdrawalBreakdown,
  computeDeterministicRisk,
  deriveDeterministicDepositAddress,
  evaluateWithdrawalRisk,
  getKycExpiryStatus,
  getKycRestrictionDetails,
  isKycStatusVerified,
  isUserKycEligibleForTrading,
  isValidIfsc,
  isValidOrderTransition,
  isValidPan,
  isValidUpi,
  isValidWalletAddress,
  KycStatus,
  maskAccountNumber,
  maskPan,
  matchBestOffers,
  matchBestOffersScored,
  VIDEO_KYC_CHALLENGES,
  type MatchableOffer,
} from '../src/lib/domain.ts';
import {
  buildOtpAuthUri,
  evaluateLoginContext,
  generateBase32Secret,
  generateTotpToken,
  issueVideoKycChallenge,
  sealTotpSecret,
  unsealTotpSecret,
  verifyTotpToken,
} from '../src/server/security.ts';

test('Decimal-safe Buy USDT breakdown avoids floating-point drift', () => {
  const res = calculateBuyBreakdown({
    inrPaise: 1_000_000, // ₹10,000.00
    rateInrPaise: 9200, // ₹92.00 / USDT
    buyerFeeBps: 25, // 0.25%
    tdsRateBps: 100, // 1.00%
  });
  assert.equal(res.grossUsdtMicro, 108_695_652); // 108.695652 USDT
  assert.equal(res.feeUsdtMicro, 271_739); // 0.271739 USDT
  assert.equal(res.netUsdtMicro, 108_423_913);
  assert.equal(res.tdsInrPaise, 10_000); // ₹100.00
});

test('Decimal-safe Sell USDT breakdown calculates net INR after fee and 1% TDS', () => {
  const res = calculateSellBreakdown({
    usdtMicro: 100_000_000, // 100 USDT
    rateInrPaise: 9200, // ₹92.00
    sellerFeeBps: 25, // 0.25%
    tdsRateBps: 100, // 1.00%
  });
  assert.equal(res.feeUsdtMicro, 250_000);
  assert.equal(res.grossInrPaise, 917_700);
  assert.equal(res.tdsInrPaise, 9_177);
  assert.equal(res.netInrPaise, 908_523);
});

test('Order state machine blocks illegal state shortcuts and terminal mutations', () => {
  assert.equal(isValidOrderTransition('CREATED', 'ACCEPTED'), true);
  assert.equal(isValidOrderTransition('CREATED', 'COMPLETED'), false);
  assert.equal(isValidOrderTransition('PAYMENT_SUBMITTED', 'PAYMENT_VERIFIED'), true);
  assert.equal(isValidOrderTransition('COMPLETED', 'CANCELLED'), false);
  assert.equal(isValidOrderTransition('REFUNDED', 'COMPLETED'), false);
});

test('KYC and Indian banking validators and maskers work accurately', () => {
  assert.equal(isValidPan('ABCDE1234F'), true);
  assert.equal(isValidPan('12345ABCDE'), false);
  assert.equal(maskPan('ABCDE1234F'), 'AB****234F');
  assert.equal(isValidIfsc('HDFC0001234'), true);
  assert.equal(isValidIfsc('HDFC1001234'), false);
  assert.equal(isValidUpi('arjun.mehta@okicici'), true);
  assert.equal(isValidUpi('invalid-upi'), false);
  assert.equal(maskAccountNumber('123456789012'), '•••• 9012');
});

test('Wallet address validation enforces chain-specific rules', () => {
  assert.equal(isValidWalletAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'TRON_TRC20'), true);
  assert.equal(isValidWalletAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7', 'TRON_TRC20'), false);
  assert.equal(isValidWalletAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7', 'ETHEREUM_ERC20'), true);
});

test('Deterministic risk scoring flags unverified high-value accounts for human review', () => {
  const highRisk = computeDeterministicRisk({
    inrPaise: 25_000_000, // ₹2,50,000
    kycStatus: 'NOT_STARTED',
    completedTrades: 0,
    disputedCount: 1,
    cancelledCount: 3,
    newPaymentAccount: true,
  });
  assert.ok(highRisk.score >= 80);
  assert.equal(highRisk.level, 'CRITICAL');
  assert.equal(highRisk.recommendedAction, 'ESCALATE_COMPLIANCE');

  const lowRisk = computeDeterministicRisk({
    inrPaise: 1_000_000, // ₹10,000
    kycStatus: 'APPROVED',
    completedTrades: 14,
    disputedCount: 0,
    cancelledCount: 0,
    newPaymentAccount: false,
  });
  assert.ok(lowRisk.score < 30);
  assert.equal(lowRisk.level, 'LOW');
  assert.equal(lowRisk.recommendedAction, 'ALLOW');
});

test('KYC expiry helper accurately identifies valid, expiring soon, expired, and unset statuses', () => {
  const baseNow = Date.UTC(2026, 0, 1);
  assert.equal(getKycExpiryStatus({ nowMs: baseNow }).status, 'UNSET');
  assert.equal(
    getKycExpiryStatus({ kycExpiresAtMs: baseNow - 1000, nowMs: baseNow }).status,
    'EXPIRED'
  );
  assert.equal(
    getKycExpiryStatus({ kycExpiresAtMs: baseNow + 10 * 86_400_000, nowMs: baseNow }).status,
    'EXPIRING_SOON'
  );
  assert.equal(
    getKycExpiryStatus({ kycExpiresAtMs: baseNow + 120 * 86_400_000, nowMs: baseNow }).status,
    'VALID'
  );
  assert.ok(VIDEO_KYC_CHALLENGES.length >= 3);
});

test('UPI payment URI builder formats amount, payee, and order code cleanly', () => {
  const uri = buildUpiPaymentUri({
    upiId: 'merchant@okaxis',
    payeeName: 'Indus Desk',
    amountInrPaise: 150_050, // ₹1,500.50
    orderCode: 'CB-88412',
  });
  assert.ok(uri.startsWith('upi://pay?'));
  assert.ok(uri.includes('pa=merchant%40okaxis'));
  assert.ok(uri.includes('am=1500.50'));
  assert.ok(uri.includes('cu=INR'));
  assert.ok(uri.includes('CB-88412'));
});

test('Best-match offer engine filters by mode, limits, verification, demo flag, and sorts by best rate', () => {
  const sampleOffers: MatchableOffer[] = [
    {
      id: 'o1',
      side: 'SELL_USDT',
      rateInrPaise: 9220,
      availableUsdtMicro: 500_000_000,
      minInrPaise: 100_000,
      maxInrPaise: 5_000_000,
      paymentMethods: ['UPI'],
      verificationLevel: 'BASIC',
      completionRateBps: 9800,
      isActive: true,
      isDemo: false,
    },
    {
      id: 'o2',
      side: 'SELL_USDT',
      rateInrPaise: 9175,
      availableUsdtMicro: 500_000_000,
      minInrPaise: 100_000,
      maxInrPaise: 5_000_000,
      paymentMethods: ['UPI', 'IMPS'],
      verificationLevel: 'PREMIUM',
      completionRateBps: 9950,
      isActive: true,
      isDemo: true,
    },
    {
      id: 'o3',
      side: 'SELL_USDT',
      rateInrPaise: 9190,
      availableUsdtMicro: 500_000_000,
      minInrPaise: 100_000,
      maxInrPaise: 5_000_000,
      paymentMethods: ['UPI', 'IMPS'],
      verificationLevel: 'VERIFIED',
      completionRateBps: 9900,
      isActive: true,
      isDemo: false,
    },
  ];

  const withDemo = matchBestOffers(sampleOffers, {
    mode: 'buy',
    inrPaise: 1_000_000,
    paymentMethod: 'UPI',
    verifiedOnly: true,
    includeDemo: true,
  });
  assert.deepEqual(
    withDemo.map((o) => o.id),
    ['o2', 'o3']
  );

  const realOnly = matchBestOffers(sampleOffers, {
    mode: 'buy',
    inrPaise: 1_000_000,
    paymentMethod: 'UPI',
    verifiedOnly: true,
    includeDemo: false,
  });
  assert.deepEqual(
    realOnly.map((o) => o.id),
    ['o3']
  );
});

test('RFC 6238 TOTP generation, verification, AES-256-GCM sealing, Video KYC challenge & login risk evaluation', () => {
  const secret = generateBase32Secret();
  assert.ok(secret.length >= 24);

  const now = 1_770_000_000_000;
  const token = generateTotpToken(secret, now);
  assert.match(token, /^\d{6}$/);
  assert.equal(verifyTotpToken(secret, token, now), true);
  assert.equal(verifyTotpToken(secret, '000000', now), token === '000000');

  const uri = buildOtpAuthUri({
    accountName: 'trader@coinbridge.in',
    issuer: 'CoinBridge P2P',
    secret,
  });
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes(`secret=${secret}`));

  const sealed = sealTotpSecret(secret, 'uid_test_123');
  assert.equal(unsealTotpSecret(sealed, 'uid_test_123'), secret);
  assert.equal(unsealTotpSecret(sealed, 'wrong_uid'), null);

  const challenge = issueVideoKycChallenge('uid_test_123');
  assert.match(challenge.digits, /^\d{4}$/);
  assert.ok(challenge.prompt.includes(challenge.digits));

  const cleanLogin = evaluateLoginContext({
    knownDevicesCount: 1,
    isNewDevice: false,
    previousTimezones: ['Asia/Kolkata'],
    currentTimezone: 'Asia/Kolkata',
  });
  assert.equal(cleanLogin.suspicious, false);

  const anomalousLogin = evaluateLoginContext({
    knownDevicesCount: 1,
    isNewDevice: true,
    previousTimezones: ['Asia/Kolkata'],
    currentTimezone: 'Europe/London',
  });
  assert.equal(anomalousLogin.suspicious, true);
  assert.ok(anomalousLogin.suspiciousReason.includes('unrecognized'));
  assert.ok(anomalousLogin.suspiciousReason.includes('Europe/London'));
});

test('Server integration configuration defaults to sandbox-safe values without exposing secrets', async () => {
  const { getIntegrationSummaryStatus, getSupabaseHealth, getTronNetworkName } = await import(
    '../src/server/integrations.ts'
  );
  assert.equal(getTronNetworkName(), 'nile');
  const summary = getIntegrationSummaryStatus(true);
  assert.equal(summary.sandboxMode, true);
  assert.equal(summary.trongrid.network, 'nile');
  assert.equal(typeof summary.marketRateFallbackInr, 'number');

  const supaHealth = (await getSupabaseHealth()) as { mode: string };
  assert.ok(
    ['DEMO_FALLBACK', 'LIVE_CONNECTED', 'CONNECTED_LIMITED', 'ERROR_FALLBACK'].includes(
      supaHealth.mode
    )
  );
});

test('Mandatory KYC trading restriction enforces VERIFIED/APPROVED + ACTIVE + non-expired + unrestricted status', () => {
  const futureMs = Date.UTC(2030, 0, 1);
  const pastMs = Date.UTC(2020, 0, 1);
  const nowMs = Date.UTC(2026, 0, 1);

  assert.equal(isKycStatusVerified('APPROVED'), true);
  assert.equal(isKycStatusVerified('VERIFIED'), true);
  assert.equal(isKycStatusVerified('PENDING'), false);
  assert.equal(isKycStatusVerified('EXPIRED'), false);

  assert.equal(
    isUserKycEligibleForTrading(
      { kycStatus: 'APPROVED', accountStatus: 'ACTIVE', kycExpiresAtMs: futureMs },
      nowMs
    ),
    true
  );
  assert.equal(
    isUserKycEligibleForTrading(
      { kycStatus: 'VERIFIED', accountStatus: 'ACTIVE', kycExpiresAtMs: futureMs },
      nowMs
    ),
    true
  );

  const blockedStatuses: KycStatus[] = [
    'NOT_STARTED',
    'PENDING',
    'UNDER_REVIEW',
    'REJECTED',
    'ADDITIONAL_INFO_REQUIRED',
    'SUSPENDED',
    'EXPIRED',
  ];
  for (const kycStatus of blockedStatuses) {
    assert.equal(
      isUserKycEligibleForTrading({ kycStatus, accountStatus: 'ACTIVE' }, nowMs),
      false,
      `Expected ${kycStatus} to be blocked`
    );
  }

  const expiredByTime = getKycRestrictionDetails(
    { kycStatus: 'APPROVED', accountStatus: 'ACTIVE', kycExpiresAtMs: pastMs },
    nowMs
  );
  assert.equal(expiredByTime.eligible, false);
  assert.equal(expiredByTime.effectiveKycStatus, 'EXPIRED');
  assert.equal(expiredByTime.reasonCode, 'KYC_EXPIRED');

  const complianceRestricted = getKycRestrictionDetails(
    {
      kycStatus: 'VERIFIED',
      accountStatus: 'ACTIVE',
      withdrawalLocked: true,
      restrictedReason: 'Compliance AML hold',
    },
    nowMs
  );
  assert.equal(complianceRestricted.eligible, false);
  assert.equal(complianceRestricted.reasonCode, 'COMPLIANCE_RESTRICTION');

  const suspendedAcct = getKycRestrictionDetails(
    { kycStatus: 'VERIFIED', accountStatus: 'SUSPENDED' },
    nowMs
  );
  assert.equal(suspendedAcct.eligible, false);
  assert.equal(suspendedAcct.reasonCode, 'ACCOUNT_SUSPENDED');
});

test('Crypto wallet deposit address derivation, event idempotency, fee breakdown, and withdrawal risk scoring', () => {
  const tronAddr = deriveDeterministicDepositAddress('user_abc_123', 'TRON_TRC20');
  const tronAddrRepeat = deriveDeterministicDepositAddress('user_abc_123', 'TRON_TRC20');
  assert.equal(tronAddr, tronAddrRepeat);
  assert.equal(isValidWalletAddress(tronAddr, 'TRON_TRC20'), true);

  const polyAddr = deriveDeterministicDepositAddress('user_abc_123', 'POLYGON');
  assert.equal(isValidWalletAddress(polyAddr, 'POLYGON'), true);

  const evtId = buildBlockchainEventId('TRON_TRC20', 'AABBCC112233', 2);
  assert.equal(evtId, 'TRON_TRC20_aabbcc112233_2');

  const breakdown = calculateWithdrawalBreakdown({
    amountMicro: 100_000_000, // 100 USDT
    networkFeeMicro: 1_000_000, // 1 USDT
    platformFeeMicro: 500_000, // 0.50 USDT
  });
  assert.equal(breakdown.totalFeeMicro, 1_500_000);
  assert.equal(breakdown.totalDebitMicro, 101_500_000);
  assert.equal(breakdown.netReceivedMicro, 100_000_000);

  const nowMs = Date.UTC(2026, 5, 1);
  const lowRiskWd = evaluateWithdrawalRisk({
    amountMicro: 50_000_000,
    manualReviewThresholdMicro: 2_500_000_000,
    isWhitelisted: true,
    whitelistCreatedAtMs: nowMs - 48 * 3_600_000,
    newAddressCooldownHours: 24,
    kycStatus: 'VERIFIED',
    completedTrades: 5,
    nowMs,
  });
  assert.equal(lowRiskWd.requiresManualReview, false);

  const cooldownHighRiskWd = evaluateWithdrawalRisk({
    amountMicro: 3_000_000_000, // >= 2,500 USDT threshold
    manualReviewThresholdMicro: 2_500_000_000,
    isWhitelisted: true,
    whitelistCreatedAtMs: nowMs - 2 * 3_600_000, // inside 24h cooldown
    newAddressCooldownHours: 24,
    kycStatus: 'VERIFIED',
    completedTrades: 0,
    nowMs,
  });
  assert.equal(cooldownHighRiskWd.requiresManualReview, true);
  assert.ok(cooldownHighRiskWd.score >= 60);
});

test('Multi-coin registry enables only USDT by default and gates unapproved assets', async () => {
  const {
    calculateMultiCoinBuyBreakdown,
    calculateMultiCoinSellBreakdown,
    DEFAULT_COIN_MAP,
    DEFAULT_SUPPORTED_COINS,
    isValidContractOrNative,
    isValidMultiChainAddress,
  } = await import('../src/lib/coins.ts');

  const expectedSymbols = ['USDT', 'BTC', 'ETH', 'USDC', 'SOL', 'BNB', 'XRP', 'DOGE', 'TRX'];
  assert.equal(DEFAULT_SUPPORTED_COINS.length, 9);
  for (const sym of expectedSymbols) {
    assert.ok(DEFAULT_COIN_MAP[sym], `Expected ${sym} in DEFAULT_COIN_MAP`);
  }

  for (const coin of DEFAULT_SUPPORTED_COINS) {
    if (coin.symbol === 'USDT') {
      assert.equal(coin.tradingEnabled, true);
      assert.equal(coin.custodyApproved, true);
      assert.equal(coin.depositEnabled, true);
      assert.equal(coin.withdrawalEnabled, true);
    } else {
      assert.equal(coin.tradingEnabled, false, `${coin.symbol} tradingEnabled must default false`);
      assert.equal(
        coin.custodyApproved,
        false,
        `${coin.symbol} custodyApproved must default false`
      );
      assert.equal(coin.depositEnabled, false, `${coin.symbol} depositEnabled must default false`);
      assert.equal(
        coin.withdrawalEnabled,
        false,
        `${coin.symbol} withdrawalEnabled must default false`
      );
    }
  }

  // Chain-specific address and contract validation
  assert.equal(
    isValidMultiChainAddress('BITCOIN', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'),
    true
  );
  assert.equal(
    isValidMultiChainAddress('BITCOIN', '0xdAC17F958D2ee523a2206206994597C13D831ec7'),
    false
  );
  assert.equal(
    isValidMultiChainAddress('SOLANA', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    true
  );
  assert.equal(
    isValidMultiChainAddress('XRP_LEDGER', 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh'),
    true
  );
  assert.equal(
    isValidMultiChainAddress('DOGECOIN', 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L'),
    true
  );
  assert.equal(isValidContractOrNative('BITCOIN', 'NATIVE'), true);
  assert.equal(isValidContractOrNative('ETHEREUM_ERC20', 'bad-contract'), false);

  // E8 multi-coin precision math
  const btcBuy = calculateMultiCoinBuyBreakdown({
    inrPaise: 10_000_000, // ₹1,00,000
    rateInrPaise: 500_000_000, // ₹50,00,000 / BTC
    feeBps: 15, // 0.15%
  });
  assert.equal(btcBuy.grossQuantityE8, 2_000_000); // 0.02 BTC
  assert.equal(btcBuy.feeE8, 3_000); // 0.00003 BTC
  assert.equal(btcBuy.netQuantityE8, 1_997_000);

  const ethSell = calculateMultiCoinSellBreakdown({
    quantityE8: 100_000_000, // 1.0 ETH
    rateInrPaise: 25_000_000, // ₹2,50,000 / ETH
    feeBps: 20, // 0.20%
    tdsBps: 100, // 1.00%
  });
  assert.equal(ethSell.feeE8, 200_000);
  assert.equal(ethSell.netQuantityE8, 99_800_000);
  assert.equal(ethSell.grossInrPaise, 24_950_000);
  assert.equal(ethSell.tdsInrPaise, 249_500);
  assert.equal(ethSell.netInrPaise, 24_700_500);
});

test('matchBestOffers isolates per-coin order books strictly by asset', () => {
  const multiCoinOffers: MatchableOffer[] = [
    {
      id: 'btc_1',
      asset: 'BTC',
      side: 'SELL',
      rateInrPaise: 500_000_000,
      availableUsdtMicro: 100_000,
      minInrPaise: 100_000,
      maxInrPaise: 50_000_000,
      paymentMethods: ['UPI'],
      verificationLevel: 'VERIFIED',
      completionRateBps: 9900,
      isActive: true,
      isDemo: false,
    },
    {
      id: 'usdt_1',
      asset: 'USDT',
      side: 'SELL_USDT',
      rateInrPaise: 9150,
      availableUsdtMicro: 500_000_000,
      minInrPaise: 100_000,
      maxInrPaise: 50_000_000,
      paymentMethods: ['UPI'],
      verificationLevel: 'VERIFIED',
      completionRateBps: 9950,
      isActive: true,
      isDemo: false,
    },
  ];

  const btcMatches = matchBestOffers(multiCoinOffers, {
    asset: 'BTC',
    mode: 'buy',
    inrPaise: 1_000_000,
    paymentMethod: 'UPI',
    verifiedOnly: true,
    includeDemo: false,
  });
  assert.deepEqual(
    btcMatches.map((m) => m.id),
    ['btc_1']
  );

  const usdtMatches = matchBestOffers(multiCoinOffers, {
    asset: 'USDT',
    mode: 'buy',
    inrPaise: 1_000_000,
    paymentMethod: 'UPI',
    verifiedOnly: true,
    includeDemo: false,
  });
  assert.deepEqual(
    usdtMatches.map((m) => m.id),
    ['usdt_1']
  );
});

test('Deterministic technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands, OHLC aggregation) compute accurately', async () => {
  const {
    aggregateOhlcBars,
    calculateBollingerBands,
    calculateEMA,
    calculateMACD,
    calculateRSI,
    calculateSMA,
  } = await import('../src/lib/technicalAnalysis.ts');

  const bars = Array.from({ length: 45 }, (_, idx) => {
    const close = 100 + idx * 2 + (idx % 3 === 0 ? 1 : -0.5);
    return {
      time: 1_770_000_000 + idx * 300,
      open: close - 0.5,
      high: close + 1.5,
      low: close - 1.5,
      close,
      volume: 1000 + idx * 25,
    };
  });

  const sma20 = calculateSMA(bars, 20);
  assert.equal(sma20.length, bars.length - 19);
  const expectedFirstSma =
    bars.slice(0, 20).reduce((acc, b) => acc + b.close, 0) / 20;
  assert.ok(Math.abs(sma20[0].value - expectedFirstSma) < 1e-5);

  const ema9 = calculateEMA(bars, 9);
  assert.equal(ema9.length, bars.length - 8);
  assert.ok(ema9[ema9.length - 1].value > ema9[0].value);

  const rsi14 = calculateRSI(bars, 14);
  assert.equal(rsi14.length, bars.length - 14);
  assert.ok(rsi14.every((pt) => pt.value >= 0 && pt.value <= 100));
  assert.ok(rsi14[rsi14.length - 1].value > 60); // consistent uptrend

  const macd = calculateMACD(bars, 12, 26, 9);
  assert.ok(macd.length > 0);
  assert.ok(Number.isFinite(macd[macd.length - 1].macd));
  assert.ok(Number.isFinite(macd[macd.length - 1].signal));

  const bb = calculateBollingerBands(bars, 20, 2);
  assert.equal(bb.length, bars.length - 19);
  assert.ok(bb[0].upper > bb[0].middle && bb[0].middle > bb[0].lower);

  const hourly = aggregateOhlcBars(bars, 3600);
  assert.ok(hourly.length > 0 && hourly.length < bars.length);
  for (const h of hourly) {
    assert.ok(h.high >= h.open && h.high >= h.close && h.high >= h.low);
    assert.ok(h.low <= h.open && h.low <= h.close);
  }
});

test('Smart P2P matchBestOffersScored ranks verified, liquid, fast desks above slow or basic desks', () => {
  const offers: MatchableOffer[] = [
    {
      id: 'slow_demo',
      asset: 'USDT',
      side: 'SELL_USDT',
      rateInrPaise: 9180,
      availableUsdtMicro: 200_000_000, // 200 USDT
      minInrPaise: 100_000,
      maxInrPaise: 10_000_000,
      paymentMethods: ['UPI'],
      verificationLevel: 'BASIC',
      completionRateBps: 8500,
      avgCompletionMins: 25,
      merchantRatingBps: 400,
      isActive: true,
      isDemo: true,
    },
    {
      id: 'prime_verified',
      asset: 'USDT',
      side: 'SELL_USDT',
      rateInrPaise: 9190,
      availableUsdtMicro: 5_000_000_000, // 5,000 USDT
      minInrPaise: 100_000,
      maxInrPaise: 25_000_000,
      paymentMethods: ['UPI', 'IMPS', 'NEFT'],
      verificationLevel: 'PREMIUM',
      completionRateBps: 9950,
      avgCompletionMins: 4,
      merchantRatingBps: 495,
      isActive: true,
      isDemo: false,
    },
    {
      id: 'expensive_outlier',
      asset: 'USDT',
      side: 'SELL_USDT',
      rateInrPaise: 9450,
      availableUsdtMicro: 300_000_000,
      minInrPaise: 100_000,
      maxInrPaise: 10_000_000,
      paymentMethods: ['UPI'],
      verificationLevel: 'BASIC',
      completionRateBps: 9000,
      avgCompletionMins: 20,
      merchantRatingBps: 420,
      isActive: true,
      isDemo: true,
    },
  ];

  const scored = matchBestOffersScored(offers, {
    mode: 'buy',
    asset: 'USDT',
    inrPaise: 1_000_000, // ₹10,000
    paymentMethod: 'UPI',
    verifiedOnly: false,
    includeDemo: true,
  });

  assert.equal(scored.length, 3);
  assert.equal(scored[0].offer.id, 'prime_verified');
  assert.ok(scored[0].matchScore > scored[1].matchScore);
  assert.ok(scored[0].reasons.length > 0);
});

test('Merchant VIP Program evaluates tiers accurately and strictly separates DEMO from KYB verification', async () => {
  const { evaluateMerchantVipProgram } = await import('../src/lib/merchantVip.ts');

  const bronze = evaluateMerchantVipProgram({
    completedOrders: 3,
    totalVolumeUsdtMicro: 500_000_000,
    disputedOrders: 0,
    verificationLevel: 'BASIC',
    isDemo: false,
  });
  assert.equal(bronze.tier, 'BRONZE');
  assert.equal(bronze.verificationSummary.isGenuineVerified, false);

  const gold = evaluateMerchantVipProgram({
    completedOrders: 80,
    totalVolumeUsdtMicro: 65_000 * 1_000_000,
    disputedOrders: 1,
    verificationLevel: 'VERIFIED',
    isDemo: false,
  });
  assert.equal(gold.tier, 'GOLD');
  assert.equal(gold.verificationSummary.isGenuineVerified, true);
  assert.equal(gold.verificationSummary.kycKybStatus, 'VERIFIED');

  const demoHighVol = evaluateMerchantVipProgram({
    completedOrders: 300,
    totalVolumeUsdtMicro: 300_000 * 1_000_000,
    disputedOrders: 0,
    verificationLevel: 'PREMIUM',
    isDemo: true,
  });
  assert.equal(demoHighVol.tier, 'PLATINUM');
  assert.equal(demoHighVol.verificationSummary.kycKybStatus, 'DEMO_SIMULATION');
  assert.equal(demoHighVol.verificationSummary.isGenuineVerified, false);
});

test('Portfolio analytics, Sec 194S/115BBH tax report, and liquidity depth calculate accurately', async () => {
  const {
    computeExchangeLiquidityStats,
    computePortfolioAnalytics,
    computeTaxAndComplianceReport,
  } = await import('../src/lib/portfolioAndTax.ts');

  const orders = [
    {
      id: 'ord_buy_1',
      orderCode: 'CB-101',
      offerId: 'off_1',
      asset: 'USDT',
      side: 'BUY_USDT',
      buyerUid: 'u1',
      buyerUsername: 'arjun',
      sellerUid: 'm1',
      sellerUsername: 'indusdesk',
      paymentMethod: 'UPI',
      inrPaise: 900_000, // ₹9,000 for 100 USDT @ ₹90
      rateInrPaise: 9_000,
      usdtMicro: 100_000_000,
      feeUsdtMicro: 0,
      tdsInrPaise: 9_000, // ₹90 (1%)
      status: 'COMPLETED',
      riskScore: 10,
      riskLevel: 'LOW',
      escrowReleased: true,
      completedAtMs: 1_770_000_000_000,
    },
    {
      id: 'ord_sell_1',
      orderCode: 'CB-102',
      offerId: 'off_2',
      asset: 'USDT',
      side: 'SELL_USDT',
      buyerUid: 'm2',
      buyerUsername: 'mumbai',
      sellerUid: 'u1',
      sellerUsername: 'arjun',
      paymentMethod: 'IMPS',
      inrPaise: 475_000, // ₹4,750 for 50 USDT @ ₹95 -> cost basis ₹4,500, realized gain +₹250
      rateInrPaise: 9_500,
      usdtMicro: 50_000_000,
      feeUsdtMicro: 0,
      tdsInrPaise: 4_750, // ₹47.50
      status: 'COMPLETED',
      riskScore: 10,
      riskLevel: 'LOW',
      escrowReleased: true,
      completedAtMs: 1_770_086_400_000,
    },
  ] as any[];

  const quotes = {
    USDT: {
      symbol: 'USDT',
      name: 'Tether',
      coingeckoId: 'tether',
      inrPrice: 92,
      change24hPct: 0.1,
      high24hInr: 92.5,
      low24hInr: 91.5,
      volume24hInr: 1e9,
      marketCapInr: 1e11,
      freshnessStatus: 'LIVE',
    },
  };

  const portfolio = computePortfolioAnalytics({
    uid: 'u1',
    orders,
    deposits: [],
    withdrawals: [],
    walletLedger: null,
    marketQuotes: quotes,
    fallbackUsdtInr: 91.85,
  });

  assert.equal(portfolio.holdings.length, 1);
  assert.equal(portfolio.holdings[0].quantity, 50);
  assert.equal(portfolio.totalValueInr, 4600);
  assert.equal(portfolio.totalCostBasisInr, 4500);
  assert.equal(portfolio.totalRealizedPnlInr, 250);
  assert.equal(portfolio.totalUnrealizedPnlInr, 100);
  assert.equal(portfolio.totalTdsPaidInr, 137.5);

  const tax = computeTaxAndComplianceReport({
    uid: 'u1',
    orders,
    deposits: [],
    withdrawals: [],
    portfolio,
  });
  assert.equal(tax.buyOrderCount, 1);
  assert.equal(tax.sellOrderCount, 1);
  assert.equal(tax.totalSection194STdsInr, 137.5);
  assert.equal(tax.estimatedVdaTax30PctInr, 75); // 30% of ₹250 realized gain

  const liq = computeExchangeLiquidityStats({
    offers: [
      {
        id: 'o_sell',
        asset: 'USDT',
        side: 'SELL_USDT',
        rateInrPaise: 9250,
        availableUsdtMicro: 1_000_000_000,
        minInrPaise: 100_000,
        maxInrPaise: 5_000_000,
        paymentMethods: ['UPI'],
        isActive: true,
        isDemo: false,
      } as any,
      {
        id: 'o_buy',
        asset: 'USDT',
        side: 'BUY_USDT',
        rateInrPaise: 9150,
        availableUsdtMicro: 500_000_000,
        minInrPaise: 100_000,
        maxInrPaise: 5_000_000,
        paymentMethods: ['IMPS'],
        isActive: true,
        isDemo: true,
      } as any,
    ],
    orders,
    merchants: [],
    marketQuotes: quotes,
  });
  assert.equal(liq.totalActiveOffers, 2);
  assert.ok(liq.totalSellLiquidityInr > liq.totalBuyLiquidityInr);
  assert.equal(liq.coinBreakdown[0].symbol, 'USDT');
});

test('Market intelligence volatility & wallet risk screening detect uptrends, illicit patterns, and velocity', async () => {
  const { computeCoinVolatilityMetrics } = await import('../src/server/intelligence.ts');
  const { screenWalletAddressRisk } = await import('../src/server/fraud.ts');

  const bars = Array.from({ length: 24 }, (_, idx) => ({
    time: 1_770_000_000 + idx * 3600,
    open: 100 + idx * 1.5,
    high: 102 + idx * 1.5,
    low: 99 + idx * 1.5,
    close: 101 + idx * 1.5,
    volume: 5000,
  }));

  const snap = computeCoinVolatilityMetrics(
    {
      symbol: 'SOL',
      name: 'Solana',
      coingeckoId: 'solana',
      inrPrice: 135.5,
      usdPrice: 1.6,
      change24hPct: 6.4,
      high24hInr: 137,
      low24hInr: 126,
      volume24hInr: 1e8,
      marketCapInr: 1e10,
      circulatingSupply: 4e8,
      lastUpdatedAt: null,
      isAvailable: true,
    },
    bars
  );
  assert.equal(snap.trendSignal, 'UPTREND');
  assert.ok((snap.annualizedVolatilityPct ?? 0) > 0);
  assert.ok((snap.range24hPct ?? 0) > 5);

  const cleanTron = screenWalletAddressRisk({
    address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    network: 'TRON_TRC20',
    amountUsdt: 250,
    recentWithdrawals24h: 1,
  });
  assert.equal(cleanTron.validFormat, true);
  assert.equal(cleanTron.recommendation, 'ALLOW');

  const sanctionedErc = screenWalletAddressRisk({
    address: '0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c',
    network: 'ETHEREUM_ERC20',
    amountUsdt: 15_000,
    recentWithdrawals24h: 5,
  });
  assert.equal(sanctionedErc.recommendation, 'BLOCK');
  assert.ok(sanctionedErc.riskScore >= 90);
});

test('Merchant API keys enforce auth, rate limits, revocation, and SSRF-safe HTTPS webhooks', async () => {
  const {
    authenticateMerchantApiKey,
    generateMerchantApiKeyBundle,
    revokeMerchantApiKeyInRegistry,
    signWebhookPayload,
    validateWebhookUrlSafe,
  } = await import('../src/server/merchantApi.ts');

  const bundle = generateMerchantApiKeyBundle({
    merchantUid: 'merchant_test_1',
    label: 'Unit Test Desk Key',
    scopes: ['offers:read', 'orders:read'],
    rateLimitPerMin: 10,
    isSandbox: true,
  });
  assert.ok(bundle.rawKey.startsWith('cb_test_'));

  const okAuth = authenticateMerchantApiKey(bundle.rawKey, '/api/v1/merchant/offers');
  assert.equal(okAuth.ok, true);
  assert.equal(okAuth.status, 200);

  // Trigger rate limit (10 req/min min clamp -> 11th request must return 429)
  let hit429 = false;
  for (let i = 0; i < 12; i++) {
    const res = authenticateMerchantApiKey(bundle.rawKey, '/api/v1/merchant/offers');
    if (res.status === 429) hit429 = true;
  }
  assert.equal(hit429, true);

  revokeMerchantApiKeyInRegistry(bundle.keyHash);
  const revokedRes = authenticateMerchantApiKey(bundle.rawKey, '/api/v1/merchant/offers');
  assert.equal(revokedRes.ok, false);
  assert.equal(revokedRes.status, 403);

  assert.equal(validateWebhookUrlSafe('https://api.example-desk.com/webhooks/cb').valid, true);
  assert.equal(validateWebhookUrlSafe('http://api.example-desk.com/webhooks/cb').valid, false);
  assert.equal(validateWebhookUrlSafe('https://localhost:3000/hook').valid, false);
  assert.equal(validateWebhookUrlSafe('https://127.0.0.1/hook').valid, false);
  assert.equal(validateWebhookUrlSafe('https://169.254.169.254/latest/meta-data').valid, false);
  assert.equal(validateWebhookUrlSafe('https://10.0.0.5/internal').valid, false);

  const sig = signWebhookPayload('whsec_test', '{"hello":"world"}', 1_770_000_000);
  assert.match(sig, /^t=1770000000,v1=[a-f0-9]{64}$/);
});

