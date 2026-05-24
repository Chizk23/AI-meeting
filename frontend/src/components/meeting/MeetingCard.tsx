import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  Hash,
  ListChecks,
  Loader2,
  Pencil,
  Radio,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { format } from 'date-fns';
import type { Meeting, User } from '../../types';
import { getMeetingJoinState, getMeetingStatusPresentation } from '../../utils/meetingFlow';

interface MeetingCardProps {
  meeting: Meeting;
  index: number;
  onEdit?: (meeting: Meeting) => void;
  onDelete?: (meeting: Meeting) => void;
  canManage?: boolean;
}

const statusConfig = {
  live: {
    label: 'Live',
    accent: 'border-l-red-500',
    dot: 'bg-red-500',
    badge: 'bg-red-50 text-red-700 border border-red-100/50',
    icon: <Radio size={10} className="animate-pulse" />,
    action: 'Vào phòng',
    href: (m: Meeting) => `/room/${m.code || m.id}`,
    actionClass: 'bg-red-600 text-white hover:bg-red-500 shadow-md shadow-red-500/25 active:scale-95 transition-transform duration-100',
  },
  upcoming: {
    label: 'Sắp tới',
    accent: 'border-l-teal-500',
    dot: 'bg-teal-500',
    badge: 'bg-teal-50 text-teal-700 border border-teal-100/50',
    icon: <Calendar size={10} />,
    action: 'Vào phòng',
    href: (m: Meeting) => `/room/${m.code || m.id}`,
    actionClass: 'bg-teal-600 text-white hover:bg-teal-500 shadow-md shadow-teal-500/25 active:scale-95 transition-transform duration-100',
  },
  completed: {
    label: 'Hoàn tất',
    accent: 'border-l-emerald-500',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border border-emerald-100/50',
    icon: <CheckCircle2 size={10} />,
    action: 'Biên bản',
    href: (m: Meeting) => `/meetings/${m.id}`,
    actionClass: 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm active:scale-95 transition-transform duration-100',
  },
  processing: {
    label: 'Đang xử lý',
    accent: 'border-l-amber-500',
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 border border-amber-100/50',
    icon: <Loader2 size={10} className="animate-spin" />,
    action: 'Xem',
    href: (m: Meeting) => `/meetings/${m.id}`,
    actionClass: 'bg-amber-600 text-white hover:bg-amber-500 shadow-md shadow-amber-500/25 active:scale-95 transition-transform duration-100',
  },
  queued: {
    label: 'Chờ xử lý',
    accent: 'border-l-amber-400',
    dot: 'bg-amber-400',
    badge: 'bg-amber-50 text-amber-600 border border-amber-100/50',
    icon: <Clock size={10} />,
    action: 'Xem',
    href: (m: Meeting) => `/meetings/${m.id}`,
    actionClass: 'bg-amber-500 text-white hover:bg-amber-400 shadow-md shadow-amber-500/20 active:scale-95 transition-transform duration-100',
  },
  failed: {
    label: 'Lỗi',
    accent: 'border-l-rose-500',
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 border border-rose-100/50',
    icon: <AlertCircle size={10} />,
    action: 'Xem',
    href: (m: Meeting) => `/meetings/${m.id}`,
    actionClass: 'bg-rose-600 text-white hover:bg-rose-500 shadow-md shadow-rose-500/25 active:scale-95 transition-transform duration-100',
  },
  canceled: {
    label: 'Đã hủy',
    accent: 'border-l-gray-350',
    dot: 'bg-gray-300',
    badge: 'bg-gray-100 text-gray-500 border border-gray-200/50',
    icon: <AlertCircle size={10} />,
    action: 'Chi tiết',
    href: (m: Meeting) => `/meetings/${m.id}`,
    actionClass: 'bg-gray-200 text-gray-600 hover:bg-gray-350 active:scale-95 transition-transform duration-100',
  },
} as const;

const safeDate = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const getEffectiveDurationMinutes = (meeting: Meeting) => {
  if (meeting.status === 'live' && meeting.actual_start) {
    const liveStart = new Date(meeting.actual_start);
    if (!Number.isNaN(liveStart.getTime())) {
      return Math.max(0, Math.floor((Date.now() - liveStart.getTime()) / 60000));
    }
  }
  if (meeting.duration) {
    return Math.max(0, meeting.duration);
  }
  const startStr = meeting.actual_start || meeting.startTime;
  const endStr = meeting.actual_end || meeting.endTime;
  if (startStr && endStr) {
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    }
  }
  return 0;
};

