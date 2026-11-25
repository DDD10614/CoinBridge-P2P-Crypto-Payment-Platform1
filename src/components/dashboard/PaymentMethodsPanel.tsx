import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Trash2 } from 'lucide-react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  buildUpiPaymentUri,
  formatInrFromPaise,
  isValidIfsc,
  isValidUpi,
  maskAccountNumber,
  PAYMENT_METHOD_LABELS,
  PaymentMethodType,
} from '../../lib/domain';
import { addPaymentAccount, deletePaymentAccount } from '../../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { useAuth } from '../../context/AuthContext';
import { PaymentAccountDoc, PaymentRecordDoc } from '../../types/models';

export function PaymentMethodsPanel() {
  const { user, privateProfile } = useAuth();
  const [accounts, setAccounts] = useState<PaymentAccountDoc[]>([]);
  const [records, setRecords] = useState<PaymentRecordDoc[]>([]);
  const [qrPreview, setQrPreview] = useState<{ id: string; url: string; upiId: string } | null>(null);

  const [methodType, setMethodType] = useState<PaymentMethodType>('UPI');
  const [holderName, setHolderName] = useState(privateProfile?.fullLegalName || '');
  const [bankName, setBankName] = useState('');
  const [accountNum, setAccountNum] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [upiId, setUpiId] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const u1 = onSnapshot(
      query(collection(db, 'payment_accounts'), where('uid', '==', user.uid)),
      (snap) => {
        const list: PaymentAccountDoc[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<PaymentAccountDoc, 'id'>) }));
        setAccounts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'payment_accounts')
    );

    const u2 = onSnapshot(
      query(
        collection(db, 'payment_records'),
        where('uid', '==', user.uid),
        orderBy('createdAt', 'desc')
      ),
      (snap) => {
        setRecords(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PaymentRecordDoc, 'id'>) }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'payment_records')
    );

    return () => {
      u1();
      u2();
    };
  }, [user]);

  const handlePreviewQr = async (acc: PaymentAccountDoc) => {
    if (!acc.upiId) return;
    if (qrPreview?.id === acc.id) {
      setQrPreview(null);
      return;
    }
    const uri = buildUpiPaymentUri({
      upiId: acc.upiId,
      payeeName: acc.accountHolderName,
      amountInrPaise: 100_000,
      orderCode: 'PREVIEW',
    });
    const url = await QRCode.toDataURL(uri, { width: 150, margin: 1 });
    setQrPreview({ id: acc.id, url, upiId: acc.upiId });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setErrorMsg(null);

    if (holderName.trim().length < 2) {
      setErrorMsg('Account holder name is required and must match your KYC legal name.');
      return;
    }
    if (methodType === 'UPI') {
      if (!isValidUpi(upiId)) {
        setErrorMsg('Please enter a valid UPI ID (e.g., name@okaxis).');
        return;
      }
    } else {
      if (accountNum.replace(/\s+/g, '').length < 6 || !isValidIfsc(ifsc)) {
        setErrorMsg('Please enter a valid bank account number and 11-character IFSC code.');
        return;
      }
    }

    setBusy(true);
    try {
      await addPaymentAccount({
        uid: user.uid,
        methodType,
        accountHolderName: holderName,
        bankName: bankName || undefined,
        maskedAccountNumber: accountNum ? maskAccountNumber(accountNum) : undefined,
        ifsc: ifsc || undefined,
        upiId: upiId || undefined,
      });
      setAccountNum('');
      setIfsc('');
      setUpiId('');
      setBankName('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save payment method.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-900">
          INR Payment Accounts &amp; Reconciliation
        </h2>
        <p className="text-sm text-slate-600">
          Bank numbers are masked on save and isolated to your account. Compliance officers verify
          payment rails before elevated limits apply.
        </p>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleAdd} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="font-display text-base font-semibold text-slate-900">
          Add INR Settlement Rail (UPI / IMPS / NEFT / RTGS)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Method</label>
            <select
              value={methodType}
              onChange={(e) => setMethodType(e.target.value as PaymentMethodType)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm bg-white"
            >
              <option value="UPI">UPI</option>
              <option value="IMPS">IMPS</option>
              <option value="NEFT">NEFT</option>
              <option value="RTGS">RTGS</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Account Holder Name
            </label>
            <input
              type="text"
              required
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm"
            />
          </div>

          {methodType === 'UPI' ? (
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">UPI ID</label>
              <input
                type="text"
                required
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="name@okicici"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Bank Name</label>
                <input
                  type="text"
                  required
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="HDFC Bank"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">IFSC Code</label>
                <input
                  type="text"
                  required
                  maxLength={11}
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  placeholder="HDFC0001234"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono uppercase"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Account Number (stored masked)
                </label>
                <input
                  type="text"
                  required
                  value={accountNum}
                  onChange={(e) => setAccountNum(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono"
                />
              </div>
            </>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
        >
          {busy ? 'Saving...' : 'Save Payment Account'}
        </button>
      </form>

      {/* Saved Payment Rails */}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {accounts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No INR payment accounts added yet.
          </div>
        ) : (
          accounts.map((acc) => (
            <div key={acc.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-4 text-sm">
                <div>
                  <div className="font-semibold text-slate-900">
                    {PAYMENT_METHOD_LABELS[acc.methodType]} · {acc.accountHolderName}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    {acc.upiId
                      ? acc.upiId
                      : `${acc.bankName || 'Bank'} · ${acc.maskedAccountNumber || ''} · ${acc.ifsc || ''}`}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {acc.upiId && (
                    <button
                      type="button"
                      onClick={() => void handlePreviewQr(acc)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 border border-blue-200 rounded-md hover:bg-blue-50 cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      {qrPreview?.id === acc.id ? 'Hide QR' : 'UPI QR'}
                    </button>
                  )}
                  <span
                    className={`text-xs font-mono font-semibold ${
                      acc.verificationStatus === 'VERIFIED'
                        ? 'text-emerald-700'
                        : acc.verificationStatus === 'REJECTED'
                        ? 'text-red-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {acc.verificationStatus}
                  </span>
                  <button
                    type="button"
                    onClick={() => void deletePaymentAccount(acc.id)}
                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                    aria-label="Remove payment account"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {qrPreview?.id === acc.id && (
                <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
                  <img
                    src={qrPreview.url}
                    alt="UPI Payment Intent QR"
                    className="w-24 h-24 rounded border border-slate-200 bg-white p-1"
                  />
                  <div className="text-slate-600 space-y-1">
                    <div className="font-semibold text-slate-900">UPI Intent QR Preview</div>
                    <div className="font-mono">{qrPreview.upiId}</div>
                    <div>Dynamic per-order INR amount QR is generated inside each active trade.</div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* INR Payment Reconciliation History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="font-display text-base font-semibold text-slate-900">
            INR Payment Reconciliation History ({records.length})
          </h3>
        </div>
        {records.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No INR UTR submissions recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Order</th>
                  <th className="py-2.5 px-4 font-medium">Rail</th>
                  <th className="py-2.5 px-4 font-medium">UTR / Reference</th>
                  <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((rec) => (
                  <tr key={rec.id}>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">{rec.orderCode}</td>
                    <td className="py-3 px-4 text-slate-700">{PAYMENT_METHOD_LABELS[rec.method]}</td>
                    <td className="py-3 px-4 font-mono text-slate-800">{rec.referenceId}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                      {formatInrFromPaise(rec.inrPaise)}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-700">
                      {rec.status} {rec.isSandbox ? '(Sandbox)' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
