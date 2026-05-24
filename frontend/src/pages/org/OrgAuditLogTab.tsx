/**
 * P2 #21 — Org-scoped audit log tab inside /org/admin/audit-logs.
 *
 * Surfaces AuditLog rows whose `org` field equals this organization's name,
 * most-recent-first. Org-admins (and system-admins) only — server enforces.
 */
import React from 'react';
import { History, RefreshCw } from 'lucide-react';
import api from '../../services/api';

type AuditLogEntry = {
  id: string;
  actor: string;
  action: string;
  target?: string;
  org?: string;
  details?: string;
  created_at: string;
};

const formatTs = (iso: string): string => {
  if (!iso) return '-';
  return iso.slice(0, 19).replace('T', ' ');
};

const OrgAuditLogTab: React.FC<{ orgId: string }> = ({ orgId }) => {
  const [logs, setLogs] = React.useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get(`/api/organizations/${orgId}/audit-logs`, {
        params: { limit: 200 },
      });
      setLogs(Array.isArray(response.data) ? response.data : []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Khong tai duoc nhat ky.');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
            <History size={18} />
          </div>
          <div>
            <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Nhat ky to chuc</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              Cac su kien lien quan toi to chuc nay (approve/suspend, view-as, ...).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <RefreshCw size={14} />
          Tai lai
        </button>
      </div>

      {error && <p className="text-sm font-semibold text-red-500">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Dang tai...</p>
      ) : logs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400">
          Chua co su kien nao trong nhat ky.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800/60">
              <tr>
                <th className="px-4 py-3 font-bold text-gray-500">Thoi diem</th>
                <th className="px-4 py-3 font-bold text-gray-500">Nguoi thuc hien</th>
                <th className="px-4 py-3 font-bold text-gray-500">Hanh dong</th>
                <th className="px-4 py-3 font-bold text-gray-500">Doi tuong</th>
                <th className="px-4 py-3 font-bold text-gray-500">Chi tiet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {logs.map((log) => (
                <tr key={log.id} className="transition hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-slate-300">
                    {formatTs(log.created_at)}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900 dark:text-slate-100">{log.actor || '-'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-700 dark:bg-slate-800 dark:text-slate-300">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 dark:text-slate-300">{log.target || '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">{log.details || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default OrgAuditLogTab;
