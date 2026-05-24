import React from 'react';
import { Calendar, Check, CheckCircle2, Circle, Pencil, Trash2, UserRound } from 'lucide-react';
import { motion } from 'framer-motion';

import type { ActionItem, ActionItemAssigneeOption, User } from '../../../types';

type ActionEditDraft = {
  title: string;
  assignedEmails: string[];
  dueDate: string;
  status: string;
  priority: string;
};

type MeetingActionItemCardProps = {
  item: ActionItem;
  currentUser?: User | null;
  assigneeOptions: ActionItemAssigneeOption[];
  canManage: boolean;
  isCurrentUserAssignee: boolean;
  isEditing: boolean;
  isSaving: boolean;
  draft: ActionEditDraft | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onPatchDraft: (updates: Partial<ActionEditDraft>) => void;
  onConfirmEdit: () => void;
  onDelete: () => void;
  onUpdateSelfStatus: (status: ActionItem['status']) => void;
  onJumpToContext?: () => void;
};

const statusLabels: Record<ActionItem['status'], string> = {
  PENDING: 'Đang chờ',
  IN_PROGRESS: 'Đang làm',
  COMPLETED: 'Đã xong',
  CANCELLED: 'Đã hủy',
};

const priorityLabels: Record<ActionItem['priority'], string> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
  URGENT: 'Khẩn cấp',
};

const priorityClass = (priority: ActionItem['priority']) => {
  switch (priority) {
    case 'URGENT':
      return 'bg-red-50 text-red-600 border border-red-100 dark:bg-red-950/20 dark:text-red-300 dark:border-red-900/30';
    case 'HIGH':
      return 'bg-orange-50 text-orange-600 border border-orange-100 dark:bg-orange-950/20 dark:text-orange-300 dark:border-orange-900/30';
    case 'LOW':
      return 'bg-gray-50 text-gray-500 border border-gray-150 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-800';
    default:
      return 'bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-950/20 dark:text-indigo-300 dark:border-indigo-900/30';
  }
};

const initialsFor = (label: string) =>
  label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

const formatDate = (value?: string) => {
  if (!value) return 'Chưa đặt hạn';
  try {
    return new Date(value).toLocaleDateString('vi-VN');
  } catch {
    return 'Chưa đặt hạn';
  }
};

const isGeneratedMetaDescription = (item: ActionItem) =>
  Boolean(
    item.summary_id &&
      item.description &&
      /^(?:Phụ trách:.*|Chưa phân công)(?:\s*\|\s*(?:Hạn:.*|Chưa đặt hạn))?$/i.test(item.description.trim()),
  );

const isOverdue = (item: ActionItem) => {
  if (!item.due_date || item.status === 'COMPLETED') return false;
  return new Date(item.due_date).getTime() < new Date().setHours(0, 0, 0, 0);
};

