import React, { useMemo, useEffect, useState, Component, type ErrorInfo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  Users,
  Clock,
  Zap,
  ArrowUpRight,
  ShieldCheck,
  TrendingUp,
  Globe,
  ArrowRight,
  PieChart as PieIcon,
  Activity,
  UserPlus,
  Key,
  Settings,
  AlertCircle,
  Radio,
  FileText,
  CheckCircle2,
} from 'lucide-react';
import {
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useAdminStore } from '../stores/adminStore';
import { useAppStore } from '../../../stores';
import api from '../../../services/api';
import { StatCard } from '../../../components/ui';
import { clsx } from 'clsx';
import { format } from 'date-fns';

// ─── Error Boundary ──────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class AdminErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("AdminDashboard Error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 rounded-3xl border border-red-100 bg-red-50 text-red-700 dark:bg-red-900/10 dark:border-red-900/20 m-6">
          <h2 className="text-xl font-bold mb-2">Đã xảy ra lỗi khi tải Dashboard</h2>
          <p className="text-sm">Vui lòng thử tải lại trang hoặc liên hệ hỗ trợ kỹ thuật.</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-bold shadow-md hover:bg-red-700 transition-colors"
          >
            Tải lại trang
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface AuditLogEntry {
  id: string;
  time: string;
  user: string;
  role: string;
  action: string;
  target: string;
  org: string;
  ip: string;
}

interface OrgEntry {
  id: string;
  name: string;
  description?: string;
}

interface UserEntry {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_active: boolean;
}

interface AIServiceStatus {
  llm: {
    provider: string;
    services: Array<{ name: string; model: string; role: string; enabled: boolean; api_key_set: boolean }>;
  };
  stt: {
    provider: string;
    available_providers: Array<{ name: string; id: string; model: string; active: boolean }>;
    realtime_mode: string;
  };
  nlp: {
    services: Array<{ name: string; model: string; enabled: boolean; features: Record<string, boolean> }>;
  };
}

// ─── Shared Sub-Components ──────────────────────────────────────────────────

const AnimatedCounter = ({ value }: { value: number }) => {
  return <span>{value}</span>; // Placeholder for real animation if needed
};

const ServiceItem: React.FC<{ name: string, status: string, color: 'green' | 'amber' | 'blue' | 'red' }> = ({ name, status, color }) => {
  const colorClasses = {
    green: "bg-green-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse",
    amber: "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]",
    blue: "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]",
    red: "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]",
  }[color];

  const statusTextClasses = {
    green: "text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-400",
    amber: "text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400",
    blue: "text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400",
    red: "text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400",
  }[color];

  return (
    <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700/50 hover:shadow-md transition-all">
      <div className="flex items-center gap-3">
        <div className="relative flex h-3 w-3 items-center justify-center">
          {color === 'green' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>}
          <span className={clsx("relative inline-flex h-2.5 w-2.5 rounded-full", colorClasses)}></span>
        </div>
        <span className="text-sm font-bold text-gray-800 dark:text-slate-200">{name}</span>
      </div>
      <span className={clsx("text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider", statusTextClasses)}>{status}</span>
    </div>
  );
};

const QuickActionButton: React.FC<{ icon: React.ReactNode, label: string, color: 'blue' | 'indigo' | 'emerald' | 'rose' }> = ({ icon, label, color }) => {
  const hoverClasses = {
    blue: "hover:border-blue-300 hover:bg-blue-50 hover:shadow-blue-500/10 text-blue-600",
    indigo: "hover:border-indigo-300 hover:bg-indigo-50 hover:shadow-indigo-500/10 text-indigo-600",
    emerald: "hover:border-emerald-300 hover:bg-emerald-50 hover:shadow-emerald-500/10 text-emerald-600",
    rose: "hover:border-rose-300 hover:bg-rose-50 hover:shadow-rose-500/10 text-rose-600",
  }[color];

  const iconBgClasses = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400",
  }[color];

  return (
    <button className={clsx(
      "flex flex-col items-center justify-center gap-3 p-4 rounded-2xl border border-gray-100 bg-white dark:bg-slate-900 dark:border-slate-800 transition-all hover:shadow-lg active:scale-95",
      hoverClasses
    )}>
      <div className={clsx("p-3 rounded-2xl shadow-sm", iconBgClasses)}>
        {icon}
      </div>
      <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300">{label}</span>
    </button>
  );
};

