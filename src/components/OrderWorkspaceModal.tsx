import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Lock,
  MessageSquare,
  Printer,
  QrCode,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  type BlockchainNetworkId,
  buildUpiPaymentUri,
  formatInrFromPaise,
  formatRateInr,
  formatUsdtFromMicro,
  PAYMENT_METHOD_LABELS,
} from '../lib/domain';
import { formatCoinQuantityFromE8, MULTI_COIN_NETWORKS } from '../lib/coins';
import {
  createDisputeCase,
  logDeniedTradingAttempt,
  recordPaymentReconciliation,
  recordWalletTransaction,
  sendOrderMessage,
  submitOrderRating,
  transitionOrderStatus,
} from '../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { useAuth } from '../context/AuthContext';
import { downloadTransactionReceiptPdf } from '../lib/pdfReports';
import { OrderEventDoc, OrderMessageDoc, P2POrderDoc } from '../types/models';
import { ConfirmDialog } from './ConfirmDialog';

interface OrderWorkspaceModalProps {
  orderId: string;
  onClose: () => void;
}

const PROGRESS_STEPS = [
  { key: 'CREATED', label: 'Created' },
  { key: 'ESCROW', label: 'Escrow Locked' },
  { key: 'PAID', label: 'INR Paid' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'COMPLETED', label: 'Completed' },
];

function getStepIndex(status: P2POrderDoc['status']): number {
  if (['CREATED', 'AWAITING_ACCEPTANCE', 'ACCEPTED'].includes(status)) return 0;
  if (['ESCROW_RESERVED', 'PAYMENT_PENDING'].includes(status)) return 1;
  if (status === 'PAYMENT_SUBMITTED') return 2;
  if (['PAYMENT_VERIFIED', 'SETTLING'].includes(status)) return 3;
  if (status === 'COMPLETED') return 4;
  return -1;
}

