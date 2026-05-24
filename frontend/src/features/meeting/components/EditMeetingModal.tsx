import React from 'react';
import { Calendar as CalendarIcon, Clock, Users, Check, User, ChevronDown } from 'lucide-react';
import { Modal, Button, Input } from '../../../components/ui';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { toast } from '../../../components/ui/Toast';
import type { Meeting } from '../../../types';
import { buildLocalDateTime, toLocalDateStr, toLocalTimeStr, toMeetingApiDateTime } from '../../../utils/meetingDateTime';

interface GroupMember {
  id: string;
  user_id: string;
  name: string;
  email?: string;
  avatar_url?: string;
  role: string;
}

interface EditMeetingModalProps {
  meeting: Meeting | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

const EditMeetingModal: React.FC<EditMeetingModalProps> = ({ meeting, isOpen, onClose, onUpdated }) => {
  const { user } = useAuth();

  const [title, setTitle] = React.useState('');
  const [date, setDate] = React.useState('');
  const [startTime, setStartTime] = React.useState('');
  const [endTime, setEndTime] = React.useState('');
  const [selectedParticipants, setSelectedParticipants] = React.useState<string[]>([]);
  const [groupMembers, setGroupMembers] = React.useState<GroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Pre-fill form when meeting changes
  React.useEffect(() => {
    if (meeting && isOpen) {
      setTitle(meeting.title);
      const start = meeting.scheduled_start || meeting.startTime;
      const end = meeting.scheduled_end || meeting.endTime;
      if (start) {
        const d = new Date(start);
        setDate(toLocalDateStr(d));
        setStartTime(toLocalTimeStr(d));
      }
      if (end) {
        const d = new Date(end);
        const startD = new Date(start);
        if (d.getTime() - startD.getTime() !== 3600000) {
          setEndTime(toLocalTimeStr(d));
        } else {
          setEndTime('');
        }
      }
      // Load participants from attendees
      const participantIds = (meeting.attendees || [])
        .filter(a => a.id !== user?.id)
        .map(a => a.id);
      setSelectedParticipants(participantIds);
    }
  }, [meeting, isOpen, user?.id]);

  // Load group members
  React.useEffect(() => {
    if (!meeting?.groupId || !isOpen) {
      setGroupMembers([]);
      return;
    }
    setLoadingMembers(true);
    api.get(`/api/groups/${meeting.groupId}/members`)
      .then(res => {
        const members = (res.data || [])
          .map((m: any) => ({
            id: m.id || m.user_id || m.userId,
            user_id: m.id || m.user_id || m.userId,
            name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.username || m.email,
            email: m.email,
            avatar_url: m.avatar_url,
            role: m.role,
          }))
          .filter((m: GroupMember) => m.user_id !== user?.id);
        setGroupMembers(members);
      })
      .catch(() => setGroupMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [meeting?.groupId, isOpen, user?.id]);

  const allSelected = groupMembers.length > 0 && selectedParticipants.length === groupMembers.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedParticipants([]);
    } else {
      setSelectedParticipants(groupMembers.map(m => m.user_id));
    }
  };

  const toggleParticipant = (userId: string) => {
    if (selectedParticipants.includes(userId)) {
      setSelectedParticipants(selectedParticipants.filter(id => id !== userId));
    } else {
      setSelectedParticipants([...selectedParticipants, userId]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meeting || !title) {
      toast.error('Vui lòng nhập tiêu đề cuộc họp');
      return;
    }

    if (!date || !startTime) {
      toast.error('Vui lòng chọn ngày và giờ bắt đầu');
      return;
    }

    const start = buildLocalDateTime(date, startTime);
    const end = endTime
      ? buildLocalDateTime(date, endTime)
      : new Date(start.getTime() + 3600000);

    if (end <= start) {
      toast.error('Giờ kết thúc phải sau giờ bắt đầu');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.put(`/api/meetings/${meeting.id}`, {
        title,
        scheduled_start: toMeetingApiDateTime(start),
        scheduled_end: toMeetingApiDateTime(end),
        participant_ids: selectedParticipants,
      });
      toast.success('Đã cập nhật cuộc họp');
      onUpdated();
      onClose();
    } catch (err: any) {
      console.error('Failed to update meeting:', err);
      toast.error(err.response?.data?.detail || 'Lỗi khi cập nhật cuộc họp');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Chỉnh sửa cuộc họp" size="lg">
      <form onSubmit={handleSubmit} className="space-y-6 py-2">
        <Input
          label="Tiêu đề cuộc họp"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input
            label="Ngày họp"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            icon={<CalendarIcon size={16} />}
          />
          <Input
            label="Giờ bắt đầu"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            icon={<Clock size={16} />}
          />
          <Input
            label="Giờ kết thúc (tùy chọn)"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            icon={<Clock size={16} />}
            placeholder="Mặc định: 1 giờ"
          />
        </div>

        {/* Participants */}
        <div className="space-y-3">
          <h4 className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-slate-200">
            <Users size={16} className="text-primary-500" />
            Thành viên tham gia
            {selectedParticipants.length > 0 && (
              <span className="ml-1 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                {selectedParticipants.length}
              </span>
            )}
          </h4>

          {loadingMembers ? (
            <div className="flex items-center justify-center py-6 text-sm text-gray-400">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent mr-2" />
              Đang tải thành viên...
            </div>
          ) : groupMembers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-sm text-gray-400 dark:border-slate-700">
              Nhóm chưa có thành viên nào
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <div
                onClick={toggleSelectAll}
                className="flex cursor-pointer items-center gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 transition hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:bg-slate-800"
              >
                <div className={`flex h-5 w-5 items-center justify-center rounded border-2 transition ${allSelected ? 'border-primary-500 bg-primary-500' : 'border-gray-300 dark:border-slate-600'}`}>
                  {allSelected && <Check size={12} className="text-white" />}
                </div>
                <span className="text-sm font-bold text-gray-800 dark:text-slate-200">Chọn tất cả</span>
                <span className="ml-auto text-xs text-gray-400">{groupMembers.length} thành viên</span>
              </div>

              <div className="max-h-48 overflow-y-auto divide-y divide-gray-50 dark:divide-slate-800">
                {groupMembers.map(member => {
                  const isSelected = selectedParticipants.includes(member.user_id);
                  return (
                    <div
                      key={member.user_id}
                      onClick={() => toggleParticipant(member.user_id)}
                      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-gray-50 dark:hover:bg-slate-800/50"
                    >
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${isSelected ? 'border-primary-500 bg-primary-500' : 'border-gray-300 dark:border-slate-600'}`}>
                        {isSelected && <Check size={12} className="text-white" />}
                      </div>
                      {member.avatar_url ? (
                        <img src={member.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                          <User size={14} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-800 dark:text-slate-200">{member.name}</p>
                        {member.email && (
                          <p className="truncate text-xs text-gray-400">{member.email}</p>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-slate-700 dark:text-slate-400">
                        {member.role === 'group-admin' ? 'Admin' : 'Member'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 pt-6 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Users size={14} />
            <span>{selectedParticipants.length + 1} người sẽ tham gia</span>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose} type="button" className="px-6">
              Hủy bỏ
            </Button>
            <Button variant="primary" type="submit" isLoading={isSubmitting} className="px-8 shadow-lg shadow-primary-500/20">
              Lưu thay đổi
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default EditMeetingModal;
