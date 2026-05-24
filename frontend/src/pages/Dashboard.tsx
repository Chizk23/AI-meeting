import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  Clock3,
  Sparkles,
  ArrowRight,
  Mic,
  FileText,
  Users,
  Building2,
  FolderOpen,
  Plus,
  Zap,
  Crown,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { StatCard, Button, AnimatedCounter } from "../components/ui";
import { useOrgStore } from "../stores";
import { useAppStore } from "../stores";
import { usePermission } from "../hooks";
import MeetingCard from "../features/meeting/components/MeetingCard";
import { clsx } from "clsx";

const Dashboard: React.FC = () => {
  const { user, session, isAuthReady, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { currentOrg, currentOrgId, loadGroups, loadOrgDetails } = useOrgStore();
  const { isOrgAdmin } = usePermission();
  const { meetings, fetchStats, loadMeetings } = useAppStore();
  const [stats, setStats] = useState({ totalMeetings: 0, totalHours: 0, processingCount: 0 });
  const [loading, setLoading] = useState(true);
  const [orgLoadFailed, setOrgLoadFailed] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);

  const approvedOrgId = useMemo(
    () => user?.orgMemberships?.find((membership) => membership.approvalStatus !== 'pending')?.orgId || '',
    [user?.orgMemberships],
  );
  const targetOrgId = currentOrg?.id || currentOrgId || session?.currentOrgId || approvedOrgId;
  const hasApprovedOrg = Boolean(approvedOrgId);

  useEffect(() => {
    let isCancelled = false;

    const initDashboard = async () => {
      if (!isAuthReady) {
        setLoading(true);
        return;
      }

      setLoading(true);
      setOrgLoadFailed(false);

      if (!targetOrgId) {
        setLoading(false);
        return;
      }

      try {
        if (!currentOrg?.id) {
          await loadOrgDetails(targetOrgId);
        }

        await Promise.all([
          loadGroups(targetOrgId),
          loadMeetings(targetOrgId)
        ]);
        const realStats = await fetchStats();
        if (!isCancelled) {
          setStats(realStats);
        }
      } catch (err) {
        console.error('Failed to initialize dashboard:', err);
        if (!isCancelled) {
          setOrgLoadFailed(true);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    initDashboard();

    return () => {
      isCancelled = true;
    };
  }, [currentOrg?.id, fetchStats, isAuthReady, loadGroups, loadMeetings, loadOrgDetails, targetOrgId]);

  const appStats = stats;

  const processingCount = useMemo(
    () => meetings.filter((m) => m.status === "processing" || m.status === "queued").length,
    [meetings]
  );

  const recentMeetings = useMemo(() => {
    return [...meetings]
      .filter(m => m.status === 'completed')
      .sort((a, b) => {
        const dateA = new Date(a.scheduled_start || a.startTime || 0);
        const dateB = new Date(b.scheduled_start || b.startTime || 0);
        return dateB.getTime() - dateA.getTime();
      })
      .slice(0, 4);
  }, [meetings]);

  const upcomingMeetings = useMemo(() => {
    return meetings
      .filter((m) => m.status === "upcoming" || m.status === "live")
      .sort((a, b) => {
        const dateA = new Date(a.scheduled_start || a.startTime || 0);
        const dateB = new Date(b.scheduled_start || b.startTime || 0);
        return dateA.getTime() - dateB.getTime();
      })
      .slice(0, 3);
  }, [meetings]);

  const calendarDays = useMemo(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const days = [];
    const startOffset = -2 + (weekOffset * 7);
    const endOffset = 4 + (weekOffset * 7);

    for (let i = startOffset; i <= endOffset; i++) {
      const d = new Date();
      d.setDate(today.getDate() + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({
        date: d.getDate(),
        dayName: d.toLocaleDateString('vi-VN', { weekday: 'short' }),
        fullDate: dateStr,
        isToday: dateStr === todayStr,
        hasMeeting: meetings.some(m => {
          const mDate = m.scheduled_start || m.startTime;
          if (!mDate) return false;
          try {
            const dObj = new Date(mDate);
            if (isNaN(dObj.getTime())) return false;
            const mDateStr = `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}-${String(dObj.getDate()).padStart(2, '0')}`;
            return mDateStr === dateStr;
          } catch (e) {
            return false;
          }
        })
      });
    }
    return days;
  }, [meetings, weekOffset]);

  const hoursSaved = useMemo(() => {
    const totalMinutes = meetings.reduce((sum, m) => sum + (m.duration || 0), 0);
    const hours = Math.round(totalMinutes / 60);
    return `${hours}h`;
  }, [meetings]);

  if (!isAuthReady || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-9 w-9 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!currentOrg && hasApprovedOrg && targetOrgId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
          <Building2 className="mx-auto mb-3 h-9 w-9" />
          <h2 className="text-lg font-bold">Đang đồng bộ tổ chức</h2>
          <p className="mt-2 text-sm">
            Tài khoản đã có tổ chức, nhưng dashboard chưa tải được dữ liệu mới nhất.
          </p>
          <Button
            className="mt-5 rounded-xl"
            onClick={async () => {
              setOrgLoadFailed(false);
              setLoading(true);
              await refreshUser();
              await loadOrgDetails(targetOrgId);
              setLoading(false);
            }}
          >
            {orgLoadFailed ? 'Tải lại' : 'Đồng bộ lại'}
          </Button>
        </div>
      </div>
    );
  }

  if (!currentOrg) {
    return <NoOrgView />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-12 px-4 sm:px-6 lg:px-8">
      {/* Premium Hero Section */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[2.5rem] border border-primary-50 bg-white p-8 shadow-sm lg:p-12"
      >
        {/* Background Decor */}
        <div className="absolute right-0 top-0 -mr-24 -mt-24 h-96 w-96 rounded-full bg-primary-50/40 blur-3xl" />
        <div className="absolute bottom-0 left-0 -ml-24 -mb-24 h-72 w-72 rounded-full bg-emerald-50/20 blur-3xl" />

        <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary-50 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-primary-700 shadow-sm shadow-primary-500/5">
              <Sparkles size={14} className="animate-pulse" />
              <span>Workspace của bạn đã sẵn sàng</span>
            </div>
            <h1 className="text-4xl font-black tracking-tight text-gray-900 sm:text-6xl leading-[1.1]">
              {(() => { const h = new Date().getHours(); return h < 12 ? 'Chào buổi sáng' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'; })()}, <span className="text-primary-600">{user?.displayName?.split(' ')[0] || user?.email?.split('@')[0]}</span>
            </h1>
            <p className="mt-6 text-lg font-medium text-gray-500 max-w-lg leading-relaxed">
              Hôm nay là một ngày tuyệt vời để tối ưu hóa các cuộc họp của bạn. Bạn có <span className="font-black text-gray-900">{processingCount}</span> bản ghi đang xử lý.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Button size="lg" onClick={() => navigate('/meetings/create')} className="h-14 px-10 rounded-2xl shadow-xl shadow-primary-500/25 font-black text-base hover:-translate-y-1 transition-all">
                <Plus size={20} className="mr-2 stroke-[3]" />
                Cuộc họp mới
              </Button>
              <Button size="lg" variant="secondary" onClick={() => navigate('/upload')} className="h-14 px-10 rounded-2xl bg-white border-gray-100 shadow-sm font-black text-base hover:-translate-y-1 transition-all">
                <Mic size={20} className="mr-2" />
                Tải ghi âm
              </Button>
            </div>
          </div>

          <div className="hidden lg:block">
            <div className="relative h-56 w-56 rounded-[2.5rem] bg-gradient-to-br from-primary-500 to-emerald-600 p-1 shadow-2xl rotate-3 hover:rotate-0 transition-all duration-500 group">
              <div className="flex h-full w-full flex-col items-center justify-center rounded-[2.2rem] bg-white">
                <AnimatedCounter value={appStats.totalMeetings} className="text-6xl font-black text-primary-600" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 mt-1">Cuộc họp</span>
              </div>
              <div className="absolute -bottom-4 -right-4 h-16 w-16 rounded-2xl bg-white shadow-xl flex items-center justify-center text-primary-600 group-hover:scale-110 transition-transform">
                <Zap size={32} fill="currentColor" />
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-12">
        {/* Main Column */}
        <div className="space-y-12 xl:col-span-8">
          {/* Stats Summary */}
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            <StatCard
              label="Tổng cuộc họp"
              value={appStats.totalMeetings}
              icon={<FileText size={20} />}
              accent="primary"
            />
            <StatCard
              label="Đang xử lý"
              value={processingCount}
              icon={<Zap size={20} />}
              accent="warning"
            />
            <StatCard
              label="Thành viên"
              value={currentOrg?.memberCount || 0}
              icon={<Users size={20} />}
              accent="info"
            />
            <StatCard
              label="Tiết kiệm"
              value={hoursSaved}
              icon={<Clock3 size={20} />}
              accent="success"
            />
          </div>

          {/* Recent Meetings */}
          <section>
            <div className="mb-8 flex items-end justify-between">
              <div>
                <h2 className="text-3xl font-black text-gray-900 tracking-tight">Cuộc họp gần đây</h2>
                <p className="text-sm font-bold text-gray-400 mt-1 uppercase tracking-widest">Truy cập nhanh nội dung vừa thảo luận</p>
              </div>
              <button
                onClick={() => navigate("/meetings")}
                className="group inline-flex items-center gap-2 rounded-xl bg-gray-50 px-4 py-2 text-xs font-black text-gray-600 transition-all hover:bg-primary-50 hover:text-primary-700"
              >
                Xem tất cả
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </button>
            </div>

            {recentMeetings.length === 0 ? (
              <div className="rounded-[2.5rem] border-2 border-dashed border-gray-100 p-16 text-center bg-gray-50/30">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-white text-gray-300 shadow-sm">
                  <FolderOpen size={32} />
                </div>
                <h3 className="mb-2 text-2xl font-black text-gray-900">Chưa có dữ liệu</h3>
                <p className="mx-auto max-w-xs text-sm font-medium text-gray-500 leading-relaxed">Bắt đầu bằng cách tạo cuộc họp mới hoặc tải lên tệp âm thanh có sẵn.</p>
                <Button onClick={() => navigate('/upload')} className="mt-8 rounded-2xl px-10 h-12 shadow-lg shadow-primary-500/20 font-black">Tải lên ngay</Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {recentMeetings.map((meeting, idx) => (
                  <MeetingCard key={meeting.id} meeting={meeting} index={idx} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column */}
        <div className="space-y-10 xl:col-span-4">
          {/* visual Calendar Widget */}
          <div className="rounded-3xl border border-gray-150/70 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-black text-gray-900 dark:text-white uppercase tracking-wider">
                <CalendarIcon size={18} className="text-primary-500" /> Lịch biểu
              </h3>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setWeekOffset(prev => prev - 1)}
                  className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-150/10 dark:border-slate-800 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setWeekOffset(0)}
                  className="px-2 py-0.5 text-[9px] font-black text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/30 rounded uppercase tracking-wider transition-colors"
                >
                  Hôm nay
                </button>
                <button
                  onClick={() => setWeekOffset(prev => prev + 1)}
                  className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-150/10 dark:border-slate-800 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Mini Horizontal Calendar */}
            <div className="mb-6 flex justify-between gap-1 border-b border-gray-50 dark:border-slate-800/80 pb-5">
              {calendarDays.map((day) => (
                <div
                  key={day.fullDate}
                  className={clsx(
                    "flex flex-1 flex-col items-center gap-1 rounded-2xl py-2.5 transition-all border",
                    day.isToday
                      ? "bg-gradient-to-br from-primary-600 to-emerald-600 text-white border-primary-500/25 shadow-md shadow-primary-500/20"
                      : "hover:bg-primary-50 border-transparent dark:hover:bg-primary-950/20 text-gray-650 dark:text-slate-400"
                  )}
                >
                  <span className={clsx("text-[9px] font-black uppercase tracking-wider", day.isToday ? "text-primary-100" : "text-gray-400")}>
                    {day.dayName}
                  </span>
                  <span className="text-xs font-black">{day.date}</span>
                  {day.hasMeeting && !day.isToday && (
                    <span className="h-1 w-1 rounded-full bg-primary-500 animate-pulse" />
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500">Cuộc họp sắp tới</p>
              {upcomingMeetings.length > 0 ? (
                upcomingMeetings.map((m) => {
                  const mDate = m.scheduled_start || m.startTime;
                  const parsedDate = mDate ? new Date(mDate) : null;
                  const isValidDate = parsedDate && !isNaN(parsedDate.getTime());
                  const isLive = m.status === 'live';
                  return (
                    <div
                      key={m.id}
                      className="group relative flex items-center justify-between gap-4 p-3.5 transition-all duration-300 hover:bg-gray-50/70 dark:hover:bg-slate-800/40 rounded-2xl border border-transparent hover:border-gray-100 dark:hover:border-slate-800"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Timeline Indicator Dot */}
                        <div className="relative flex items-center justify-center shrink-0">
                          <div className={clsx(
                            "h-2.5 w-2.5 rounded-full border-2 border-white dark:border-slate-900 shadow-sm",
                            isLive ? "bg-red-500 animate-pulse" : "bg-primary-500"
                          )} />
                        </div>
                        
                        <div className="min-w-0">
                          <p className="truncate text-xs font-extrabold text-gray-900 dark:text-white group-hover:text-primary-600 transition-colors">
                            {m.title}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400 dark:text-slate-500 font-semibold">
                            <span className="text-primary-600 dark:text-primary-400 font-black bg-primary-50 dark:bg-primary-950/40 px-1.5 py-0.5 rounded text-[9px]">
                              {isValidDate ? parsedDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }) : 'Chưa lên lịch'}
                            </span>
                            <span>·</span>
                            <span>
                              {isValidDate ? `${parsedDate.getDate()} Tháng ${parsedDate.getMonth() + 1}` : 'Chưa rõ ngày'}
                            </span>
                            {isLive && (
                              <span className="inline-flex items-center gap-0.5 font-black text-[8px] text-red-500 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded animate-pulse">
                                LIVE
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="shrink-0 flex items-center text-gray-300 group-hover:text-primary-500 transition-colors">
                        <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="py-6 text-center border border-dashed border-gray-150 dark:border-slate-800 rounded-xl">
                  <p className="text-xs text-gray-400">Tuyệt vời! Không có lịch họp nào.</p>
                </div>
              )}
              <Button
                variant="secondary"
                className="w-full rounded-xl border-dashed py-2 text-xs font-bold"
                onClick={() => navigate('/calendar')}
              >
                Mở lịch biểu đầy đủ
              </Button>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-3xl border border-gray-150/70 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-6 flex items-center gap-2 text-base font-black text-gray-900 dark:text-white uppercase tracking-wider">
              <Zap size={18} className="text-amber-500" /> Thao tác nhanh
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <QuickActionButton icon={<Mic size={20} />} label="Ghi âm" onClick={() => navigate('/upload')} />
              <QuickActionButton icon={<Plus size={20} />} label="Nhóm mới" onClick={() => navigate("/groups/create")} />
              <QuickActionButton icon={<FileText size={20} />} label="Dự án" onClick={() => navigate("/meetings")} />
              <QuickActionButton icon={<Sparkles size={20} />} label="AI Chat" onClick={() => navigate("/notifications")} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};



const QuickActionButton: React.FC<{ icon: React.ReactNode, label: string, onClick: () => void }> = ({ icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="group flex flex-col items-center justify-center gap-3 rounded-2xl border border-gray-100 bg-gradient-to-b from-white to-gray-50/30 p-4 shadow-sm transition-all duration-300 hover:bg-white hover:border-primary-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:from-slate-900 dark:to-slate-950/20 dark:hover:border-primary-900/40 active:scale-[0.97]"
  >
    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100/50 border border-gray-200/25 text-gray-400 group-hover:text-primary-500 group-hover:bg-primary-50 group-hover:border-primary-100/30 dark:bg-slate-800/80 dark:border-slate-700/25 dark:text-slate-500 dark:group-hover:text-primary-400 dark:group-hover:bg-primary-950/40 dark:group-hover:border-primary-900/30 transition-all duration-300 shrink-0">
      {icon}
    </div>
    <span className="text-[10px] font-black text-gray-600 dark:text-slate-400 group-hover:text-primary-700 dark:group-hover:text-primary-400 uppercase tracking-wider">{label}</span>
  </button>
);

const NoOrgView: React.FC = () => {
  const { refreshUser } = useAuth();
  const { createOrg, acceptInvitation, setCurrentOrg, isLoading, error, clearError } = useOrgStore();
  const [orgName, setOrgName] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"choice" | "create" | "join">("choice");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) return;
    try {
      await createOrg(orgName);
      await refreshUser();
    } catch (e) {
      console.error('Tạo tổ chức thất bại:', e);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    try {
      const organizationId = await acceptInvitation(token);
      await refreshUser();
      setCurrentOrg(organizationId);
    } catch (e) {
      console.error('Tham gia tổ chức thất bại:', e);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md rounded-[2.5rem] border border-gray-100 bg-white p-10 shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400">
            <Building2 size={40} />
          </div>
          <h2 className="text-3xl font-black text-gray-900 dark:text-white">Chào mừng!</h2>
          <p className="mt-2 text-slate-500">Bạn chưa thuộc về tổ chức nào. Hãy bắt đầu ngay.</p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-600 dark:bg-red-900/20 dark:text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={clearError} className="text-xs underline">Thoát</button>
          </div>
        )}

        {mode === "choice" && (
          <div className="space-y-4">
            <button
              onClick={() => setMode("create")}
              className="group flex w-full items-center justify-between rounded-2xl border border-primary-100 bg-primary-50/30 p-5 text-left transition-all hover:bg-primary-50 dark:border-primary-900/20 dark:bg-primary-900/10 dark:hover:bg-primary-900/20"
            >
              <div>
                <h3 className="font-bold text-primary-900 dark:text-primary-100">Tôi là Quản trị viên</h3>
                <p className="text-xs text-primary-600 dark:text-primary-400">Tạo tổ chức mới cho công ty/nhóm của bạn.</p>
              </div>
              <Plus className="text-primary-500 group-hover:scale-110 transition-transform" />
            </button>

            <div className="rounded-2xl border border-gray-100 p-5 dark:border-slate-800">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white">Tôi được mời tham gia</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Luồng chính là mở email mời từ quản trị viên và bấm vào liên kết tham gia tổ chức.
                  </p>
                </div>
                <ArrowRight className="mt-0.5 text-gray-300" />
              </div>
              <button
                onClick={() => setMode("join")}
                className="mt-4 text-xs font-bold text-primary-600 transition hover:text-primary-700 dark:text-primary-300"
              >
                Tôi có token thủ công
              </button>
            </div>
          </div>
        )}

        {mode === "create" && (
          <form onSubmit={handleCreate} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Tên tổ chức</label>
              <input
                autoFocus
                className="w-full h-14 rounded-2xl border-gray-100 bg-gray-50 px-5 text-lg font-bold focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                placeholder="Ví dụ: Công ty CONVIA"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
              />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="secondary" className="flex-1 rounded-xl" onClick={() => setMode("choice")}>Quay lại</Button>
              <Button type="submit" className="flex-2 rounded-xl px-8" loading={isLoading}>Tạo ngay</Button>
            </div>
          </form>
        )}

        {mode === "join" && (
          <form onSubmit={handleJoin} className="space-y-6">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-200">
              Hãy ưu tiên dùng liên kết trong email mời. Chỉ nhập token nếu bạn đang dùng luồng dự phòng hoặc môi trường dev.
            </div>
            <div className="space-y-2">
              <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Mã mời dự phòng</label>
              <input
                autoFocus
                className="h-14 w-full rounded-2xl border-gray-100 bg-gray-50 px-5 text-lg font-bold focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-500/10 dark:border-slate-800 dark:bg-slate-800/50 dark:text-white"
                placeholder="Dán token mời của bạn vào đây"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="secondary" className="flex-1 rounded-xl" onClick={() => setMode("choice")}>Quay lại</Button>
              <Button type="submit" className="flex-2 rounded-xl px-8" loading={isLoading}>Tham gia</Button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
};

export default Dashboard;
