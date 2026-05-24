import React from 'react';
import axios from 'axios';
import { Calendar as CalendarIcon, Clock, Users } from 'lucide-react';
import { Modal, Button, Input, Badge } from '../ui';
import { useCalendarStore, useOrgStore, useAppStore } from '../../stores';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../ui/Toast';
import { toLocalDateStr, toMeetingApiDateTime } from '../../utils/meetingDateTime';
import { useGroupMembers } from '../../hooks/useGroupMembers';
import GroupSelector from './GroupSelector';
import ParticipantSelector from './ParticipantSelector';
import AIConfigSection from './AIConfigSection';
import { validateMeetingForm } from '../../utils/meetingFlow';

const ScheduleMeetingModal: React.FC = () => {
  const { isScheduleModalOpen, toggleScheduleModal, selectedDate } = useCalendarStore();
  const { currentOrgId, groups, loadGroups } = useOrgStore();
  const { user } = useAuth();
  const { loadMeetings } = useAppStore();

  const [title, setTitle] = React.useState('');
  const [selectedGroupId, setSelectedGroupId] = React.useState<string>('');
  const [date, setDate] = React.useState(toLocalDateStr(selectedDate));
  const [time, setTime] = React.useState('14:00');
  const [endTime, setEndTime] = React.useState('');
  const [language, setLanguage] = React.useState('vi');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const { members, loading: loadingMembers, selectedIds: selectedParticipants, setSelectedIds: setSelectedParticipants, toggleSelectAll, toggleMember } = useGroupMembers(selectedGroupId, user?.id);

  React.useEffect(() => {
    if (isScheduleModalOpen) {
      if (currentOrgId) loadGroups(currentOrgId);
      setDate(toLocalDateStr(selectedDate));
      setTime(selectedDate ? `${String(selectedDate.getHours()).padStart(2, '0')}:${String(selectedDate.getMinutes()).padStart(2, '0')}` : '14:00');
    }
  }, [isScheduleModalOpen, currentOrgId, loadGroups, selectedDate]);

  React.useEffect(() => {
    if (groups.length > 0 && !selectedGroupId) setSelectedGroupId(groups[0].id);
  }, [groups, selectedGroupId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrgId) { toast.error('Vui lòng chọn tổ chức'); return; }
    const validation = validateMeetingForm({ title, groupId: selectedGroupId, date, time, endTime });
    if (validation.ok === false) { toast.error(validation.message); return; }

    setIsSubmitting(true);
    try {
      await api.post('/api/meetings', {
        title: validation.title,
        organization_id: currentOrgId,
        group_id: selectedGroupId,
        scheduled_start: toMeetingApiDateTime(validation.start),
        scheduled_end: toMeetingApiDateTime(validation.end),
        status: 'upcoming',
        description: `Cuộc họp lên lịch trong nhóm ${groups.find(g => g.id === selectedGroupId)?.name || selectedGroupId}`,
        settings: { enableRecord: true, enableSummary: true, language },
        participant_ids: selectedParticipants,
      });

      toast.success('Đã lên lịch cuộc họp!');
      await loadMeetings(currentOrgId);
      toggleScheduleModal(false);
      resetForm();
    } catch (err) {
      const detail = axios.isAxiosError<{ detail?: string }>(err) ? err.response?.data?.detail : undefined;
      toast.error(detail || 'Lỗi khi lên lịch cuộc họp');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setTitle(''); setSelectedParticipants([]);
    setSelectedGroupId(''); setDate(toLocalDateStr(new Date()));
    setTime('14:00'); setEndTime(''); setLanguage('vi');
  };

  const preview = validateMeetingForm({
    title: title || 'Cuộc họp',
    groupId: selectedGroupId || 'preview',
    date,
    time,
    endTime,
    now: new Date(0),
  });
  const previewText = preview.ok
    ? `${preview.start.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })} - ${preview.end.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
    : 'Chọn ngày giờ hợp lệ';

  return (
    <Modal isOpen={isScheduleModalOpen} onClose={() => toggleScheduleModal(false)} title="Lên lịch cuộc họp" size="lg">
      <form onSubmit={handleSubmit} className="space-y-6 py-2">
        <div className="space-y-4">
          <Input label="Tiêu đề cuộc họp" placeholder="Sprint Review Q2, Planning Dự án MUTI..." value={title} onChange={(e) => setTitle(e.target.value)} required />
          <GroupSelector groups={groups} selectedId={selectedGroupId} onChange={(id) => { setSelectedGroupId(id); setSelectedParticipants([]); }} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input label="Ngày họp" type="date" value={date} onChange={(e) => setDate(e.target.value)} icon={<CalendarIcon size={16} />} />
          <Input label="Giờ bắt đầu" type="time" value={time} onChange={(e) => setTime(e.target.value)} icon={<Clock size={16} />} />
          <Input label="Giờ kết thúc" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} icon={<Clock size={16} />} placeholder="Mặc định: 1 giờ" />
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
          <div className="font-semibold text-gray-800 dark:text-slate-100">Preview lịch họp</div>
          <div className="mt-1">{previewText}</div>
          <div className="mt-1">{selectedParticipants.length + 1} người nhận lời mời · AI Notes và ghi âm luôn bật</div>
        </div>

        <div className="rounded-2xl border border-primary-100 bg-primary-50/30 p-5 dark:border-primary-900/30 dark:bg-primary-900/5">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-sm font-bold text-primary-800 dark:text-primary-300">Cấu hình AI</h4>
            <Badge variant="primary" className="text-[10px]">Premium</Badge>
          </div>
          <AIConfigSection language={language} onLanguageChange={setLanguage} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-slate-200">
              <Users size={16} className="text-primary-500" />
              Thành viên tham gia
              {selectedParticipants.length > 0 && (
                <span className="ml-1 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                  {selectedParticipants.length}
                </span>
              )}
            </h4>
          </div>
          <ParticipantSelector members={members} selectedIds={selectedParticipants} loading={loadingMembers} onToggleAll={toggleSelectAll} onToggleMember={toggleMember} />
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 pt-6 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Users size={14} />
            <span>{selectedParticipants.length + 1} người sẽ nhận thông báo</span>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => toggleScheduleModal(false)} type="button" className="px-6">Hủy bỏ</Button>
            <Button variant="primary" type="submit" isLoading={isSubmitting} className="px-8 shadow-lg shadow-primary-500/20">Xác nhận lên lịch</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default ScheduleMeetingModal;