const getInitials = (user: User) => {
  if (user.displayName) return user.displayName.substring(0, 2).toUpperCase();
  if (user.firstName && user.lastName) return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  if (user.firstName) return user.firstName.substring(0, 2).toUpperCase();
  return user.email.substring(0, 2).toUpperCase();
};

const getDisplayName = (user: User) => (
  user.displayName
  || `${user.firstName || ''} ${user.lastName || ''}`.trim()
  || user.email
  || 'Thành viên'
);

const getAvatarColor = (id: string) => {
  const colors = [
    'bg-blue-500 text-white',
    'bg-emerald-500 text-white',
    'bg-violet-500 text-white',
    'bg-amber-500 text-white',
    'bg-rose-500 text-white',
    'bg-cyan-500 text-white',
    'bg-indigo-500 text-white',
  ];
  let sum = 0;
  const key = id || 'user';
  for (let i = 0; i < key.length; i++) {
    sum += key.charCodeAt(i);
  }
  return colors[sum % colors.length];
};

const MeetingCard: React.FC<MeetingCardProps> = ({
  meeting,
  index,
  onEdit,
  onDelete,
  canManage = false,
}) => {
  const presentation = getMeetingStatusPresentation(meeting);
  const status = {
    ...(statusConfig[meeting.status] || statusConfig.upcoming),
    label: presentation.label,
    accent: presentation.accentClass,
    badge: presentation.badgeClass,
    dot: presentation.dotClass,
  };
  const start = safeDate(meeting.startTime);
  const durationMinutes = getEffectiveDurationMinutes(meeting);
  const hasTranscript = Boolean(meeting.transcriptUrl || meeting.summary || meeting.keyPoints?.length || meeting.decisions?.length);
  const hasRecording = presentation.hasRecording;
  const hasAiNotes = Boolean(meeting.summary || meeting.keyPoints?.length || meeting.decisions?.length);
  const insightCount = (meeting.keyPoints?.length || 0) + (meeting.decisions?.length || 0);
  const actionCount = meeting.actionItemsCount || 0;

  const joinState = getMeetingJoinState(meeting);
  const canJoin = joinState.canJoin;

  const effectiveStatus = meeting.status === 'upcoming' && !canJoin
    ? { ...status, action: joinState.label, actionClass: 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200/20' }
    : { ...status, action: joinState.label };
  const actionHref = joinState.href;

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, scale: 1.01 }}
      transition={{ 
        type: 'spring', 
        stiffness: 280, 
        damping: 18,
        delay: index * 0.03 
      }}
      className={`group relative flex flex-col rounded-2xl border border-gray-200 bg-white transition-all duration-300 hover:shadow-md hover:border-gray-300 border-l-[3px] ${status.accent}`}
    >
      {/* Main Container - Generous padding */}
      <div className="flex flex-1 flex-col p-5 pb-4.5 relative z-10">
        {/* Top row: Date & Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 font-semibold">
            <Calendar size={13} className="text-gray-400" />
            <span>{format(start, 'dd/MM · HH:mm')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${status.badge}`}>
              {status.icon}
              {status.label}
            </span>
            {meeting.status === 'live' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
            )}
            {meeting.isPinned && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 border border-amber-100/50">
                <Star size={9} fill="currentColor" />
              </span>
            )}
          </div>
        </div>

        {/* Content Link Wrapper */}
        <Link to={`/meetings/${meeting.id}`} className="mt-4 flex flex-1 flex-col group">
          {/* Group Tag */}
          <div className="flex items-center gap-1 text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
            <FolderOpen size={11} className="text-gray-400" />
            <span className="truncate">{meeting.groupName || meeting.organizationName || 'Chưa phân nhóm'}</span>
          </div>

          {/* Title */}
          <h3 className="line-clamp-2 text-base font-bold text-gray-900 group-hover:text-primary-600 transition-colors leading-snug tracking-tight">
            {meeting.title}
          </h3>

          {/* Summary / Description */}
          {(meeting.summary || meeting.description) && (
            <p className="line-clamp-2 text-xs text-gray-600 leading-relaxed mt-2">
              {meeting.summary || meeting.description}
            </p>
          )}

          {/* Metadata Row: Attendees & Duration */}
          <div className="mt-auto flex items-center justify-between border-t border-gray-100 pt-3.5">
            {/* Overlapping Avatar Stack */}
            {meeting.attendees && meeting.attendees.length > 0 ? (
              <div className="flex -space-x-1.5 overflow-hidden">
                {meeting.attendees.slice(0, 4).map((att) => (
                  <div
                    key={att.id}
                    className={`group/avatar relative inline-flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold ring-2 ring-white transition-transform hover:scale-110 hover:z-10 cursor-pointer ${
                      att.avatarUrl ? '' : getAvatarColor(att.id || att.email)
                    }`}
                    title={getDisplayName(att)}
                  >
                    {att.avatarUrl ? (
                      <img
                        src={att.avatarUrl}
                        alt={getDisplayName(att)}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      getInitials(att)
                    )}
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1 text-[10px] font-bold text-white shadow-lg group-hover/avatar:block dark:bg-slate-100 dark:text-slate-900">
                      {getDisplayName(att)}
                    </div>
                  </div>
                ))}
                {meeting.attendees.length > 4 && (
                  <div
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[9px] font-extrabold text-gray-600 ring-2 ring-white"
                    title="Và các thành viên khác"
                  >
                    +{meeting.attendees.length - 4}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-6 items-center text-[11px] text-gray-500 font-semibold">
                <Users size={11} className="mr-1 text-gray-400" /> Không có người tham gia
              </div>
            )}

            {/* Duration */}
            <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-600">
              <Clock size={12} className="text-gray-400" />
              <span>{durationMinutes > 0 ? `${durationMinutes} phút` : '--'}</span>
            </div>
          </div>

          {/* AI Badge Pills */}
          {(hasRecording || hasTranscript || hasAiNotes || insightCount > 0 || actionCount > 0) && (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-gray-100 pt-3">
              {hasRecording && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 text-emerald-700 font-bold text-[10px] px-2 py-0.5 border border-emerald-100 shadow-sm">
                  <FileText size={10} />
                  Bản ghi
                </span>
              )}
              {hasAiNotes && (
                <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 text-teal-700 font-bold text-[10px] px-2 py-0.5 border border-teal-100/50 shadow-sm">
                  <Bot size={10} />
                  AI Notes
                </span>
              )}
              {insightCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 text-violet-700 font-bold text-[10px] px-2 py-0.5 border border-violet-100 shadow-sm">
                  <Star size={10} className="text-violet-500" fill="currentColor" />
                  {insightCount} ý tưởng
                </span>
              )}
              {actionCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 text-amber-700 font-bold text-[10px] px-2 py-0.5 border border-amber-100/30 shadow-sm">
                  <ListChecks size={10} />
                  {actionCount} việc
                </span>
              )}
            </div>
          )}
        </Link>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-gray-150 px-5 py-3.5 bg-gray-50/50 rounded-b-2xl relative z-10">
        <div className="text-[10px] font-bold text-gray-500">
          {meeting.code ? (
            <span className="inline-flex items-center gap-1 font-mono tracking-wide">
              <Hash size={10} className="text-gray-400" />
              {meeting.code}
            </span>
          ) : (
            <span className="text-gray-400">&mdash;</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <div className="flex items-center gap-0.5 mr-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <button
                type="button"
                onClick={() => onEdit?.(meeting)}
                className="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
                title="Sửa"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                onClick={() => onDelete?.(meeting)}
                className="rounded-lg p-1.5 text-gray-500 transition hover:bg-red-50 hover:text-red-500"
                title="Xóa"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
          <Link
            to={actionHref}
            onClick={(e) => { if (!canJoin && meeting.status === 'upcoming') e.preventDefault(); }}
            className={`inline-flex items-center rounded-lg px-3.5 py-1.5 text-[11px] font-bold transition-all duration-200 hover:-translate-y-0.5 ${effectiveStatus.actionClass}`}
          >
            {effectiveStatus.action}
          </Link>
        </div>
      </div>
    </motion.article>
  );
};

export default MeetingCard;
