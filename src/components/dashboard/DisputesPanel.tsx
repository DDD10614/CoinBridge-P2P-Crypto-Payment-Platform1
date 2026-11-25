import React, { useEffect, useState } from 'react';
import { MessageSquare, Send, ShieldAlert } from 'lucide-react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { addDisputeEvidenceAndEscalate, sendSupportMessage } from '../../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../../lib/firestoreError';
import { useAuth } from '../../context/AuthContext';
import { DisputeCaseDoc, SupportMessageDoc, SupportTicketDoc } from '../../types/models';

export function DisputesPanel() {
  const { user, account } = useAuth();
  const [disputes, setDisputes] = useState<DisputeCaseDoc[]>([]);
  const [tickets, setTickets] = useState<SupportTicketDoc[]>([]);
  const [evidenceText, setEvidenceText] = useState<Record<string, string>>({});
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<SupportMessageDoc[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const q1 = query(collection(db, 'disputes'), where('raisedByUid', '==', user.uid));
    const q2 = query(collection(db, 'disputes'), where('counterpartyUid', '==', user.uid));
    const q3 = query(collection(db, 'support_tickets'), where('uid', '==', user.uid));

    const map = new Map<string, DisputeCaseDoc>();
    const sync = () => setDisputes(Array.from(map.values()));

    const u1 = onSnapshot(
      q1,
      (snap) => {
        snap.forEach((d) => map.set(d.id, { id: d.id, ...(d.data() as Omit<DisputeCaseDoc, 'id'>) }));
        sync();
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'disputes')
    );
    const u2 = onSnapshot(
      q2,
      (snap) => {
        snap.forEach((d) => map.set(d.id, { id: d.id, ...(d.data() as Omit<DisputeCaseDoc, 'id'>) }));
        sync();
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'disputes')
    );
    const u3 = onSnapshot(
      q3,
      (snap) => {
        const list: SupportTicketDoc[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<SupportTicketDoc, 'id'>) }));
        setTickets(list);
      },
      (e) => handleFirestoreError(e, OperationType.LIST, 'support_tickets')
    );

    return () => {
      u1();
      u2();
      u3();
    };
  }, [user]);

  useEffect(() => {
    if (!expandedTicketId) {
      setChatMessages([]);
      return;
    }
    const q = query(
      collection(db, 'support_tickets', expandedTicketId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setChatMessages(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SupportMessageDoc, 'id'>) }))
        );
      },
      (e) => handleFirestoreError(e, OperationType.LIST, `support_tickets/${expandedTicketId}/messages`)
    );
    return () => unsub();
  }, [expandedTicketId]);

  const handleSubmitEvidence = async (dispute: DisputeCaseDoc, escalate: boolean) => {
    const text = (evidenceText[dispute.id] || '').trim();
    if (!text && !escalate) return;
    setBusyId(dispute.id);
    try {
      const nextItems = text
        ? [...(dispute.evidenceItems || []), text.slice(0, 160)].slice(-6)
        : dispute.evidenceItems || [];
      await addDisputeEvidenceAndEscalate({
        disputeId: dispute.id,
        evidenceSummary:
          text || dispute.evidenceSummary || 'Escalated to compliance review by participant.',
        evidenceItems: nextItems,
        escalate,
      });
      setEvidenceText((prev) => ({ ...prev, [dispute.id]: '' }));
    } finally {
      setBusyId(null);
    }
  };

  const handleSendChat = async (ticketId: string) => {
    if (!user || !chatInput.trim()) return;
    setBusyId(ticketId);
    try {
      await sendSupportMessage({
        ticketId,
        senderUid: user.uid,
        senderName: account?.username || user.displayName || 'Trader',
        senderRole: 'USER',
        body: chatInput,
      });
      setChatInput('');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
          Disputes &amp; Live Support Cases
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Track active escrow disputes, upload UTR or bank statement evidence metadata, escalate to
          Compliance, and chat directly with support staff.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Order Disputes ({disputes.length})
          </h3>
        </div>
        {disputes.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No order disputes associated with your account.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {disputes.map((d) => (
              <div key={d.id} className="p-5 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    Order {d.orderCode} · {d.category.replace(/_/g, ' ')}
                  </div>
                  <div className="flex items-center gap-2">
                    {d.escalatedToCompliance && (
                      <span className="px-2 py-0.5 rounded-sm font-mono text-[11px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                        COMPLIANCE ESCALATED
                      </span>
                    )}
                    <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                      {d.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
                <p className="text-slate-600 dark:text-slate-300">{d.description}</p>

                {d.evidenceSummary && (
                  <p className="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                    Evidence Note: {d.evidenceSummary}
                  </p>
                )}

                {d.evidenceItems && d.evidenceItems.length > 0 && (
                  <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      Submitted Evidence Records ({d.evidenceItems.length})
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      {d.evidenceItems.map((item, idx) => (
                        <li key={`${d.id}_ev_${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {d.resolutionNote && (
                  <p className="text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                    Officer Resolution: {d.resolutionNote}
                  </p>
                )}

                {!['RESOLVED', 'REJECTED'].includes(d.status) && (
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <input
                      type="text"
                      placeholder="Add bank UTR reference, transfer timestamp, or statement note"
                      value={evidenceText[d.id] || ''}
                      onChange={(e) =>
                        setEvidenceText((prev) => ({ ...prev, [d.id]: e.target.value }))
                      }
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      disabled={busyId === d.id}
                      onClick={() => void handleSubmitEvidence(d, false)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg cursor-pointer shrink-0"
                    >
                      Attach Evidence
                    </button>
                    {!d.escalatedToCompliance && (
                      <button
                        type="button"
                        disabled={busyId === d.id}
                        onClick={() => void handleSubmitEvidence(d, true)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg cursor-pointer shrink-0"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Escalate to Compliance
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            My Support Tickets &amp; Live Chat ({tickets.length})
          </h3>
        </div>
        {tickets.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No support tickets filed yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {tickets.map((t) => {
              const isOpen = expandedTicketId === t.id;
              return (
                <div key={t.id} className="p-4 space-y-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {t.subject}
                      </span>
                      {t.priority && (
                        <span className="px-1.5 py-0.5 rounded-sm font-mono text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {t.priority}
                        </span>
                      )}
                      {t.escalatedToCompliance && (
                        <span className="px-1.5 py-0.5 rounded-sm font-mono text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                          COMPLIANCE
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-slate-600 dark:text-slate-400">{t.status}</span>
                      <button
                        type="button"
                        onClick={() => setExpandedTicketId(isOpen ? null : t.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        {isOpen ? 'Close Chat' : 'Live Support Chat'}
                      </button>
                    </div>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{t.message}</p>
                  {t.adminReply && (
                    <p className="text-blue-900 dark:text-blue-200 bg-blue-50 dark:bg-blue-950/40 p-2 rounded border border-blue-100 dark:border-blue-800">
                      Staff Resolution Note: {t.adminReply}
                    </p>
                  )}

                  {isOpen && (
                    <div className="mt-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        {chatMessages.length === 0 ? (
                          <div className="text-slate-500 dark:text-slate-400">
                            No live chat messages yet. Send a follow-up message below.
                          </div>
                        ) : (
                          chatMessages.map((m) => (
                            <div
                              key={m.id}
                              className={`p-2.5 rounded-lg text-xs ${
                                m.senderRole === 'USER'
                                  ? 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 ml-6'
                                  : 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 mr-6'
                              }`}
                            >
                              <div className="flex justify-between font-mono text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                                <span>
                                  {m.senderName} ({m.senderRole})
                                </span>
                                <span>
                                  {m.createdAt?.toDate
                                    ? m.createdAt.toDate().toLocaleTimeString()
                                    : 'Now'}
                                </span>
                              </div>
                              <div className="text-slate-800 dark:text-slate-200">{m.body}</div>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Write message to support agent..."
                          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs"
                        />
                        <button
                          type="button"
                          disabled={busyId === t.id || !chatInput.trim()}
                          onClick={() => void handleSendChat(t.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                        >
                          <Send className="w-3 h-3" />
                          Send
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
