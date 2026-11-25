import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Video,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  getKycExpiryStatus,
  isKycStatusVerified,
  isValidIfsc,
  isValidPan,
  maskPan,
} from '../../lib/domain';
import { submitKycApplication } from '../../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { useAuth } from '../../context/AuthContext';
import { KycSubmissionDoc } from '../../types/models';

export function KycPanel() {
  const { user, account, privateProfile, getIdToken } = useAuth();
  const [submission, setSubmission] = useState<KycSubmissionDoc | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  const [fullLegalName, setFullLegalName] = useState(privateProfile?.fullLegalName || '');
  const [dateOfBirth, setDateOfBirth] = useState('1995-06-15');
  const [country, setCountry] = useState('India');
  const [residentialAddress, setResidentialAddress] = useState('');

  const [idType, setIdType] = useState<'PAN' | 'PASSPORT' | 'AADHAAR_MASKED' | 'DRIVING_LICENSE'>(
    'PAN'
  );
  const [rawIdNumber, setRawIdNumber] = useState('');
  const [rawPan, setRawPan] = useState('');
  const [documentExpiry, setDocumentExpiry] = useState('2032-12-31');

  // Video KYC challenge & live capture
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedFrameB64, setCapturedFrameB64] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<{
    challengeId: string;
    digits: string;
    prompt: string;
    providerMode: string;
  } | null>(null);
  const [spokenDigits, setSpokenDigits] = useState('');
  const [videoVerifyResult, setVideoVerifyResult] = useState<{
    videoStatus: 'LIVENESS_PASSED' | 'MANUAL_REVIEW';
    livenessScore: number;
    faceMatchScore: number;
    providerMode: string;
    advisorySummary: string;
  } | null>(null);

  const [accountHolderName, setAccountHolderName] = useState(privateProfile?.fullLegalName || '');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [sourceOfFunds, setSourceOfFunds] = useState('Salaried / Business Income');
  const [pepDeclared, setPepDeclared] = useState(false);
  const [sanctionsDeclaredClear, setSanctionsDeclaredClear] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [uploadReceipts, setUploadReceipts] = useState<
    Array<{
      docType: string;
      storedIn: string;
      objectPath: string;
      bytes: number;
      signedUrl: string | null;
      notice: string;
    }>
  >([]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'kyc_submissions'), where('uid', '==', user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!snap.empty) {
          const docSnap = snap.docs[0];
          setSubmission({ id: docSnap.id, ...(docSnap.data() as Omit<KycSubmissionDoc, 'id'>) });
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'kyc_submissions')
    );
    return () => unsub();
  }, [user]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const handleStartCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Browser camera access unavailable. Upload a selfie or use Sandbox Capture below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setCameraError(
        'Camera permission denied or blocked in preview iframe. You can upload a selfie image or verify via Sandbox Capture below.'
      );
    }
  };

  const handleCaptureFrame = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const commaIdx = dataUrl.indexOf(',');
    setCapturedFrameB64(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    stopCamera();
  };

  const handleGenerateChallenge = async () => {
    setErrorMsg(null);
    const token = await getIdToken();
    if (!token) {
      setErrorMsg('Sign in required to issue a Video KYC challenge.');
      return;
    }
    const resp = await fetch('/api/kyc/video/challenge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Could not generate Video KYC prompt.');
    } else {
      setChallenge(data);
      setVideoVerifyResult(null);
    }
  };

  const handleVerifyVideoLiveness = async () => {
    if (!challenge) return;
    setErrorMsg(null);
    const token = await getIdToken();
    if (!token) return;
    const captureMethod = capturedFrameB64
      ? 'WEBCAM_STREAM'
      : uploadReceipts.some((r) => r.docType === 'SELFIE')
      ? 'UPLOADED_CLIP'
      : 'SANDBOX_SIMULATOR';

    const resp = await fetch('/api/kyc/video/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        spokenDigits: spokenDigits.trim(),
        captureMethod,
        hasDocumentUploaded: uploadReceipts.some((r) => r.docType === 'ID_FRONT'),
        frameBase64: capturedFrameB64 || undefined,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Video KYC verification failed.');
    } else {
      setVideoVerifyResult(data);
    }
  };

  const canResubmit =
    !submission ||
    ['NOT_STARTED', 'REJECTED', 'ADDITIONAL_INFO_REQUIRED', 'EXPIRED'].includes(
      submission.status
    ) ||
    account?.kycStatus === 'EXPIRED';

  const expiryStatus = getKycExpiryStatus({
    documentExpiry: submission?.documentExpiry,
    kycExpiresAtMs: account?.kycExpiresAtMs || submission?.kycExpiresAtMs,
  });

  const handleKycFileUpload = async (
    docType: 'ID_FRONT' | 'ID_BACK' | 'SELFIE',
    file: File | undefined
  ) => {
    if (!file || !user) return;
    setErrorMsg(null);
    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('KYC document file must be 2 MB or smaller.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      setErrorMsg('Only JPEG, PNG, or PDF documents are supported.');
      return;
    }

    const token = await getIdToken();
    if (!token) {
      setErrorMsg('Authentication token required for secure KYC upload.');
      return;
    }

    setUploadingDocType(docType);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(new Error('Failed to read selected file.'));
        reader.readAsDataURL(file);
      });

      const resp = await fetch('/api/integrations/supabase/kyc-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          docType,
          fileName: file.name,
          contentType: file.type,
          base64Data,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErrorMsg(data.error || 'Document upload failed.');
      } else {
        setUploadReceipts((prev) => [
          ...prev.filter((item) => item.docType !== docType),
          data,
        ]);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to upload document.');
    } finally {
      setUploadingDocType(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!user) return;
    if (fullLegalName.trim().length < 2 || residentialAddress.trim().length < 5) {
      setErrorMsg('Please complete Step 1 legal name and residential address.');
      return;
    }
    if (idType === 'PAN' && !isValidPan(rawIdNumber)) {
      setErrorMsg('Please enter a valid 10-character Indian PAN (e.g., ABCDE1234F).');
      return;
    }
    if (rawPan && !isValidPan(rawPan)) {
      setErrorMsg('Entered PAN format is invalid.');
      return;
    }
    if (!videoVerifyResult) {
      setErrorMsg('Please complete Step 3 Video KYC challenge & liveness verification first.');
      return;
    }
    if (!isValidIfsc(bankIfsc)) {
      setErrorMsg('Please enter a valid 11-character IFSC code (e.g., HDFC0001234).');
      return;
    }
    if (bankAccountNumber.replace(/\s+/g, '').length < 6) {
      setErrorMsg('Please enter your bank account number (only the last 4 digits are stored).');
      return;
    }

    setSubmitting(true);
    try {
      const maskedId =
        idType === 'PAN'
          ? maskPan(rawIdNumber)
          : `****${rawIdNumber.trim().slice(-4).toUpperCase()}`;

      await submitKycApplication({
        uid: user.uid,
        existingId: submission?.id,
        existingHistory: submission?.verificationHistory,
        fullLegalName,
        dateOfBirth,
        country,
        residentialAddress,
        idType,
        maskedIdNumber: maskedId,
        panMasked: rawPan ? maskPan(rawPan) : idType === 'PAN' ? maskPan(rawIdNumber) : undefined,
        documentExpiry,
        livenessMethod: 'VIDEO_KYC_ADAPTER',
        videoStatus: videoVerifyResult.videoStatus,
        videoChallengePrompt: challenge?.prompt,
        livenessScore: videoVerifyResult.livenessScore,
        faceMatchScore: videoVerifyResult.faceMatchScore,
        providerMode: videoVerifyResult.providerMode,
        bankAccountLast4: bankAccountNumber.replace(/\s+/g, '').slice(-4),
        bankIfsc,
        accountHolderName,
        pepDeclared,
        sanctionsDeclaredClear,
        sourceOfFunds,
      });

      setSuccessMsg('Video KYC dossier submitted for mandatory compliance officer review.');
      setRawIdNumber('');
      setRawPan('');
      setBankAccountNumber('');
      setStep(5);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to submit KYC application.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-900">
          Video KYC &amp; Compliance Verification
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Complete identity verification, randomized Video KYC liveness challenge, and bank matching.
          Genuine accounts undergo manual compliance review—never auto-approved or conflated with
          fictional DEMO profiles.
        </p>
      </div>

      {/* Current Status & Expiry Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          {isKycStatusVerified(account?.kycStatus) && expiryStatus.status !== 'EXPIRED' ? (
            <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
          ) : (
            <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0" />
          )}
          <div>
            <div className="text-xs text-slate-500">Current Verification Status</div>
            <div className="font-display text-lg font-bold text-slate-900">
              {(submission?.status || account?.kycStatus || 'NOT_STARTED').replace(/_/g, ' ')}
            </div>
            {submission?.reviewerNote && (
              <p className="text-xs text-slate-600 mt-1">
                Compliance Note: {submission.reviewerNote}
              </p>
            )}
            {expiryStatus.status !== 'UNSET' && (
              <p
                className={`text-xs mt-1 flex items-center gap-1 ${
                  expiryStatus.status === 'EXPIRED'
                    ? 'text-red-700 font-semibold'
                    : expiryStatus.status === 'EXPIRING_SOON'
                    ? 'text-amber-700 font-semibold'
                    : 'text-slate-500'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>{expiryStatus.message}</span>
              </p>
            )}
          </div>
        </div>
        {submission && (
          <div className="text-xs font-mono text-slate-500 text-right space-y-0.5">
            <div>ID: {submission.idType} ({submission.maskedIdNumber})</div>
            <div>Bank: •••• {submission.bankAccountLast4} · {submission.bankIfsc}</div>
            {typeof submission.livenessScore === 'number' && (
              <div>
                Liveness {submission.livenessScore}% · Match {submission.faceMatchScore ?? '—'}%
              </div>
            )}
          </div>
        )}
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900">
          {errorMsg}
        </div>
      )}

      {canResubmit ? (
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          {/* 5-Step Tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-slate-100 p-1 rounded-lg">
            {[
              [1, '1. Profile'],
              [2, '2. ID & Expiry'],
              [3, '3. Video KYC'],
              [4, '4. Bank & AML'],
              [5, '5. History'],
            ].map(([idx, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setStep(idx as 1 | 2 | 3 | 4 | 5)}
                className={`py-2 px-2.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                  step === idx ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Full Legal Name (as on PAN/Bank)
                </label>
                <input
                  type="text"
                  required
                  value={fullLegalName}
                  onChange={(e) => setFullLegalName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  required
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Country</label>
                <input
                  type="text"
                  required
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Residential Address
                </label>
                <input
                  type="text"
                  required
                  value={residentialAddress}
                  onChange={(e) => setResidentialAddress(e.target.value)}
                  placeholder="House/Flat, Street, City, State, PIN Code"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Identity Document Type
                </label>
                <select
                  value={idType}
                  onChange={(e) => setIdType(e.target.value as typeof idType)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm bg-white"
                >
                  <option value="PAN">Indian PAN Card</option>
                  <option value="PASSPORT">Passport</option>
                  <option value="AADHAAR_MASKED">Masked Aadhaar (Last 4 Only)</option>
                  <option value="DRIVING_LICENSE">Driving License</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Document Number (Masked before save)
                </label>
                <input
                  type="text"
                  required
                  value={rawIdNumber}
                  onChange={(e) => setRawIdNumber(e.target.value)}
                  placeholder={idType === 'PAN' ? 'ABCDE1234F' : 'Document ID'}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono uppercase"
                />
              </div>
              {idType !== 'PAN' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    PAN Card (Optional / Sec 194S Tax Reporting)
                  </label>
                  <input
                    type="text"
                    value={rawPan}
                    onChange={(e) => setRawPan(e.target.value)}
                    placeholder="ABCDE1234F"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono uppercase"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Document / KYC Expiry Date
                </label>
                <input
                  type="date"
                  value={documentExpiry}
                  onChange={(e) => setDocumentExpiry(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              {/* Document Upload Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(
                  [
                    ['ID_FRONT', 'ID Front (JPEG/PNG/PDF)'],
                    ['ID_BACK', 'ID Back (Optional)'],
                    ['SELFIE', 'Selfie Fallback (Optional)'],
                  ] as const
                ).map(([docType, label]) => (
                  <label
                    key={docType}
                    className="border border-slate-200 rounded-lg p-3 text-xs space-y-1.5 block cursor-pointer hover:bg-slate-50"
                  >
                    <span className="font-semibold text-slate-800 block">{label}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      disabled={uploadingDocType === docType}
                      onChange={(e) => void handleKycFileUpload(docType, e.target.files?.[0])}
                      className="block w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-800"
                    />
                    {uploadingDocType === docType && (
                      <span className="text-blue-600 block">Uploading securely...</span>
                    )}
                  </label>
                ))}
              </div>

              {uploadReceipts.length > 0 && (
                <div className="space-y-2">
                  {uploadReceipts.map((rec) => (
                    <div
                      key={rec.docType}
                      className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs flex flex-wrap justify-between gap-2"
                    >
                      <span className="font-semibold text-slate-900">
                        {rec.docType} ({(rec.bytes / 1024).toFixed(1)} KB) · {rec.storedIn}
                      </span>
                      {rec.signedUrl && (
                        <a
                          href={rec.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 font-medium hover:underline"
                        >
                          Signed Preview
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Video KYC Challenge & Camera */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-4 bg-slate-50/70">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4 text-blue-600" />
                    <span className="font-display text-sm font-semibold text-slate-900">
                      Video KYC Liveness Challenge &amp; Face Match Triage
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleGenerateChallenge()}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                  >
                    {challenge ? 'New Challenge Code' : 'Generate Challenge Prompt'}
                  </button>
                </div>

                {challenge && (
                  <div className="p-3.5 rounded-lg bg-white border border-blue-200 text-xs space-y-2">
                    <div className="font-semibold text-blue-900">
                      Live Verification Instruction:
                    </div>
                    <p className="text-slate-800">{challenge.prompt}</p>
                    <div className="font-mono text-base font-bold text-blue-700">
                      Code: {challenge.digits}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {!cameraActive ? (
                    <button
                      type="button"
                      onClick={() => void handleStartCamera()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Enable Live Camera Preview
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleCaptureFrame}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
                      >
                        Capture Video KYC Frame
                      </button>
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg cursor-pointer"
                      >
                        Stop Camera
                      </button>
                    </>
                  )}
                  {capturedFrameB64 && (
                    <span className="text-xs font-semibold text-emerald-700">
                      Live frame captured for triage
                    </span>
                  )}
                </div>

                {cameraError && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    {cameraError}
                  </p>
                )}

                {cameraActive && (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full max-w-sm rounded-lg border border-slate-300 bg-slate-900"
                  />
                )}

                {challenge && (
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="Confirm 4-digit spoken code"
                      value={spokenDigits}
                      onChange={(e) => setSpokenDigits(e.target.value.replace(/\D/g, ''))}
                      className="sm:w-56 rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => void handleVerifyVideoLiveness()}
                      className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 cursor-pointer"
                    >
                      Run Liveness &amp; Face Match Check
                    </button>
                  </div>
                )}

                {videoVerifyResult && (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1">
                    <div className="font-semibold">
                      Video Triage Status: {videoVerifyResult.videoStatus} · Liveness{' '}
                      {videoVerifyResult.livenessScore}% · Face Match{' '}
                      {videoVerifyResult.faceMatchScore}%
                    </div>
                    <p>{videoVerifyResult.advisorySummary}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bank Account Holder Name
                  </label>
                  <input
                    type="text"
                    required
                    value={accountHolderName}
                    onChange={(e) => setAccountHolderName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bank IFSC Code
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={11}
                    value={bankIfsc}
                    onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                    placeholder="HDFC0001234"
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bank Account Number (Last 4 stored)
                  </label>
                  <input
                    type="text"
                    required
                    value={bankAccountNumber}
                    onChange={(e) => setBankAccountNumber(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Source of Funds
                  </label>
                  <input
                    type="text"
                    required
                    value={sourceOfFunds}
                    onChange={(e) => setSourceOfFunds(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2 text-xs text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pepDeclared}
                    onChange={(e) => setPepDeclared(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>I am a Politically Exposed Person (PEP) or close associate</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sanctionsDeclaredClear}
                    onChange={(e) => setSanctionsDeclaredClear(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    I confirm I am not subject to UN / OFAC / Indian MHA sanctions lists
                  </span>
                </label>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3 text-xs">
              <div className="font-semibold text-slate-900">Verification History Timeline</div>
              {submission?.verificationHistory && submission.verificationHistory.length > 0 ? (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {submission.verificationHistory.map((item) => (
                    <div key={item} className="p-3 font-mono text-slate-700">
                      {item}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500">
                  No verification history entries recorded yet. Complete Steps 1–4 and submit your
                  dossier for manual compliance review.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4 | 5) : s))}
              disabled={step === 1}
              className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>
            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s < 5 ? ((s + 1) as 1 | 2 | 3 | 4 | 5) : s))}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                Next Step
              </button>
            ) : step === 4 ? (
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {submitting ? 'Submitting Video KYC...' : 'Submit Video KYC for Review'}
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 text-sm text-slate-600">
          <div>
            Your Video KYC dossier is currently{' '}
            <strong className="text-slate-900">{submission?.status}</strong>. Genuine KYC approvals
            are performed strictly by human compliance officers in the Compliance Desk.
          </div>
          {submission?.verificationHistory && submission.verificationHistory.length > 0 && (
            <div className="border-t border-slate-200 pt-3 space-y-1 text-xs">
              <div className="font-semibold text-slate-800">Audit Verification History</div>
              {submission.verificationHistory.map((h) => (
                <div key={h} className="font-mono text-slate-600">
                  • {h}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
