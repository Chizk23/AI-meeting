import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  CheckCircle2,
  Clock,
  Plus,
  Radio,
  Upload,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAppStore, useOrgStore } from '../stores';
import { AnimatedCounter, PageState, StatCard } from '../components/ui';
import EditMeetingModal from '../features/meeting/components/EditMeetingModal';
import MeetingCard from '../features/meeting/components/MeetingCard';
import MeetingFilters from '../features/meeting/components/MeetingFilters';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';
import type { Meeting } from '../types';

type SortOption = 'newest' | 'oldest' | 'longest' | 'most-attendees';

const COMPLETED_PAGE_SIZE = 6;

interface MeetingSection {
  key: string;
  label: string;
  icon: React.ReactNode;
  accent: string;
  badge: string;
  meetings: Meeting[];
  collapsible?: boolean;
}

const MeetingList: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isViewer } = usePermission();
  const { meetings } = useAppStore();
  const { currentOrg, currentOrgId, groups } = useOrgStore();
  const { loadMeetings } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingMeeting, setEditingMeeting] = useState<any>(null);
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [completedPage, setCompletedPage] = useState(1);
  const targetOrgId = currentOrg?.id || currentOrgId;

  React.useEffect(() => {
    if (!targetOrgId) return;
    let active = true;
    setIsLoadingMeetings(true);
    setLoadError(null);
    loadMeetings(targetOrgId)
      .catch((err: any) => {
        if (!active) return;
        setLoadError(err?.response?.data?.detail || 'Không thể tải danh sách cuộc họp');
      })
      .finally(() => {
        if (active) setIsLoadingMeetings(false);
      });
    return () => { active = false; };
  }, [loadMeetings, targetOrgId]);

  const orgMeetings = useMemo(() => {
    if (!targetOrgId) return meetings;
    return meetings.filter(m => m.orgId === targetOrgId || m.organization_id === targetOrgId);
  }, [meetings, targetOrgId]);

  const uniqueGroups = useMemo(() => {
    const groupIds = [...new Set(orgMeetings.map((m) => m.groupId))];
    return groupIds.map((id) => groups.find((group) => group.id === id)).filter(Boolean);
  }, [groups, orgMeetings]);

  const filteredMeetings = useMemo(() => {
    let result = [...orgMeetings];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(m => m.title.toLowerCase().includes(term) || m.description?.toLowerCase().includes(term));
    }
    if (groupFilter !== 'all') result = result.filter(m => m.groupId === groupFilter);
    if (statusFilter !== 'all') {
      if (statusFilter === 'live_upcoming') result = result.filter(m => m.status === 'live' || m.status === 'upcoming');
      else if (statusFilter === 'processing') result = result.filter(m => m.status === 'processing' || m.status === 'queued');
      else if (statusFilter === 'done') result = result.filter(m => m.status === 'completed' || m.status === 'failed' || m.status === 'canceled');
    }

    switch (sortBy) {
      case 'newest': result.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()); break;
      case 'oldest': result.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()); break;
      case 'longest': result.sort((a, b) => b.duration - a.duration); break;
      case 'most-attendees': result.sort((a, b) => (b.attendees?.length || 0) - (a.attendees?.length || 0)); break;
    }
    return result;
  }, [orgMeetings, searchTerm, groupFilter, statusFilter, sortBy]);

  const sections: MeetingSection[] = useMemo(() => {
    const liveUpcoming = filteredMeetings.filter(m => m.status === 'live' || m.status === 'upcoming');
    const processing = filteredMeetings.filter(m => m.status === 'processing' || m.status === 'queued');
    const done = filteredMeetings.filter(m => m.status === 'completed' || m.status === 'failed' || m.status === 'canceled');

    return [
      { key: 'live_upcoming', label: 'Sắp tới / Đang diễn ra', icon: <Radio size={16} className="text-teal-500 animate-pulse stroke-[2.5]" />, accent: 'border-teal-500', badge: 'bg-teal-50 text-teal-700 border border-teal-100/30', meetings: liveUpcoming },
      { key: 'processing', label: 'Đang xử lý', icon: <Loader2 size={16} className="animate-spin" />, accent: 'border-amber-500', badge: 'bg-amber-100 text-amber-700', meetings: processing },
      { key: 'done', label: 'Đã xong', icon: <CheckCircle2 size={16} />, accent: 'border-emerald-500', badge: 'bg-emerald-100 text-emerald-700', meetings: done, collapsible: true },
    ].filter(s => s.meetings.length > 0);
  }, [filteredMeetings]);

  const stats = useMemo(() => {
    const total = orgMeetings.length;
    const liveOrUpcoming = orgMeetings.filter(m => m.status === 'live' || m.status === 'upcoming').length;
    const completed = orgMeetings.filter(m => m.status === 'completed').length;
    const totalHours = orgMeetings.reduce((sum, m) => sum + m.duration, 0) / 60;
    return { total, liveOrUpcoming, completed, totalHours };
  }, [orgMeetings]);

  const handleEditMeeting = (meeting: any) => setEditingMeeting(meeting);
  const handleEditMeetingUpdated = async () => {
    if (targetOrgId) await loadMeetings(targetOrgId);
    setEditingMeeting(null);
  };

  const handleDeleteMeeting = async (meeting: any) => {
    const confirmed = window.confirm(`Xóa cuộc họp "${meeting.title}"?`);
    if (!confirmed) return;
    try {
      await api.delete(`/api/meetings/${meeting.id}`);
      if (targetOrgId) await loadMeetings(targetOrgId);
    } catch (err: any) {
      window.alert(err?.response?.data?.detail || 'Không thể xóa cuộc họp');
    }
  };

  return (
    <>
      <div className="space-y-10 pb-12">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between px-1">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-gray-900 leading-none">
              Cuộc họp
              {currentOrg && <span className="ml-3 text-lg font-bold text-gray-400">/ {currentOrg.name}</span>}
            </h1>
            <p className="mt-3 text-sm font-bold text-gray-400 uppercase tracking-widest">{orgMeetings.length} cuộc họp · {stats.totalHours.toFixed(1)}h đã xử lý</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => navigate('/upload')} className="inline-flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-5 py-2.5 text-xs font-black text-gray-600 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
              <Upload size={14} /> Tải âm thanh
            </button>
            <button onClick={() => navigate('/meetings/create')} className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-xs font-black text-white shadow-lg shadow-primary-600/20 transition-all hover:-translate-y-0.5 hover:shadow-primary-600/30">
              <Plus size={14} className="stroke-[3]" /> Tạo live
            </button>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {[
            { label: 'Tổng cuộc họp', value: stats.total, icon: <FileText size={18} />, accent: 'primary' },
            { label: 'Live / Sắp tới', value: stats.liveOrUpcoming, icon: <Radio size={18} className="text-red-500 animate-pulse" />, accent: 'danger' },
            { label: 'Hoàn thành', value: stats.completed, icon: <CheckCircle2 size={18} />, accent: 'primary' },
            { label: 'Tổng thời gian', value: stats.totalHours, suffix: 'h', icon: <Clock size={18} />, accent: 'warning' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 + i * 0.04 }}
            >
              <StatCard
                label={stat.label}
                value={typeof stat.value === 'number' ? <AnimatedCounter value={stat.value} /> : stat.value}
                icon={stat.icon}
                accent={stat.accent as any}
                subtitle={stat.suffix ? `${stat.value.toFixed(1)}${stat.suffix}` : undefined}
              />
            </motion.div>
          ))}
        </motion.div>

        {/* Filters */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="sticky top-0 z-20 -mx-4 px-4 py-3 backdrop-blur-md lg:mx-0 lg:px-0">
          <div className="rounded-[1.5rem] border border-gray-100 bg-white/80 p-3 shadow-xl shadow-gray-200/20">
            <MeetingFilters
              searchTerm={searchTerm} setSearchTerm={(v) => { setSearchTerm(v); setCompletedPage(1); }}
              sortBy={sortBy} setSortBy={(v) => { setSortBy(v); setCompletedPage(1); }}
              groupFilter={groupFilter} setGroupFilter={(v) => { setGroupFilter(v); setCompletedPage(1); }}
              uniqueGroups={uniqueGroups}
              statusFilter={statusFilter} setStatusFilter={(v) => { setStatusFilter(v); setCompletedPage(1); }}
            />
          </div>
        </motion.div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {isLoadingMeetings ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <PageState
                title="Đang tải danh sách cuộc họp"
                description="Hệ thống đang đồng bộ lịch họp, trạng thái xử lý và các meeting liên quan tới tổ chức của bạn."
                tone="loading"
              />
            </motion.div>
          ) : loadError ? (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <PageState
                title="Không tải được danh sách cuộc họp"
                description={loadError}
                tone="error"
                action={
                  <button
                    onClick={() => targetOrgId && loadMeetings(targetOrgId)}
                    className="rounded-xl bg-red-600 px-8 py-3 text-sm font-black text-white transition hover:bg-red-700 shadow-lg shadow-red-600/20"
                  >
                    Tải lại
                  </button>
                }
              />
            </motion.div>
          ) : filteredMeetings.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <PageState
                title={orgMeetings.length === 0 ? 'Chưa có cuộc họp nào trong tổ chức này' : 'Không tìm thấy kết quả phù hợp'}
                description={
                  orgMeetings.length === 0
                    ? isViewer
                      ? 'Bạn đang ở chế độ chỉ xem. Hãy tham gia bằng mã phòng hoặc chờ quản trị viên tạo cuộc họp đầu tiên.'
                      : 'Bắt đầu bằng một cuộc họp live, tải ghi âm hoặc mời mọi người tham gia bằng mã phòng.'
                    : 'Thử thay đổi từ khóa, nhóm hoặc trạng thái để mở rộng danh sách kết quả.'
                }
                tone="empty"
                action={
                  <div className="flex flex-wrap justify-center gap-3">
                    {!isViewer && (
                      <button
                        onClick={() => navigate('/meetings/create')}
                        className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-8 py-4 text-sm font-black text-white shadow-xl shadow-gray-900/20 transition-all hover:-translate-y-1"
                      >
                        <Plus size={18} className="stroke-[3]" />
                        Tạo cuộc họp
                      </button>
                    )}
                    <button
                      onClick={() => navigate(orgMeetings.length === 0 ? '/join' : '/upload')}
                      className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-8 py-4 text-sm font-black text-gray-700 shadow-sm transition-all hover:-translate-y-1 hover:bg-gray-50"
                    >
                      {orgMeetings.length === 0 ? <Radio size={18} /> : <Upload size={18} />}
                      {orgMeetings.length === 0 ? 'Tham gia bằng mã' : 'Tải âm thanh'}
                    </button>
                  </div>
                }
              />
            </motion.div>
          ) : (
            <motion.div key="sections" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-12">
              {sections.map((section) => {
                const totalPages = section.collapsible ? Math.ceil(section.meetings.length / COMPLETED_PAGE_SIZE) : 1;
                const displayMeetings = section.collapsible
                  ? section.meetings.slice((completedPage - 1) * COMPLETED_PAGE_SIZE, completedPage * COMPLETED_PAGE_SIZE)
                  : section.meetings;

                return (
                  <div key={section.key}>
                    {/* Section header */}
                    <div className="mb-6 flex items-center gap-3">
                      <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-5 py-2.5 shadow-xl shadow-gray-200/10">
                        <div className={`h-2 w-2 rounded-full ${section.accent.replace('border-', 'bg-')} shadow-sm`} />
                        <span className="text-gray-400">{section.icon}</span>
                        <span className="text-sm font-black text-gray-900 uppercase tracking-widest">{section.label}</span>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black shadow-inner ${section.badge}`}>{section.meetings.length}</span>
                    </div>

                    {/* Cards grid */}
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {displayMeetings.map((meeting, idx) => (
                        <MeetingCard key={meeting.id} meeting={meeting} index={idx} canManage={!isViewer} onEdit={handleEditMeeting} onDelete={handleDeleteMeeting} />
                      ))}
                    </div>

                    {/* Pagination for completed */}
                    {section.collapsible && totalPages > 1 && (
                      <div className="mt-6 flex items-center justify-center gap-2">
                        <button
                          onClick={() => setCompletedPage((p) => Math.max(1, p - 1))}
                          disabled={completedPage === 1}
                          className="rounded-lg border border-gray-200 p-2 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                          <button
                            key={page}
                            onClick={() => setCompletedPage(page)}
                            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                              completedPage === page
                                ? 'bg-primary-600 text-white'
                                : 'text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {page}
                          </button>
                        ))}
                        <button
                          onClick={() => setCompletedPage((p) => Math.min(totalPages, p + 1))}
                          disabled={completedPage === totalPages}
                          className="rounded-lg border border-gray-200 p-2 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <EditMeetingModal
        meeting={editingMeeting}
        isOpen={Boolean(editingMeeting)}
        onClose={() => setEditingMeeting(null)}
        onUpdated={handleEditMeetingUpdated}
      />
    </>
  );
};

export default MeetingList;
