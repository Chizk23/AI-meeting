import React from 'react';
import { 
  Send, 
  Trash2, 
  Info, 
  AlertTriangle, 
  Megaphone, 
  Eye, 
  Activity, 
  Target, 
  Clock, 
  CheckCircle2, 
  Building2 
} from 'lucide-react';
import { clsx } from 'clsx';
import api from '../../../services/api';
import { toast } from '../../../components/ui/Toast';

type BroadcastItem = {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'warning' | 'broadcast';
  target: string;
  status: string;
  sentAt: string;
  reach: number;
};

type OrgOption = {
  id: string;
  name: string;
};

const AdminNotifications: React.FC = () => {
  const [title, setTitle] = React.useState('');
  const [content, setContent] = React.useState('');
  const [type, setType] = React.useState<'info' | 'warning' | 'broadcast'>('info');
  const [target, setTarget] = React.useState('all');
  const [orgs, setOrgs] = React.useState<OrgOption[]>([]);
  const [history, setHistory] = React.useState<BroadcastItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState('');

  const loadHistory = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/admin/notifications');
      setHistory(Array.isArray(response.data) ? response.data : []);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Không tải được lịch sử thông báo');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadHistory();
    api.get('/api/organizations').then(({ data }) => {
      setOrgs(Array.isArray(data) ? data.map((o: any) => ({ id: o.id, name: o.name })) : []);
    }).catch(() => {});
  }, [loadHistory]);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      const response = await api.post('/api/admin/notifications', { title, content, type, target });
      setHistory((current) => [response.data, ...current]);
      setTitle('');
      setContent('');
      toast.success('Đã gửi thông báo hệ thống');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không gửi được thông báo');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bạn có chắc muốn xóa thông báo này khỏi lịch sử?')) return;
    try {
      await api.delete(`/api/admin/notifications/${id}`);
      setHistory((current) => current.filter((item) => item.id !== id));
      toast.success('Đã xóa thông báo');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không xóa được thông báo');
    }
  };

  // Tính toán thống kê
  const totalBroadcasts = history.length;
  const totalReach = history.reduce((sum, item) => sum + (item.reach || 0), 0);
  const reachRateAvg = totalBroadcasts > 0 ? Math.round(totalReach / totalBroadcasts) : 0;

  const typeConfig = {
    info: { 
      icon: Info, 
      color: 'blue', 
      label: 'Thông tin',
      bgClass: 'bg-blue-50 dark:bg-blue-900/30',
      borderClass: 'border-blue-200 dark:border-blue-800/50',
      textClass: 'text-blue-600 dark:text-blue-400',
      gradient: 'from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20'
    },
    warning: { 
      icon: AlertTriangle, 
      color: 'amber', 
      label: 'Cảnh báo',
      bgClass: 'bg-amber-50 dark:bg-amber-900/30',
      borderClass: 'border-amber-200 dark:border-amber-800/50',
      textClass: 'text-amber-600 dark:text-amber-400',
      gradient: 'from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20'
    },
    broadcast: { 
      icon: Megaphone, 
      color: 'purple', 
      label: 'Khẩn cấp',
      bgClass: 'bg-purple-50 dark:bg-purple-900/30',
      borderClass: 'border-purple-200 dark:border-purple-800/50',
      textClass: 'text-purple-600 dark:text-purple-400',
      gradient: 'from-purple-50 to-fuchsia-50 dark:from-purple-900/20 dark:to-fuchsia-900/20'
    }
  };

  const PreviewIcon = typeConfig[type].icon;

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="absolute -right-4 -top-4 rounded-full bg-indigo-50/50 p-8 transition-transform group-hover:scale-150 dark:bg-indigo-900/10"></div>
          <div className="relative flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
              <Send size={24} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">{totalBroadcasts}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Đã gửi</p>
            </div>
          </div>
        </div>
        <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="absolute -right-4 -top-4 rounded-full bg-emerald-50/50 p-8 transition-transform group-hover:scale-150 dark:bg-emerald-900/10"></div>
          <div className="relative flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              <Target size={24} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">{totalReach}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Lượt tiếp cận</p>
            </div>
          </div>
        </div>
        <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="absolute -right-4 -top-4 rounded-full bg-rose-50/50 p-8 transition-transform group-hover:scale-150 dark:bg-rose-900/10"></div>
          <div className="relative flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
              <Activity size={24} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">~{reachRateAvg}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Reach Trung bình</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Composer Form */}
        <div className="lg:col-span-5">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-600 dark:from-indigo-900/40 dark:to-purple-900/40 dark:text-indigo-400">
                <Send size={20} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Broadcast Center</h3>
                <p className="text-xs font-medium text-gray-500">Soạn thảo và gửi thông báo hệ thống</p>
              </div>
            </div>

            <form onSubmit={handleSend} className="space-y-6">
              {/* Type Selection (Radio Group) */}
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">Loại thông báo</label>
                <div className="grid grid-cols-3 gap-3">
                  {(['info', 'warning', 'broadcast'] as const).map((t) => {
                    const config = typeConfig[t];
                    const Icon = config.icon;
                    const isSelected = type === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={clsx(
                          "relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 p-3 transition-all",
                          isSelected 
                            ? `${config.borderClass} ${config.bgClass}` 
                            : "border-gray-100 bg-white hover:bg-gray-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/50"
                        )}
                      >
                        <Icon size={20} className={isSelected ? config.textClass : "text-gray-400"} />
                        <span className={clsx("text-xs font-bold", isSelected ? config.textClass : "text-gray-500")}>
                          {config.label}
                        </span>
                        {isSelected && (
                          <div className={clsx("absolute right-2 top-2 rounded-full", config.textClass)}>
                            <CheckCircle2 size={12} strokeWidth={3} />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Input Fields */}
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">Tiêu đề</label>
                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="VD: Cập nhật hệ thống v2.0"
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm font-medium text-gray-900 transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100 dark:focus:border-indigo-400 dark:focus:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">Nội dung</label>
                  <textarea
                    required
                    rows={4}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Nhập nội dung chi tiết..."
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm font-medium text-gray-900 transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100 dark:focus:border-indigo-400 dark:focus:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-gray-500">Đối tượng nhận</label>
                  <div className="relative">
                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <select
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      className="w-full appearance-none rounded-2xl border border-gray-200 bg-gray-50/50 pl-10 pr-4 py-3 text-sm font-medium text-gray-900 transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100 dark:focus:border-indigo-400 dark:focus:bg-slate-800"
                    >
                      <option value="all">Tất cả (Toàn hệ thống)</option>
                      {orgs.map((org) => (
                        <option key={org.id} value={org.id}>Tổ chức: {org.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Live Preview */}
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 p-1 dark:border-slate-800/60 dark:bg-slate-900/40">
                <div className="px-3 py-2 flex items-center gap-2 border-b border-gray-200/50 dark:border-slate-800/50">
                  <Eye size={14} className="text-gray-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Live Preview</span>
                </div>
                <div className={clsx("m-2 rounded-xl border p-4", typeConfig[type].bgClass, typeConfig[type].borderClass)}>
                  <div className="flex gap-3">
                    <div className={clsx("mt-0.5 shrink-0", typeConfig[type].textClass)}>
                      <PreviewIcon size={20} strokeWidth={2.5} />
                    </div>
                    <div>
                      <h4 className={clsx("text-sm font-bold", typeConfig[type].textClass)}>
                        {title || 'Tiêu đề thông báo'}
                      </h4>
                      <p className={clsx("mt-1 text-xs font-medium", typeConfig[type].textClass, "opacity-80")}>
                        {content || 'Nội dung thông báo sẽ hiển thị tại đây...'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={sending || !title || !content}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gray-900 px-4 py-4 text-sm font-black text-white transition-all hover:bg-gray-800 hover:shadow-lg hover:shadow-gray-900/20 disabled:opacity-50 dark:bg-slate-100 dark:text-gray-900 dark:hover:bg-white dark:hover:shadow-white/10"
              >
                {sending ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent dark:border-gray-900"></div>
                ) : (
                  <>
                    <span className="relative z-10 flex items-center gap-2">
                      <Send size={18} /> Gửi Broadcast
                    </span>
                    <div className="absolute inset-0 bg-white/20 translate-y-full transition-transform group-hover:translate-y-0 dark:bg-black/10"></div>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* History List */}
        <div className="lg:col-span-7">
          <div className="flex h-full flex-col rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5 dark:border-slate-800">
              <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Lịch sử gửi</h3>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600 dark:bg-slate-800 dark:text-gray-400">
                {history.length} bản ghi
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {loading ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"></div>
                </div>
              ) : error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm font-medium text-red-600 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400">
                  {error}
                </div>
              ) : history.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-50 text-gray-400 dark:bg-slate-800/50">
                    <Clock size={24} />
                  </div>
                  <p className="text-sm font-medium text-gray-500">Chưa có thông báo nào được gửi.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map((item) => {
                    const typeType = item.type as 'info' | 'warning' | 'broadcast';
                    const config = typeConfig[typeType] || typeConfig['info'];
                    const ItemIcon = config.icon;

                    return (
                      <div 
                        key={item.id} 
                        className="group relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 transition-all hover:border-gray-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                      >
                        <div className={clsx("absolute -right-4 -top-4 rounded-full p-8 opacity-0 transition-all group-hover:opacity-100", config.bgClass)}></div>
                        
                        <div className="relative flex items-start justify-between gap-4">
                          <div className="flex items-start gap-4">
                            <div className={clsx("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm", config.gradient, config.textClass)}>
                              <ItemIcon size={20} strokeWidth={2.5} />
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-base font-bold text-gray-900 dark:text-slate-100">{item.title}</h4>
                                <span className={clsx(
                                  "rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-widest",
                                  item.target === 'all' 
                                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400"
                                    : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                )}>
                                  {item.target === 'all' ? 'Toàn hệ thống' : 'Theo tổ chức'}
                                </span>
                              </div>
                              <p className="mt-1.5 text-sm font-medium text-gray-500 line-clamp-2">{item.content}</p>
                              
                              <div className="mt-4 flex items-center gap-4 text-xs font-semibold text-gray-400">
                                <span className="flex items-center gap-1.5">
                                  <Clock size={14} />
                                  {new Date(item.sentAt).toLocaleString('vi-VN')}
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <Target size={14} className={config.textClass} />
                                  <span className={clsx("font-bold", config.textClass)}>Reach: {item.reach}</span>
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-gray-400 opacity-0 shadow-sm transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:bg-slate-800 dark:hover:bg-red-900/20"
                            title="Xóa"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminNotifications;
