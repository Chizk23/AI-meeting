import React from 'react';
import { Modal } from '../../../components/ui';
import { Users, Clock, User, Calendar as CalendarIcon, Building2, FolderOpen, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../../services/api';
import type { MeetingDetail } from '../../../types';
import { normalizeMeetingDetail } from '../../../services/mappers';
import { useAuth } from '../../../context/AuthContext';
import { usePermission } from '../../../hooks/usePermission';
import EditMeetingModal from './EditMeetingModal';
import { toast } from '../../../components/ui/Toast';

interface MeetingDetailPopupProps {
  meetingId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted?: () => void;
  onUpdated?: () => void;
}

const MeetingDetailPopup: React.FC<MeetingDetailPopupProps> = ({ meetingId, isOpen, onClose, onDeleted, onUpdated }) => {
  const [meeting, setMeeting] = React.useState<MeetingDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [isEditMeetingOpen, setIsEditMeetingOpen] = React.useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isSystemAdmin, isOrgAdmin, isGroupAdmin, isViewer } = usePermission();

  const canManage = Boolean(
    meeting && user && !isViewer &&
    (isSystemAdmin || isOrgAdmin || isGroupAdmin || meeting.createdBy === user.id)
  );

  React.useEffect(() => {
    if (!meetingId || !isOpen) {
      setMeeting(null);
      return;
    }
    setLoading(true);
    api.get(`/api/meetings/${meetingId}`)
      .then(res => setMeeting(normalizeMeetingDetail(res.data)))
      .catch(() => setMeeting(null))
      .finally(() => setLoading(false));
  }, [meetingId, isOpen]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('vi-VN', {
        hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
      });
    } catch { return iso; }
  };

  const getDuration = () => {
    if (!meeting) return '';
    if (meeting.duration > 0) return `${meeting.duration} phút`;
    if (meeting.scheduled_start && meeting.scheduled_end) {
      const diff = new Date(meeting.scheduled_end).getTime() - new Date(meeting.scheduled_start).getTime();
      return `${Math.round(diff / 60000)} phút`;
    }
    return 'Chưa xác định';
  };

  const statusColors: Record<string, string> = {
    upcoming: 'bg-blue-100 text-blue-700',
    live: 'bg-red-100 text-red-700',
    completed: 'bg-emerald-100 text-emerald-700',
    canceled: 'bg-gray-100 text-gray-500',
    queued: 'bg-yellow-100 text-yellow-700',
    processing: 'bg-purple-100 text-purple-700',
    failed: 'bg-red-100 text-red-600',
  };

  const statusLabels: Record<string, string> = {
    upcoming: 'Sắp tới',
    live: 'Đang diễn ra',
    completed: 'Đã hoàn thành',
    canceled: 'Đã hủy',
    queued: 'Đang chờ',
    processing: 'Đang xử lý',
    failed: 'Thất bại',
  };

  const handleDelete = async () => {
    if (!meeting || !window.confirm('Bạn có chắc muốn xóa cuộc họp này?')) return;
    try {
      await api.delete(`/api/meetings/${meeting.id}`);
      toast.success('Đã xóa cuộc họp');
      onDeleted?.();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Lỗi khi xóa cuộc họp');
    }
  };

  const handleEditMeetingUpdated = async () => {
    if (!meetingId) return;
    try {
      const res = await api.get(`/api/meetings/${meetingId}`);
      setMeeting(normalizeMeetingDetail(res.data));
    } catch {}
    onUpdated?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Chi tiết cuộc họp" size="md">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
        </div>
      ) : !meeting ? (
        <p className="text-center text-gray-500 py-8">Không tìm thấy thông tin cuộc họp.</p>
      ) : (
        <div className="space-y-5">
          {/* Title & Status */}
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">{meeting.title}</h3>
            {meeting.description && (
              <p className="mt-1 text-sm text-gray-500">{meeting.description}</p>
            )}
            <div className="mt-2">
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusColors[meeting.status] || 'bg-gray-100'}`}>
                {statusLabels[meeting.status] || meeting.status}
              </span>
            </div>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="flex items-center gap-2">
              <CalendarIcon size={16} className="text-primary-500" />
              <div>
                <p className="text-xs text-gray-500">Bắt đầu</p>
                <p className="text-sm font-medium text-gray-800 dark:text-slate-200">
                  {formatTime(meeting.scheduled_start || meeting.startTime)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-primary-500" />
              <div>
                <p className="text-xs text-gray-500">Thời lượng</p>
                <p className="text-sm font-medium text-gray-800 dark:text-slate-200">{getDuration()}</p>
              </div>
            </div>
            {meeting.organizationName && (
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-primary-500" />
                <div>
                  <p className="text-xs text-gray-500">Tổ chức</p>
                  <p className="text-sm font-medium text-gray-800 dark:text-slate-200">{meeting.organizationName}</p>
                </div>
              </div>
            )}
            {meeting.groupName && (
              <div className="flex items-center gap-2">
                <FolderOpen size={16} className="text-primary-500" />
                <div>
                  <p className="text-xs text-gray-500">Nhóm</p>
                  <p className="text-sm font-medium text-gray-800 dark:text-slate-200">{meeting.groupName}</p>
                </div>
              </div>
            )}
          </div>

          {/* Organizer */}
          {meeting.createdByUser && (
            <div>
              <h4 className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-slate-200 mb-2">
                <User size={16} className="text-primary-500" />
                Người tổ chức
              </h4>
              <div className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 dark:border-slate-700">
                {meeting.createdByUser.avatarUrl ? (
                  <img src={meeting.createdByUser.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-600">
                    <User size={14} />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-slate-200">
                    {meeting.createdByUser.displayName || `${meeting.createdByUser.firstName} ${meeting.createdByUser.lastName}`.trim() || meeting.createdByUser.email}
                  </p>
                  <p className="text-xs text-gray-400">{meeting.createdByUser.email}</p>
                </div>
              </div>
            </div>
          )}

          {/* Participants */}
          <div>
            <h4 className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-slate-200 mb-2">
              <Users size={16} className="text-primary-500" />
              Thành viên tham gia ({meeting.attendees?.length || 0})
            </h4>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-50 dark:border-slate-700 dark:divide-slate-800">
              {(meeting.attendees || []).map((attendee) => (
                <div key={attendee.id} className="flex items-center gap-3 px-4 py-2.5">
                  {attendee.avatarUrl ? (
                    <img src={attendee.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-slate-700">
                      <User size={12} />
                    </div>
                  )}
                  <p className="text-sm text-gray-700 dark:text-slate-300 truncate">
                    {attendee.displayName || `${attendee.firstName} ${attendee.lastName}`.trim() || attendee.email}
                  </p>
                </div>
              ))}
              {(!meeting.attendees || meeting.attendees.length === 0) && (
                <p className="px-4 py-3 text-sm text-gray-400">Chưa có thành viên nào.</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-slate-800">
            <div className="flex gap-2">
              {canManage && (
                <>
                  <button
                    onClick={() => setIsEditMeetingOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors dark:text-slate-400 dark:hover:text-primary-400 dark:hover:bg-primary-900/20"
                  >
                    <Pencil size={14} />
                    Sửa
                  </button>
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors dark:text-slate-400 dark:hover:text-red-400 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={14} />
                    Xóa
                  </button>
                </>
              )}
            </div>
            <button
              onClick={() => { onClose(); navigate(`/meetings/${meeting.id}`); }}
              className="flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
            >
              <ExternalLink size={14} />
              Xem chi tiết đầy đủ
            </button>
          </div>
        </div>
      )}

      {meeting && (
        <EditMeetingModal
          meeting={meeting}
          isOpen={isEditMeetingOpen}
          onClose={() => setIsEditMeetingOpen(false)}
          onUpdated={handleEditMeetingUpdated}
        />
      )}
    </Modal>
  );
};

export default MeetingDetailPopup;