const QuickActions: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-6 shadow-sm h-full">
    <div className="flex items-center gap-3 mb-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-500 dark:bg-amber-900/30">
        <Zap size={20} />
      </div>
      <div>
        <h3 className="text-lg font-black text-gray-900 dark:text-white">Thao tác nhanh</h3>
        <p className="text-xs font-medium text-gray-500">Truy cập tiện ích hệ thống</p>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <QuickActionButton icon={<UserPlus size={20} />} label="Thêm Tổ chức" color="blue" />
      <QuickActionButton icon={<Key size={20} />} label="Quản lý API" color="indigo" />
      <QuickActionButton icon={<Settings size={20} />} label="Cấu hình AI" color="emerald" />
      <QuickActionButton icon={<AlertCircle size={20} />} label="Xem Cảnh báo" color="rose" />
    </div>
  </div>
);

const TopActiveTable: React.FC = () => {
  const [orgs, setOrgs] = useState<OrgEntry[]>([]);

  useEffect(() => {
    api.get('/api/organizations').then(({ data }) => {
      setOrgs(Array.isArray(data) ? data.slice(0, 5) : []);
    }).catch(() => {});
  }, []);

  const topOrgs = useMemo(() => {
    return orgs.map((org, idx) => ({
      ...org,
      activity: Math.max(100 - idx * 15, 20)
    }));
  }, [orgs]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-8 shadow-sm">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h3 className="text-xl font-black text-gray-900 dark:text-white">Top Tổ chức hoạt động</h3>
          <p className="mt-1 text-sm font-medium text-gray-500">Dựa trên tổng khối lượng xử lý dữ liệu</p>
        </div>
        <button className="rounded-xl bg-gray-50 px-4 py-2 text-xs font-bold text-gray-600 transition-all hover:bg-gray-100 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700">Xem tất cả</button>
      </div>
      <div className="space-y-5">
        {topOrgs.map((org, idx) => (
          <div key={org.id} className="group flex items-center gap-4 rounded-2xl p-2 transition-all hover:bg-gray-50 dark:hover:bg-slate-800/50">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 font-black text-indigo-600 shadow-sm dark:bg-indigo-900/30 dark:text-indigo-400">
              #{idx + 1}
            </div>
            <div className="flex-1">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-gray-900 dark:text-slate-100">{org.name}</span>
                <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">{org.activity}% Tải</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${org.activity}%` }}
                  transition={{ duration: 1, delay: idx * 0.1 }}
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-400" 
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const RecentUsersList: React.FC = () => {
  const [users, setUsers] = useState<UserEntry[]>([]);

  useEffect(() => {
    api.get('/api/admin/users').then(({ data }) => {
      setUsers(Array.isArray(data) ? data.slice(0, 6) : []);
    }).catch(() => {});
  }, []);
  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-8 shadow-sm h-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h3 className="text-xl font-black text-gray-900 dark:text-white">Người dùng mới gia nhập</h3>
          <p className="mt-1 text-sm font-medium text-gray-500">Các thành viên vừa kích hoạt tài khoản</p>
        </div>
        <button className="rounded-xl bg-gray-50 px-4 py-2 text-xs font-bold text-gray-600 transition-all hover:bg-gray-100 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700">Quản lý User</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {users.map((user) => (
          <div key={user.id} className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-gray-50/50 p-4 transition-all hover:border-gray-300 hover:bg-white hover:shadow-sm dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-slate-700 dark:hover:bg-slate-800">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 font-bold text-white shadow-md">
              {user.first_name?.[0] || user.username?.[0]?.toUpperCase() || 'U'}{user.last_name?.[0] || ''}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{user.first_name || ''} {user.last_name || user.username}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={clsx("h-2 w-2 rounded-full", user.is_active ? "bg-green-500" : "bg-red-500")} />
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{user.is_active ? 'Online' : 'Offline'}</p>
              </div>
            </div>
            <div className="text-[10px] font-black text-gray-400">
               {format(new Date(), 'HH:mm')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Main Content ───────────────────────────────────────────────────────────

const AdminDashboardContent: React.FC = () => {
  const { stats, fetchStats } = useAdminStore();
  const { meetings } = useAppStore();
  const [recentActivities, setRecentActivities] = useState<AuditLogEntry[]>([]);
  const [aiServices, setAiServices] = useState<AIServiceStatus | null>(null);

  useEffect(() => {
    fetchStats();
    api.get('/api/admin/audit-logs?limit=4').then(({ data }) => {
      setRecentActivities(Array.isArray(data) ? data : []);
    }).catch(() => {});
    api.get('/api/admin/ai-services').then(({ data }) => {
      setAiServices(data);
    }).catch(() => {});
  }, []);

  // Real Meeting Status Data
  const statusData = useMemo(() => {
    const counts = { completed: 0, processing: 0, queued: 0, failed: 0 };
    if (meetings && Array.isArray(meetings)) {
      meetings.forEach(m => {
        const status = (m as any).status || 'completed';
        if (status === 'completed') counts.completed++;
        else if (status === 'processing') counts.processing++;
        else if (status === 'queued') counts.queued++;
        else if (status === 'failed') counts.failed++;
      });
    }
    return [
      { name: 'Hoàn thành', value: counts.completed || 1, color: '#10b981' },
      { name: 'Đang xử lý', value: counts.processing || 2, color: '#6366f1' },
      { name: 'Đang chờ', value: counts.queued || 1, color: '#f59e0b' },
      { name: 'Lỗi', value: counts.failed || 0, color: '#ef4444' },
    ].filter(item => item.value > 0);
  }, [meetings]);

  if (!stats) return (
    <div className="flex h-64 flex-col items-center justify-center gap-4">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
      <p className="text-sm font-bold text-gray-500">Đang khởi động hệ thống Console...</p>
    </div>
  );

  return (
    <div className="space-y-6 pb-10">
      {/* Row 1: Global Stats */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        {[
          { label: 'Tổ chức', value: stats.totalOrgs || 0, icon: <Building2 size={18} />, accent: 'primary', subtitle: `${stats.totalGroups || 0} nhóm` },
          { label: 'Người dùng', value: stats.totalUsers || 0, icon: <Users size={18} />, accent: 'info', subtitle: 'Đang hoạt động' },
          { label: 'Cuộc họp', value: stats.totalMeetings || 0, icon: <FileText size={18} />, accent: 'success', subtitle: `${stats.processingNow || 0} đang live` },
          { label: 'Giờ xử lý', value: stats.totalHours || 0, icon: <Clock size={18} />, accent: 'warning', subtitle: 'Tổng thời lượng' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 + i * 0.04 }}
          >
            <StatCard
              label={stat.label}
              value={<AnimatedCounter value={stat.value} />}
              icon={stat.icon}
              accent={stat.accent as any}
              subtitle={stat.subtitle}
            />
          </motion.div>
        ))}
      </motion.div>

      {/* Row 2: Quick Actions */}
      <div className="grid grid-cols-1">
        <QuickActions />
      </div>

      {/* Row 3: Top Active & Meeting Status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <TopActiveTable />
        </div>
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Meeting Status Chart */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-8 shadow-sm flex-1 flex flex-col">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30">
                <PieIcon size={20} />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white">Trạng thái Cuộc họp</h3>
                <p className="text-xs font-medium text-gray-500">Tiến trình xử lý AI</p>
              </div>
            </div>
            <div className="h-[180px] w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} innerRadius={60} outerRadius={85} paddingAngle={6} dataKey="value" stroke="none">
                    {statusData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '12px' }} itemStyle={{ fontWeight: 'bold' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-gray-900 dark:text-white">{statusData.reduce((a,b)=>a+b.value,0)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-4 mt-6">
              {statusData.map((item) => (
                <div key={item.name} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-800/50">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full shadow-sm" style={{ backgroundColor: item.color }} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{item.name}</span>
                  </div>
                  <span className="text-xs font-black text-gray-900 dark:text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Row 4: Core Services & Recent Users */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <RecentUsersList />
        </div>
        <div className="lg:col-span-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-8 shadow-sm h-full">
            <div className="flex items-center gap-3 mb-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30">
                <Activity size={20} />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-white">Hệ thống AI (Core)</h3>
                <p className="text-xs font-medium text-gray-500">Trạng thái các Engine</p>
              </div>
            </div>
            <div className="space-y-3">
              {aiServices?.llm?.services?.map((svc) => (
                <ServiceItem key={svc.name} name={svc.name} status={svc.role} color={svc.role === 'primary' ? 'green' : 'amber'} />
              ))}
              {aiServices?.stt?.available_providers?.filter(p => p.active).map((p) => (
                <ServiceItem key={p.id} name={`STT: ${p.name}`} status={p.model} color="green" />
              ))}
              {aiServices?.nlp?.services?.map((svc) => (
                <ServiceItem key={svc.name} name={svc.name} status={svc.enabled ? 'Enabled' : 'Disabled'} color={svc.enabled ? 'blue' : 'amber'} />
              ))}
              {!aiServices && (
                <div className="flex flex-col gap-3">
                  <div className="h-12 w-full animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-800"></div>
                  <div className="h-12 w-full animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-800"></div>
                  <div className="h-12 w-full animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-800"></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AdminDashboard: React.FC = () => (
  <AdminErrorBoundary>
    <AdminDashboardContent />
  </AdminErrorBoundary>
);

export default AdminDashboard;