const MeetingActionItemCard: React.FC<MeetingActionItemCardProps> = ({
  item,
  currentUser,
  assigneeOptions,
  canManage,
  isCurrentUserAssignee,
  isEditing,
  isSaving,
  draft,
  expanded,
  onToggleExpanded,
  onStartEdit,
  onCancelEdit,
  onPatchDraft,
  onConfirmEdit,
  onDelete,
  onUpdateSelfStatus,
  onJumpToContext,
}) => {
  const completedAssigneeCount = item.assignees.filter((assignee) => assignee.status === 'COMPLETED').length;
  const assigneeLabels = item.assignees.map((assignee) => assignee.display_name || assignee.email || 'Người phụ trách');
  const displayedAssignee = item.assignees.length ? assigneeLabels.join(', ') : 'Chưa giao';
  const progressSummary = item.assignees.length ? `${completedAssigneeCount}/${item.assignees.length} hoàn thành` : 'Chưa giao';
  const selfAssignee = item.assignees.find(
    (assignee) =>
      (currentUser?.id && assignee.user_id === currentUser.id) ||
      (currentUser?.email && assignee.email?.toLowerCase() === currentUser.email.toLowerCase()),
  );
  const selfStatus = selfAssignee?.status || 'PENDING';
  const selfStatusLabel = selfAssignee ? statusLabels[selfStatus] : 'Không được giao';
  const canToggleSelfStatus = Boolean(selfAssignee) && isCurrentUserAssignee;
  const isBusy = isSaving;
  const overdue = isOverdue(item);
  const description = isGeneratedMetaDescription(item) ? '' : item.description?.trim() || '';
  const showDescription = expanded || description.length <= 140;

  const handleToggleStatus = () => {
    if (!canToggleSelfStatus) return;
    const nextStatus = selfStatus === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
    onUpdateSelfStatus(nextStatus);
  };

  if (isEditing && draft) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl border border-primary-200 bg-white p-5 shadow-lg shadow-primary-500/10"
      >
        <div className="space-y-4">
          <input
            autoFocus
            value={draft.title}
            onChange={(event) => onPatchDraft({ title: event.target.value })}
            className="w-full text-lg font-black text-gray-900 outline-none placeholder:text-gray-300"
            placeholder="Tên công việc..."
          />

          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Người phụ trách</label>
            <div className="flex flex-wrap gap-2">
              {assigneeOptions.map((option) => {
                const selected = draft.assignedEmails.includes(option.email);
                return (
                  <button
                    key={option.email}
                    type="button"
                    onClick={() => {
                      const next = selected
                        ? draft.assignedEmails.filter((email) => email !== option.email)
                        : [...draft.assignedEmails, option.email];
                      onPatchDraft({ assignedEmails: next });
                    }}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-bold transition-all ${
                      selected
                        ? 'border-primary-200 bg-primary-50 text-primary-700 shadow-sm'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-primary-200 hover:bg-primary-50/50'
                    }`}
                    title={option.label}
                  >
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-black ${
                        selected ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {selected ? <Check size={14} strokeWidth={3} /> : initialsFor(option.label)}
                    </span>
                    <span className="max-w-[140px] truncate text-left">{option.label}</span>
                  </button>
                );
              })}
            </div>
            {assigneeOptions.length === 0 && (
              <p className="text-xs font-medium text-gray-400">Chưa có người tham gia nào để giao việc.</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Ưu tiên</label>
              <select
                value={draft.priority}
                onChange={(event) => onPatchDraft({ priority: event.target.value })}
                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs font-black text-gray-700 outline-none focus:border-primary-300"
              >
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Hạn</label>
              <input
                type="date"
                value={draft.dueDate}
                onChange={(event) => onPatchDraft({ dueDate: event.target.value })}
                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs font-black text-gray-700 outline-none focus:border-primary-300"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={onCancelEdit}
              className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 transition hover:text-gray-600"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={onConfirmEdit}
              disabled={isSaving}
              className="rounded-xl bg-primary-600 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-primary-600/20 disabled:opacity-60"
            >
              {isSaving ? 'Đang lưu...' : 'Cập nhật'}
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="group rounded-2xl border border-gray-100 bg-white shadow-sm transition-colors hover:border-gray-200 hover:bg-gray-50/40 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <button
            type="button"
            onClick={handleToggleStatus}
            disabled={isBusy || !canToggleSelfStatus}
            className="mt-0.5 shrink-0 text-gray-400 transition-colors hover:text-emerald-500 disabled:opacity-50"
            title={canToggleSelfStatus ? 'Cập nhật phần việc của bạn' : 'Chỉ người được giao mới cập nhật được phần việc của mình'}
          >
            {selfStatus === 'COMPLETED' ? (
              <CheckCircle2 size={18} className="text-emerald-500 fill-emerald-50/30 dark:fill-emerald-950/20" />
            ) : (
              <Circle size={18} className="transition-transform hover:scale-105" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <h4
              className={`text-sm font-bold text-gray-900 dark:text-white ${
                item.status === 'COMPLETED' ? 'text-gray-400 line-through dark:text-slate-500' : ''
              }`}
            >
              {item.title}
            </h4>

            {description && (
              <div className="mt-0.5">
                <p className={`text-xs text-gray-500 dark:text-slate-400 ${showDescription ? '' : 'line-clamp-2'}`}>
                  {description}
                </p>
                {description.length > 140 && (
                  <button
                    type="button"
                    onClick={onToggleExpanded}
                    className="mt-1 text-[10px] font-black uppercase tracking-widest text-primary-600 transition hover:text-primary-700"
                  >
                    {expanded ? 'Thu gọn' : 'Xem thêm'}
                  </button>
                )}
              </div>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
              <span className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-300">
                Phần tôi: {selfStatusLabel}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-gray-150 bg-gray-50/80 px-1.5 py-0.5 text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                Tổng: {progressSummary}
              </span>
              {item.anchor && onJumpToContext && (
                <button
                  type="button"
                  onClick={onJumpToContext}
                  className="inline-flex items-center gap-1 rounded-md border border-violet-100 bg-violet-50 px-1.5 py-0.5 text-violet-700 transition hover:bg-violet-100 dark:border-violet-900/30 dark:bg-violet-950/20 dark:text-violet-300"
                >
                  Nghe lại đoạn này
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-7 sm:justify-end sm:pl-0">
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${priorityClass(item.priority)}`}>
            <span
              className={`h-1 w-1 rounded-full ${
                item.priority === 'URGENT' || item.priority === 'HIGH'
                  ? 'bg-red-500'
                  : item.priority === 'MEDIUM'
                    ? 'bg-indigo-500'
                    : 'bg-gray-400'
              }`}
            />
            {priorityLabels[item.priority]}
          </span>

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
            <span
              className="inline-flex items-center gap-1 rounded-md border border-gray-150 bg-gray-50/70 px-1.5 py-0.5 text-[9px] font-bold text-gray-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400"
              title={displayedAssignee}
            >
              <UserRound size={9} />
              {displayedAssignee}
            </span>
          )}

          <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${
              overdue
                ? 'border-red-100 bg-red-50 text-red-600 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400'
                : 'border-gray-150 bg-gray-50/70 text-gray-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400'
            }`}
          >
            <Calendar size={9} />
            {formatDate(item.due_date)}
          </span>

          {canManage && (
            <div className="flex items-center gap-0.5 pl-1 transition-opacity duration-200 md:opacity-0 group-hover:opacity-100">
              <button
                type="button"
                onClick={onStartEdit}
                disabled={isBusy}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                title="Sửa"
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={isBusy}
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                title="Xóa"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default MeetingActionItemCard;