export function OrderWorkspaceModal({ orderId, onClose }: OrderWorkspaceModalProps) {
  const { user, account, privateProfile, isTradingEligible, kycRestriction, getIdToken } = useAuth();
  const [order, setOrder] = useState<P2POrderDoc | null>(null);
  const [events, setEvents] = useState<OrderEventDoc[]>([]);
  const [messages, setMessages] = useState<OrderMessageDoc[]>([]);
  const [remainingSec, setRemainingSec] = useState<number>(0);

  const [utrInput, setUtrInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  const [payeeUpiHandle, setPayeeUpiHandle] = useState('coinbridge.escrow@okicici');
  const [upiQrDataUrl, setUpiQrDataUrl] = useState<string | null>(null);

  const [totpCode, setTotpCode] = useState('');
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Dispute form state
  const [showDispute, setShowDispute] = useState(false);
  const [disputeCategory, setDisputeCategory] = useState<
    | 'PAYMENT_NOT_RECEIVED'
    | 'PAYMENT_NOT_ACKNOWLEDGED'
    | 'INCORRECT_AMOUNT'
    | 'SELLER_NOT_RELEASING'
    | 'BUYER_NOT_PAYING'
    | 'SUSPICIOUS_TRANSACTION'
    | 'DUPLICATE_PAYMENT'
    | 'OTHER'
  >('PAYMENT_NOT_ACKNOWLEDGED');
  const [disputeDesc, setDisputeDesc] = useState('');

  // Rating state
  const [ratingVal, setRatingVal] = useState(5);
  const [ratingComment, setRatingComment] = useState('');

  useEffect(() => {
    const unsubOrder = onSnapshot(
      doc(db, 'p2p_orders', orderId),
      (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...(snap.data() as Omit<P2POrderDoc, 'id'>) };
          setOrder(data);
          setPayeeUpiHandle(`${data.sellerUsername.replace(/[^a-z0-9]/gi, '').slice(0, 14) || 'merchant'}@okicici`);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `p2p_orders/${orderId}`)
    );

    const unsubEvents = onSnapshot(
      query(collection(db, 'p2p_orders', orderId, 'events'), orderBy('createdAt', 'asc')),
      (snap) => {
        const list: OrderEventDoc[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<OrderEventDoc, 'id'>) }));
        setEvents(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `p2p_orders/${orderId}/events`)
    );

    const unsubMessages = onSnapshot(
      query(collection(db, 'p2p_orders', orderId, 'messages'), orderBy('createdAt', 'asc')),
      (snap) => {
        const list: OrderMessageDoc[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<OrderMessageDoc, 'id'>) }));
        setMessages(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `p2p_orders/${orderId}/messages`)
    );

    return () => {
      unsubOrder();
      unsubEvents();
      unsubMessages();
    };
  }, [orderId]);

  useEffect(() => {
    if (!order) return;
    const tick = () => {
      const diff = Math.max(0, Math.floor((order.expiresAtMs - Date.now()) / 1000));
      setRemainingSec(diff);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [order]);

  useEffect(() => {
    if (!order || order.paymentMethod !== 'UPI') {
      setUpiQrDataUrl(null);
      return;
    }
    const uri = buildUpiPaymentUri({
      upiId: payeeUpiHandle,
      payeeName: order.sellerUsername,
      amountInrPaise: order.inrPaise,
      orderCode: order.orderCode,
    });
    QRCode.toDataURL(uri, { width: 168, margin: 1 })
      .then((url) => setUpiQrDataUrl(url))
      .catch(() => setUpiQrDataUrl(null));
  }, [order, payeeUpiHandle]);

  if (!order || !user) return null;

  const isBuyer = order.buyerUid === user.uid;
  const isSeller = order.sellerUid === user.uid;
  const assetSym = (order.asset || 'USDT').toUpperCase();
  const qtyE8 = order.quantityE8 ?? order.usdtMicro * 100;
  const displayQty =
    assetSym === 'USDT'
      ? formatUsdtFromMicro(order.usdtMicro, 2)
      : `${formatCoinQuantityFromE8(qtyE8, 6)} ${assetSym}`;
  const networkLabel =
    MULTI_COIN_NETWORKS[order.network as keyof typeof MULTI_COIN_NETWORKS]?.label || order.network;
  const isTerminal = ['COMPLETED', 'CANCELLED', 'EXPIRED', 'REFUNDED'].includes(order.status);
  const canExpireOverdue =
    remainingSec === 0 &&
    ['CREATED', 'AWAITING_ACCEPTANCE', 'ACCEPTED', 'ESCROW_RESERVED', 'PAYMENT_PENDING'].includes(
      order.status
    );
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  const activeStepIdx = getStepIndex(order.status);

  const handleSellerAcceptAndReserve = async () => {
    if (!isTradingEligible) {
      setErrorMsg(kycRestriction.reasonMessage);
      void logDeniedTradingAttempt({
        uid: user.uid,
        action: 'ACCEPT_AND_LOCK_ESCROW',
        kycStatus: kycRestriction.effectiveKycStatus,
        reasonCode: kycRestriction.reasonCode,
        reasonMessage: kycRestriction.reasonMessage,
      });
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setActionMsg(null);
    try {
      const sandboxEscrowHash = `0xsandbox_${order.orderCode.toLowerCase()}_${Date.now().toString(16)}`;
      if (assetSym === 'USDT' && order.side === 'SELL_USDT') {
        await recordWalletTransaction({
          uid: user.uid,
          type: 'ESCROW_LOCK',
          network: order.network as BlockchainNetworkId,
          amountMicro: order.usdtMicro,
          networkFeeMicro: 0,
          txHash: sandboxEscrowHash,
          isSandbox: order.isSandbox,
        });
      }
      await transitionOrderStatus({
        orderId: order.id,
        actorUid: user.uid,
        action: 'ESCROW_RESERVED',
        nextStatus: 'PAYMENT_PENDING',
        escrowStatus: 'RESERVED',
        escrowTxHash: sandboxEscrowHash,
        paymentAccountSnapshot: `${PAYMENT_METHOD_LABELS[order.paymentMethod]} · ${payeeUpiHandle}`,
        note: 'Seller accepted order and reserved USDT in sandbox escrow ledger (not a smart contract).',
      });
      setActionMsg('Escrow reserved. Awaiting buyer INR transfer and UTR reference.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to reserve escrow.');
    } finally {
      setBusy(false);
    }
  };

  const handleBuyerSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isTradingEligible) {
      setErrorMsg(kycRestriction.reasonMessage);
      void logDeniedTradingAttempt({
        uid: user.uid,
        action: 'SUBMIT_ORDER_PAYMENT',
        kycStatus: kycRestriction.effectiveKycStatus,
        reasonCode: kycRestriction.reasonCode,
        reasonMessage: kycRestriction.reasonMessage,
      });
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setActionMsg(null);
    try {
      const cleanRef = utrInput.trim().toUpperCase();
      const token = await getIdToken();
      const resp = await fetch('/api/payments/sandbox-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': `${order.id}-${cleanRef}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          inrPaise: order.inrPaise,
          method: order.paymentMethod,
          referenceId: cleanRef,
          screenshotOnly: false,
        }),
      });
      const data = (await resp.json()) as { error?: string; referenceId?: string; notice?: string };
      if (!resp.ok) {
        if (resp.status === 409) {
          await recordPaymentReconciliation({
            uid: user.uid,
            orderId: order.id,
            orderCode: order.orderCode,
            method: order.paymentMethod,
            referenceId: cleanRef,
            inrPaise: order.inrPaise,
            status: 'DUPLICATE_FLAGGED',
            isSandbox: order.isSandbox,
            reconciliationNote: data.error || 'Duplicate UTR blocked across orders.',
          });
        }
        throw new Error(data.error || 'Payment reference verification failed.');
      }

      await recordPaymentReconciliation({
        uid: user.uid,
        orderId: order.id,
        orderCode: order.orderCode,
        method: order.paymentMethod,
        referenceId: data.referenceId || cleanRef,
        inrPaise: order.inrPaise,
        status: 'VERIFIED',
        isSandbox: order.isSandbox,
        reconciliationNote:
          data.notice || 'Sandbox reference recorded; awaiting seller bank statement confirmation.',
      });

      await transitionOrderStatus({
        orderId: order.id,
        actorUid: user.uid,
        action: 'PAYMENT_SUBMITTED',
        nextStatus: 'PAYMENT_SUBMITTED',
        paymentRef: data.referenceId || cleanRef,
        note: `Buyer submitted payment reference ${data.referenceId} (${order.paymentMethod}).`,
      });
      setActionMsg('Payment reference submitted. Waiting for seller bank receipt confirmation.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment submission failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSellerConfirmAndRelease = async () => {
    if (!isTradingEligible) {
      setErrorMsg(kycRestriction.reasonMessage);
      void logDeniedTradingAttempt({
        uid: user.uid,
        action: 'RELEASE_ORDER_ESCROW',
        kycStatus: kycRestriction.effectiveKycStatus,
        reasonCode: kycRestriction.reasonCode,
        reasonMessage: kycRestriction.reasonMessage,
      });
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setActionMsg(null);
    try {
      let confirmed2FA = false;
      if (privateProfile?.twoFactorEnabled && privateProfile.totpSealedSecret) {
        if (!/^\d{6}$/.test(totpCode.trim())) {
          throw new Error('Enter your 6-digit authenticator code to authorize escrow release.');
        }
        const token = await getIdToken();
        const verifyResp = await fetch('/api/security/2fa/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            code: totpCode.trim(),
            sealedSecret: privateProfile.totpSealedSecret,
          }),
        });
        const verifyJson = (await verifyResp.json()) as { error?: string; verified?: boolean };
        if (!verifyResp.ok || !verifyJson.verified) {
          throw new Error(verifyJson.error || '2FA code verification failed.');
        }
        confirmed2FA = true;
      }

      if (assetSym === 'USDT' && order.side === 'SELL_USDT') {
        await recordWalletTransaction({
          uid: user.uid,
          type: 'ESCROW_RELEASE',
          network: order.network as BlockchainNetworkId,
          amountMicro: order.usdtMicro,
          networkFeeMicro: 0,
          txHash: order.escrowTxHash,
          isSandbox: order.isSandbox,
        });
      }
      await transitionOrderStatus({
        orderId: order.id,
        actorUid: user.uid,
        action: 'SETTLEMENT_COMPLETED',
        nextStatus: 'COMPLETED',
        escrowStatus: 'RELEASED',
        releaseConfirmed2FA: confirmed2FA,
        note: `Seller independently verified INR receipt and released ${assetSym} settlement.`,
      });
      setShowReleaseConfirm(false);
      setTotpCode('');
      setActionMsg(`Order completed and ${assetSym} settlement released.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Settlement failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelOrder = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await transitionOrderStatus({
        orderId: order.id,
        actorUid: user.uid,
        action: 'ORDER_CANCELLED',
        nextStatus: 'CANCELLED',
        note: 'Order cancelled prior to INR settlement.',
      });
      setShowCancelConfirm(false);
      setActionMsg('Order cancelled.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to cancel order.');
    } finally {
      setBusy(false);
    }
  };

  const handleExpireOrder = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const wasReserved = order.escrowStatus === 'RESERVED';
      if (wasReserved && isSeller && assetSym === 'USDT' && order.side === 'SELL_USDT') {
        await recordWalletTransaction({
          uid: user.uid,
          type: 'ESCROW_REFUND',
          network: order.network as BlockchainNetworkId,
          amountMicro: order.usdtMicro,
          networkFeeMicro: 0,
          txHash: order.escrowTxHash,
          isSandbox: order.isSandbox,
        });
      }
      await transitionOrderStatus({
        orderId: order.id,
        actorUid: user.uid,
        action: 'ORDER_EXPIRED',
        nextStatus: 'EXPIRED',
        escrowStatus: wasReserved ? 'REFUNDED' : 'NONE',
        note: 'Payment window elapsed; order expired and any reserved escrow unlocked.',
      });
      setActionMsg('Overdue order expired and reserved escrow released back.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to expire order.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setSendingChat(true);
    try {
      await sendOrderMessage({
        orderId: order.id,
        senderUid: user.uid,
        senderUsername: account?.username || 'trader',
        senderRole: isBuyer ? 'BUYER' : isSeller ? 'SELLER' : 'ADMIN',
        body: chatInput,
      });
      setChatInput('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to send chat message.');
    } finally {
      setSendingChat(false);
    }
  };

  const handleOpenDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disputeDesc.trim().length < 10) {
      setErrorMsg('Please describe the dispute in at least 10 characters.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      await createDisputeCase({
        orderId: order.id,
        orderCode: order.orderCode,
        raisedByUid: user.uid,
        counterpartyUid: isBuyer ? order.sellerUid : order.buyerUid,
        category: disputeCategory,
        description: disputeDesc,
        paymentRef: order.paymentRef,
      });
      setShowDispute(false);
      setActionMsg('Dispute opened and escrow frozen pending compliance review.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to open dispute.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await submitOrderRating({
        orderId: order.id,
        buyerUid: user.uid,
        authorName: account?.displayName || order.buyerUsername,
        rating: ratingVal,
        comment: ratingComment,
      });
      setActionMsg('Order rating recorded.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit rating.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-4xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-5">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {order.orderCode}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {order.side === 'BUY_USDT' || order.side === 'BUY'
                  ? `Buy ${assetSym}`
                  : `Sell ${assetSym}`}
              </span>
              <span aria-hidden="true">·</span>
              <span>{order.isSandbox ? 'Sandbox Ledger Escrow' : 'Live'}</span>
            </div>
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
              Status: {order.status.replace(/_/g, ' ')}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {!isTerminal && (
              <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg tabular-nums">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
              </div>
            )}
            {order.status === 'COMPLETED' && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    downloadTransactionReceiptPdf({
                      kind: 'P2P_ORDER',
                      transactionId: order.id,
                      orderId: order.orderCode,
                      asset: assetSym,
                      cryptoAmount: displayQty,
                      inrAmount: formatInrFromPaise(order.inrPaise),
                      exchangeRate: formatRateInr(order.rateInrPaise),
                      feesSummary: `${formatCoinQuantityFromE8(order.feeE8 ?? order.feeUsdtMicro * 100, 6)} ${assetSym}`,
                      tdsSummary: formatInrFromPaise(order.tdsInrPaise),
                      dateIso: order.createdAt?.toDate
                        ? order.createdAt.toDate().toISOString()
                        : new Date().toISOString(),
                      status: order.status,
                      counterpartyOrAddress: `Buyer @${order.buyerUsername} / Seller @${order.sellerUsername} (${PAYMENT_METHOD_LABELS[order.paymentMethod]})`,
                      network: networkLabel,
                      blockchainTxHash: order.escrowTxHash || order.paymentRef,
                      isSandbox: order.isSandbox,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  PDF Receipt
                </button>
                <button
                  type="button"
                  onClick={() => setShowReceipt((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  {showReceipt ? 'Hide Receipt' : 'Preview'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close order workspace"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 5-Step Progress Tracker */}
        {activeStepIdx >= 0 && (
          <div className="grid grid-cols-5 gap-2 text-center text-[11px]">
            {PROGRESS_STEPS.map((st, idx) => {
              const reached = idx <= activeStepIdx;
              return (
                <div key={st.key} className="space-y-1">
                  <div
                    className={`h-1.5 rounded-full ${
                      reached ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-800'
                    }`}
                  />
                  <div className={reached ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-400'}>
                    {st.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Printable & Downloadable Transaction Receipt */}
        {showReceipt && order.status === 'COMPLETED' && (
          <div className="border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 rounded-xl p-5 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  CoinBridge P2P Settlement Receipt
                </div>
                <div className="font-mono text-slate-500 dark:text-slate-400">
                  Order {order.orderCode}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadTransactionReceiptPdf({
                      kind: 'P2P_ORDER',
                      transactionId: order.id,
                      orderId: order.orderCode,
                      asset: assetSym,
                      cryptoAmount: displayQty,
                      inrAmount: formatInrFromPaise(order.inrPaise),
                      exchangeRate: formatRateInr(order.rateInrPaise),
                      feesSummary: `${formatCoinQuantityFromE8(order.feeE8 ?? order.feeUsdtMicro * 100, 6)} ${assetSym}`,
                      tdsSummary: formatInrFromPaise(order.tdsInrPaise),
                      dateIso: order.createdAt?.toDate
                        ? order.createdAt.toDate().toISOString()
                        : new Date().toISOString(),
                      status: order.status,
                      counterpartyOrAddress: `Buyer @${order.buyerUsername} / Seller @${order.sellerUsername}`,
                      network: networkLabel,
                      blockchainTxHash: order.escrowTxHash || order.paymentRef,
                      isSandbox: order.isSandbox,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-800 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  Print
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono tabular-nums">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Buyer</span>
                <span className="text-slate-900 dark:text-slate-100 font-semibold">@{order.buyerUsername}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Seller</span>
                <span className="text-slate-900 dark:text-slate-100 font-semibold">@{order.sellerUsername}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Payment Method</span>
                <span className="text-slate-900 dark:text-slate-100 font-semibold">{PAYMENT_METHOD_LABELS[order.paymentMethod]}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">INR Settled</span>
                <span className="text-slate-900 dark:text-slate-100 font-semibold">{formatInrFromPaise(order.inrPaise)}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">{assetSym} Quantity</span>
                <span className="text-slate-900 dark:text-slate-100 font-semibold">{displayQty}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Sec 194S 1% TDS</span>
                <span className="text-slate-900 dark:text-slate-100 font-semibold">{formatInrFromPaise(order.tdsInrPaise)}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">UTR / Reference</span>
                <span className="text-slate-900 dark:text-slate-100 font-semibold">{order.paymentRef || '—'}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500 dark:text-slate-400 block">Escrow Reference</span>
                <span className="text-slate-900 dark:text-slate-100 font-semibold break-all">{order.escrowTxHash || 'Sandbox Ledger'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs">
          <div>
            <div className="text-slate-500 dark:text-slate-400">INR Amount</div>
            <div className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatInrFromPaise(order.inrPaise)}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">{assetSym} Quantity</div>
            <div className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {displayQty}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Rate &amp; Rail</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {formatRateInr(order.rateInrPaise)} · {PAYMENT_METHOD_LABELS[order.paymentMethod]}
            </div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400">Risk Triage</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {order.riskScore}/100 ({order.riskLevel})
            </div>
          </div>
        </div>

        {/* Escrow & Tax Notice */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-blue-600" />
            <span>
              Escrow: <strong className="text-slate-900 dark:text-slate-100">{order.escrowStatus}</strong>
              {order.escrowTxHash && (
                <span className="font-mono ml-2 text-slate-500">
                  ({order.escrowTxHash.slice(0, 18)}...)
                </span>
              )}
              {order.releaseConfirmed2FA && (
                <span className="ml-2 font-semibold text-emerald-700 dark:text-emerald-400">
                  · 2FA Confirmed
                </span>
              )}
            </span>
          </div>
          <div className="font-mono tabular-nums">
            Network: {networkLabel} · TDS: {formatInrFromPaise(order.tdsInrPaise)}
          </div>
        </div>

        {actionMsg && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionMsg}</span>
          </div>
        )}
        {errorMsg && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Overdue Expiration Callout */}
        {canExpireOverdue && (isBuyer || isSeller) && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="text-amber-950">
              <strong>Order payment window has elapsed.</strong> Expire this overdue order to unlock
              any reserved sandbox escrow.
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleExpireOrder()}
              className="px-4 py-2 font-semibold text-white bg-amber-900 rounded-lg hover:bg-amber-800 shrink-0 cursor-pointer"
            >
              Expire Order & Refund Escrow
            </button>
          </div>
        )}

        {/* Action Controls Based on Role & Status */}
        {!isTerminal && (
          <div className="border border-slate-200 rounded-xl p-5 space-y-4">
            {isSeller && ['CREATED', 'AWAITING_ACCEPTANCE', 'ACCEPTED'].includes(order.status) && (
              <div className="space-y-3">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Step 1: Accept Order & Reserve Escrow
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Reserves {displayQty} in your sandbox escrow ledger
                  before the buyer initiates the INR transfer.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSellerAcceptAndReserve()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                  >
                    Accept & Lock Escrow
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowCancelConfirm(true)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Decline / Cancel
                  </button>
                </div>
              </div>
            )}

            {isBuyer && ['CREATED', 'AWAITING_ACCEPTANCE'].includes(order.status) && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-600">
                  Awaiting seller acceptance and escrow reservation. Do not transfer INR until
                  escrow is reserved.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowCancelConfirm(true)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 shrink-0 cursor-pointer"
                >
                  Cancel Order
                </button>
              </div>
            )}

            {isBuyer && ['ESCROW_RESERVED', 'PAYMENT_PENDING'].includes(order.status) && (
              <form onSubmit={handleBuyerSubmitPayment} className="space-y-4">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Step 2: Complete INR Transfer & Submit UTR Reference
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <div className="md:col-span-8 space-y-2 text-xs text-slate-700">
                    <div>
                      Pay exact INR amount:{' '}
                      <strong className="font-mono text-slate-900">
                        {formatInrFromPaise(order.inrPaise)}
                      </strong>{' '}
                      via <strong>{PAYMENT_METHOD_LABELS[order.paymentMethod]}</strong>.
                    </div>
                    {order.paymentMethod === 'UPI' ? (
                      <div>
                        UPI Handle:{' '}
                        <span className="font-mono font-semibold text-slate-900">
                          {payeeUpiHandle}
                        </span>
                      </div>
                    ) : (
                      <div>
                        Settlement Rail:{' '}
                        <span className="font-mono text-slate-900">
                          {order.paymentAccountSnapshot || `${PAYMENT_METHOD_LABELS[order.paymentMethod]} — Counterparty ${order.sellerUsername}`}
                        </span>
                      </div>
                    )}
                    <p className="text-slate-500">
                      Enter the 8–40 character bank UTR / UPI reference ID below. Screenshots alone
                      never authorize USDT release.
                    </p>
                  </div>

                  {order.paymentMethod === 'UPI' && upiQrDataUrl && (
                    <div className="md:col-span-4 flex flex-col items-center gap-1.5">
                      <img
                        src={upiQrDataUrl}
                        alt="UPI Payment QR"
                        className="w-28 h-28 rounded-lg border border-slate-200 bg-white p-1"
                      />
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                        <QrCode className="w-3 h-3" /> UPI Intent QR
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    required
                    minLength={8}
                    maxLength={40}
                    placeholder="Enter UTR / UPI Reference (e.g., UTR4092817362)"
                    value={utrInput}
                    onChange={(e) => setUtrInput(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    Verify & Mark Paid (Sandbox)
                  </button>
                </div>
              </form>
            )}

            {isSeller && order.status === 'PAYMENT_SUBMITTED' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  Step 3: Independently Verify INR Receipt &amp; Release {assetSym}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Buyer submitted reference{' '}
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {order.paymentRef || 'N/A'}
                  </span>
                  . Confirm the funds actually settled in your bank statement before releasing.
                </p>

                {privateProfile?.twoFactorEnabled && privateProfile.totpSealedSecret && (
                  <div className="max-w-xs">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      2FA Authenticator Code (Required for Release)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6-digit TOTP"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono tracking-widest"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowReleaseConfirm(true)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                  >
                    Confirm INR Received &amp; Release {assetSym}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDispute(true)}
                    className="px-4 py-2 text-xs font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer"
                  >
                    Payment Not Received — Open Dispute
                  </button>
                </div>
              </div>
            )}

            {isBuyer && order.status === 'PAYMENT_SUBMITTED' && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-600">
                  UTR <span className="font-mono font-semibold">{order.paymentRef}</span>{' '}
                  submitted. Waiting for seller bank verification and USDT release.
                </p>
                <button
                  type="button"
                  onClick={() => setShowDispute(true)}
                  className="px-3.5 py-2 text-xs font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50 shrink-0 cursor-pointer"
                >
                  Open Dispute
                </button>
              </div>
            )}
          </div>
        )}

        {/* Dispute Creation Inline Form */}
        {showDispute && !isTerminal && (
          <form onSubmit={handleOpenDispute} className="border border-red-200 bg-red-50/40 rounded-xl p-4 space-y-3">
            <h4 className="text-sm font-semibold text-slate-900">Raise Order Dispute</h4>
            <select
              value={disputeCategory}
              onChange={(e) => setDisputeCategory(e.target.value as typeof disputeCategory)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
            >
              <option value="PAYMENT_NOT_RECEIVED">Payment Not Received</option>
              <option value="PAYMENT_NOT_ACKNOWLEDGED">Payment Sent But Not Acknowledged</option>
              <option value="INCORRECT_AMOUNT">Incorrect Amount</option>
              <option value="SELLER_NOT_RELEASING">Seller Not Releasing USDT</option>
              <option value="BUYER_NOT_PAYING">Buyer Not Paying</option>
              <option value="DUPLICATE_PAYMENT">Duplicate Payment</option>
              <option value="SUSPICIOUS_TRANSACTION">Suspicious Transaction</option>
              <option value="OTHER">Other</option>
            </select>
            <textarea
              required
              rows={3}
              value={disputeDesc}
              onChange={(e) => setDisputeDesc(e.target.value)}
              placeholder="Provide UTR reference, timestamp, and discrepancy details."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDispute(false)}
                className="px-3 py-1.5 text-xs text-slate-600 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 cursor-pointer"
              >
                Submit Dispute
              </button>
            </div>
          </form>
        )}

        {/* Buyer Rating after Completion */}
        {isBuyer && order.status === 'COMPLETED' && !order.buyerRating && (
          <form onSubmit={handleSubmitRating} className="border border-slate-200 rounded-xl p-4 space-y-3">
            <h4 className="text-sm font-semibold text-slate-900">Rate This Trade</h4>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRatingVal(n)}
                  className={`px-3 py-1 text-xs font-mono rounded-md border cursor-pointer ${
                    ratingVal === n
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 text-slate-700'
                  }`}
                >
                  {n} / 5
                </button>
              ))}
            </div>
            <input
              type="text"
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              placeholder="Optional feedback (min 10 chars to submit for public review approval)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              Submit Rating
            </button>
          </form>
        )}

        {/* Two-Column Counterparty Chat & Audit Timeline */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Real-Time Order Chat */}
          <div className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-600" />
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Counterparty Order Chat
              </h3>
            </div>
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1 text-xs">
              {messages.length === 0 ? (
                <p className="text-slate-400 py-4 text-center">
                  No messages yet. Coordinate bank verification or UTR checks here.
                </p>
              ) : (
                messages.map((m) => {
                  const mine = m.senderUid === user.uid;
                  return (
                    <div
                      key={m.id}
                      className={`p-2.5 rounded-lg border ${
                        mine
                          ? 'bg-blue-50 border-blue-100 ml-6'
                          : 'bg-slate-50 border-slate-200 mr-6'
                      }`}
                    >
                      <div className="flex justify-between text-[11px] text-slate-500 mb-0.5">
                        <span className="font-semibold text-slate-800">
                          @{m.senderUsername} · {m.senderRole}
                        </span>
                        <span className="font-mono">
                          {m.createdAt?.toDate
                            ? m.createdAt.toDate().toLocaleTimeString()
                            : 'Sending'}
                        </span>
                      </div>
                      <p className="text-slate-800">{m.body}</p>
                    </div>
                  );
                })
              )}
            </div>
            <form onSubmit={handleSendChat} className="flex gap-2 pt-2 border-t border-slate-100">
              <input
                type="text"
                maxLength={500}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Send verified order message..."
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              />
              <button
                type="submit"
                disabled={sendingChat || !chatInput.trim()}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                <Send className="w-3 h-3" />
                Send
              </button>
            </form>
          </div>

          {/* Audit Event Timeline */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Order Audit Timeline
            </h3>
            <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {events.map((ev) => (
                <div key={ev.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {ev.action} ({ev.fromStatus} → {ev.toStatus})
                    </div>
                    <div className="text-slate-600 mt-0.5">{ev.note}</div>
                  </div>
                  <div className="font-mono text-slate-400 shrink-0">
                    {ev.createdAt?.toDate ? ev.createdAt.toDate().toLocaleTimeString() : 'Pending'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showReleaseConfirm}
        title={`Release Escrow ${assetSym}?`}
        description={`Confirm that you independently verified ${formatInrFromPaise(order.inrPaise)} settled in your own bank account under UTR ${order.paymentRef || 'N/A'}. Releasing ${displayQty} cannot be undone.`}
        confirmLabel={`Release ${assetSym} Settlement`}
        tone="primary"
        busy={busy}
        onConfirm={handleSellerConfirmAndRelease}
        onCancel={() => setShowReleaseConfirm(false)}
      />

      <ConfirmDialog
        open={showCancelConfirm}
        title="Cancel This Order?"
        description={`Order ${order.orderCode} will be marked CANCELLED and closed immediately.`}
        confirmLabel="Confirm Cancellation"
        tone="danger"
        busy={busy}
        onConfirm={handleCancelOrder}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </div>
  );
}
