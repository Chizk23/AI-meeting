import React from 'react';
import { 
  Download, 
  Search, 
  Activity, 
  Clock, 
  Globe, 
  ShieldAlert,
  Calendar,
  FileText,
  Filter
} from 'lucide-react';
import { clsx } from 'clsx';
import api from '../../../services/api';

type AuditLog = {
  id: string;
  time: string;
  user: string;
  role: string;
  action: string;
  target: string;
  org: string;
  ip: string;
};

type FilterActionType = 'ALL' | 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'ERROR';

const AdminAuditLogs: React.FC = () => {
  const [logs, setLogs] = React.useState<AuditLog[]>([]);
  const [query, setQuery] = React.useState('');
  const [filterAction, setFilterAction] = React.useState<FilterActionType>('ALL');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await api.get('/api/admin/audit-logs');
        setLogs(Array.isArray(response.data) ? response.data : []);
      } catch (err: any) {
        setError(err?.response?.data?.detail || 'Không tải được nhật ký hoạt động (Audit Logs)');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = logs.filter((log) => {
    const haystack = `${log.user} ${log.action} ${log.target} ${log.ip}`.toLowerCase();
    const matchesQuery = haystack.includes(query.trim().toLowerCase());
    
    let matchesAction = true;
    if (filterAction !== 'ALL') {
      const act = log.action.toUpperCase();
      if (filterAction === 'CREATE') matchesAction = act.includes('CREATE') || act.includes('ADD') || act.includes('POST');
      if (filterAction === 'UPDATE') matchesAction = act.includes('UPDATE') || act.includes('PATCH') || act.includes('PUT');
      if (filterAction === 'DELETE') matchesAction = act.includes('DELETE') || act.includes('REMOVE');
      if (filterAction === 'LOGIN') matchesAction = act.includes('LOGIN') || act.includes('AUTH');
      if (filterAction === 'ERROR') matchesAction = act.includes('FAIL') || act.includes('ERROR');
    }

    return matchesQuery && matchesAction;
  });

  const exportCsv = () => {
    const headers = ['time', 'user', 'role', 'action', 'target', 'org', 'ip'];
    const rows = filtered.map((log) => headers.map((key) => `"${String((log as any)[key] ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // Helper cho Badge màu
  const getActionBadgeStyle = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes('CREATE') || act.includes('ADD') || act.includes('POST')) 
      return "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200/50 dark:border-green-800/30";
    if (act.includes('DELETE') || act.includes('REMOVE')) 
      return "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200/50 dark:border-red-800/30";
    if (act.includes('UPDATE') || act.includes('PATCH') || act.includes('PUT')) 
      return "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/30";
    if (act.includes('LOGIN') || act.includes('AUTH')) 
      return "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-200/50 dark:border-purple-800/30";
    if (act.includes('FAIL') || act.includes('ERROR')) 
      return "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/30";
    return "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300 border border-gray-200/50 dark:border-slate-700/50";
  };

  // Thống kê sơ bộ
  const totalLogs = logs.length;
  const today = new Date().toLocaleDateString('vi-VN');
  const logsToday = logs.filter(l => new Date(l.time).toLocaleDateString('vi-VN') === today).length;
  const uniqueIPs = new Set(logs.map(l => l.ip)).size;

  return (
    <div className="space-y-6">
      {/* Top Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="absolute -right-4 -top-4 rounded-full bg-blue-50/50 p-8 transition-transform group-hover:scale-150 dark:bg-blue-900/10"></div>
          <div className="relative flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <FileText size={24} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">{totalLogs}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Tổng Logs</p>
            </div>
          </div>
        </div>
        
        <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="absolute -right-4 -top-4 rounded-full bg-emerald-50/50 p-8 transition-transform group-hover:scale-150 dark:bg-emerald-900/10"></div>
          <div className="relative flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              <Calendar size={24} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">{logsToday}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Ghi nhận Hôm nay</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="absolute -right-4 -top-4 rounded-full bg-indigo-50/50 p-8 transition-transform group-hover:scale-150 dark:bg-indigo-900/10"></div>
          <div className="relative flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
              <Globe size={24} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">{uniqueIPs}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">IP Địa chỉ duy nhất</p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo user, action, target..."
              className="w-full rounded-3xl border border-gray-200 bg-white/50 px-12 py-3.5 text-sm font-medium outline-none backdrop-blur-xl transition-all focus:border-primary-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(99,102,241,0.1)] dark:border-slate-800 dark:bg-slate-900/50 dark:focus:border-primary-500 dark:focus:bg-slate-900"
            />
          </div>
          
          {/* Action Filters (Dropdown) */}
          <div className="relative shrink-0">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value as FilterActionType)}
              className="appearance-none rounded-3xl border border-gray-200 bg-white/50 pl-10 pr-10 py-3.5 text-sm font-bold text-gray-700 outline-none backdrop-blur-xl transition-all hover:bg-gray-50 focus:border-primary-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(99,102,241,0.1)] dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:border-primary-500 dark:focus:bg-slate-900"
            >
              <option value="ALL">Tất cả hành động</option>
              <option value="LOGIN">Đăng nhập</option>
              <option value="CREATE">Tạo mới</option>
              <option value="UPDATE">Cập nhật</option>
              <option value="DELETE">Xóa</option>
              <option value="ERROR">Lỗi</option>
            </select>
            <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={exportCsv}
          className="group relative flex shrink-0 items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gray-900 px-6 py-3.5 text-sm font-black text-white transition-all hover:bg-gray-800 hover:shadow-lg hover:shadow-gray-900/20 dark:bg-slate-100 dark:text-gray-900 dark:hover:bg-white dark:hover:shadow-white/10"
        >
          <span className="relative z-10 flex items-center gap-2">
            <Download size={18} />
            Xuất CSV ({filtered.length})
          </span>
          <div className="absolute inset-0 bg-white/20 translate-y-full transition-transform group-hover:translate-y-0 dark:bg-black/10"></div>
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-600 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400">
          <ShieldAlert size={20} />
          <p className="text-sm font-semibold">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50/50 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:bg-slate-800/30">
              <tr>
                <th className="px-6 py-4">Thời gian</th>
                <th className="px-6 py-4">Người thực hiện</th>
                <th className="px-6 py-4">Hành động</th>
                <th className="px-6 py-4">Mục tiêu</th>
                <th className="px-6 py-4 text-right">IP Client</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
                      <span className="text-sm font-medium text-gray-500">Đang tải nhật ký...</span>
                    </div>
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-3 text-gray-400 dark:text-slate-600">
                      <Activity size={32} />
                      <span className="text-sm font-medium text-gray-500">Không có bản ghi log nào phù hợp.</span>
                    </div>
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((log) => (
                  <tr key={log.id} className="transition-colors hover:bg-gray-50/80 dark:hover:bg-slate-800/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-slate-400">
                        <Clock size={14} className="text-gray-400" />
                        {new Date(log.time).toLocaleString('vi-VN')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-bold text-gray-900 dark:text-slate-100">{log.user}</p>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">{log.role}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={clsx(
                        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
                        getActionBadgeStyle(log.action)
                      )}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-700 dark:text-slate-300 line-clamp-1" title={log.target}>
                        {log.target}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1 dark:bg-slate-800">
                        <Globe size={12} className="text-gray-400" />
                        <span className="font-mono text-xs font-medium text-gray-500 dark:text-slate-400">
                          {log.ip}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminAuditLogs;
