/**
 * GroupMeetingsTab Component
 * Hiển thị danh sách meetings trong group với filters
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Clock,
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  Star,
  FileText,
  CheckCircle2,
  AlertCircle,
  Key,
  Bot,
} from 'lucide-react';
import type { Meeting } from '../../../types';
import { format, isValid } from 'date-fns';

interface GroupMeetingsTabProps {
  meetings: Meeting[];
}

type StatusFilter = 'all' | 'completed' | 'processing' | 'queued' | 'failed';
type SortOption = 'newest' | 'oldest' | 'longest';

const getMeetingDate = (meeting: Meeting) => {
  const rawDate = meeting.scheduled_start || meeting.startTime;
  if (!rawDate) return null;
  const parsedDate = new Date(rawDate);
  return isValid(parsedDate) ? parsedDate : null;
};

const GroupMeetingsTab: React.FC<GroupMeetingsTabProps> = ({ meetings }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Filter and sort meetings
  const filteredMeetings = React.useMemo(() => {
    let result = [...meetings];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (m) =>
          m.title.toLowerCase().includes(term) ||
          m.description?.toLowerCase().includes(term)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((m) => m.status === statusFilter);
    }

    // Sort
    switch (sortBy) {
      case 'newest':
        result.sort((a, b) => (getMeetingDate(b)?.getTime() || 0) - (getMeetingDate(a)?.getTime() || 0));
        break;
      case 'oldest':
        result.sort((a, b) => (getMeetingDate(a)?.getTime() || 0) - (getMeetingDate(b)?.getTime() || 0));
        break;
      case 'longest':
        result.sort((a, b) => (b.duration || 0) - (a.duration || 0));
        break;
    }

    return result;
  }, [meetings, searchTerm, statusFilter, sortBy]);

  // Pagination
  const totalPages = Math.ceil(filteredMeetings.length / pageSize);
  const paginatedMeetings = filteredMeetings.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const statusBadge = (status: string) => {
    const config: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
      completed: {
        icon: <CheckCircle2 size={12} />,
        color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
        label: 'Complete',
      },
      processing: {
        icon: <AlertCircle size={12} />,
        color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
        label: 'Processing',
      },
      failed: {
        icon: <AlertCircle size={12} />,
        color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        label: 'Failed',
      },
    };

    const { icon, color, label } = config[status] || config.completed;

    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${color}`}>
        {icon}
        {label}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-blue-50 p-4 dark:bg-blue-900/20">
          <p className="text-xs text-blue-600 dark:text-blue-400">Tổng cuộc họp</p>
          <p className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-200">
            {meetings.length}
          </p>
        </div>
        <div className="rounded-xl bg-green-50 p-4 dark:bg-green-900/20">
          <p className="text-xs text-green-600 dark:text-green-400">Tổng thời lượng</p>
          <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-200">
            {(meetings.reduce((sum, m) => sum + m.duration, 0) / 60).toFixed(1)}h
          </p>
        </div>
        <div className="rounded-xl bg-purple-50 p-4 dark:bg-purple-900/20">
          <p className="text-xs text-purple-600 dark:text-purple-400">Thời lượng trung bình</p>
          <p className="mt-1 text-2xl font-bold text-purple-700 dark:text-purple-200">
            {(meetings.reduce((sum, m) => sum + m.duration, 0) / meetings.length || 0).toFixed(0)}m
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Tìm theo tiêu đề hoặc mô tả..."
            className="w-full rounded-lg border border-gray-200 bg-white pl-10 pr-4 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-primary-900/30"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as StatusFilter);
            setCurrentPage(1);
          }}
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm outline-none transition focus:border-primary-400 dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="completed">Hoàn tất</option>
          <option value="processing">Đang xử lý</option>
          <option value="failed">Lỗi</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value as SortOption);
            setCurrentPage(1);
          }}
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm outline-none transition focus:border-primary-400 dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="newest">Mới nhất</option>
          <option value="oldest">Cũ nhất</option>
          <option value="longest">Thời lượng dài nhất</option>

        </select>
      </div>

      {/* Meetings List */}
      <div className="space-y-3">
        {paginatedMeetings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-slate-700">
            <FileText size={32} className="mx-auto mb-3 text-gray-400" />
            <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">
              {meetings.length === 0 ? 'Nhóm này chưa có cuộc họp nào' : 'Không có cuộc họp phù hợp bộ lọc'}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              {meetings.length === 0
                ? 'Hãy tạo cuộc họp đầu tiên của nhóm hoặc tải một bản ghi âm để bắt đầu timeline, AI Notes và việc cần làm.'
                : 'Hãy đổi bộ lọc hoặc từ khóa để xem thêm kết quả.'}
            </p>
          </div>
        ) : (
          paginatedMeetings.map((meeting) => {
            const meetingDate = getMeetingDate(meeting);

            return (
              <Link
                key={meeting.id}
                to={`/meetings/${meeting.id}`}
                className="block rounded-xl border border-gray-200 bg-white p-5 transition hover:border-primary-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-primary-700"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <h4 className="text-base font-bold text-gray-900 dark:text-slate-100">
                        {meeting.title}
                      </h4>
                      {meeting.isPinned && (
                        <Star size={14} className="text-amber-500" fill="currentColor" />
                      )}
                    </div>

                    {meeting.description && (
                      <p className="mb-3 text-sm text-gray-600 dark:text-slate-300">
                        {meeting.description}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-slate-400">
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        {meetingDate ? format(meetingDate, 'dd/MM/yyyy HH:mm') : 'Chưa có lịch'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {meeting.duration || 0} min
                      </span>
                      <span className="flex items-center gap-1">
                        <Users size={12} />
                        {Array.isArray(meeting.attendees) ? meeting.attendees.length : 0} attendees
                      </span>
                    </div>

                    {meeting.keyPoints && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                          <Key size={10} /> {meeting.keyPoints.length} Key Points
                        </span>
                        {meeting.decisions && meeting.decisions.length > 0 && (
                          <span className="flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/20 dark:text-green-300">
                            <CheckCircle2 size={10} /> {meeting.decisions.length} Decisions
                          </span>
                        )}
                        <span className="flex items-center gap-1 rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 dark:bg-purple-900/20 dark:text-purple-300">
                          <Bot size={10} /> AI Summary
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {statusBadge(meeting.status || 'completed')}
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600 dark:text-slate-300">
            Showing {(currentPage - 1) * pageSize + 1}-
            {Math.min(currentPage * pageSize, filteredMeetings.length)} of{' '}
            {filteredMeetings.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-lg border border-gray-200 p-2 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  currentPage === page
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {page}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded-lg border border-gray-200 p-2 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupMeetingsTab;
