import React from 'react';
import { ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { getKycRestrictionDetails, KycStatus } from '../lib/domain';

interface KycRestrictionModalProps {
  open: boolean;
  kycStatus: KycStatus;
  reasonMessage: string;
  reasonCode: ReturnType<typeof getKycRestrictionDetails>['reasonCode'];
  onCompleteKyc: () => void;
  onViewStatus: () => void;
  onClose: () => void;
}

export function KycRestrictionModal({
  open,
  kycStatus,
  reasonMessage,
  reasonCode,
  onCompleteKyc,
  onViewStatus,
  onClose,
}: KycRestrictionModalProps) {
  if (!open) return null;

  const statusLabel = kycStatus.replace(/_/g, ' ');
  const isErrorTone =
    kycStatus === 'REJECTED' || kycStatus === 'SUSPENDED' || kycStatus === 'EXPIRED';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kyc-restriction-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                isErrorTone ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="kyc-restriction-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                Complete KYC Verification
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Mandatory Compliance Gate · Trading Restricted
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close verification notice"
            className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-slate-700 leading-relaxed">
          To protect our trading community and comply with verification requirements, you must
          complete identity verification before buying or selling USDT.
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500 font-medium">Current KYC Status</span>
            <span
              className={`font-mono font-bold uppercase ${
                isErrorTone ? 'text-red-700' : 'text-amber-800'
              }`}
            >
              {statusLabel}
            </span>
          </div>
          <div className="text-slate-600">{reasonMessage}</div>
          {reasonCode === 'KYC_EXPIRED' && (
            <div className="text-red-700 font-medium">
              Your previous KYC validity period has expired. Re-verification is required.
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
          <button
            type="button"
            onClick={onCompleteKyc}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            Complete KYC
          </button>
          <button
            type="button"
            onClick={onViewStatus}
            className="flex-1 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            View Verification Status
          </button>
        </div>
      </div>
    </div>
  );
}
