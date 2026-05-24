import React from 'react';
import FullCalendar from '@fullcalendar/react';
import type { EventClickArg, EventDropArg, EventInput } from '@fullcalendar/core';
import type { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import axios from 'axios';
import viLocale from '@fullcalendar/core/locales/vi';
import { Plus, Calendar as CalendarIcon, AlertCircle, Loader2 } from 'lucide-react';
import { Card, Button } from '../../components/ui';
import { useCalendarStore, useAppStore, useOrgStore } from '../../stores';
import ScheduleMeetingModal from '../../components/meeting/ScheduleMeetingModal';
import MeetingDetailPopup from '../../components/meeting/MeetingDetailPopup';
import api from '../../services/api';
import { toast } from '../../components/ui/Toast';
import type { Meeting } from '../../types';
import { getMeetingEnd, getMeetingStart, toMeetingApiDateTime } from '../../utils/meetingDateTime';
import { getMeetingStatusPresentation } from '../../utils/meetingFlow';

const isEditableMeeting = (meeting?: Meeting) =>
  Boolean(meeting && meeting.status === 'upcoming');

const toCalendarEvent = (meeting: Meeting) => {
  const startStr = getMeetingStart(meeting);
  const endStr = getMeetingEnd(meeting);

  if (!startStr) return null;

  const startDate = new Date(startStr);
  if (isNaN(startDate.getTime())) return null;

  const endDate = endStr && !isNaN(new Date(endStr).getTime())
    ? new Date(endStr)
    : new Date(startDate.getTime() + 3600000);
  const now = Date.now();
  const terminalStatus = ['completed', 'processing', 'queued', 'failed', 'canceled'].includes(meeting.status);
  const isPast = endDate.getTime() < now;
  const isLive = meeting.status === 'live' || (!terminalStatus && startDate.getTime() <= now && endDate.getTime() >= now);
  const bgColor = getMeetingStatusPresentation(meeting).calendarColor;

  return {
    id: meeting.id,
    title: meeting.title,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    editable: isEditableMeeting(meeting),
    className: meeting.status === 'completed' || isPast ? 'fc-event-past' : isLive ? 'fc-event-live' : 'fc-event-upcoming',
    backgroundColor: bgColor,
    borderColor: bgColor,
    extendedProps: {
      status: meeting.status,
      groupName: meeting.groupName,
      bgColor,
      isPast: meeting.status === 'completed' || isPast,
      isLive,
    },
  };
};

const CalendarView: React.FC = () => {
  const { viewType, setViewType, setSelectedDate, toggleScheduleModal } = useCalendarStore();
  const { meetings, loadMeetings } = useAppStore();
  const { currentOrgId } = useOrgStore();
  const calendarRef = React.useRef<FullCalendar>(null);
  const [selectedMeetingId, setSelectedMeetingId] = React.useState<string | null>(null);
  const [isPopupOpen, setIsPopupOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isUpdatingEvent, setIsUpdatingEvent] = React.useState(false);

  const refreshMeetings = React.useCallback(async () => {
    if (!currentOrgId) return;
    setIsLoading(true);
    setError(null);
    try {
      await loadMeetings(currentOrgId);
    } catch (err) {
      const detail = axios.isAxiosError<{ detail?: string }>(err) ? err.response?.data?.detail : undefined;
      const message = detail || 'Không thể tải lịch họp';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [currentOrgId, loadMeetings]);

  // Load meetings on mount and when org changes
  React.useEffect(() => {
    refreshMeetings();
  }, [refreshMeetings]);

  React.useEffect(() => {
    window.addEventListener('focus', refreshMeetings);
    return () => window.removeEventListener('focus', refreshMeetings);
  }, [refreshMeetings]);

  // Sync FullCalendar instance with viewType from store
  React.useEffect(() => {
    if (calendarRef.current) {
      const calendarApi = calendarRef.current.getApi();
      calendarApi.changeView(viewType);
    }
  }, [viewType]);

  const visibleMeetings = React.useMemo(
    () => currentOrgId
      ? meetings.filter((meeting) => meeting.orgId === currentOrgId || meeting.organization_id === currentOrgId)
      : [],
    [currentOrgId, meetings],
  );

  const events = React.useMemo(
    () => visibleMeetings.map(toCalendarEvent).filter(Boolean) as EventInput[],
    [visibleMeetings],
  );

  const handleDateClick = (arg: DateClickArg) => {
    setSelectedDate(arg.date);
    toggleScheduleModal(true);
  };

  const handleEventClick = (arg: EventClickArg) => {
    setSelectedMeetingId(arg.event.id);
    setIsPopupOpen(true);
  };

  const handleEventDrop = async (arg: EventDropArg) => {
    const { event } = arg;
    const meeting = visibleMeetings.find((item) => item.id === event.id);
    if (!isEditableMeeting(meeting)) {
      arg.revert();
      toast.error('Chỉ cuộc họp sắp tới mới được đổi lịch');
      return;
    }
    try {
      setIsUpdatingEvent(true);
      await api.put(`/api/meetings/${event.id}`, {
        scheduled_start: toMeetingApiDateTime(event.start),
        scheduled_end: toMeetingApiDateTime(event.end || new Date(event.start.getTime() + 3600000)),
      });
      toast.success('Đã cập nhật thời gian cuộc họp');
      await refreshMeetings();
    } catch (err) {
      const detail = axios.isAxiosError<{ detail?: string }>(err) ? err.response?.data?.detail : undefined;
      arg.revert();
      toast.error(detail || 'Lỗi khi cập nhật thời gian');
    } finally {
      setIsUpdatingEvent(false);
    }
  };

  const handleEventResize = async (arg: EventResizeDoneArg) => {
    const { event } = arg;
    const meeting = visibleMeetings.find((item) => item.id === event.id);
    if (!isEditableMeeting(meeting)) {
      arg.revert();
      toast.error('Chỉ cuộc họp sắp tới mới được đổi thời lượng');
      return;
    }
    if (!event.end || event.end <= event.start) {
      arg.revert();
      toast.error('Giờ kết thúc phải sau giờ bắt đầu');
      return;
    }
    try {
      setIsUpdatingEvent(true);
      await api.put(`/api/meetings/${event.id}`, {
        scheduled_start: toMeetingApiDateTime(event.start),
        scheduled_end: toMeetingApiDateTime(event.end),
      });
      toast.success('Đã cập nhật thời lượng cuộc họp');
      await refreshMeetings();
    } catch (err) {
      const detail = axios.isAxiosError<{ detail?: string }>(err) ? err.response?.data?.detail : undefined;
      arg.revert();
      toast.error(detail || 'Lỗi khi cập nhật thời lượng');
    } finally {
      setIsUpdatingEvent(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
            <CalendarIcon className="text-primary-600" />
            Lịch họp của tôi
          </h1>
          <p className="text-gray-500 dark:text-slate-400">
            Quản lý và theo dõi các cuộc họp sắp tới trong tổ chức.
          </p>
        </div>
        <Button 
          variant="primary" 
          className="flex items-center gap-2"
          onClick={() => toggleScheduleModal(true)}
          disabled={!currentOrgId}
        >
          <Plus size={18} />
          Lên lịch họp mới
        </Button>
      </div>

      {!currentOrgId && (
        <Card className="flex min-h-[320px] flex-col items-center justify-center border-dashed p-8 text-center">
          <CalendarIcon className="mb-4 h-12 w-12 text-gray-300" />
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Chưa chọn tổ chức</h2>
          <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-slate-400">
            Chọn hoặc thiết lập tổ chức trước khi xem và lên lịch cuộc họp.
          </p>
        </Card>
      )}

      {currentOrgId && (
      <Card className="border-none bg-white p-0 shadow-xl dark:bg-slate-900">
        <div className="flex flex-col gap-4 border-b border-gray-100 bg-gray-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/50 lg:flex-row lg:items-center lg:justify-between">
           <div className="flex bg-white dark:bg-slate-900 rounded-lg p-1 border border-gray-200 dark:border-slate-700 shadow-sm">
              <button 
                onClick={() => setViewType('dayGridMonth')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${viewType === 'dayGridMonth' ? 'bg-primary-600 text-white shadow-md' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'}`}
              >
                Tháng
              </button>
              <button 
                onClick={() => setViewType('timeGridWeek')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${viewType === 'timeGridWeek' ? 'bg-primary-600 text-white shadow-md' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'}`}
              >
                Tuần
              </button>
              <button 
                onClick={() => setViewType('timeGridDay')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${viewType === 'timeGridDay' ? 'bg-primary-600 text-white shadow-md' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'}`}
              >
                Ngày
              </button>
           </div>
           
           <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                <span className="text-gray-600 dark:text-slate-400">Đã xong</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                <span className="text-gray-600 dark:text-slate-400">Sắp tới</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="w-3 h-3 rounded-full bg-red-500"></span>
                <span className="text-gray-600 dark:text-slate-400">Đang diễn ra</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                <span className="text-gray-600 dark:text-slate-400">Đang xử lý</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="w-3 h-3 rounded-full bg-rose-500"></span>
                <span className="text-gray-600 dark:text-slate-400">Lỗi</span>
              </div>
           </div>
        </div>

        {error && (
          <div className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
            <button className="font-bold hover:underline" onClick={refreshMeetings}>
              Tải lại
            </button>
          </div>
        )}

        <div className="calendar-container relative min-h-[620px] overflow-x-auto p-4">
          {(isLoading || isUpdatingEvent) && (
            <div className="absolute inset-4 z-20 flex items-center justify-center rounded-xl bg-white/70 backdrop-blur-sm dark:bg-slate-900/70">
              <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
            </div>
          )}
          {!isLoading && events.length === 0 && (
            <div className="pointer-events-none absolute inset-x-4 top-24 z-10 flex justify-center">
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white/90 px-5 py-4 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/90">
                <p className="font-bold text-gray-800 dark:text-slate-100">Chưa có cuộc họp nào</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Bấm vào một ngày hoặc dùng nút lên lịch để tạo cuộc họp.</p>
              </div>
            </div>
          )}
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={viewType}
            locale={viLocale}
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: '',
            }}
            events={events}
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            editable={!isUpdatingEvent}
            eventDurationEditable={!isUpdatingEvent}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            snapDuration="00:15:00"
            height="auto"
            contentHeight="auto"
            stickyHeaderDates={true}
            eventTimeFormat={{
              hour: '2-digit',
              minute: '2-digit',
              meridiem: false,
              hour12: false
            }}
            slotMinTime="07:00:00"
            slotMaxTime="22:00:00"
            allDaySlot={false}
            nowIndicator={true}
            dayMaxEvents={true}
            eventDisplay="block"
            eventDidMount={(info) => {
              const bgColor = info.event.extendedProps?.bgColor || '#3b82f6';
              info.el.style.setProperty('background-color', bgColor, 'important');
              info.el.style.setProperty('border-color', bgColor, 'important');
              info.el.style.setProperty('color', '#ffffff', 'important');
            }}
          />
        </div>
      </Card>
      )}

      <ScheduleMeetingModal />

      <MeetingDetailPopup
        meetingId={selectedMeetingId}
        isOpen={isPopupOpen}
        onClose={() => { setIsPopupOpen(false); setSelectedMeetingId(null); }}
        onDeleted={refreshMeetings}
        onUpdated={refreshMeetings}
      />

      <style>{`
        .fc {
          --fc-border-color: #e2e8f0;
          --fc-button-bg-color: #ffffff;
          --fc-button-border-color: #e2e8f0;
          --fc-button-text-color: #475569;
          --fc-button-hover-bg-color: #f8fafc;
          --fc-button-hover-border-color: #cbd5e1;
          --fc-button-active-bg-color: #f1f5f9;
          --fc-today-bg-color: #f1f5f9;
        }
        .dark .fc {
          --fc-border-color: #1e293b;
          --fc-button-bg-color: #0f172a;
          --fc-button-text-color: #94a3b8;
          --fc-button-hover-bg-color: #1e293b;
          --fc-button-active-bg-color: #334155;
          --fc-today-bg-color: #1e293b;
        }
        .fc-toolbar-title {
          font-size: 1.125rem !important;
          font-weight: 700 !important;
          color: #1e293b;
        }
        .dark .fc-toolbar-title {
          color: #f1f5f9;
        }
        .fc-col-header-cell-cushion {
          font-size: 0.875rem !important;
          font-weight: 600 !important;
          padding: 10px 0 !important;
          color: #64748b;
        }
        .fc-event {
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 6px !important;
          font-size: 0.75rem !important;
          font-weight: 500 !important;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
          transition: all 0.2s ease;
        }
        .fc-event:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }
        /* Past event styling */
        .fc-event-past {
          opacity: 0.6 !important;
          filter: grayscale(0.5);
        }
        .fc-event-past .fc-event-title {
          text-decoration: line-through;
          text-decoration-thickness: 1px;
        }
        .fc-daygrid-event-dot {
          display: none;
        }
        .fc-v-event {
          border: none !important;
        }
        .fc-event-upcoming {
          background-color: #3b82f6 !important;
          border-color: #3b82f6 !important;
          color: #ffffff !important;
        }
      `}</style>
    </div>
  );
};

export default CalendarView;
