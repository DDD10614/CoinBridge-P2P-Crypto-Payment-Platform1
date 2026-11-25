import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  RefreshCw,
  Wrench,
  AlertTriangle,
} from 'lucide-react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  saveMaintenanceWindowAdmin,
  updateMaintenanceWindowStatusAdmin,
} from '../lib/firestoreService';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { useAuth } from '../context/AuthContext';
import { MaintenanceWindowDoc } from '../types/models';

interface ServiceProbeItem {
  id: string;
  name: string;
  status: string;
  detail: string;
}

interface StatusPayload {
  overallStatus: string;
  sandboxMode: boolean;
  checkedAt: string;
  services: ServiceProbeItem[];
}

export function StatusPage() {
  const { user, isAdmin } = useAuth();
  const [statusData, setStatusData] = useState<StatusPayload | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceWindowDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Admin maintenance form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [affectedServices, setAffectedServices] = useState('Crypto Deposit Monitor, TRON Nile');
  const [startIso, setStartIso] = useState(new Date(Date.now() + 3_600_000).toISOString().slice(0, 16));
  const [endIso, setEndIso] = useState(new Date(Date.now() + 7_200_000).toISOString().slice(0, 16));

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/status');
      if (resp.ok) {
        setStatusData((await resp.json()) as StatusPayload);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'system_maintenance'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: MaintenanceWindowDoc[] = [];
        snap.forEach((d) =>
          list.push({ id: d.id, ...(d.data() as Omit<MaintenanceWindowDoc, 'id'>) })
        );
        setMaintenance(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'system_maintenance')
    );
    return () => unsub();
  }, []);

  const handlePublishMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isAdmin) return;
    setSaving(true);
    try {
      await saveMaintenanceWindowAdmin({
        title,
        description,
        affectedServices: affectedServices
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        status: 'SCHEDULED',
        scheduledStartIso: startIso,
        scheduledEndIso: endIso,
        adminUid: user.uid,
      });
      setTitle('');
      setDescription('');
    } finally {
      setSaving(false);
    }
  };

  const allOperational = statusData?.overallStatus === 'ALL_SYSTEMS_OPERATIONAL';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="text-xs font-medium text-blue-700 dark:text-blue-400">
            Platform Telemetry &amp; Maintenance
          </div>
          <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-slate-100">
            CoinBridge System Status
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Live availability checks across web portal, P2P escrow engine, CoinGecko price feed,
            blockchain monitors, deposits, withdrawals, and notifications.
          </p>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void fetchStatus()}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer self-start"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Re-Probe Services
        </button>
      </div>

      {/* Overall Status Banner */}
      <div
        className={`rounded-xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          allOperational
            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-950 dark:text-emerald-200'
            : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-950 dark:text-amber-200'
        }`}
      >
        <div className="flex items-center gap-3">
          {allOperational ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <div>
            <div className="font-display text-base font-bold">
              {statusData
                ? allOperational
                  ? 'All Core Systems Operational'
                  : 'Partial Upstream Feed Degradation (Fallback Active)'
                : 'Probing Services...'}
            </div>
            <div className="text-xs opacity-80">
              {statusData
                ? `Last checked ${new Date(statusData.checkedAt).toLocaleTimeString()} · Mode: ${
                    statusData.sandboxMode ? 'Sandbox Escrow' : 'Live'
                  }`
                : 'Running health probes'}
            </div>
          </div>
        </div>
        <span className="font-mono text-xs font-semibold">
          {statusData?.overallStatus || 'CHECKING'}
        </span>
      </div>

      {/* Individual Services List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
        {(statusData?.services || []).map((svc) => (
          <div
            key={svc.id}
            className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>{svc.name}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">{svc.detail}</p>
            </div>
            <span
              className={`font-mono text-xs font-bold shrink-0 ${
                svc.status === 'OPERATIONAL'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {svc.status}
            </span>
          </div>
        ))}
      </div>

      {/* Scheduled Maintenance Notices */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-slate-700 dark:text-slate-300" />
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            Scheduled Maintenance &amp; Incident Notices
          </h2>
        </div>

        {maintenance.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No scheduled maintenance windows or active platform incidents reported.
          </p>
        ) : (
          <div className="space-y-3">
            {maintenance.map((m) => (
              <div
                key={m.id}
                className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                    {m.title}
                  </span>
                  <span className="font-mono font-bold text-blue-700 dark:text-blue-400">
                    {m.status}
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-400">{m.description}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {m.scheduledStartIso} → {m.scheduledEndIso}
                  </span>
                  <span>Affected: {(m.affectedServices || []).join(', ')}</span>
                </div>
                {isAdmin && m.status !== 'COMPLETED' && (
                  <div className="flex gap-2 pt-1">
                    {m.status === 'SCHEDULED' && (
                      <button
                        type="button"
                        onClick={() => void updateMaintenanceWindowStatusAdmin(m.id, 'IN_PROGRESS')}
                        className="px-2.5 py-1 text-[11px] font-semibold bg-amber-700 text-white rounded cursor-pointer"
                      >
                        Mark In Progress
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void updateMaintenanceWindowStatusAdmin(m.id, 'COMPLETED')}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-700 text-white rounded cursor-pointer"
                    >
                      Mark Completed
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {isAdmin && (
          <form
            onSubmit={handlePublishMaintenance}
            className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs"
          >
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Admin: Publish Scheduled Maintenance Notice
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                placeholder="Window Title (e.g. TRON Nile Indexer Upgrade)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
              />
              <input
                type="text"
                required
                placeholder="Affected Services (comma separated)"
                value={affectedServices}
                onChange={(e) => setAffectedServices(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
              />
              <input
                type="datetime-local"
                required
                value={startIso}
                onChange={(e) => setStartIso(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono"
              />
              <input
                type="datetime-local"
                required
                value={endIso}
                onChange={(e) => setEndIso(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono"
              />
            </div>
            <textarea
              required
              rows={2}
              placeholder="Impact & expected resolution details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
            />
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 font-semibold text-white bg-slate-900 dark:bg-blue-600 rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              {saving ? 'Publishing...' : 'Publish Maintenance Window'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
