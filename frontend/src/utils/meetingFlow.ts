import type { Meeting } from '../types';
import { buildLocalDateTime } from './meetingDateTime';

const JOIN_WINDOW_MS = 15 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['completed', 'processing', 'queued', 'failed', 'canceled']);

type MeetingFormInput = {
  title: string;
  groupId?: string;
  date: string;
  time: string;
  endTime?: string;
  now?: Date;
};

type MeetingFormValidation =
  | { ok: true; title: string; start: Date; end: Date }
  | { ok: false; message: string };

export const validateMeetingForm = (input: MeetingFormInput): MeetingFormValidation => {
  const title = input.title.trim();
  if (!title) return { ok: false, message: 'Vui lòng nhập tiêu đề cuộc họp' };
  if (!input.groupId) return { ok: false, message: 'Vui lòng chọn nhóm/phòng ban' };

  const start = buildLocalDateTime(input.date, input.time);
  if (Number.isNaN(start.getTime())) return { ok: false, message: 'Thời gian họp không hợp lệ' };

  const now = input.now ?? new Date();
  if (start.getTime() < now.getTime()) {
    return { ok: false, message: 'Không thể tạo cuộc họp trong quá khứ' };
  }

  const end = input.endTime
    ? buildLocalDateTime(input.date, input.endTime)
    : new Date(start.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(end.getTime()) || end <= start) {
    return { ok: false, message: 'Giờ kết thúc phải sau giờ bắt đầu' };
  }

  return { ok: true, title, start, end };
};

export const getMeetingJoinState = (meeting: Meeting, now: Date = new Date()) => {
  const roomKey = meeting.code || meeting.id;
  const href = roomKey ? `/room/${roomKey}` : '#';
  if (meeting.status === 'live') {
    return { canJoin: true, label: 'Vào phòng', reason: 'Cuộc họp đang diễn ra', href };
  }
  if (meeting.status === 'completed') {
    return { canJoin: false, label: 'Biên bản', reason: 'Cuộc họp đã hoàn tất', href: `/meetings/${meeting.id}` };
  }
  if (meeting.status === 'processing' || meeting.status === 'queued') {
    return { canJoin: false, label: 'Đang xử lý', reason: 'AI Notes đang được xử lý', href: `/meetings/${meeting.id}` };
  }
  if (meeting.status === 'failed') {
    return { canJoin: false, label: 'Xem lỗi', reason: 'Cuộc họp xử lý lỗi', href: `/meetings/${meeting.id}` };
  }
  if (meeting.status === 'canceled') {
    return { canJoin: false, label: 'Đã hủy', reason: 'Cuộc họp đã hủy', href: `/meetings/${meeting.id}` };
  }

  const start = new Date(meeting.startTime || meeting.scheduled_start || meeting.createdAt);
  const startMs = start.getTime();
  if (Number.isNaN(startMs)) {
    return { canJoin: false, label: 'Chưa tới giờ', reason: 'Thời gian họp không hợp lệ', href: '#' };
  }
  if (startMs - now.getTime() <= JOIN_WINDOW_MS) {
    if (!roomKey) {
      return { canJoin: false, label: 'Thiếu mã họp', reason: 'Cuộc họp chưa có mã tham gia', href: '#' };
    }
    return { canJoin: true, label: 'Vào phòng', reason: 'Có thể vào trước giờ họp 15 phút', href };
  }

  return { canJoin: false, label: 'Chưa tới giờ', reason: 'Có thể vào trước giờ họp 15 phút', href: '#' };
};

export const getMeetingStatusPresentation = (meeting: Meeting, now: Date = new Date()) => {
  const start = new Date(meeting.startTime || meeting.scheduled_start || meeting.createdAt);
  const end = new Date(meeting.endTime || meeting.scheduled_end || meeting.updatedAt);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const terminal = TERMINAL_STATUSES.has(meeting.status);
  const inferredLive = !terminal && !Number.isNaN(startMs) && !Number.isNaN(endMs) && startMs <= now.getTime() && endMs >= now.getTime();
  const hasRecording = Boolean(meeting.audioStatus === 'READY' || meeting.audioUrl || meeting.recordingUrl);

  if (meeting.status === 'canceled') {
    return { label: 'Đã hủy', badgeClass: 'bg-gray-100 text-gray-500 border border-gray-200/50', accentClass: 'border-l-gray-350', dotClass: 'bg-gray-300', calendarColor: '#64748b', hasRecording };
  }
  if (meeting.status === 'processing' || meeting.status === 'queued') {
    return { label: meeting.status === 'queued' ? 'Chờ xử lý' : 'Đang xử lý', badgeClass: 'bg-amber-50 text-amber-700 border border-amber-100/50', accentClass: 'border-l-amber-500', dotClass: 'bg-amber-500', calendarColor: '#f59e0b', hasRecording };
  }
  if (meeting.status === 'failed') {
    return { label: 'Lỗi', badgeClass: 'bg-rose-50 text-rose-700 border border-rose-100/50', accentClass: 'border-l-rose-500', dotClass: 'bg-rose-500', calendarColor: '#e11d48', hasRecording };
  }
  if (meeting.status === 'completed' || (!terminal && !Number.isNaN(endMs) && endMs < now.getTime())) {
    return { label: 'Hoàn tất', badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-100/50', accentClass: 'border-l-emerald-500', dotClass: 'bg-emerald-500', calendarColor: '#10b981', hasRecording };
  }
  if (meeting.status === 'live' || inferredLive) {
    return { label: 'Live', badgeClass: 'bg-red-50 text-red-700 border border-red-100/50', accentClass: 'border-l-red-500', dotClass: 'bg-red-500', calendarColor: '#ef4444', hasRecording };
  }
  return { label: 'Sắp tới', badgeClass: 'bg-teal-50 text-teal-700 border border-teal-100/50', accentClass: 'border-l-teal-500', dotClass: 'bg-teal-500', calendarColor: '#3b82f6', hasRecording };
};
