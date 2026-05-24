/**
 * Personal action items page.
 */
import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardList,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';

import { useAuth } from '../../../context/AuthContext';
import { useOrgStore } from '../../../stores';
import api from '../../../services/api';
import { actionItemService } from '../../../services/actionItemService';
import { normalizeMeeting } from '../../../services/mappers';
import type { ActionItem, ActionItemUpdate, Meeting } from '../../../types';

type StatusFilter = 'all' | ActionItem['status'];
type WorkSectionKey = 'today' | 'overdue' | 'week' | 'assigned' | 'unassigned';

type ActionEditDraft = {
  title: string;
  assignedEmails: string[];
  dueDate: string;
  status: ActionItem['status'];
  priority: ActionItem['priority'];
};

const statusLabels: Record<ActionItem['status'], string> = {
  PENDING: 'Đang chờ',
  IN_PROGRESS: 'Đang làm',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};

const priorityLabels: Record<ActionItem['priority'], string> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
  URGENT: 'Khẩn cấp',
};

const initialsFor = (label: string) =>
  label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

const inputClass =
  'h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-primary-900/30';

const isAssignedToCurrentUser = (item: ActionItem, userId?: string, email?: string) => {
  const normalizedEmail = email?.toLowerCase();
  return item.assignees.some(
    (assignee) =>
      (userId && assignee.user_id === userId) ||
      (normalizedEmail && assignee.email?.toLowerCase() === normalizedEmail),
  );
};

const isUnassigned = (item: ActionItem) => item.assignees.length === 0;

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const parseDueDate = (value?: string) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isDueToday = (item: ActionItem) => {
  const dueDate = parseDueDate(item.due_date);
  if (!dueDate) return false;
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return dueDate >= today && dueDate < tomorrow;
};

const isOverdueTask = (item: ActionItem) => {
  const dueDate = parseDueDate(item.due_date);
  if (!dueDate || item.status === 'COMPLETED' || item.status === 'CANCELLED') return false;
  return dueDate < startOfToday();
};

const isDueThisWeek = (item: ActionItem) => {
  const dueDate = parseDueDate(item.due_date);
  if (!dueDate) return false;
  const today = startOfToday();
  const weekLater = new Date(today);
  weekLater.setDate(today.getDate() + 7);
  return dueDate >= today && dueDate < weekLater;
};

const wasRecentlyAssigned = (item: ActionItem) => {
  const createdAt = item.created_at ? new Date(item.created_at) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
  const now = Date.now();
  return now - createdAt.getTime() <= 3 * 24 * 60 * 60 * 1000;
};

const formatDate = (value?: string) => {
  if (!value) return 'Chưa có hạn';
  try {
    return format(new Date(value), 'dd/MM/yyyy');
  } catch {
    return 'Ngày không hợp lệ';
  }
};

const statusClass = (status: ActionItem['status']) => {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/30 shadow-sm';
    case 'IN_PROGRESS':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-100 dark:border-blue-900/30 shadow-sm';
    case 'CANCELLED':
      return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-100 dark:border-rose-900/30 shadow-sm';
    default:
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-100 dark:border-amber-900/30 shadow-sm';
  }
};

const priorityClass = (priority: ActionItem['priority']) => {
  switch (priority) {
    case 'URGENT':
    case 'HIGH':
      return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-100 dark:border-red-900/30 shadow-sm';
    case 'MEDIUM':
      return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-100 dark:border-indigo-900/30 shadow-sm';
    default:
      return 'bg-gray-50 text-gray-700 dark:bg-slate-800/80 dark:text-slate-300 border-gray-150 dark:border-slate-700 shadow-sm';
  }
};

const isGeneratedMetaDescription = (item: ActionItem) =>
  Boolean(
    item.summary_id &&
      item.description &&
      /^(?:Phụ trách:.*|Chưa phân công)(?:\s*\|\s*(?:Hạn:.*|Chưa đặt hạn))?$/i.test(item.description.trim()),
  );

const toDraft = (item: ActionItem): ActionEditDraft => ({
  title: item.title,
  assignedEmails: item.assignees.map((assignee) => assignee.email).filter(Boolean),
  dueDate: item.due_date || '',
  status: item.status,
  priority: item.priority,
});

