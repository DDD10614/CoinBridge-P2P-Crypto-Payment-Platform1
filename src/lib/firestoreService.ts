import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  BLOCKCHAIN_NETWORKS,
  BlockchainNetworkConfig,
  BlockchainNetworkId,
  buildBlockchainEventId,
  DEFAULT_PLATFORM_SETTINGS,
  DEFAULT_WALLET_SECURITY_POLICY,
  DepositStatus,
  deriveDeterministicDepositAddress,
  KycStatus,
  OrderStatus,
  PaymentMethodType,
  PlatformSettings,
  RiskLevel,
  UserRole,
  WalletLedgerEntryType,
  WalletSecurityPolicy,
  WithdrawalStatus,
} from './domain';
import { handleFirestoreError, OperationType } from './firestoreError';

export async function logAuditEvent(params: {
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}) {
  try {
    await addDoc(collection(db, 'audit_logs'), {
      ...params,
      summary: params.summary.slice(0, 400),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'audit_logs');
  }
}

export async function logWalletAuditEvent(params: {
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
}) {
  try {
    await addDoc(collection(db, 'wallet_audit_logs'), {
      actorUid: params.actorUid,
      subjectUid: params.subjectUid,
      action: params.action.slice(0, 80),
      targetType: params.targetType,
      targetId: params.targetId.slice(0, 128),
      summary: params.summary.slice(0, 400),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'wallet_audit_logs');
  }
}

export async function logDeniedTradingAttempt(params: {
  uid: string;
  action: string;
  kycStatus: KycStatus;
  reasonCode: string;
  reasonMessage: string;
}) {
  try {
    const summary = `Blocked ${params.action} — KYC=${params.kycStatus} (${params.reasonCode}): ${params.reasonMessage}`;
    await Promise.all([
      logAuditEvent({
        actorUid: params.uid,
        action: 'TRADING_ACTION_BLOCKED_KYC',
        targetType: 'user_kyc_gate',
        targetId: params.uid,
        summary,
      }),
      logWalletAuditEvent({
        actorUid: params.uid,
        subjectUid: params.uid,
        action: 'TRADING_ACTION_BLOCKED_KYC',
        targetType: 'TRADING_ACCESS',
        targetId: params.action,
        summary,
      }),
    ]);
  } catch {
    // Do not throw if audit logging fails while already blocking user
  }
}

export async function createUserNotification(params: {
  uid: string;
  type: 'KYC' | 'ORDER' | 'PAYMENT' | 'ESCROW' | 'DISPUTE' | 'SECURITY' | 'WALLET';
  title: string;
  body: string;
}) {
  try {
    await addDoc(collection(db, 'notifications'), {
      uid: params.uid,
      type: params.type,
      title: params.title.slice(0, 120),
      body: params.body.slice(0, 400),
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'notifications');
  }
}

export async function createP2POffer(params: {
  merchantUid: string;
  merchantUsername: string;
  verificationLevel: 'BASIC' | 'VERIFIED' | 'PREMIUM';
  side: 'SELL_USDT' | 'BUY_USDT' | 'SELL' | 'BUY';
  asset?: string;
  rateInrPaise: number;
  availableUsdtMicro: number;
  availableAssetE8?: number;
  minInrPaise: number;
  maxInrPaise: number;
  paymentMethods: PaymentMethodType[];
  network: string;
  avgCompletionMins: number;
  termsNote?: string;
  isSandbox: boolean;
}) {
  const assetSym = (params.asset || 'USDT').trim().toUpperCase();
  const availE8 =
    typeof params.availableAssetE8 === 'number'
      ? Math.round(params.availableAssetE8)
      : Math.round(params.availableUsdtMicro * 100);
  try {
    const docRef = await addDoc(collection(db, 'p2p_offers'), {
      merchantUid: params.merchantUid,
      merchantUsername: params.merchantUsername.slice(0, 40),
      verificationLevel: params.verificationLevel,
      side: params.side,
      asset: assetSym,
      fiatCurrency: 'INR',
      rateInrPaise: Math.round(params.rateInrPaise),
      availableUsdtMicro: Math.max(1, Math.round(params.availableUsdtMicro)),
      availableAssetE8: Math.max(1, availE8),
      minInrPaise: Math.round(params.minInrPaise),
      maxInrPaise: Math.round(params.maxInrPaise),
      paymentMethods: params.paymentMethods.slice(0, 5),
      network: params.network,
      avgCompletionMins: Math.min(240, Math.max(5, Math.round(params.avgCompletionMins))),
      completedTrades: 0,
      completionRateBps: 10000,
      ...(params.termsNote ? { termsNote: params.termsNote.slice(0, 400) } : {}),
      isActive: true,
      isSandbox: params.isSandbox,
      isDemo: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.merchantUid,
      action: 'OFFER_CREATED',
      targetType: 'p2p_offer',
      targetId: docRef.id,
      summary: `Published ${assetSym} ${params.side} offer at ₹${(params.rateInrPaise / 100).toFixed(2)}`,
    });
    return docRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'p2p_offers');
  }
}

export async function toggleOfferActive(offerId: string, isActive: boolean, actorUid: string) {
  try {
    await updateDoc(doc(db, 'p2p_offers', offerId), {
      isActive,
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid,
      action: isActive ? 'OFFER_ACTIVATED' : 'OFFER_PAUSED',
      targetType: 'p2p_offer',
      targetId: offerId,
      summary: `Offer ${offerId} set active=${isActive}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `p2p_offers/${offerId}`);
  }
}

export async function createP2POrder(params: {
  offerId: string;
  side: 'BUY_USDT' | 'SELL_USDT' | 'BUY' | 'SELL';
  asset?: string;
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
  network: string;
  buyerWalletAddress?: string;
  sellerWalletAddress?: string;
  riskScore: number;
  riskLevel: RiskLevel;
  riskReasons: string[];
  recommendedAction:
    | 'ALLOW'
    | 'REQUEST_ADDITIONAL_VERIFICATION'
    | 'APPLY_LIMITS'
    | 'HOLD_MANUAL_REVIEW'
    | 'ESCALATE_COMPLIANCE'
    | 'BLOCK';
  isSandbox: boolean;
  actorUid: string;
}) {
  const orderCode = `CB${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const expiresAtMs = Date.now() + 30 * 60 * 1000; // 30-minute payment window
  const assetSym = (params.asset || 'USDT').trim().toUpperCase();
  const qtyE8 =
    typeof params.quantityE8 === 'number' && params.quantityE8 > 0
      ? Math.round(params.quantityE8)
      : Math.max(1, Math.round(params.usdtMicro * 100));
  const feeE8 =
    typeof params.feeE8 === 'number'
      ? Math.round(params.feeE8)
      : Math.max(0, Math.round(params.feeUsdtMicro * 100));
  const normalizedSide: 'BUY' | 'SELL' =
    params.side === 'BUY_USDT' || params.side === 'BUY' ? 'BUY' : 'SELL';

  try {
    const orderRef = await addDoc(collection(db, 'p2p_orders'), {
      orderCode,
      offerId: params.offerId,
      side: params.side,
      asset: assetSym,
      buyerUid: params.buyerUid,
      sellerUid: params.sellerUid,
      buyerUsername: params.buyerUsername.slice(0, 40),
      sellerUsername: params.sellerUsername.slice(0, 40),
      usdtMicro: Math.max(1, Math.round(params.usdtMicro)),
      quantityE8: qtyE8,
      inrPaise: Math.round(params.inrPaise),
      rateInrPaise: Math.round(params.rateInrPaise),
      feeUsdtMicro: Math.max(0, Math.round(params.feeUsdtMicro)),
      feeE8,
      tdsInrPaise: Math.round(params.tdsInrPaise),
      paymentMethod: params.paymentMethod,
      network: params.network,
      ...(params.buyerWalletAddress ? { buyerWalletAddress: params.buyerWalletAddress } : {}),
      ...(params.sellerWalletAddress ? { sellerWalletAddress: params.sellerWalletAddress } : {}),
      escrowStatus: 'NONE',
      paymentMode: 'SANDBOX',
      riskScore: Math.round(params.riskScore),
      riskLevel: params.riskLevel,
      status: 'AWAITING_ACCEPTANCE',
      isSandbox: params.isSandbox,
      expiresAtMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'multi_coin_orders', orderRef.id), {
      orderId: orderRef.id,
      orderCode,
      symbol: assetSym,
      side: normalizedSide,
      buyerUid: params.buyerUid,
      sellerUid: params.sellerUid,
      quantityE8: qtyE8,
      rateInrPaise: Math.round(params.rateInrPaise),
      inrPaise: Math.round(params.inrPaise),
      feeE8,
      network: params.network,
      status: 'AWAITING_ACCEPTANCE',
      isSandbox: params.isSandbox,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, 'p2p_orders', orderRef.id, 'events'), {
      orderId: orderRef.id,
      actorUid: params.actorUid,
      action: 'ORDER_CREATED',
      fromStatus: 'NONE',
      toStatus: 'AWAITING_ACCEPTANCE',
      note: `Order ${orderCode} initialized (${assetSym} ${normalizedSide}) via ${params.paymentMethod}.`,
      createdAt: serverTimestamp(),
    });

    await addDoc(collection(db, 'risk_assessments'), {
      orderId: orderRef.id,
      subjectUid: params.actorUid,
      score: Math.round(params.riskScore),
      level: params.riskLevel,
      reasons: params.riskReasons.slice(0, 8),
      recommendedAction: params.recommendedAction,
      humanDecision: params.riskScore >= 60 ? 'PENDING_REVIEW' : 'APPROVED',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await createUserNotification({
      uid: params.actorUid,
      type: 'ORDER',
      title: `Order ${orderCode} (${assetSym}) Created`,
      body: `Created ${normalizedSide === 'BUY' ? 'Buy' : 'Sell'} ${assetSym} order for ₹${(params.inrPaise / 100).toLocaleString('en-IN')}.`,
    });

    await logAuditEvent({
      actorUid: params.actorUid,
      action: 'ORDER_CREATED',
      targetType: 'p2p_order',
      targetId: orderRef.id,
      summary: `Order ${orderCode} (${assetSym}) created (${params.riskLevel} risk score ${params.riskScore}/100)`,
    });

    return { id: orderRef.id, orderCode };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'p2p_orders');
  }
}

export async function transitionOrderStatus(params: {
  orderId: string;
  actorUid: string;
  action: string;
  nextStatus: OrderStatus;
  escrowStatus?: 'NONE' | 'RESERVED' | 'RELEASED' | 'REFUNDED';
  escrowTxHash?: string;
  paymentRef?: string;
  paymentAccountSnapshot?: string;
  releaseConfirmed2FA?: boolean;
  note: string;
}) {
  const orderRef = doc(db, 'p2p_orders', params.orderId);
  try {
    let prevStatus = '';
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists()) {
        throw new Error('Order not found.');
      }
      const data = snap.data();
      prevStatus = data.status;

      const patch: Record<string, unknown> = {
        status: params.nextStatus,
        updatedAt: serverTimestamp(),
      };
      if (params.escrowStatus) patch.escrowStatus = params.escrowStatus;
      if (params.escrowTxHash) patch.escrowTxHash = params.escrowTxHash.slice(0, 128);
      if (params.paymentRef) patch.paymentRef = params.paymentRef.slice(0, 128);
      if (params.paymentAccountSnapshot) {
        patch.paymentAccountSnapshot = params.paymentAccountSnapshot.slice(0, 240);
      }
      if (typeof params.releaseConfirmed2FA === 'boolean') {
        patch.releaseConfirmed2FA = params.releaseConfirmed2FA;
      }
      if (params.nextStatus === 'COMPLETED') {
        patch.completedAtMs = Date.now();
      }

      tx.update(orderRef, patch);
    });

    try {
      const multiRef = doc(db, 'multi_coin_orders', params.orderId);
      const multiSnap = await getDoc(multiRef);
      if (multiSnap.exists()) {
        await updateDoc(multiRef, {
          status: params.nextStatus,
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Optional multi-coin mirror sync
    }

    await addDoc(collection(db, 'p2p_orders', params.orderId, 'events'), {
      orderId: params.orderId,
      actorUid: params.actorUid,
      action: params.action,
      fromStatus: prevStatus,
      toStatus: params.nextStatus,
      note: params.note.slice(0, 400),
      createdAt: serverTimestamp(),
    });

    await logAuditEvent({
      actorUid: params.actorUid,
      action: params.action,
      targetType: 'p2p_order',
      targetId: params.orderId,
      summary: `${prevStatus} -> ${params.nextStatus}: ${params.note}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `p2p_orders/${params.orderId}`);
  }
}

export async function sendOrderMessage(params: {
  orderId: string;
  senderUid: string;
  senderUsername: string;
  senderRole: 'BUYER' | 'SELLER' | 'ADMIN';
  body: string;
}) {
  try {
    await addDoc(collection(db, 'p2p_orders', params.orderId, 'messages'), {
      orderId: params.orderId,
      senderUid: params.senderUid,
      senderUsername: params.senderUsername.slice(0, 40),
      senderRole: params.senderRole,
      body: params.body.trim().slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `p2p_orders/${params.orderId}/messages`);
  }
}

export async function recordPaymentReconciliation(params: {
  uid: string;
  orderId: string;
  orderCode: string;
  method: PaymentMethodType;
  referenceId: string;
  inrPaise: number;
  status: 'PENDING' | 'VERIFIED' | 'DUPLICATE_FLAGGED' | 'FAILED';
  isSandbox: boolean;
  reconciliationNote: string;
}) {
  try {
    await addDoc(collection(db, 'payment_records'), {
      uid: params.uid,
      orderId: params.orderId,
      orderCode: params.orderCode.slice(0, 32),
      method: params.method,
      referenceId: params.referenceId.trim().toUpperCase().slice(0, 48),
      inrPaise: Math.round(params.inrPaise),
      status: params.status,
      isSandbox: params.isSandbox,
      reconciliationNote: params.reconciliationNote.slice(0, 300),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'payment_records');
  }
}

export async function submitOrderRating(params: {
  orderId: string;
  buyerUid: string;
  authorName: string;
  rating: number;
  comment: string;
}) {
  try {
    await updateDoc(doc(db, 'p2p_orders', params.orderId), {
      buyerRating: Math.min(5, Math.max(1, Math.round(params.rating))),
      updatedAt: serverTimestamp(),
    });
    if (params.comment.trim().length >= 10) {
      await addDoc(collection(db, 'reviews'), {
        orderId: params.orderId,
        authorUid: params.buyerUid,
        authorName: params.authorName.slice(0, 60),
        roleLabel: 'Verified P2P Trader',
        rating: Math.min(5, Math.max(1, Math.round(params.rating))),
        comment: params.comment.trim().slice(0, 400),
        approved: false,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `p2p_orders/${params.orderId}`);
  }
}

export async function submitKycApplication(params: {
  uid: string;
  existingId?: string;
  existingHistory?: string[];
  fullLegalName: string;
  dateOfBirth: string;
  country: string;
  residentialAddress: string;
  idType: 'PAN' | 'PASSPORT' | 'AADHAAR_MASKED' | 'DRIVING_LICENSE';
  maskedIdNumber: string;
  panMasked?: string;
  documentExpiry?: string;
  livenessMethod?: 'SANDBOX_LIVENESS' | 'PROVIDER_API' | 'VIDEO_KYC_ADAPTER';
  videoStatus?: 'NOT_STARTED' | 'CHALLENGE_ISSUED' | 'LIVENESS_PASSED' | 'MANUAL_REVIEW';
  videoChallengePrompt?: string;
  livenessScore?: number;
  faceMatchScore?: number;
  providerMode?: string;
  bankAccountLast4: string;
  bankIfsc: string;
  accountHolderName: string;
  pepDeclared: boolean;
  sanctionsDeclaredClear: boolean;
  sourceOfFunds: string;
}) {
  try {
    const historyEntry = `${new Date().toISOString().slice(0, 16)} — Submitted Video KYC (${params.idType}, liveness=${params.livenessScore ?? 'N/A'}%)`;
    const nextHistory = [...(params.existingHistory || []), historyEntry].slice(-15);

    const payload = {
      uid: params.uid,
      fullLegalName: params.fullLegalName.trim().slice(0, 120),
      dateOfBirth: params.dateOfBirth.trim().slice(0, 20),
      country: params.country.trim().slice(0, 64),
      residentialAddress: params.residentialAddress.trim().slice(0, 300),
      idType: params.idType,
      maskedIdNumber: params.maskedIdNumber.trim().slice(0, 32),
      ...(params.panMasked ? { panMasked: params.panMasked.trim().slice(0, 16) } : {}),
      ...(params.documentExpiry ? { documentExpiry: params.documentExpiry.trim().slice(0, 20) } : {}),
      livenessMethod: params.livenessMethod || 'VIDEO_KYC_ADAPTER',
      ...(params.videoStatus ? { videoStatus: params.videoStatus } : {}),
      ...(params.videoChallengePrompt
        ? { videoChallengePrompt: params.videoChallengePrompt.slice(0, 240) }
        : {}),
      ...(typeof params.livenessScore === 'number'
        ? { livenessScore: Math.min(100, Math.max(0, Math.round(params.livenessScore))) }
        : {}),
      ...(typeof params.faceMatchScore === 'number'
        ? { faceMatchScore: Math.min(100, Math.max(0, Math.round(params.faceMatchScore))) }
        : {}),
      ...(params.providerMode ? { providerMode: params.providerMode.slice(0, 64) } : {}),
      verificationHistory: nextHistory,
      isDemoRecord: false,
      bankAccountLast4: params.bankAccountLast4.trim().slice(-4),
      bankIfsc: params.bankIfsc.trim().toUpperCase().slice(0, 11),
      accountHolderName: params.accountHolderName.trim().slice(0, 120),
      pepDeclared: params.pepDeclared,
      sanctionsDeclaredClear: params.sanctionsDeclaredClear,
      sourceOfFunds: params.sourceOfFunds.trim().slice(0, 120),
      status: 'PENDING',
      updatedAt: serverTimestamp(),
    };

    if (params.existingId) {
      await updateDoc(doc(db, 'kyc_submissions', params.existingId), payload);
    } else {
      await addDoc(collection(db, 'kyc_submissions'), {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }

    await createUserNotification({
      uid: params.uid,
      type: 'KYC',
      title: 'Video KYC Submission Received',
      body: 'Your identity, liveness challenge, and bank dossier are queued for compliance review.',
    });

    await logAuditEvent({
      actorUid: params.uid,
      action: 'KYC_SUBMITTED',
      targetType: 'kyc_submission',
      targetId: params.uid,
      summary: `Video KYC submitted (${params.idType}, IFSC ${params.bankIfsc})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'kyc_submissions');
  }
}

export async function addPaymentAccount(params: {
  uid: string;
  methodType: PaymentMethodType;
  accountHolderName: string;
  bankName?: string;
  maskedAccountNumber?: string;
  ifsc?: string;
  upiId?: string;
}) {
  try {
    const docRef = await addDoc(collection(db, 'payment_accounts'), {
      uid: params.uid,
      methodType: params.methodType,
      accountHolderName: params.accountHolderName.trim().slice(0, 120),
      ...(params.bankName ? { bankName: params.bankName.trim().slice(0, 100) } : {}),
      ...(params.maskedAccountNumber
        ? { maskedAccountNumber: params.maskedAccountNumber.trim().slice(0, 32) }
        : {}),
      ...(params.ifsc ? { ifsc: params.ifsc.trim().toUpperCase().slice(0, 11) } : {}),
      ...(params.upiId ? { upiId: params.upiId.trim().slice(0, 80) } : {}),
      verificationStatus: 'PENDING',
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'payment_accounts');
  }
}

export async function deletePaymentAccount(accountId: string) {
  try {
    await deleteDoc(doc(db, 'payment_accounts', accountId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `payment_accounts/${accountId}`);
  }
}

export async function verifyPaymentAccountAdmin(params: {
  accountId: string;
  verificationStatus: 'VERIFIED' | 'REJECTED';
  adminUid: string;
}) {
  try {
    await updateDoc(doc(db, 'payment_accounts', params.accountId), {
      verificationStatus: params.verificationStatus,
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.adminUid,
      action: 'PAYMENT_ACCOUNT_VERIFIED',
      targetType: 'payment_account',
      targetId: params.accountId,
      summary: `Payment account ${params.accountId} marked ${params.verificationStatus}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `payment_accounts/${params.accountId}`);
  }
}

export async function recordWalletTransaction(params: {
  uid: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'ESCROW_LOCK' | 'ESCROW_RELEASE' | 'ESCROW_REFUND';
  network: BlockchainNetworkId;
  amountMicro: number;
  networkFeeMicro: number;
  txHash?: string;
  toAddress?: string;
  isSandbox: boolean;
}) {
  const walletRef = doc(db, 'wallets', params.uid);
  const amt = Math.round(params.amountMicro);
  const fee = Math.round(params.networkFeeMicro);
  const ledgerRef = doc(collection(db, 'wallet_ledger'));
  const txDocRef = doc(collection(db, 'wallet_transactions'));

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(walletRef);
      const currentAvail = snap.exists() ? (snap.data().availableUsdtMicro as number) : 0;
      const currentRes = snap.exists() ? (snap.data().reservedUsdtMicro as number) : 0;

      let nextAvail = currentAvail;
      let nextRes = currentRes;
      let entryType: WalletLedgerEntryType = 'P2P_ESCROW_LOCK';

      if (params.type === 'DEPOSIT') {
        nextAvail += amt;
        entryType = 'DEPOSIT_CREDIT';
      } else if (params.type === 'WITHDRAWAL') {
        const totalOut = amt + fee;
        if (currentAvail < totalOut) {
          throw new Error('Insufficient available USDT balance for withdrawal and network fee.');
        }
        nextAvail -= totalOut;
        entryType = 'WITHDRAWAL_SETTLE';
      } else if (params.type === 'ESCROW_LOCK') {
        if (currentAvail < amt) {
          throw new Error('Insufficient available USDT balance to lock in escrow.');
        }
        nextAvail -= amt;
        nextRes += amt;
        entryType = 'P2P_ESCROW_LOCK';
      } else if (params.type === 'ESCROW_RELEASE') {
        nextRes = Math.max(0, currentRes - amt);
        entryType = 'P2P_ESCROW_RELEASE';
      } else if (params.type === 'ESCROW_REFUND') {
        const refund = Math.min(currentRes, amt);
        nextRes -= refund;
        nextAvail += refund;
        entryType = 'P2P_ESCROW_REFUND';
      }

      tx.set(
        walletRef,
        {
          uid: params.uid,
          availableUsdtMicro: nextAvail,
          reservedUsdtMicro: nextRes,
          preferredNetwork: params.network,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(txDocRef, {
        uid: params.uid,
        type: params.type,
        network: params.network,
        asset: 'USDT',
        amountMicro: amt,
        networkFeeMicro: fee,
        ...(params.txHash ? { txHash: params.txHash.slice(0, 128) } : {}),
        ...(params.toAddress ? { toAddress: params.toAddress.slice(0, 128) } : {}),
        isSandbox: params.isSandbox,
        status: 'CONFIRMED',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(ledgerRef, {
        uid: params.uid,
        entryType,
        network: params.network,
        asset: 'USDT',
        deltaAvailableMicro: nextAvail - currentAvail,
        deltaReservedMicro: nextRes - currentRes,
        balanceBeforeMicro: currentAvail + currentRes,
        balanceAfterMicro: nextAvail + nextRes,
        referenceId: params.txHash || txDocRef.id,
        note: `${params.type.replace(/_/g, ' ')} on ${params.network}`,
        isSandbox: params.isSandbox,
        createdAt: serverTimestamp(),
      });

      if (params.type === 'ESCROW_LOCK') {
        const resRef = doc(db, 'wallet_reservations', txDocRef.id);
        tx.set(resRef, {
          uid: params.uid,
          purpose: 'P2P_ESCROW',
          referenceId: params.txHash || txDocRef.id,
          amountMicro: amt,
          status: 'ACTIVE',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'wallet_transactions');
  }
}

export async function connectWalletAddress(uid: string, address: string, network: BlockchainNetworkId) {
  try {
    await updateDoc(doc(db, 'users', uid), {
      walletAddress: address,
      updatedAt: serverTimestamp(),
    });
    await setDoc(
      doc(db, 'wallets', uid),
      {
        uid,
        connectedAddress: address,
        preferredNetwork: network,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `wallets/${uid}`);
  }
}

export async function registerMerchantProfile(params: {
  uid: string;
  businessName: string;
  merchantType: 'INDIVIDUAL' | 'BUSINESS';
  declaredLiquidityUsdtMicro: number;
  minOrderInrPaise: number;
  maxOrderInrPaise: number;
  commissionBps: number;
}) {
  try {
    await setDoc(doc(db, 'merchants', params.uid), {
      uid: params.uid,
      businessName: params.businessName.trim().slice(0, 100),
      merchantType: params.merchantType,
      verificationLevel: 'BASIC',
      declaredLiquidityUsdtMicro: Math.round(params.declaredLiquidityUsdtMicro),
      commissionBps: Math.round(params.commissionBps),
      minOrderInrPaise: Math.round(params.minOrderInrPaise),
      maxOrderInrPaise: Math.round(params.maxOrderInrPaise),
      isAvailable: true,
      isDemo: false,
      completedOrders: 0,
      totalVolumeUsdtMicro: 0,
      ratingAvgBps: 500,
      agreementAccepted: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'users', params.uid), {
      role: 'MERCHANT',
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.uid,
      action: 'MERCHANT_REGISTERED',
      targetType: 'merchant',
      targetId: params.uid,
      summary: `Registered merchant ${params.businessName}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `merchants/${params.uid}`);
  }
}

export async function createDisputeCase(params: {
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
}) {
  try {
    const ref = await addDoc(collection(db, 'disputes'), {
      orderId: params.orderId,
      orderCode: params.orderCode,
      raisedByUid: params.raisedByUid,
      counterpartyUid: params.counterpartyUid,
      category: params.category,
      description: params.description.trim().slice(0, 1000),
      ...(params.paymentRef ? { paymentRef: params.paymentRef.trim().slice(0, 128) } : {}),
      ...(params.evidenceSummary
        ? { evidenceSummary: params.evidenceSummary.trim().slice(0, 600) }
        : {}),
      status: 'OPEN',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await transitionOrderStatus({
      orderId: params.orderId,
      actorUid: params.raisedByUid,
      action: 'DISPUTE_OPENED',
      nextStatus: 'DISPUTED',
      note: `Dispute opened (${params.category}): ${params.description.slice(0, 180)}`,
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'disputes');
  }
}

export async function createSupportTicket(params: {
  uid?: string;
  name: string;
  email: string;
  category: 'GENERAL' | 'KYC' | 'PAYMENT' | 'ESCROW' | 'DISPUTE' | 'MERCHANT' | 'COMPLIANCE';
  subject: string;
  message: string;
}) {
  try {
    const ref = await addDoc(collection(db, 'support_tickets'), {
      ...(params.uid ? { uid: params.uid } : {}),
      name: params.name.trim().slice(0, 100),
      email: params.email.trim().slice(0, 160),
      category: params.category,
      subject: params.subject.trim().slice(0, 160),
      message: params.message.trim().slice(0, 2000),
      status: 'OPEN',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'support_tickets');
  }
}

// --- Security Sessions, 2FA, Withdrawal Whitelist, Price Alerts ---
export async function recordLoginSession(params: {
  sessionId: string;
  uid: string;
  deviceLabel: string;
  browser: string;
  os: string;
  timezone: string;
  suspicious: boolean;
  suspiciousReason?: string;
}) {
  const sessionRef = doc(db, 'security_sessions', params.sessionId);
  try {
    const existing = await getDoc(sessionRef);
    if (existing.exists()) {
      await updateDoc(sessionRef, {
        lastActiveAt: serverTimestamp(),
        ...(params.suspicious
          ? {
              suspicious: true,
              ...(params.suspiciousReason
                ? { suspiciousReason: params.suspiciousReason.slice(0, 240) }
                : {}),
            }
          : {}),
      });
    } else {
      await setDoc(sessionRef, {
        uid: params.uid,
        deviceLabel: params.deviceLabel.slice(0, 120),
        browser: params.browser.slice(0, 64),
        os: params.os.slice(0, 64),
        timezone: params.timezone.slice(0, 64),
        suspicious: params.suspicious,
        ...(params.suspiciousReason
          ? { suspiciousReason: params.suspiciousReason.slice(0, 240) }
          : {}),
        trusted: !params.suspicious,
        revoked: false,
        createdAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
      });
    }
    if (params.suspicious) {
      await createUserNotification({
        uid: params.uid,
        type: 'SECURITY',
        title: 'New Device or Timezone Sign-In',
        body: params.suspiciousReason || 'Unrecognized login environment flagged for review.',
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `security_sessions/${params.sessionId}`);
  }
}

export async function updateSecuritySession(params: {
  sessionId: string;
  trusted?: boolean;
  revoked?: boolean;
}) {
  try {
    await updateDoc(doc(db, 'security_sessions', params.sessionId), {
      ...(typeof params.trusted === 'boolean' ? { trusted: params.trusted } : {}),
      ...(typeof params.revoked === 'boolean' ? { revoked: params.revoked } : {}),
      ...(params.trusted ? { suspicious: false } : {}),
      lastActiveAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `security_sessions/${params.sessionId}`);
  }
}

export async function saveTotpEnrollment(params: {
  uid: string;
  enabled: boolean;
  sealedSecret?: string;
}) {
  try {
    await updateDoc(doc(db, 'users', params.uid, 'private', 'profile'), {
      twoFactorEnabled: params.enabled,
      twoFactorMethod: params.enabled ? 'TOTP' : 'NONE',
      ...(params.sealedSecret ? { totpSealedSecret: params.sealedSecret } : {}),
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.uid,
      action: params.enabled ? 'TOTP_2FA_ENABLED' : 'TOTP_2FA_DISABLED',
      targetType: 'user_security',
      targetId: params.uid,
      summary: `TOTP 2FA set enabled=${params.enabled}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${params.uid}/private/profile`);
  }
}

export async function saveWhitelistOnlySetting(uid: string, whitelistOnly: boolean) {
  try {
    await updateDoc(doc(db, 'users', uid, 'private', 'profile'), {
      whitelistOnlyWithdrawals: whitelistOnly,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/private/profile`);
  }
}

export async function toggleUserWithdrawalLock(params: {
  uid: string;
  locked: boolean;
  reason?: string;
  actorUid: string;
}) {
  try {
    await updateDoc(doc(db, 'users', params.uid), {
      withdrawalLocked: params.locked,
      ...(params.reason ? { restrictedReason: params.reason.slice(0, 300) } : {}),
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.actorUid,
      action: params.locked ? 'WITHDRAWAL_LOCKED' : 'WITHDRAWAL_UNLOCKED',
      targetType: 'user',
      targetId: params.uid,
      summary: `Withdrawal lock=${params.locked}${params.reason ? ` (${params.reason})` : ''}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${params.uid}`);
  }
}

export async function addWithdrawalWhitelistAddress(params: {
  uid: string;
  label: string;
  network: BlockchainNetworkId;
  address: string;
}) {
  try {
    const ref = await addDoc(collection(db, 'withdrawal_whitelist'), {
      uid: params.uid,
      label: params.label.trim().slice(0, 80),
      network: params.network,
      address: params.address.trim().slice(0, 128),
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.uid,
      action: 'WHITELIST_ADDRESS_ADDED',
      targetType: 'withdrawal_whitelist',
      targetId: ref.id,
      summary: `Whitelisted ${params.network} address ${params.address.slice(0, 12)}...`,
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'withdrawal_whitelist');
  }
}

export async function removeWithdrawalWhitelistAddress(entryId: string) {
  try {
    await deleteDoc(doc(db, 'withdrawal_whitelist', entryId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `withdrawal_whitelist/${entryId}`);
  }
}

export async function createPriceAlert(params: {
  uid: string;
  targetRateInrPaise: number;
  condition: 'ABOVE' | 'BELOW';
}) {
  try {
    const ref = await addDoc(collection(db, 'price_alerts'), {
      uid: params.uid,
      targetRateInrPaise: Math.round(params.targetRateInrPaise),
      condition: params.condition,
      isActive: true,
      triggered: false,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'price_alerts');
  }
}

export async function markPriceAlertTriggered(alertId: string) {
  try {
    await updateDoc(doc(db, 'price_alerts', alertId), {
      triggered: true,
      lastTriggeredAtMs: Date.now(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `price_alerts/${alertId}`);
  }
}

export async function deletePriceAlert(alertId: string) {
  try {
    await deleteDoc(doc(db, 'price_alerts', alertId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `price_alerts/${alertId}`);
  }
}

// --- Admin & Compliance Functions ---
export async function savePlatformSettingsAdmin(settings: PlatformSettings, adminUid: string) {
  try {
    await setDoc(doc(db, 'platform_settings', 'default'), {
      ...settings,
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: adminUid,
      action: 'SETTINGS_UPDATED',
      targetType: 'platform_settings',
      targetId: 'default',
      summary: `Updated fees/limits (buyer=${settings.buyerFeeBps}bps, seller=${settings.sellerFeeBps}bps, tds=${settings.tdsRateBps}bps)`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'platform_settings/default');
  }
}

export async function reviewKycAdmin(params: {
  submissionId: string;
  targetUid: string;
  decision: KycStatus;
  reviewerNote: string;
  existingHistory?: string[];
  adminUid: string;
}) {
  try {
    const entry = `${new Date().toISOString().slice(0, 16)} — Compliance review: ${params.decision} (${params.reviewerNote.slice(0, 80)})`;
    const nextHistory = [...(params.existingHistory || []), entry].slice(-15);
    const isVerifiedDecision = params.decision === 'APPROVED' || params.decision === 'VERIFIED';
    const kycExpiresAtMs = isVerifiedDecision
      ? Date.now() + 365 * 24 * 60 * 60 * 1000
      : params.decision === 'EXPIRED'
        ? Date.now() - 1000
        : undefined;

    await updateDoc(doc(db, 'kyc_submissions', params.submissionId), {
      status: params.decision,
      reviewerNote: params.reviewerNote.trim().slice(0, 500),
      reviewedByUid: params.adminUid,
      verificationHistory: nextHistory,
      ...(typeof kycExpiresAtMs === 'number' ? { kycExpiresAtMs } : {}),
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'users', params.targetUid), {
      kycStatus: params.decision,
      ...(typeof kycExpiresAtMs === 'number' ? { kycExpiresAtMs } : {}),
      updatedAt: serverTimestamp(),
    });

    const notifTitle = isVerifiedDecision
      ? 'KYC Approved — Trading Access Unlocked'
      : params.decision === 'REJECTED'
        ? 'KYC Verification Rejected'
        : params.decision === 'EXPIRED'
          ? 'KYC Verification Expired'
          : `KYC Status Updated: ${params.decision.replace(/_/g, ' ')}`;

    const notifBody = isVerifiedDecision
      ? 'Your identity and Video KYC have been approved. You can now buy/sell USDT, post P2P offers, and withdraw USDT.'
      : params.reviewerNote || `Your KYC verification status is now ${params.decision.replace(/_/g, ' ')}.`;

    await createUserNotification({
      uid: params.targetUid,
      type: 'KYC',
      title: notifTitle,
      body: notifBody,
    });
    await logAuditEvent({
      actorUid: params.adminUid,
      action: 'KYC_REVIEWED',
      targetType: 'kyc_submission',
      targetId: params.submissionId,
      summary: `Set KYC status=${params.decision} for ${params.targetUid}`,
    });
    await logWalletAuditEvent({
      actorUid: params.adminUid,
      subjectUid: params.targetUid,
      action: 'KYC_REVIEWED',
      targetType: 'TRADING_ACCESS',
      targetId: params.submissionId,
      summary: `Compliance officer set KYC=${params.decision} (${params.reviewerNote.slice(0, 120)})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `kyc_submissions/${params.submissionId}`);
  }
}

export async function updateUserRoleOrStatusAdmin(params: {
  targetUid: string;
  role?: UserRole;
  accountStatus?: 'ACTIVE' | 'SUSPENDED' | 'DELETION_REQUESTED';
  withdrawalLocked?: boolean;
  restrictedReason?: string;
  adminUid: string;
}) {
  try {
    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (params.role) patch.role = params.role;
    if (params.accountStatus) patch.accountStatus = params.accountStatus;
    if (typeof params.withdrawalLocked === 'boolean') patch.withdrawalLocked = params.withdrawalLocked;
    if (typeof params.restrictedReason === 'string') {
      patch.restrictedReason = params.restrictedReason.slice(0, 300);
    }
    await updateDoc(doc(db, 'users', params.targetUid), patch);

    if (params.role) {
      const staffAdminRoles: UserRole[] = [
        'ADMIN',
        'SUPER_ADMIN',
        'COMPLIANCE_OFFICER',
        'TREASURY_ADMIN',
      ];
      if (staffAdminRoles.includes(params.role)) {
        await setDoc(doc(db, 'admins', params.targetUid), {
          uid: params.targetUid,
          role: params.role,
          updatedAt: serverTimestamp(),
        });
      }
    }

    await logAuditEvent({
      actorUid: params.adminUid,
      action: 'USER_ADMIN_UPDATED',
      targetType: 'user',
      targetId: params.targetUid,
      summary: `Updated user ${params.targetUid} (${JSON.stringify({ role: params.role, status: params.accountStatus, withdrawalLocked: params.withdrawalLocked })})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${params.targetUid}`);
  }
}

export async function createComplianceCaseAdmin(params: {
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
  summary: string;
  adminUid: string;
}) {
  try {
    const ref = await addDoc(collection(db, 'compliance_cases'), {
      subjectUid: params.subjectUid,
      subjectUsername: params.subjectUsername.slice(0, 40),
      caseType: params.caseType,
      severity: params.severity,
      status: 'OPEN',
      summary: params.summary.trim().slice(0, 600),
      assignedOfficerUid: params.adminUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.adminUid,
      action: 'COMPLIANCE_CASE_CREATED',
      targetType: 'compliance_case',
      targetId: ref.id,
      summary: `${params.caseType} (${params.severity}) opened for ${params.subjectUsername}`,
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'compliance_cases');
  }
}

export async function updateComplianceCaseAdmin(params: {
  caseId: string;
  status: 'OPEN' | 'INVESTIGATING' | 'ESCALATED' | 'CLOSED';
  resolutionNote: string;
  adminUid: string;
}) {
  try {
    await updateDoc(doc(db, 'compliance_cases', params.caseId), {
      status: params.status,
      assignedOfficerUid: params.adminUid,
      resolutionNote: params.resolutionNote.trim().slice(0, 600),
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.adminUid,
      action: 'COMPLIANCE_CASE_UPDATED',
      targetType: 'compliance_case',
      targetId: params.caseId,
      summary: `Compliance case ${params.caseId} set status=${params.status}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `compliance_cases/${params.caseId}`);
  }
}

const DEMO_MERCHANT_FIXTURES = [
  {
    docId: 'demo_merchant_1',
    uid: 'demo_merchant_1',
    demoMerchantCode: 'DEMO-IN-01',
    username: 'demo_indus_desk',
    businessName: 'DEMO · Indus Digital Liquidity',
    merchantType: 'BUSINESS' as const,
    verificationLevel: 'PREMIUM' as const,
    declaredLiquidityUsdtMicro: 45_000_000_000,
    commissionBps: 15,
    minOrderInrPaise: 100_000,
    maxOrderInrPaise: 25_000_000,
    completedOrders: 1420,
    totalVolumeUsdtMicro: 890_000_000_000,
    ratingAvgBps: 492,
    avgCompletionMins: 6,
    disputedOrders: 2,
    profileBio:
      'Fictional DEMO merchant profile for marketplace preview. Simulated sandbox desk—not genuinely KYB/KYC verified.',
    offers: [
      {
        offerId: 'demo_offer_1',
        side: 'SELL_USDT' as const,
        rateInrPaise: 9175,
        availableUsdtMicro: 25_000_000_000,
        minInrPaise: 100_000,
        maxInrPaise: 25_000_000,
        paymentMethods: ['UPI', 'IMPS', 'NEFT'] as PaymentMethodType[],
        network: 'TRON_TRC20' as BlockchainNetworkId,
        completionRateBps: 9940,
      },
      {
        offerId: 'demo_offer_2',
        side: 'BUY_USDT' as const,
        rateInrPaise: 9150,
        availableUsdtMicro: 20_000_000_000,
        minInrPaise: 200_000,
        maxInrPaise: 30_000_000,
        paymentMethods: ['IMPS', 'NEFT', 'RTGS'] as PaymentMethodType[],
        network: 'TRON_TRC20' as BlockchainNetworkId,
        completionRateBps: 9940,
      },
    ],
  },
  {
    docId: 'demo_merchant_2',
    uid: 'demo_merchant_2',
    demoMerchantCode: 'DEMO-IN-02',
    username: 'demo_kaveri_fx',
    businessName: 'DEMO · Kaveri Settlement Desk',
    merchantType: 'BUSINESS' as const,
    verificationLevel: 'VERIFIED' as const,
    declaredLiquidityUsdtMicro: 30_000_000_000,
    commissionBps: 15,
    minOrderInrPaise: 250_000,
    maxOrderInrPaise: 50_000_000,
    completedOrders: 865,
    totalVolumeUsdtMicro: 510_000_000_000,
    ratingAvgBps: 486,
    avgCompletionMins: 9,
    disputedOrders: 3,
    profileBio:
      'Fictional DEMO merchant desk showcasing IMPS/NEFT/RTGS limits and multi-chain Polygon quotes.',
    offers: [
      {
        offerId: 'demo_offer_3',
        side: 'SELL_USDT' as const,
        rateInrPaise: 9190,
        availableUsdtMicro: 18_000_000_000,
        minInrPaise: 250_000,
        maxInrPaise: 50_000_000,
        paymentMethods: ['IMPS', 'RTGS', 'BANK_TRANSFER'] as PaymentMethodType[],
        network: 'POLYGON' as BlockchainNetworkId,
        completionRateBps: 9880,
      },
      {
        offerId: 'demo_offer_4',
        side: 'BUY_USDT' as const,
        rateInrPaise: 9135,
        availableUsdtMicro: 12_000_000_000,
        minInrPaise: 150_000,
        maxInrPaise: 25_000_000,
        paymentMethods: ['UPI', 'IMPS'] as PaymentMethodType[],
        network: 'POLYGON' as BlockchainNetworkId,
        completionRateBps: 9880,
      },
    ],
  },
  {
    docId: 'demo_merchant_3',
    uid: 'demo_merchant_3',
    demoMerchantCode: 'DEMO-IN-03',
    username: 'demo_metro_upi',
    businessName: 'DEMO · Metro Quick UPI',
    merchantType: 'INDIVIDUAL' as const,
    verificationLevel: 'VERIFIED' as const,
    declaredLiquidityUsdtMicro: 15_000_000_000,
    commissionBps: 20,
    minOrderInrPaise: 100_000,
    maxOrderInrPaise: 10_000_000,
    completedOrders: 512,
    totalVolumeUsdtMicro: 195_000_000_000,
    ratingAvgBps: 478,
    avgCompletionMins: 5,
    disputedOrders: 1,
    profileBio:
      'Fictional DEMO UPI desk for smaller retail tickets (₹1,000 – ₹1,00,000). Clearly labeled demo fixture.',
    offers: [
      {
        offerId: 'demo_offer_5',
        side: 'SELL_USDT' as const,
        rateInrPaise: 9205,
        availableUsdtMicro: 15_000_000_000,
        minInrPaise: 100_000,
        maxInrPaise: 10_000_000,
        paymentMethods: ['UPI'] as PaymentMethodType[],
        network: 'BSC' as BlockchainNetworkId,
        completionRateBps: 9820,
      },
      {
        offerId: 'demo_offer_6',
        side: 'BUY_USDT' as const,
        rateInrPaise: 9120,
        availableUsdtMicro: 10_000_000_000,
        minInrPaise: 100_000,
        maxInrPaise: 15_000_000,
        paymentMethods: ['UPI', 'NEFT'] as PaymentMethodType[],
        network: 'ETHEREUM_ERC20' as BlockchainNetworkId,
        completionRateBps: 9820,
      },
    ],
  },
];

export async function seedSandboxMarketplaceAdmin(adminUid: string, _adminUsername: string) {
  try {
    const existingSettings = await getDoc(doc(db, 'platform_settings', 'default'));
    if (!existingSettings.exists()) {
      await setDoc(doc(db, 'platform_settings', 'default'), {
        ...DEFAULT_PLATFORM_SETTINGS,
        updatedAt: serverTimestamp(),
      });
    }

    for (const fixture of DEMO_MERCHANT_FIXTURES) {
      await setDoc(doc(db, 'merchants', fixture.docId), {
        uid: fixture.uid,
        businessName: fixture.businessName,
        merchantType: fixture.merchantType,
        verificationLevel: fixture.verificationLevel,
        declaredLiquidityUsdtMicro: fixture.declaredLiquidityUsdtMicro,
        commissionBps: fixture.commissionBps,
        minOrderInrPaise: fixture.minOrderInrPaise,
        maxOrderInrPaise: fixture.maxOrderInrPaise,
        isAvailable: true,
        isDemo: true,
        demoMerchantCode: fixture.demoMerchantCode,
        profileBio: fixture.profileBio,
        avgCompletionMins: fixture.avgCompletionMins,
        disputedOrders: fixture.disputedOrders,
        completedOrders: fixture.completedOrders,
        totalVolumeUsdtMicro: fixture.totalVolumeUsdtMicro,
        ratingAvgBps: fixture.ratingAvgBps,
        agreementAccepted: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (const off of fixture.offers) {
        await setDoc(doc(db, 'p2p_offers', off.offerId), {
          merchantUid: fixture.uid,
          merchantUsername: fixture.username,
          verificationLevel: fixture.verificationLevel,
          side: off.side,
          asset: 'USDT',
          fiatCurrency: 'INR',
          rateInrPaise: off.rateInrPaise,
          availableUsdtMicro: off.availableUsdtMicro,
          minInrPaise: off.minInrPaise,
          maxInrPaise: off.maxInrPaise,
          paymentMethods: off.paymentMethods,
          network: off.network,
          avgCompletionMins: fixture.avgCompletionMins,
          completedTrades: fixture.completedOrders,
          completionRateBps: off.completionRateBps,
          merchantRatingBps: fixture.ratingAvgBps,
          merchantVolumeUsdtMicro: fixture.totalVolumeUsdtMicro,
          termsNote:
            'DEMO offer only. Simulated counterparty quote—not backed by genuine KYC/KYB or real INR settlement.',
          isActive: true,
          isSandbox: true,
          isDemo: true,
          demoLabel: 'DEMO',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    await logAuditEvent({
      actorUid: adminUid,
      action: 'DEMO_MERCHANTS_SEEDED',
      targetType: 'marketplace',
      targetId: 'demo_fixtures',
      summary: `Seeded ${DEMO_MERCHANT_FIXTURES.length} clearly labeled DEMO merchants and 6 marketplace demo offers`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'p2p_offers');
  }
}

export async function replaceDemoMerchantsWithVerifiedAdmin(adminUid: string) {
  try {
    const demoOffersSnap = await getDocs(
      query(collection(db, 'p2p_offers'), where('isDemo', '==', true))
    );
    for (const d of demoOffersSnap.docs) {
      await updateDoc(doc(db, 'p2p_offers', d.id), {
        isActive: false,
        updatedAt: serverTimestamp(),
      });
    }

    const demoMerchantsSnap = await getDocs(
      query(collection(db, 'merchants'), where('isDemo', '==', true))
    );
    const nowMs = Date.now();
    for (const d of demoMerchantsSnap.docs) {
      await updateDoc(doc(db, 'merchants', d.id), {
        isAvailable: false,
        replacedByVerifiedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      });
    }

    await logAuditEvent({
      actorUid: adminUid,
      action: 'DEMO_MERCHANTS_REPLACED',
      targetType: 'marketplace',
      targetId: 'demo_fixtures',
      summary: `Deactivated ${demoOffersSnap.size} demo offers and ${demoMerchantsSnap.size} demo merchant desks in favor of verified KYB merchants.`,
    });
    return { deactivatedOffers: demoOffersSnap.size, deactivatedMerchants: demoMerchantsSnap.size };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'merchants');
  }
}

export async function runSchemaMigrationAdmin(adminUid: string) {
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    let updatedUsers = 0;
    for (const d of usersSnap.docs) {
      const data = d.data();
      if (typeof data.isDemo !== 'boolean' || typeof data.withdrawalLocked !== 'boolean') {
        await updateDoc(doc(db, 'users', d.id), {
          ...(typeof data.isDemo !== 'boolean' ? { isDemo: false } : {}),
          ...(typeof data.withdrawalLocked !== 'boolean' ? { withdrawalLocked: false } : {}),
          updatedAt: serverTimestamp(),
        });
        updatedUsers += 1;
      }
    }
    await logAuditEvent({
      actorUid: adminUid,
      action: 'SCHEMA_MIGRATION_EXECUTED',
      targetType: 'database',
      targetId: 'users',
      summary: `Idempotent migration backfilled defaults on ${updatedUsers} user record(s).`,
    });
    return { updatedUsers };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'users');
  }
}

// --- Crypto Wallet Deposits, Withdrawals, Addresses & Treasury Admin ---
export async function ensureUserDepositAddress(params: {
  uid: string;
  network: BlockchainNetworkId;
  isSandbox: boolean;
}): Promise<string> {
  const docId = `${params.uid}_${params.network}`;
  const address = deriveDeterministicDepositAddress(params.uid, params.network);
  const addrRef = doc(db, 'wallet_addresses', docId);
  try {
    const existing = await getDoc(addrRef);
    if (!existing.exists()) {
      await setDoc(addrRef, {
        uid: params.uid,
        network: params.network,
        address,
        label: `${params.network} USDT Deposit`,
        isSandbox: params.isSandbox,
        createdAt: serverTimestamp(),
      });
    }
    return existing.exists() ? String(existing.data().address || address) : address;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `wallet_addresses/${docId}`);
    return address;
  }
}

export async function recordDepositTransaction(params: {
  uid: string;
  username?: string;
  network: BlockchainNetworkId;
  contractAddress: string;
  depositAddress: string;
  txHash: string;
  eventIndex: number;
  amountMicro: number;
  confirmations: number;
  requiredConfirmations: number;
  status: DepositStatus;
  verificationSource: 'TRONGRID_TESTNET' | 'SANDBOX_FAUCET' | 'ONCHAIN_VERIFIED';
  isSandbox: boolean;
}) {
  const eventId = buildBlockchainEventId(params.network, params.txHash, params.eventIndex);
  const eventRef = doc(db, 'blockchain_events', eventId);
  const depositRef = doc(db, 'deposit_transactions', eventId);
  const walletRef = doc(db, 'wallets', params.uid);
  const amt = Math.round(params.amountMicro);

  try {
    await runTransaction(db, async (tx) => {
      const existingEvent = await tx.get(eventRef);
      if (existingEvent.exists()) {
        throw new Error(`Duplicate deposit blocked: transaction ${eventId} has already been processed.`);
      }
      const walletSnap = await tx.get(walletRef);
      const currentAvail = walletSnap.exists() ? Number(walletSnap.data().availableUsdtMicro || 0) : 0;
      const currentRes = walletSnap.exists() ? Number(walletSnap.data().reservedUsdtMicro || 0) : 0;

      tx.set(eventRef, {
        uid: params.uid,
        network: params.network,
        txHash: params.txHash.slice(0, 128),
        eventIndex: Math.max(0, Math.round(params.eventIndex)),
        direction: 'DEPOSIT',
        contractAddress: params.contractAddress.slice(0, 128),
        amountMicro: amt,
        confirmations: Math.max(0, Math.round(params.confirmations)),
        processedRecordId: eventId,
        createdAt: serverTimestamp(),
      });

      tx.set(depositRef, {
        uid: params.uid,
        ...(params.username ? { username: params.username.slice(0, 40) } : {}),
        network: params.network,
        tokenSymbol: 'USDT',
        contractAddress: params.contractAddress.slice(0, 128),
        depositAddress: params.depositAddress.slice(0, 128),
        txHash: params.txHash.slice(0, 128),
        eventIndex: Math.max(0, Math.round(params.eventIndex)),
        amountMicro: amt,
        confirmations: Math.max(0, Math.round(params.confirmations)),
        requiredConfirmations: Math.max(1, Math.round(params.requiredConfirmations)),
        status: params.status,
        verificationSource: params.verificationSource,
        isSandbox: params.isSandbox,
        ...(params.status === 'CREDITED' ? { creditedAtMs: Date.now() } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (params.status === 'CREDITED') {
        const nextAvail = currentAvail + amt;
        tx.set(
          walletRef,
          {
            uid: params.uid,
            availableUsdtMicro: nextAvail,
            reservedUsdtMicro: currentRes,
            preferredNetwork: params.network,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        const ledgerRef = doc(collection(db, 'wallet_ledger'));
        tx.set(ledgerRef, {
          uid: params.uid,
          entryType: 'DEPOSIT_CREDIT',
          network: params.network,
          asset: 'USDT',
          deltaAvailableMicro: amt,
          deltaReservedMicro: 0,
          balanceBeforeMicro: currentAvail + currentRes,
          balanceAfterMicro: nextAvail + currentRes,
          referenceId: eventId,
          note: `${params.isSandbox ? '[SANDBOX] ' : ''}USDT deposit credited (${params.txHash.slice(0, 12)}...)`,
          isSandbox: params.isSandbox,
          createdAt: serverTimestamp(),
        });

        const legacyTxRef = doc(collection(db, 'wallet_transactions'));
        tx.set(legacyTxRef, {
          uid: params.uid,
          type: 'DEPOSIT',
          network: params.network,
          asset: 'USDT',
          amountMicro: amt,
          networkFeeMicro: 0,
          txHash: params.txHash.slice(0, 128),
          toAddress: params.depositAddress.slice(0, 128),
          isSandbox: params.isSandbox,
          status: 'CONFIRMED',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });

    await createUserNotification({
      uid: params.uid,
      type: 'WALLET',
      title:
        params.status === 'CREDITED'
          ? 'USDT Deposit Credited'
          : params.status === 'UNDER_COMPLIANCE_REVIEW'
            ? 'USDT Deposit Under Compliance Review'
            : 'USDT Deposit Detected',
      body:
        params.status === 'CREDITED'
          ? `${params.isSandbox ? '[SANDBOX] ' : ''}+${(amt / 1_000_000).toFixed(2)} USDT credited via ${params.network}.`
          : `Detected ${(amt / 1_000_000).toFixed(2)} USDT deposit on ${params.network} (${params.confirmations}/${params.requiredConfirmations} confs).`,
    });

    await logWalletAuditEvent({
      actorUid: params.uid,
      subjectUid: params.uid,
      action: `DEPOSIT_${params.status}`,
      targetType: 'DEPOSIT',
      targetId: eventId,
      summary: `${params.network} deposit ${(amt / 1_000_000).toFixed(2)} USDT (${params.verificationSource}) -> ${params.status}`,
    });

    return eventId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `deposit_transactions/${eventId}`);
  }
}

export async function submitWithdrawalRequest(params: {
  uid: string;
  username?: string;
  network: BlockchainNetworkId;
  destinationAddress: string;
  requestedAmountMicro: number;
  networkFeeMicro: number;
  platformFeeMicro: number;
  totalDebitMicro: number;
  netSentMicro: number;
  initialStatus: WithdrawalStatus;
  riskScore: number;
  riskLevel: RiskLevel;
  riskReasons: string[];
  twoFactorVerified: boolean;
  idempotencyKey: string;
  txHash?: string;
  isSandbox: boolean;
}) {
  const cleanKey = params.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
  const withdrawalRef = doc(db, 'withdrawal_transactions', cleanKey);
  const walletRef = doc(db, 'wallets', params.uid);
  const resRef = doc(db, 'wallet_reservations', cleanKey);
  const ledgerRef = doc(collection(db, 'wallet_ledger'));
  const totalDebit = Math.round(params.totalDebitMicro);

  try {
    await runTransaction(db, async (tx) => {
      const existingWd = await tx.get(withdrawalRef);
      if (existingWd.exists()) {
        throw new Error('Duplicate withdrawal idempotency key already processed.');
      }

      const walletSnap = await tx.get(walletRef);
      const currentAvail = walletSnap.exists() ? Number(walletSnap.data().availableUsdtMicro || 0) : 0;
      const currentRes = walletSnap.exists() ? Number(walletSnap.data().reservedUsdtMicro || 0) : 0;

      if (currentAvail < totalDebit) {
        throw new Error('Insufficient available USDT balance (P2P-escrowed funds cannot be withdrawn).');
      }

      const nextAvail = currentAvail - totalDebit;
      const nextRes = currentRes + totalDebit;

      tx.set(
        walletRef,
        {
          uid: params.uid,
          availableUsdtMicro: nextAvail,
          reservedUsdtMicro: nextRes,
          preferredNetwork: params.network,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(withdrawalRef, {
        uid: params.uid,
        ...(params.username ? { username: params.username.slice(0, 40) } : {}),
        network: params.network,
        tokenSymbol: 'USDT',
        destinationAddress: params.destinationAddress.trim().slice(0, 128),
        requestedAmountMicro: Math.round(params.requestedAmountMicro),
        networkFeeMicro: Math.round(params.networkFeeMicro),
        platformFeeMicro: Math.round(params.platformFeeMicro),
        totalDebitMicro: totalDebit,
        netSentMicro: Math.round(params.netSentMicro),
        status: params.initialStatus,
        riskScore: Math.round(params.riskScore),
        riskLevel: params.riskLevel,
        riskReasons: params.riskReasons.slice(0, 8),
        twoFactorVerified: params.twoFactorVerified,
        idempotencyKey: cleanKey,
        ...(params.txHash ? { txHash: params.txHash.slice(0, 128) } : {}),
        isSandbox: params.isSandbox,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(resRef, {
        uid: params.uid,
        purpose: 'WITHDRAWAL_PENDING',
        referenceId: cleanKey,
        amountMicro: totalDebit,
        status: 'ACTIVE',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(ledgerRef, {
        uid: params.uid,
        entryType: 'WITHDRAWAL_RESERVE',
        network: params.network,
        asset: 'USDT',
        deltaAvailableMicro: -totalDebit,
        deltaReservedMicro: totalDebit,
        balanceBeforeMicro: currentAvail + currentRes,
        balanceAfterMicro: nextAvail + nextRes,
        referenceId: cleanKey,
        note: `Reserved ${(totalDebit / 1_000_000).toFixed(2)} USDT for ${params.network} withdrawal`,
        isSandbox: params.isSandbox,
        createdAt: serverTimestamp(),
      });
    });

    await createUserNotification({
      uid: params.uid,
      type: 'WALLET',
      title:
        params.initialStatus === 'UNDER_REVIEW'
          ? 'Withdrawal Queued for Review'
          : 'Withdrawal Request Submitted',
      body: `Reserved ${(totalDebit / 1_000_000).toFixed(2)} USDT for withdrawal to ${params.destinationAddress.slice(0, 10)}... on ${params.network}.`,
    });

    await logWalletAuditEvent({
      actorUid: params.uid,
      subjectUid: params.uid,
      action: 'WITHDRAWAL_REQUESTED',
      targetType: 'WITHDRAWAL',
      targetId: cleanKey,
      summary: `Requested ${(params.requestedAmountMicro / 1_000_000).toFixed(2)} USDT to ${params.destinationAddress.slice(0, 12)}... (status=${params.initialStatus}, risk=${params.riskScore})`,
    });

    return cleanKey;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `withdrawal_transactions/${cleanKey}`);
  }
}

export async function reviewDepositAdmin(params: {
  depositId: string;
  decision: 'CREDITED' | 'REJECTED';
  note: string;
  adminUid: string;
}) {
  const depositRef = doc(db, 'deposit_transactions', params.depositId);
  try {
    let targetUid = '';
    let amountMicro = 0;
    let network: BlockchainNetworkId = 'TRON_TRC20';
    let isSandbox = true;

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(depositRef);
      if (!snap.exists()) throw new Error('Deposit record not found.');
      const data = snap.data();
      if (data.status === 'CREDITED' || data.status === 'REJECTED') {
        throw new Error(`Deposit already finalized as ${data.status}.`);
      }

      targetUid = String(data.uid);
      amountMicro = Number(data.amountMicro || 0);
      network = (data.network as BlockchainNetworkId) || 'TRON_TRC20';
      isSandbox = Boolean(data.isSandbox);

      tx.update(depositRef, {
        status: params.decision,
        complianceNote: params.note.trim().slice(0, 400),
        reviewedByUid: params.adminUid,
        ...(params.decision === 'CREDITED' ? { creditedAtMs: Date.now() } : {}),
        updatedAt: serverTimestamp(),
      });

      if (params.decision === 'CREDITED') {
        const walletRef = doc(db, 'wallets', targetUid);
        const walletSnap = await tx.get(walletRef);
        const currentAvail = walletSnap.exists() ? Number(walletSnap.data().availableUsdtMicro || 0) : 0;
        const currentRes = walletSnap.exists() ? Number(walletSnap.data().reservedUsdtMicro || 0) : 0;
        const nextAvail = currentAvail + amountMicro;

        tx.set(
          walletRef,
          {
            uid: targetUid,
            availableUsdtMicro: nextAvail,
            reservedUsdtMicro: currentRes,
            preferredNetwork: network,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        const ledgerRef = doc(collection(db, 'wallet_ledger'));
        tx.set(ledgerRef, {
          uid: targetUid,
          entryType: 'DEPOSIT_CREDIT',
          network,
          asset: 'USDT',
          deltaAvailableMicro: amountMicro,
          deltaReservedMicro: 0,
          balanceBeforeMicro: currentAvail + currentRes,
          balanceAfterMicro: nextAvail + currentRes,
          referenceId: params.depositId,
          note: `Compliance approved deposit ${params.depositId}`,
          isSandbox,
          createdAt: serverTimestamp(),
        });
      }
    });

    await createUserNotification({
      uid: targetUid,
      type: 'WALLET',
      title: params.decision === 'CREDITED' ? 'USDT Deposit Credited' : 'USDT Deposit Rejected',
      body:
        params.decision === 'CREDITED'
          ? `+${(amountMicro / 1_000_000).toFixed(2)} USDT approved and credited to your wallet.`
          : `Deposit ${params.depositId} was rejected: ${params.note}`,
    });

    await logWalletAuditEvent({
      actorUid: params.adminUid,
      subjectUid: targetUid,
      action: `DEPOSIT_ADMIN_${params.decision}`,
      targetType: 'DEPOSIT',
      targetId: params.depositId,
      summary: `Admin set deposit ${params.depositId} to ${params.decision}: ${params.note}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `deposit_transactions/${params.depositId}`);
  }
}

export async function transitionWithdrawalAdmin(params: {
  withdrawalId: string;
  nextStatus: WithdrawalStatus;
  txHash?: string;
  note: string;
  adminUid: string;
}) {
  const wdRef = doc(db, 'withdrawal_transactions', params.withdrawalId);
  const resRef = doc(db, 'wallet_reservations', params.withdrawalId);

  try {
    let targetUid = '';
    let totalDebit = 0;
    let network: BlockchainNetworkId = 'TRON_TRC20';
    let isSandbox = true;

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(wdRef);
      if (!snap.exists()) throw new Error('Withdrawal record not found.');
      const data = snap.data();
      targetUid = String(data.uid);
      totalDebit = Number(data.totalDebitMicro || 0);
      network = (data.network as BlockchainNetworkId) || 'TRON_TRC20';
      isSandbox = Boolean(data.isSandbox);

      if (['COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED'].includes(data.status)) {
        throw new Error(`Withdrawal is already terminal (${data.status}).`);
      }

      const walletRef = doc(db, 'wallets', targetUid);
      const walletSnap = await tx.get(walletRef);
      const resSnap = await tx.get(resRef);
      const currentAvail = walletSnap.exists() ? Number(walletSnap.data().availableUsdtMicro || 0) : 0;
      const currentRes = walletSnap.exists() ? Number(walletSnap.data().reservedUsdtMicro || 0) : 0;

      const generatedHash =
        params.txHash?.trim() ||
        data.txHash ||
        `${Date.now().toString(16)}${params.withdrawalId.slice(0, 16)}`.padEnd(64, 'a').slice(0, 64);
      const finalHash =
        network === 'TRON_TRC20'
          ? generatedHash.replace(/^0x/, '').slice(0, 64)
          : generatedHash.startsWith('0x')
            ? generatedHash
            : `0x${generatedHash}`;

      tx.update(wdRef, {
        status: params.nextStatus,
        reviewedByUid: params.adminUid,
        reviewerNote: params.note.trim().slice(0, 400),
        ...(['PROCESSING', 'BROADCASTED', 'CONFIRMING', 'COMPLETED'].includes(params.nextStatus)
          ? { txHash: finalHash.slice(0, 128) }
          : {}),
        ...(['FAILED', 'REJECTED'].includes(params.nextStatus)
          ? { failureReason: params.note.trim().slice(0, 400) }
          : {}),
        updatedAt: serverTimestamp(),
      });

      if (params.nextStatus === 'COMPLETED') {
        const releaseAmt = Math.min(currentRes, totalDebit);
        const nextRes = currentRes - releaseAmt;
        tx.set(
          walletRef,
          {
            uid: targetUid,
            availableUsdtMicro: currentAvail,
            reservedUsdtMicro: nextRes,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        if (resSnap.exists()) {
          tx.update(resRef, { status: 'RELEASED', updatedAt: serverTimestamp() });
        }
        const ledgerRef = doc(collection(db, 'wallet_ledger'));
        tx.set(ledgerRef, {
          uid: targetUid,
          entryType: 'WITHDRAWAL_SETTLE',
          network,
          asset: 'USDT',
          deltaAvailableMicro: 0,
          deltaReservedMicro: -releaseAmt,
          balanceBeforeMicro: currentAvail + currentRes,
          balanceAfterMicro: currentAvail + nextRes,
          referenceId: params.withdrawalId,
          note: `Settled external USDT withdrawal (${finalHash.slice(0, 12)}...)`,
          isSandbox,
          createdAt: serverTimestamp(),
        });
        const legacyRef = doc(collection(db, 'wallet_transactions'));
        tx.set(legacyRef, {
          uid: targetUid,
          type: 'WITHDRAWAL',
          network,
          asset: 'USDT',
          amountMicro: Number(data.requestedAmountMicro || totalDebit),
          networkFeeMicro: Number(data.networkFeeMicro || 0) + Number(data.platformFeeMicro || 0),
          txHash: finalHash.slice(0, 128),
          toAddress: String(data.destinationAddress || ''),
          isSandbox,
          status: 'CONFIRMED',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (['FAILED', 'REJECTED', 'CANCELLED'].includes(params.nextStatus)) {
        const refundAmt = Math.min(currentRes, totalDebit);
        const nextAvail = currentAvail + refundAmt;
        const nextRes = currentRes - refundAmt;
        tx.set(
          walletRef,
          {
            uid: targetUid,
            availableUsdtMicro: nextAvail,
            reservedUsdtMicro: nextRes,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        if (resSnap.exists()) {
          tx.update(resRef, { status: 'REFUNDED', updatedAt: serverTimestamp() });
        }
        const ledgerRef = doc(collection(db, 'wallet_ledger'));
        tx.set(ledgerRef, {
          uid: targetUid,
          entryType: 'WITHDRAWAL_REFUND',
          network,
          asset: 'USDT',
          deltaAvailableMicro: refundAmt,
          deltaReservedMicro: -refundAmt,
          balanceBeforeMicro: currentAvail + currentRes,
          balanceAfterMicro: nextAvail + nextRes,
          referenceId: params.withdrawalId,
          note: `Refunded reserved withdrawal (${params.nextStatus}): ${params.note}`,
          isSandbox,
          createdAt: serverTimestamp(),
        });
      }
    });

    await createUserNotification({
      uid: targetUid,
      type: 'WALLET',
      title: `Withdrawal ${params.nextStatus.replace(/_/g, ' ')}`,
      body:
        params.nextStatus === 'COMPLETED'
          ? `Your ${network} USDT withdrawal has been completed.`
          : `Withdrawal status updated to ${params.nextStatus}: ${params.note}`,
    });

    await logWalletAuditEvent({
      actorUid: params.adminUid,
      subjectUid: targetUid,
      action: `WITHDRAWAL_${params.nextStatus}`,
      targetType: 'WITHDRAWAL',
      targetId: params.withdrawalId,
      summary: `Treasury set withdrawal ${params.withdrawalId} -> ${params.nextStatus}: ${params.note}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `withdrawal_transactions/${params.withdrawalId}`);
  }
}

export async function saveWalletNetworkAdmin(params: {
  networkConfig: BlockchainNetworkConfig;
  adminUid: string;
}) {
  const cfg = params.networkConfig;
  try {
    await setDoc(doc(db, 'supported_networks', cfg.id), {
      name: cfg.name,
      tokenStandard: cfg.tokenStandard,
      usdtContractAddress: cfg.usdtContractAddress,
      testnetName: cfg.testnetName,
      testnetContractAddress: cfg.testnetContractAddress,
      requiredConfirmations: Math.max(1, Math.round(cfg.requiredConfirmations)),
      estimatedNetworkFeeUsdtMicro: Math.max(0, Math.round(cfg.estimatedNetworkFeeUsdtMicro)),
      platformWithdrawalFeeUsdtMicro: Math.max(0, Math.round(cfg.platformWithdrawalFeeUsdtMicro)),
      minDepositUsdtMicro: Math.max(0, Math.round(cfg.minDepositUsdtMicro)),
      minWithdrawalUsdtMicro: Math.max(0, Math.round(cfg.minWithdrawalUsdtMicro)),
      maxWithdrawalUsdtMicro: Math.max(0, Math.round(cfg.maxWithdrawalUsdtMicro)),
      dailyWithdrawalLimitUsdtMicro: Math.max(0, Math.round(cfg.dailyWithdrawalLimitUsdtMicro)),
      depositsEnabled: cfg.depositsEnabled,
      withdrawalsEnabled: cfg.withdrawalsEnabled,
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'supported_tokens', `USDT_${cfg.id}`), {
      symbol: 'USDT',
      name: `Tether USD (${cfg.name})`,
      network: cfg.id,
      contractAddress: cfg.usdtContractAddress,
      decimals: 6,
      isActive: cfg.depositsEnabled || cfg.withdrawalsEnabled,
      updatedAt: serverTimestamp(),
    });
    await logWalletAuditEvent({
      actorUid: params.adminUid,
      subjectUid: params.adminUid,
      action: 'NETWORK_CONFIG_UPDATED',
      targetType: 'NETWORK',
      targetId: cfg.id,
      summary: `Updated ${cfg.name} confirmations=${cfg.requiredConfirmations}, netFee=${cfg.estimatedNetworkFeeUsdtMicro}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `supported_networks/${cfg.id}`);
  }
}

export async function saveWalletSecuritySettingsAdmin(params: {
  settings: WalletSecurityPolicy;
  adminUid: string;
}) {
  try {
    await setDoc(doc(db, 'wallet_security_settings', 'default'), {
      newAddressCooldownHours: Math.max(0, Math.round(params.settings.newAddressCooldownHours)),
      manualReviewThresholdUsdtMicro: Math.max(0, Math.round(params.settings.manualReviewThresholdUsdtMicro)),
      dailyWithdrawalLimitUsdtMicro: Math.max(0, Math.round(params.settings.dailyWithdrawalLimitUsdtMicro)),
      require2faForWithdrawals: params.settings.require2faForWithdrawals,
      sandboxFaucetEnabled: params.settings.sandboxFaucetEnabled,
      updatedAt: serverTimestamp(),
    });
    await logWalletAuditEvent({
      actorUid: params.adminUid,
      subjectUid: params.adminUid,
      action: 'WALLET_SECURITY_POLICY_UPDATED',
      targetType: 'SECURITY_POLICY',
      targetId: 'default',
      summary: `Cooldown=${params.settings.newAddressCooldownHours}h, reviewThreshold=${params.settings.manualReviewThresholdUsdtMicro}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'wallet_security_settings/default');
  }
}

export async function seedWalletDefaultsAdmin(adminUid: string) {
  for (const netCfg of Object.values(BLOCKCHAIN_NETWORKS)) {
    await saveWalletNetworkAdmin({ networkConfig: netCfg, adminUid });
  }
  await saveWalletSecuritySettingsAdmin({
    settings: DEFAULT_WALLET_SECURITY_POLICY,
    adminUid,
  });
}

// --- Multi-Coin Watchlist, Alerts, & Admin Coin Governance ---
export async function toggleCoinWatchlist(params: {
  uid: string;
  symbol: string;
  currentlyWatchlisted: boolean;
}) {
  const sym = params.symbol.trim().toUpperCase();
  const docId = `${params.uid}_${sym}`;
  const ref = doc(db, 'coin_watchlists', docId);
  try {
    if (params.currentlyWatchlisted) {
      await deleteDoc(ref);
      return false;
    }
    await setDoc(ref, {
      uid: params.uid,
      symbol: sym,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `coin_watchlists/${docId}`);
    return params.currentlyWatchlisted;
  }
}

export async function createCoinPriceAlert(params: {
  uid: string;
  symbol: string;
  targetInrPaise: number;
  condition: 'ABOVE' | 'BELOW';
}) {
  const sym = params.symbol.trim().toUpperCase();
  try {
    const ref = await addDoc(collection(db, 'coin_price_alerts'), {
      uid: params.uid,
      symbol: sym,
      targetInrPaise: Math.max(1, Math.round(params.targetInrPaise)),
      condition: params.condition,
      isActive: true,
      triggered: false,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'coin_price_alerts');
  }
}

export async function markCoinPriceAlertTriggered(alertId: string) {
  try {
    await updateDoc(doc(db, 'coin_price_alerts', alertId), {
      triggered: true,
      lastTriggeredAtMs: Date.now(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `coin_price_alerts/${alertId}`);
  }
}

export async function deleteCoinPriceAlert(alertId: string) {
  try {
    await deleteDoc(doc(db, 'coin_price_alerts', alertId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `coin_price_alerts/${alertId}`);
  }
}

export async function saveSupportedCoinAdmin(params: {
  coin: import('./coins').SupportedCoinConfig;
  adminUid: string;
}) {
  const c = params.coin;
  const sym = c.symbol.trim().toUpperCase();
  try {
    await setDoc(doc(db, 'supported_coins', sym), {
      symbol: sym,
      name: c.name.trim().slice(0, 64),
      coingeckoId: c.coingeckoId.trim().toLowerCase().slice(0, 64),
      iconKey: c.iconKey.trim().toLowerCase().slice(0, 32),
      accentHex: c.accentHex.trim().slice(0, 16),
      description: c.description.trim().slice(0, 500),
      decimals: Math.max(0, Math.min(18, Math.round(c.decimals))),
      supportedNetworks: c.supportedNetworks,
      networkContracts: c.networkContracts,
      minTradeQuantityE8: Math.max(1, Math.round(c.minTradeQuantityE8)),
      maxTradeQuantityE8: Math.max(
        Math.round(c.minTradeQuantityE8),
        Math.round(c.maxTradeQuantityE8)
      ),
      minOrderInrPaise: Math.max(100, Math.round(c.minOrderInrPaise)),
      maxOrderInrPaise: Math.max(
        Math.round(c.minOrderInrPaise),
        Math.round(c.maxOrderInrPaise)
      ),
      tradingFeeBps: Math.max(0, Math.min(1000, Math.round(c.tradingFeeBps))),
      confirmationsRequired: Math.max(1, Math.round(c.confirmationsRequired)),
      depositEnabled: Boolean(c.depositEnabled),
      withdrawalEnabled: Boolean(c.withdrawalEnabled),
      tradingEnabled: Boolean(c.tradingEnabled),
      custodyApproved: Boolean(c.custodyApproved),
      isFeatured: Boolean(c.isFeatured),
      sortOrder: Math.max(0, Math.round(c.sortOrder)),
      updatedByUid: params.adminUid,
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'coin_trading_settings', sym), {
      symbol: sym,
      tradingEnabled: Boolean(c.tradingEnabled),
      depositEnabled: Boolean(c.depositEnabled),
      withdrawalEnabled: Boolean(c.withdrawalEnabled),
      custodyApproved: Boolean(c.custodyApproved),
      minTradeQuantityE8: Math.max(1, Math.round(c.minTradeQuantityE8)),
      maxTradeQuantityE8: Math.max(
        Math.round(c.minTradeQuantityE8),
        Math.round(c.maxTradeQuantityE8)
      ),
      tradingFeeBps: Math.max(0, Math.min(1000, Math.round(c.tradingFeeBps))),
      confirmationsRequired: Math.max(1, Math.round(c.confirmationsRequired)),
      updatedByUid: params.adminUid,
      updatedAt: serverTimestamp(),
    });

    await logAuditEvent({
      actorUid: params.adminUid,
      action: 'COIN_GOVERNANCE_SAVED',
      targetType: 'supported_coin',
      targetId: sym,
      summary: `${sym}: trading=${c.tradingEnabled}, custody=${c.custodyApproved}, deposit=${c.depositEnabled}, withdraw=${c.withdrawalEnabled}`,
    });

    await logWalletAuditEvent({
      actorUid: params.adminUid,
      subjectUid: params.adminUid,
      action: 'COIN_GOVERNANCE_SAVED',
      targetType: 'COIN_GOVERNANCE',
      targetId: sym,
      summary: `${sym} governance updated (trading=${c.tradingEnabled}, custodyApproved=${c.custodyApproved}, fee=${c.tradingFeeBps}bps)`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `supported_coins/${sym}`);
  }
}

export async function seedDefaultSupportedCoinsAdmin(adminUid: string) {
  const { DEFAULT_SUPPORTED_COINS } = await import('./coins');
  for (const coin of DEFAULT_SUPPORTED_COINS) {
    await saveSupportedCoinAdmin({ coin, adminUid });
  }
}

// --- Price Lock Persistence ---
export async function savePriceLockRecord(params: {
  lockId: string;
  uid: string;
  offerId: string;
  asset: string;
  side: 'BUY' | 'SELL';
  rateInrPaise: number;
  ttlSeconds: number;
  expiresAtMs: number;
  signature: string;
}) {
  try {
    await setDoc(doc(db, 'price_locks', params.lockId), {
      lockId: params.lockId,
      uid: params.uid,
      offerId: params.offerId,
      asset: params.asset.toUpperCase(),
      side: params.side,
      rateInrPaise: Math.round(params.rateInrPaise),
      ttlSeconds: Math.round(params.ttlSeconds),
      expiresAtMs: Math.round(params.expiresAtMs),
      signature: params.signature,
      status: 'LOCKED',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `price_locks/${params.lockId}`);
  }
}

export async function updatePriceLockStatus(lockId: string, status: 'CONSUMED' | 'EXPIRED') {
  try {
    await updateDoc(doc(db, 'price_locks', lockId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Best-effort lock status sync
  }
}

// --- Merchant Visibility & VIP Sync ---
export async function updateMerchantVisibilitySettings(params: {
  uid: string;
  visibilityMode: 'PUBLIC' | 'HIGH_VOLUME_ONLY' | 'HIDDEN';
  showVipBadge: boolean;
}) {
  try {
    await updateDoc(doc(db, 'merchants', params.uid), {
      visibilityMode: params.visibilityMode,
      showVipBadge: params.showVipBadge,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `merchants/${params.uid}`);
  }
}

// --- Dispute Evidence, Escalation & Officer Assignment ---
export async function addDisputeEvidenceAndEscalate(params: {
  disputeId: string;
  evidenceSummary: string;
  evidenceItems: string[];
  escalate?: boolean;
}) {
  try {
    await updateDoc(doc(db, 'disputes', params.disputeId), {
      evidenceSummary: params.evidenceSummary.trim().slice(0, 600),
      evidenceItems: params.evidenceItems.slice(0, 6),
      ...(params.escalate
        ? {
            status: 'ESCALATED',
            escalatedToCompliance: true,
            escalatedAtMs: Date.now(),
          }
        : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `disputes/${params.disputeId}`);
  }
}

export async function updateDisputeAdmin(params: {
  disputeId: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_EVIDENCE' | 'ESCALATED' | 'RESOLVED' | 'REJECTED';
  assignedOfficerUid: string;
  resolutionNote: string;
}) {
  try {
    await updateDoc(doc(db, 'disputes', params.disputeId), {
      status: params.status,
      assignedOfficerUid: params.assignedOfficerUid,
      resolutionNote: params.resolutionNote.trim().slice(0, 600),
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.assignedOfficerUid,
      action: 'DISPUTE_UPDATED',
      targetType: 'dispute',
      targetId: params.disputeId,
      summary: `Dispute ${params.disputeId} set status=${params.status}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `disputes/${params.disputeId}`);
  }
}

// --- Support Ticket Live Chat & Escalation ---
export async function sendSupportMessage(params: {
  ticketId: string;
  senderUid: string;
  senderName: string;
  senderRole: 'USER' | 'SUPPORT' | 'ADMIN';
  body: string;
}) {
  try {
    await addDoc(collection(db, 'support_tickets', params.ticketId, 'messages'), {
      ticketId: params.ticketId,
      senderUid: params.senderUid,
      senderName: params.senderName.trim().slice(0, 80),
      senderRole: params.senderRole,
      body: params.body.trim().slice(0, 1000),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `support_tickets/${params.ticketId}/messages`);
  }
}

export async function updateSupportTicketAdmin(params: {
  ticketId: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  adminUid: string;
  adminReply?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  escalatedToCompliance?: boolean;
}) {
  try {
    await updateDoc(doc(db, 'support_tickets', params.ticketId), {
      status: params.status,
      assignedAgentUid: params.adminUid,
      ...(params.adminReply ? { adminReply: params.adminReply.trim().slice(0, 1000) } : {}),
      ...(params.priority ? { priority: params.priority } : {}),
      ...(typeof params.escalatedToCompliance === 'boolean'
        ? { escalatedToCompliance: params.escalatedToCompliance }
        : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `support_tickets/${params.ticketId}`);
  }
}

// --- Merchant API Keys & Webhooks ---
export async function saveMerchantApiKeyDoc(params: {
  uid: string;
  keyHash: string;
  keyPrefix: string;
  label: string;
  scopes: string[];
  rateLimitPerMin: number;
}) {
  try {
    await setDoc(doc(db, 'merchant_api_keys', params.keyHash), {
      uid: params.uid,
      keyHash: params.keyHash,
      keyPrefix: params.keyPrefix,
      label: params.label.trim().slice(0, 64),
      scopes: params.scopes.slice(0, 8),
      rateLimitPerMin: Math.round(params.rateLimitPerMin),
      revoked: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.uid,
      action: 'MERCHANT_API_KEY_CREATED',
      targetType: 'merchant_api_key',
      targetId: params.keyPrefix,
      summary: `Generated API key ${params.keyPrefix} (${params.label})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `merchant_api_keys/${params.keyHash}`);
  }
}

export async function revokeMerchantApiKeyDoc(keyHash: string, uid: string) {
  try {
    await updateDoc(doc(db, 'merchant_api_keys', keyHash), {
      revoked: true,
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: uid,
      action: 'MERCHANT_API_KEY_REVOKED',
      targetType: 'merchant_api_key',
      targetId: keyHash.slice(0, 16),
      summary: `Revoked merchant API key hash ${keyHash.slice(0, 12)}...`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `merchant_api_keys/${keyHash}`);
  }
}

export async function saveMerchantWebhookDoc(params: {
  uid: string;
  url: string;
  events: string[];
  secretMasked: string;
}) {
  try {
    const ref = await addDoc(collection(db, 'merchant_webhooks'), {
      uid: params.uid,
      url: params.url.trim().slice(0, 300),
      events: params.events.slice(0, 10),
      secretMasked: params.secretMasked.slice(0, 40),
      isActive: true,
      lastTestStatus: 'NOT_TESTED',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'merchant_webhooks');
  }
}

export async function updateMerchantWebhookStatus(webhookId: string, lastTestStatus: string) {
  try {
    await updateDoc(doc(db, 'merchant_webhooks', webhookId), {
      lastTestStatus: lastTestStatus.slice(0, 120),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `merchant_webhooks/${webhookId}`);
  }
}

export async function deleteMerchantWebhookDoc(webhookId: string) {
  try {
    await deleteDoc(doc(db, 'merchant_webhooks', webhookId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `merchant_webhooks/${webhookId}`);
  }
}

// --- Platform Status Maintenance Windows ---
export async function saveMaintenanceWindowAdmin(params: {
  title: string;
  description: string;
  affectedServices: string[];
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
  scheduledStartIso: string;
  scheduledEndIso: string;
  adminUid: string;
}) {
  try {
    const ref = await addDoc(collection(db, 'system_maintenance'), {
      title: params.title.trim().slice(0, 120),
      description: params.description.trim().slice(0, 500),
      affectedServices: params.affectedServices.slice(0, 10),
      status: params.status,
      scheduledStartIso: params.scheduledStartIso,
      scheduledEndIso: params.scheduledEndIso,
      createdByUid: params.adminUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent({
      actorUid: params.adminUid,
      action: 'MAINTENANCE_WINDOW_PUBLISHED',
      targetType: 'system_maintenance',
      targetId: ref.id,
      summary: `Maintenance: ${params.title} (${params.status})`,
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'system_maintenance');
  }
}

export async function updateMaintenanceWindowStatusAdmin(
  windowId: string,
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED'
) {
  try {
    await updateDoc(doc(db, 'system_maintenance', windowId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `system_maintenance/${windowId}`);
  }
}



