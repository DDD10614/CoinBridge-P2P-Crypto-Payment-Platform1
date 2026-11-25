import React, { useState } from 'react';
import { CheckCircle2, Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  BLOCKCHAIN_NETWORKS,
  formatInrFromPaise,
  formatRateInr,
  formatUsdtFromMicro,
} from '../lib/domain';
import { createSupportTicket } from '../lib/firestoreService';

export function HowItWorksPage() {
  const steps = [
    {
      title: '01. User Registration & Authentication',
      body: 'Authenticate securely via verified Google Sign-In. Every session issues a server-verified authentication token and isolates personal PII in owner-restricted collections.',
    },
    {
      title: '02. KYC & Bank Ownership Verification',
      body: 'Submit basic identity details, PAN or government ID (stored masked), live verification check, bank account IFSC/last-4 matching, and PEP/sanctions declarations before full trading.',
    },
    {
      title: '03. Non-Custodial Wallet Connection',
      body: 'Link your TRON, Ethereum, Polygon, or BNB Smart Chain wallet via browser provider signature. CoinBridge P2P never asks for private keys or seed phrases.',
    },
    {
      title: '04. Finding Verified Counterparties',
      body: 'Filter Buy USDT and Sell USDT offers by INR order amount, UPI/IMPS/NEFT/RTGS rail, completion rate, and merchant verification tier.',
    },
    {
      title: '05. Atomic Order Creation & Risk Screening',
      body: 'Confirm order terms and review fee + Section 194S 1% TDS breakdown. Orders undergo deterministic + AI-assisted risk triage (0–100) before execution.',
    },
    {
      title: '06. Escrow Reservation',
      body: 'The seller reserves the exact USDT amount in the escrow mechanism before INR payment begins, preventing mid-trade double-spending.',
    },
    {
      title: '07. INR Payment Execution & UTR Submission',
      body: 'Buyer transfers INR directly using the verified payment rail and submits the unique UTR / bank reference ID. Screenshots alone are never treated as payment confirmation.',
    },
    {
      title: '08. Independent Payment Confirmation & Settlement',
      body: 'Seller verifies actual INR receipt in their own bank/UPI account (or Sandbox Payment Simulator in testing) and authorizes escrow release to the buyer.',
    },
    {
      title: '09. Wallet Reconciliation & Audit History',
      body: 'Every state transition, transaction hash, and fee deduction is recorded in an immutable order event subcollection and wallet ledger.',
    },
    {
      title: '10. Structured Dispute Resolution',
      body: 'If payment is delayed, mismatched, or disputed, either party can freeze settlement and escalate evidence to Compliance & Support Officers.',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-10">
      <div className="space-y-3">
        <div className="text-xs font-medium text-blue-700">Platform Architecture</div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
          How CoinBridge P2P Works
        </h1>
        <p className="text-slate-600 text-base max-w-3xl">
          From KYC onboarding to escrow reservation, independent INR verification, and dispute
          handling—every stage enforces explicit state checks.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {steps.map((s) => (
          <div key={s.title} className="bg-white border border-slate-200 rounded-xl p-6 space-y-2">
            <h2 className="font-display text-base font-semibold text-slate-900">{s.title}</h2>
            <p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SecurityPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-10">
      <div className="space-y-3">
        <div className="text-xs font-medium text-blue-700">Security & India Compliance</div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
          Security Architecture & Regulatory Controls
        </h1>
        <p className="text-slate-600 text-base max-w-3xl">
          Peer-to-peer digital asset transfers involve inherent counterparty, operational, and
          regulatory risks. No exchange can guarantee zero fraud. Below are the controls active in
          this platform.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-950 space-y-1">
          <div className="font-semibold">Pre-Production Legal & Audit Notice</div>
          <p>
            Before enabling real-money INR/USDT trading, operators must complete Indian legal and
            compliance review covering PMLA, FIU-IND registration, Section 194S TDS withholding,
            DPDP Act data protection, RBI payment-aggregator rules, and independent smart-contract
            security audits.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[
          {
            icon: ShieldCheck,
            title: 'KYC, Sanctions & Bank Name Matching',
            desc: 'KYC dossiers store masked PAN/IDs and last-4 bank digits in owner/compliance-isolated collections. Support agents cannot browse unrestricted identity or financial tables.',
          },
          {
            icon: Lock,
            title: 'AI-Assisted Risk Engine (Human-in-the-Loop)',
            desc: 'Each order receives a 0–100 risk score evaluating KYC status, INR thresholds, prior disputes, and account history. Scores support human compliance review and never establish criminal conduct automatically.',
          },
          {
            icon: CheckCircle2,
            title: 'No Screenshot-Only Crypto Release',
            desc: 'Uploading an image never releases USDT. Orders require UTR / bank reference submission, duplicate-UTR detection, and independent seller bank confirmation.',
          },
          {
            icon: Lock,
            title: 'Atomic State Locks & Non-Custodial Keys',
            desc: 'Firestore security rules enforce strict order state transitions, terminal state locking, and immutable audit logs. Wallet private keys and seed phrases are never requested or stored.',
          },
        ].map((card) => (
          <div key={card.title} className="bg-white border border-slate-200 rounded-xl p-6 space-y-2.5">
            <card.icon className="w-5 h-5 text-blue-600" />
            <h2 className="font-display text-base font-semibold text-slate-900">{card.title}</h2>
            <p className="text-sm text-slate-600 leading-relaxed">{card.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeesAndLimitsPage() {
  const { platformSettings } = useAuth();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-10">
      <div className="space-y-3">
        <div className="text-xs font-medium text-blue-700">Live Admin-Configured Schedule</div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
          Fees, Tax Disclosures & Order Limits
        </h1>
        <p className="text-slate-600 text-base max-w-3xl">
          All trading fees, commission schedules, and INR transaction limits below are loaded live
          from platform configuration managed by administrators.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-slate-900">Trading & Network Fees</h2>
          <div className="divide-y divide-slate-100 text-sm">
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">Buyer Trading Fee</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {(platformSettings.buyerFeeBps / 100).toFixed(2)}%
              </span>
            </div>
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">Seller Trading Fee</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {(platformSettings.sellerFeeBps / 100).toFixed(2)}%
              </span>
            </div>
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">Default Merchant Commission</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {(platformSettings.merchantCommissionBps / 100).toFixed(2)}%
              </span>
            </div>
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">India VDA Sec 194S TDS Rate</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {(platformSettings.tdsRateBps / 100).toFixed(2)}%
              </span>
            </div>
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">Platform Deposit Fee</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {formatUsdtFromMicro(platformSettings.depositFeeUsdtMicro, 2)}
              </span>
            </div>
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">Platform Withdrawal Fee</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {formatUsdtFromMicro(platformSettings.withdrawalFeeUsdtMicro, 2)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-slate-900">INR Order & Volume Limits</h2>
          <div className="divide-y divide-slate-100 text-sm">
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">Minimum Single Order</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {formatInrFromPaise(platformSettings.minOrderInrPaise)}
              </span>
            </div>
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">Maximum Single Order</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {formatInrFromPaise(platformSettings.maxOrderInrPaise)}
              </span>
            </div>
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">Daily Trading Limit</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {formatInrFromPaise(platformSettings.dailyLimitInrPaise)}
              </span>
            </div>
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">Monthly Trading Limit</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {formatInrFromPaise(platformSettings.monthlyLimitInrPaise)}
              </span>
            </div>
            <div className="py-3 flex justify-between">
              <span className="text-slate-600">Configured Base Reference Rate</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {formatRateInr(platformSettings.baseUsdtInrPaise)} / USDT
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="font-display text-lg font-semibold text-slate-900">
          Network Gas & Confirmation Thresholds
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-2.5 pr-4 font-medium">Network</th>
                <th className="py-2.5 pr-4 font-medium">Token Standard</th>
                <th className="py-2.5 pr-4 font-medium">USDT Contract</th>
                <th className="py-2.5 pr-4 font-medium text-right">Confirmations</th>
                <th className="py-2.5 font-medium text-right">Est. Network Fee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.values(BLOCKCHAIN_NETWORKS).map((net) => (
                <tr key={net.id}>
                  <td className="py-3 pr-4 font-medium text-slate-900">{net.name}</td>
                  <td className="py-3 pr-4 text-slate-600">{net.tokenStandard}</td>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-500">
                    {net.usdtContractAddress}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-700">
                    {net.requiredConfirmations}
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums text-slate-900">
                    {formatUsdtFromMicro(net.estimatedNetworkFeeUsdtMicro, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function FaqAndContactPage({ initialTab = 'faq' }: { initialTab?: 'faq' | 'contact' }) {
  const { user, privateProfile } = useAuth();
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [name, setName] = useState(privateProfile?.fullLegalName || user?.displayName || '');
  const [email, setEmail] = useState(privateProfile?.email || user?.email || '');
  const [category, setCategory] = useState<
    'GENERAL' | 'KYC' | 'PAYMENT' | 'ESCROW' | 'DISPUTE' | 'MERCHANT' | 'COMPLIANCE'
  >('GENERAL');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const faqData = [
    {
      cat: 'BUYERS',
      q: 'What payment methods can I use to buy USDT?',
      a: 'Buyers can filter verified seller offers supporting UPI, IMPS, NEFT, RTGS, or domestic Bank Transfer. Always pay from a bank/UPI account matching your KYC legal name.',
    },
    {
      cat: 'SELLERS',
      q: 'When should I release USDT from escrow?',
      a: 'Only after you log into your own bank or UPI app and verify the exact INR amount and UTR reference have settled. Never release USDT based solely on an uploaded screenshot.',
    },
    {
      cat: 'KYC',
      q: 'What documents are required for KYC verification?',
      a: 'Step 1 collects legal name, DOB, and address; Step 2 collects PAN or Passport/Govt ID (stored masked); Step 3 records liveness verification; Step 4 verifies bank account IFSC ownership and PEP/sanctions declarations.',
    },
    {
      cat: 'WALLETS',
      q: 'Does CoinBridge store my private keys or seed phrase?',
      a: 'No. Wallet integration uses browser EIP-1193 provider signatures and public address verification. Never share private keys or seed phrases with anyone.',
    },
    {
      cat: 'DISPUTES',
      q: 'What happens if a counterparty fails to pay or release?',
      a: 'Either party can open a dispute inside the order workspace with the bank UTR reference and evidence summary. Escrow remains locked while Support & Compliance Officers review the audit trail.',
    },
    {
      cat: 'MERCHANTS',
      q: 'How do merchant limits and commissions work?',
      a: 'Approved merchants configure available USDT liquidity, spreads, and INR min/max limits. Commission rates and verification tiers (Basic, Verified, Premium) are governed by platform administrators.',
    },
  ];

  const filteredFaqs =
    categoryFilter === 'ALL' ? faqData : faqData.filter((f) => f.cat === categoryFilter);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2 || !email.includes('@') || subject.trim().length < 3 || message.trim().length < 10) {
      setError('Please fill in your name, valid email, subject, and a message of at least 10 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const id = await createSupportTicket({
        uid: user?.uid,
        name,
        email,
        category,
        subject,
        message,
      });
      setTicketId(id);
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit support ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 space-y-12">
      {initialTab === 'faq' && (
        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-2">
              <div className="text-xs font-medium text-blue-700">Knowledge Base</div>
              <h1 className="font-display text-3xl font-bold text-slate-900">
                Frequently Asked Questions
              </h1>
            </div>
            <div className="flex flex-wrap gap-1.5 bg-slate-100 p-1 rounded-lg">
              {['ALL', 'BUYERS', 'SELLERS', 'KYC', 'WALLETS', 'DISPUTES', 'MERCHANTS'].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                    categoryFilter === cat
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filteredFaqs.map((item) => (
              <div key={item.q} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                <div className="text-xs font-medium text-blue-700">{item.cat}</div>
                <h2 className="font-display text-base font-semibold text-slate-900">{item.q}</h2>
                <p className="text-sm text-slate-600 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-w-3xl">
        <div className="space-y-2 mb-6">
          <h2 className="font-display text-2xl font-bold text-slate-900">
            Contact & Support Ticket Desk
          </h2>
          <p className="text-sm text-slate-600">
            Submit a support or compliance inquiry. Tickets are stored in our database and tracked
            by support staff.
          </p>
        </div>

        {ticketId && (
          <div className="mb-5 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
            Support ticket submitted successfully. Reference ID:{' '}
            <span className="font-mono font-semibold">{ticketId}</span>
          </div>
        )}
        {error && (
          <div className="mb-5 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-900">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="GENERAL">General Inquiry</option>
                <option value="KYC">KYC & Verification</option>
                <option value="PAYMENT">INR Payment / UTR</option>
                <option value="ESCROW">Escrow & Wallet</option>
                <option value="DISPUTE">Order Dispute</option>
                <option value="MERCHANT">Merchant Onboarding</option>
                <option value="COMPLIANCE">Compliance & TDS</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subject</label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of your request"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Message</label>
            <textarea
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Include any relevant order code or payment reference ID (never share passwords or private keys)."
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'Submitting Ticket...' : 'Submit Support Ticket'}
          </button>
        </form>
      </section>
    </div>
  );
}