interface TaskCardProps {
  item: ActionItem;
  currentUserId?: string;
  currentUserEmail?: string;
  draft?: ActionEditDraft;
  isEditing: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  canManage: boolean;
  canUpdateStatusOnly: boolean;
  onStartEdit: (item: ActionItem) => void;
  onPatchDraft: (id: string, updates: Partial<ActionEditDraft>) => void;
  onCancelEdit: (id: string) => void;
  onConfirmEdit: (item: ActionItem) => void;
  onQuickToggleStatus: (item: ActionItem, nextStatus: ActionItem['status']) => void;
  onDelete: (id: string) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({
  item,
  currentUserId,
  currentUserEmail,
  draft,
  isEditing,
  isSaving,
  isDeleting,
  canManage,
  canUpdateStatusOnly,
  onStartEdit,
  onPatchDraft,
  onCancelEdit,
  onConfirmEdit,
  onQuickToggleStatus,
  onDelete,
}) => {
  const navigate = useNavigate();
  const completedAssigneeCount = item.assignees.filter((assignee) => assignee.status === 'COMPLETED').length;
  const assigneeLabels = item.assignees.map((assignee) => assignee.display_name || assignee.email || 'Người phụ trách');
  const displayedAssignee = item.assignees.length
    ? assigneeLabels.join(', ')
    : 'Chưa giao';
  const progressSummary = item.assignees.length
    ? `${completedAssigneeCount}/${item.assignees.length} hoàn thành`
    : 'Chưa giao';
  const isBusy = isSaving || isDeleting;
  const assigneeOptions = item.assignee_options || [];
  const usesMeetingAssigneeOptions = Boolean(item.meeting_id);
  const selfAssignee = item.assignees.find(
    (assignee) =>
      (currentUserId && assignee.user_id === currentUserId) ||
      (currentUserEmail && assignee.email?.toLowerCase() === currentUserEmail.toLowerCase()),
  );
  const selfStatus = selfAssignee?.status || 'PENDING';
  const canToggleSelfStatus = Boolean(selfAssignee);
  const selfStatusLabel = selfAssignee ? statusLabels[selfStatus] : 'Không được giao';
  const description = isGeneratedMetaDescription(item) ? '' : item.description?.trim() || '';

  const handleToggleStatus = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canToggleSelfStatus) return;
    const nextStatus = selfStatus === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
    onQuickToggleStatus(item, nextStatus);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="group border-b border-gray-100 last:border-b-0 dark:border-slate-800/80 bg-white dark:bg-slate-900 transition-colors"
    >
      {!isEditing ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-3.5 px-4 transition-colors hover:bg-gray-50/40 dark:hover:bg-slate-800/15">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            {/* Interactive Checkbox */}
            <button
              type="button"
              onClick={handleToggleStatus}
              disabled={isBusy || !canToggleSelfStatus}
              className="mt-0.5 shrink-0 text-gray-400 hover:text-emerald-500 transition-colors duration-150 disabled:opacity-50"
              title={canToggleSelfStatus ? (selfStatus === 'COMPLETED' ? 'Đánh dấu chưa hoàn thành phần việc của bạn' : 'Đánh dấu hoàn thành phần việc của bạn') : 'Chỉ người được giao mới cập nhật được tiến độ của mình'}
            >
              {selfStatus === 'COMPLETED' ? (
                <CheckCircle2 size={18} className="text-emerald-500 fill-emerald-50/30 dark:fill-emerald-950/20" />
              ) : (
                <Circle size={18} className="hover:scale-105 transition-transform" />
              )}
            </button>

            {/* Title & Description */}
            <div className="min-w-0 flex-1">
              <h4 className={`text-sm font-bold text-gray-900 dark:text-white ${item.status === 'COMPLETED' ? 'line-through text-gray-400 dark:text-slate-500 font-semibold' : ''}`}>
                {item.title}
              </h4>
              {description && (
                <p className="text-xs text-gray-500 dark:text-slate-400 truncate mt-0.5">{description}</p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                <span className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-300">
                  Phần tôi: {selfStatusLabel}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-gray-150 bg-gray-50/80 px-1.5 py-0.5 text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                  Tổng: {progressSummary}
                </span>
              </div>
            </div>
          </div>

          {/* Metadata Badges Grid / Row */}
          <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0 pl-7 sm:pl-0">
            {/* Priority Badge */}
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${priorityClass(item.priority)}`}>
              <span className={`h-1 w-1 rounded-full ${
                item.priority === 'URGENT' || item.priority === 'HIGH' ? 'bg-red-500 animate-pulse' :
                item.priority === 'MEDIUM' ? 'bg-indigo-500' : 'bg-gray-400'
              }`} />
              {priorityLabels[item.priority]}
            </span>

            {/* Meeting Name Tag */}
            {item.meeting_id ? (
              <button
                type="button"
                onClick={() => navigate(`/meetings/${item.meeting_id}`, { state: { initialTab: 'actions' } })}
                className="inline-flex items-center gap-1 rounded-md bg-gray-50/70 border border-gray-150 px-1.5 py-0.5 text-[9px] font-bold text-gray-500 transition hover:border-primary-200 hover:bg-primary-50/70 hover:text-primary-700 dark:bg-slate-800/40 dark:border-slate-800 dark:text-slate-400 dark:hover:border-primary-900/30 dark:hover:bg-primary-950/20 dark:hover:text-primary-300 truncate max-w-[110px]"
                title={item.meeting_title || 'Mở cuộc họp'}
              >
                <MessageSquare size={9} />
                {item.meeting_title || 'Cuộc họp'}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-50/70 border border-gray-150 px-1.5 py-0.5 text-[9px] font-bold text-gray-500 dark:bg-slate-800/40 dark:border-slate-800 dark:text-slate-400 truncate max-w-[110px]" title="Việc cá nhân">
                <MessageSquare size={9} />
                Cá nhân
              </span>
            )}

            {/* Assignee Badge */}
            {item.assignees.length > 0 ? (
              <div className="group/assignees relative flex items-center gap-1">
                <div className="flex -space-x-2">
                  {item.assignees.slice(0, 3).map((assignee, index) => {
                    const label = assignee.display_name || assignee.email || 'Người phụ trách';
                    return (
                      <div
                        key={assignee.id || `${assignee.email}-${index}`}
                        className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-primary-50 text-[9px] font-black text-primary-700 shadow-sm transition-transform duration-150 hover:z-10 hover:scale-125 dark:border-slate-900 dark:bg-primary-950/30 dark:text-primary-300"
                        title={label}
                      >
                        {initialsFor(label)}
                      </div>
                    );
                  })}
                  {item.assignees.length > 3 && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-100 text-[9px] font-black text-gray-500 shadow-sm dark:border-slate-900 dark:bg-slate-800 dark:text-slate-300">
                      +{item.assignees.length - 3}
                    </div>
                  )}
                </div>
                <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 min-w-[180px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-[10px] font-bold text-gray-600 opacity-0 shadow-xl transition-opacity duration-150 group-hover/assignees:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <div className="mb-1 flex items-center gap-1 text-[9px] uppercase tracking-wider text-gray-400 dark:text-slate-500">
                    <UserRound size={10} />
                    Người được giao
                  </div>
                  <div className="space-y-1">
                    {assigneeLabels.map((label, index) => (
                      <div key={`${label}-${index}`} className="truncate">
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-50/70 border border-gray-150 px-1.5 py-0.5 text-[9px] font-bold text-gray-500 dark:bg-slate-800/40 dark:border-slate-800 dark:text-slate-400 truncate max-w-[95px]" title={displayedAssignee}>
                <UserRound size={9} />
                {displayedAssignee}
              </span>
            )}
            {/* Due Date Badge */}
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold border ${
              item.due_date && new Date(item.due_date).getTime() < new Date().setHours(0,0,0,0) && item.status !== 'COMPLETED'
                ? 'bg-red-50 text-red-600 border-red-100 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30'
                : 'bg-gray-50/70 border-gray-150 text-gray-500 dark:bg-slate-800/40 dark:border-slate-800 dark:text-slate-400'
            }`}>
              <Calendar size={9} />
              {formatDate(item.due_date)}
            </span>

            {/* Assignee Claim Button (Nhận việc) */}
            {canManage && isUnassigned(item) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPatchDraft(item.id, { ...toDraft(item), assignedEmails: currentUserEmail ? [currentUserEmail] : [] });
                  onConfirmEdit(item);
                }}
                className="inline-flex items-center gap-0.5 rounded bg-gray-900 px-2 py-0.75 text-[9px] font-bold text-white transition hover:bg-gray-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white shadow-sm"
              >
                Nhận việc
              </button>
            )}

            {/* Action Tools */}
            <div className="flex items-center gap-0.5 md:opacity-0 group-hover:opacity-100 transition-opacity duration-200 pl-1">
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => onStartEdit(item)}
                    disabled={isBusy}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    title="Sửa"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    disabled={isBusy}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                    title="Xóa"
                  >
                    {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  </button>
                </>
              )}
              {!canManage && canUpdateStatusOnly && (
                <button
                  type="button"
                  onClick={() => onStartEdit(item)}
                  disabled={isBusy}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  title="Cập nhật trạng thái"
                >
                  <Pencil size={11} />
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-gray-50/30 dark:bg-slate-950/5 border-b border-gray-100 dark:border-slate-800/80">
          <div className="space-y-3">
            {canManage ? (
              <input
                value={draft?.title || ''}
                onChange={(event) => onPatchDraft(item.id, { title: event.target.value })}
                placeholder="Tiêu đề..."
                disabled={isSaving}
                className="w-full h-9 rounded-lg border border-gray-250 bg-white px-3 text-xs font-bold text-gray-900 outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                {item.title}
              </div>
            )}
            <div className={`grid gap-2 ${canManage ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1'}`}>
              {!canManage && (
                <select
                  value={draft?.status || selfStatus}
                  onChange={(event) => onPatchDraft(item.id, { status: event.target.value as ActionItem['status'] })}
                  disabled={isSaving}
                  className={`${inputClass} !h-8 !text-xs !bg-white`}
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              )}
              {canManage && (
                <>
                  <select
                    value={draft?.priority || item.priority}
                    onChange={(event) => onPatchDraft(item.id, { priority: event.target.value as ActionItem['priority'] })}
                    disabled={isSaving}
                    className={`${inputClass} !h-8 !text-xs !bg-white`}
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  {usesMeetingAssigneeOptions ? (
                    <select
                      value={draft?.assignedEmails || []}
                      onChange={(event) => onPatchDraft(item.id, { assignedEmails: Array.from(event.target.selectedOptions, (option) => option.value) })}
                      multiple
                      disabled={isSaving}
                      className={`${inputClass} !h-24 !text-xs !bg-white`}
                    >
                      {assigneeOptions.map((option) => (
                        <option key={option.email} value={option.email}>{option.label}</option>
                      ))}
                      {item.assignees.filter((assignee) => !assigneeOptions.some((option) => option.email === assignee.email)).map((assignee) => (
                        <option key={assignee.email} value={assignee.email}>{assignee.email}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="email"
                      value={draft?.assignedEmails?.[0] || ''}
                      onChange={(event) => onPatchDraft(item.id, { assignedEmails: event.target.value ? [event.target.value] : [] })}
                      placeholder="Email..."
                      disabled={isSaving}
                      className={`${inputClass} !h-8 !text-xs !bg-white`}
                    />
                  )}
                  <input
                    type="date"
                    value={draft?.dueDate || ''}
                    onChange={(event) => onPatchDraft(item.id, { dueDate: event.target.value })}
                    disabled={isSaving}
                    className={`${inputClass} !h-8 !text-xs !bg-white`}
                  />
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => onCancelEdit(item.id)}
                disabled={isSaving}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-250 px-3 text-xs font-bold text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-350 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => onConfirmEdit(item)}
                disabled={isSaving}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900 px-3 text-xs font-bold hover:bg-gray-800 dark:hover:bg-white"
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

const ActionItems: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<ActionItem['priority']>('MEDIUM');
  const [editingTaskIds, setEditingTaskIds] = useState<Set<string>>(() => new Set());
  const [editDrafts, setEditDrafts] = useState<Record<string, ActionEditDraft>>({});
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<'my' | 'unassigned'>('my');
  const [activeSection, setActiveSection] = useState<WorkSectionKey>('today');

  const { data: actionItems = [], isLoading } = useQuery({
    queryKey: ['actionItems'],
    queryFn: () => actionItemService.list(),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    staleTime: 10000,
  });
  const { data: meetings = [] } = useQuery({
    queryKey: ['meetings-for-action-items', currentOrgId],
    queryFn: async (): Promise<Meeting[]> => {
      const params = currentOrgId ? `?organization_id=${currentOrgId}` : '';
      const response = await api.get(`/api/meetings${params}`);
      return Array.isArray(response.data) ? response.data.map(normalizeMeeting) : [];
    },
    enabled: !!currentOrgId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: ActionItemUpdate }) =>
      actionItemService.update(id, updates),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      actionItemService.create({
        title: newTaskTitle.trim(),
        assignee_emails: user?.email ? [user.email] : [],
        due_date: newTaskDueDate || undefined,
        priority: newTaskPriority,
        status: 'PENDING',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actionItems'] });
      setNewTaskTitle('');
      setNewTaskDueDate('');
      setNewTaskPriority('MEDIUM');
      setIsCreating(false);
      toast.success('Đã thêm việc cần làm');
    },
    onError: () => toast.error('Không thể thêm việc cần làm'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => actionItemService.delete(id),
  });

  const filteredItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return actionItems.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.meeting_title?.toLowerCase().includes(normalizedSearch) ||
        item.assignees.some(
          (assignee) =>
            (assignee.email || '').toLowerCase().includes(normalizedSearch) ||
            (assignee.display_name || '').toLowerCase().includes(normalizedSearch),
        );
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [actionItems, searchTerm, statusFilter]);

  const myItems = useMemo(
    () => filteredItems.filter((item) => isAssignedToCurrentUser(item, user?.id, user?.email)),
    [filteredItems, user?.email, user?.id],
  );

  const unassignedItems = useMemo(
    () => filteredItems.filter((item) => isUnassigned(item)),
    [filteredItems],
  );

  const stats = useMemo(
    () => ({
      total: myItems.length,
      pending: myItems.filter((item) => item.status === 'PENDING').length,
      inProgress: myItems.filter((item) => item.status === 'IN_PROGRESS').length,
      completed: myItems.filter((item) => item.status === 'COMPLETED').length,
    }),
    [myItems],
  );
  const workSections = useMemo(
    () => ({
      today: myItems.filter(isDueToday),
      overdue: myItems.filter(isOverdueTask),
      week: myItems.filter(isDueThisWeek),
      assigned: myItems.filter(wasRecentlyAssigned),
      unassigned: unassignedItems,
    }),
    [myItems, unassignedItems],
  );
  const sectionMeta: Record<
    WorkSectionKey,
    { label: string; count: number; description: string }
  > = {
    today: {
      label: 'Hôm nay',
      count: workSections.today.length,
      description: 'Các việc chạm hạn trong hôm nay.',
    },
    overdue: {
      label: 'Quá hạn',
      count: workSections.overdue.length,
      description: 'Những việc đã quá hạn nhưng chưa hoàn thành.',
    },
    week: {
      label: 'Tuần này',
      count: workSections.week.length,
      description: 'Việc cần xử lý trong 7 ngày tới.',
    },
    assigned: {
      label: 'Vừa được giao',
      count: workSections.assigned.length,
      description: 'Những việc mới giao gần đây để bạn bắt đầu nhanh.',
    },
    unassigned: {
      label: 'Chưa giao',
      count: workSections.unassigned.length,
      description: 'Backlog chưa giao trong các cuộc họp bạn tham gia.',
    },
  };
  const meetingsById = useMemo(
    () => new Map(meetings.map((meeting) => [meeting.id, meeting])),
    [meetings],
  );

  const canManageItem = (item: ActionItem) => {
    if (user?.systemRole === 'system-admin') return true;
    if (!item.meeting_id) return item.created_by === user?.id;
    const meeting = meetingsById.get(item.meeting_id);
    if (!meeting || !user) return false;
    if (meeting.group_id) {
      return user.groupMemberships?.some(
        (membership) => membership.groupId === meeting.group_id && membership.role === 'group-admin',
      );
    }
    return user.orgMemberships?.some(
      (membership) => membership.orgId === meeting.organization_id && membership.role === 'org-admin',
    );
  };

  const canUpdateStatusOnly = (item: ActionItem) =>
    !canManageItem(item) && isAssignedToCurrentUser(item, user?.id, user?.email);

  const startEdit = (item: ActionItem) => {
    setEditingTaskIds((current) => new Set(current).add(item.id));
    setEditDrafts((current) => ({
      ...current,
      [item.id]: current[item.id] || toDraft(item),
    }));
  };

  const patchDraft = (id: string, updates: Partial<ActionEditDraft>) => {
    setEditDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] || {
          title: '',
          assignedEmails: [],
          dueDate: '',
          status: 'PENDING',
          priority: 'MEDIUM',
        }),
        ...updates,
      },
    }));
  };

  const cancelEdit = (id: string) => {
    setEditingTaskIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setEditDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const confirmEdit = async (item: ActionItem) => {
    const draft = editDrafts[item.id];
    if (!draft) return;
    const manager = canManageItem(item);
    const title = draft.title.trim();
    if (manager && !title) {
      toast.error('Vui lòng nhập tiêu đề việc cần làm');
      return;
    }

    setSavingTaskId(item.id);
    try {
      if (manager) {
        const updates: ActionItemUpdate = {
          title,
          priority: draft.priority,
          assignee_emails: draft.assignedEmails,
          due_date: draft.dueDate || null,
        };
        await updateMutation.mutateAsync({
          id: item.id,
          updates,
        });
      } else {
        await api.patch(`/api/action-items/${item.id}/assignees/me`, { status: draft.status });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['actionItems'] }),
        queryClient.invalidateQueries({ queryKey: ['meeting-detail'] }),
      ]);
      cancelEdit(item.id);
      toast.success('Đã cập nhật việc cần làm');
    } catch {
      toast.error('Không thể cập nhật việc cần làm');
    } finally {
      setSavingTaskId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Xóa việc cần làm này?')) return;
    setDeletingTaskId(id);
    try {
      await deleteMutation.mutateAsync(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['actionItems'] }),
        queryClient.invalidateQueries({ queryKey: ['meeting-detail'] }),
      ]);
      cancelEdit(id);
      toast.success('Đã xóa việc cần làm');
    } catch {
      toast.error('Không thể xóa việc cần làm');
    } finally {
      setDeletingTaskId(null);
    }
  };

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newTaskTitle.trim()) return;
    createMutation.mutate();
  };

  const handleQuickToggleStatus = async (item: ActionItem, nextStatus: ActionItem['status']) => {
    setSavingTaskId(item.id);
    try {
      await api.patch(`/api/action-items/${item.id}/assignees/me`, { status: nextStatus });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['actionItems'] }),
        queryClient.invalidateQueries({ queryKey: ['meeting-detail'] }),
      ]);
      toast.success('Đã cập nhật tiến độ của bạn');
    } catch {
      toast.error('Không thể cập nhật tiến độ của bạn');
    } finally {
      setSavingTaskId(null);
    }
  };

  const currentList = activeTab === 'my' ? workSections[activeSection] : workSections.unassigned;
  const currentEmptyText =
    activeTab === 'my'
      ? sectionMeta[activeSection].description
      : 'Không có việc chưa giao phù hợp trong các cuộc họp bạn đang theo dõi.';

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Việc cần làm</h1>
          <p className="text-gray-600 dark:text-slate-400">
            Trung tâm làm việc hằng ngày của bạn: ưu tiên việc đến hạn, backlog chưa giao và lối tắt về đúng cuộc họp nguồn.
          </p>
        </div>
      </motion.div>

      {/* Refined Executive Split-Pane Analytics Dashboard */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-gray-100 dark:divide-slate-800">
          
          {/* Left Pane: Interactive Large Circular Chart & Summary */}
          <div className="w-full md:w-[35%] p-6 flex flex-col justify-between bg-gray-50/30 dark:bg-slate-900/40 relative overflow-hidden">
            {/* Technical grid backdrop */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.02] dark:opacity-[0.04] text-gray-900 dark:text-white">
              <svg width="100%" height="100%">
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="1"/>
                </pattern>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
            </div>

            <div className="relative z-10">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                <ClipboardList size={11} />
                Tổng quan danh sách hiện tại
              </span>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 font-semibold mt-2.5 uppercase tracking-wider">Nhịp công việc của tôi</p>
              <h2 className="text-3xl font-black text-gray-900 dark:text-white mt-1 tracking-tight">
                {stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%
              </h2>
              <p className="text-xs text-gray-500 dark:text-slate-450 mt-1 font-medium">
                Đã giải quyết <strong className="text-gray-800 dark:text-slate-200">{stats.completed}</strong> trên tổng số <strong className="text-gray-800 dark:text-slate-200">{stats.total}</strong> việc được giao cho bạn.
              </p>
            </div>

            {/* Micro-Progress Bar ribbon */}
            <div className="mt-8 relative z-10">
              <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 dark:text-slate-500 mb-2">
                <span>Tỷ lệ hoàn thành</span>
                <span className="text-gray-700 dark:text-slate-355">{stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800 flex border border-gray-150/20 dark:border-slate-800/40">
                {stats.total > 0 ? (
                  <>
                    <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(stats.completed / stats.total) * 100}%` }} />
                    <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${(stats.inProgress / stats.total) * 100}%` }} />
                    <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${(stats.pending / stats.total) * 100}%` }} />
                  </>
                ) : (
                  <div className="h-full w-full bg-gray-200 dark:bg-slate-800" />
                )}
              </div>
            </div>
          </div>

          {/* Right Pane: Split Executive Metrics Grid */}
          <div className="w-full md:w-[65%] grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 dark:divide-slate-800">
            {[
              { 
                label: 'Đang chờ', 
                value: stats.pending, 
                accentBg: 'border-amber-500 dark:border-amber-500',
                textColor: 'text-amber-600 dark:text-amber-400',
                sub: 'Chưa bắt đầu',
                ratio: stats.total > 0 ? Math.round((stats.pending / stats.total) * 100) : 0,
                trend: 'Đang đợi gán hoặc gác lại',
                sparkline: "M 0,15 Q 10,5 20,18 T 40,8 T 60,15"
              },
              { 
                label: 'Đang làm', 
                value: stats.inProgress, 
                accentBg: 'border-blue-500 dark:border-blue-500',
                textColor: 'text-blue-600 dark:text-blue-400',
                sub: 'Đang xử lý',
                ratio: stats.total > 0 ? Math.round((stats.inProgress / stats.total) * 100) : 0,
                trend: 'Đang thực thi chủ động',
                sparkline: "M 0,18 Q 10,8 20,5 T 40,12 T 60,3"
              },
              { 
                label: 'Hoàn thành', 
                value: stats.completed, 
                accentBg: 'border-emerald-500 dark:border-emerald-500',
                textColor: 'text-emerald-600 dark:text-emerald-400',
                sub: 'Đã hoàn tất',
                ratio: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
                trend: 'Hiệu suất đã ghi nhận',
                sparkline: "M 0,18 Q 10,18 20,10 T 40,5 T 60,2"
              },
            ].map((stat, idx) => (
              <div key={stat.label} className="p-6 flex flex-col justify-between group hover:bg-gray-50/50 dark:hover:bg-slate-850/10 transition-colors duration-200">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-slate-500">{stat.label}</span>
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-black border ${stat.accentBg} ${stat.textColor} bg-transparent`}>
                      {stat.ratio}%
                    </span>
                  </div>
                  
                  <div className="mt-4 flex items-baseline gap-2">
                    <p className="text-4xl font-black text-gray-900 dark:text-white leading-none tracking-tight">
                      {stat.value}
                    </p>
                    <span className="text-[10px] text-gray-400 dark:text-slate-500 font-bold">{stat.sub}</span>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-gray-100 dark:border-slate-800/80 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-[9.5px] text-gray-400 dark:text-slate-500 font-bold truncate">{stat.trend}</p>
                  </div>
                  {/* Premium Sparkline Mini-Chart */}
                  <svg className="w-12 h-6 text-gray-300 dark:text-slate-700 shrink-0 ml-2" viewBox="0 0 60 20" fill="none">
                    <path
                      d={stat.sparkline}
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            ))}
          </div>

        </div>
      </motion.div>

      {/* Unified Toolbar Command Center */}
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Tìm theo tiêu đề, cuộc họp, email..."
              className="h-10 w-full rounded-xl border border-gray-150 bg-gray-50 pl-10 pr-4 text-sm outline-none transition focus:border-primary-400 dark:border-slate-700 dark:bg-slate-850 dark:focus:border-slate-650"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status select filter */}
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="h-10 rounded-xl border border-gray-150 bg-white px-3 text-xs font-bold text-gray-600 outline-none transition hover:bg-gray-50 dark:border-slate-750 dark:bg-slate-900 dark:text-slate-350"
            >
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>

            {/* Quick Task Creation Trigger button */}
            <button
              onClick={() => setIsCreating(!isCreating)}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-gray-900 px-4 text-xs font-bold text-white shadow transition hover:bg-gray-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              <Plus size={14} />
              Tạo việc cá nhân
            </button>
          </div>
        </div>

        {/* Collapsible Inline Creation Form */}
        <AnimatePresence>
          {isCreating && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={handleCreate}
              className="overflow-hidden border-t border-gray-100 pt-3 mt-1 dark:border-slate-800"
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px_130px_auto]">
                <input
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  placeholder="Tôi muốn làm..."
                  className="h-9 rounded-lg border border-gray-150 bg-gray-50 px-3 text-xs font-semibold text-gray-805 outline-none transition focus:border-gray-250 dark:border-slate-750 dark:bg-slate-850 dark:text-slate-205"
                />
                <select
                  value={newTaskPriority}
                  onChange={(event) => setNewTaskPriority(event.target.value as ActionItem['priority'])}
                  className="h-9 rounded-lg border border-gray-150 bg-gray-50 px-3 text-xs font-bold text-gray-600 outline-none transition focus:border-gray-250 dark:border-slate-750 dark:bg-slate-850 dark:text-slate-350"
                >
                  {Object.entries(priorityLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={newTaskDueDate}
                  onChange={(event) => setNewTaskDueDate(event.target.value)}
                  className="h-9 rounded-lg border border-gray-150 bg-gray-50 px-3 text-xs font-semibold text-gray-605 outline-none transition focus:border-gray-250 dark:border-slate-750 dark:bg-slate-850 dark:text-slate-355"
                />
                <button
                  type="submit"
                  disabled={!newTaskTitle.trim() || createMutation.isPending}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-4 text-xs font-bold text-white transition hover:bg-gray-850 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Thêm
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      {/* Unified Table Container Card with Tabbed Headers */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900 shadow-sm">
        {/* Tab Headers */}
        <div className="flex border-b border-gray-100 dark:border-slate-800/80 bg-gray-50/50 dark:bg-slate-950/20 px-4">
          <button
            onClick={() => {
              setActiveTab('my');
              setActiveSection((current) => (current === 'unassigned' ? 'today' : current));
            }}
            className={`flex items-center gap-2 py-3.5 text-xs font-black transition relative ${
              activeTab === 'my' ? 'text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-slate-300'
            }`}
          >
            Việc của tôi
            <span className={`inline-flex items-center justify-center h-4.5 min-w-[18px] px-1 rounded-full text-[9px] font-bold ${
              activeTab === 'my' ? 'bg-primary-100 text-primary-700 dark:bg-primary-950/50 dark:text-primary-350' : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'
            }`}>
              {myItems.length}
            </span>
            {activeTab === 'my' && (
              <motion.div layoutId="activeTabIndicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 dark:bg-slate-100" />
            )}
          </button>
          
          <button
            onClick={() => {
              setActiveTab('unassigned');
              setActiveSection('unassigned');
            }}
            className={`flex items-center gap-2 py-3.5 text-xs font-black transition relative ml-6 ${
              activeTab === 'unassigned' ? 'text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-slate-300'
            }`}
          >
            Chưa giao trong cuộc họp mời
            <span className={`inline-flex items-center justify-center h-4.5 min-w-[18px] px-1 rounded-full text-[9px] font-bold ${
              activeTab === 'unassigned' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-350' : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'
            }`}>
              {unassignedItems.length}
            </span>
            {activeTab === 'unassigned' && (
              <motion.div layoutId="activeTabIndicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 dark:bg-slate-100" />
            )}
          </button>
        </div>

        {activeTab === 'my' && (
          <div className="border-b border-gray-100 bg-white px-4 py-3 dark:border-slate-800/80 dark:bg-slate-900">
            <div className="flex flex-wrap gap-2">
              {(['today', 'overdue', 'week', 'assigned'] as WorkSectionKey[]).map((section) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => setActiveSection(section)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
                    activeSection === section
                      ? 'border-gray-900 bg-gray-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-white dark:border-slate-700 dark:bg-slate-850 dark:text-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  {sectionMeta[section].label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      activeSection === section
                        ? 'bg-white/20 text-white dark:bg-slate-900/20 dark:text-slate-900'
                        : 'bg-white text-gray-500 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {sectionMeta[section].count}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
              {sectionMeta[activeSection].description}
            </p>
          </div>
        )}

        {/* Unified Rows List */}
        <div className="divide-y divide-gray-100 dark:divide-slate-800/80">
          <AnimatePresence mode="popLayout">
            {currentList.map((item) => (
              <TaskCard
                key={item.id}
                item={item}
                currentUserId={user?.id}
                currentUserEmail={user?.email}
                draft={editDrafts[item.id]}
                isEditing={editingTaskIds.has(item.id)}
                isSaving={savingTaskId === item.id}
                isDeleting={deletingTaskId === item.id}
                canManage={canManageItem(item)}
                canUpdateStatusOnly={canUpdateStatusOnly(item)}
                onStartEdit={startEdit}
                onPatchDraft={patchDraft}
                onCancelEdit={cancelEdit}
                onConfirmEdit={confirmEdit}
                onQuickToggleStatus={handleQuickToggleStatus}
                onDelete={handleDelete}
              />
            ))}
          </AnimatePresence>

          {currentList.length === 0 && (
            <div className="py-14 text-center">
              <ClipboardList size={38} className="mx-auto mb-3 text-gray-300 dark:text-slate-700" />
              <p className="text-sm font-extrabold text-gray-500 dark:text-slate-400">{currentEmptyText}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ActionItems;
