import React from 'react';
import { Calendar, Check, Plus, UserPlus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import type { ActionItem, ActionItemAssigneeOption } from '../../../types/actionItem';

type ActionItemComposerProps = {
  canManage: boolean;
  title: string;
  onTitleChange: (value: string) => void;
  assigneeOptions: ActionItemAssigneeOption[];
  selectedAssignees: string[];
  onSelectedAssigneesChange: (emails: string[]) => void;
  dueDate: string;
  onDueDateChange: (value: string) => void;
  priority: ActionItem['priority'];
  onPriorityChange: (value: ActionItem['priority']) => void;
  isExpanded: boolean;
  onExpandedChange: (next: boolean) => void;
  showAdvanced: boolean;
  onShowAdvancedChange: (next: boolean) => void;
  isSubmitting: boolean;
  onSubmit: (event: React.FormEvent) => void;
};

const priorityLabels: Record<ActionItem['priority'], string> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
  URGENT: 'Khẩn cấp',
};

const toggleSelection = (current: string[], email: string) =>
  current.includes(email) ? current.filter((item) => item !== email) : [...current, email];

const initialsFor = (label: string) =>
  label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

const ActionItemComposer: React.FC<ActionItemComposerProps> = ({
  canManage,
  title,
  onTitleChange,
  assigneeOptions,
  selectedAssignees,
  onSelectedAssigneesChange,
  dueDate,
  onDueDateChange,
  priority,
  onPriorityChange,
  isExpanded,
  onExpandedChange,
  isSubmitting,
  onSubmit,
}) => {
  if (!canManage) return null;

  const resetForm = () => {
    onTitleChange('');
    onSelectedAssigneesChange([]);
    onDueDateChange('');
    onExpandedChange(false);
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
      <form onSubmit={onSubmit}>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600">
            <Plus size={18} strokeWidth={3} />
          </div>
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            onFocus={() => onExpandedChange(true)}
            placeholder="Thêm việc cần làm mới..."
            className="h-10 w-full bg-transparent text-[15px] font-black text-gray-900 outline-none placeholder:text-gray-300"
          />

          <AnimatePresence>
            {!isExpanded && title.trim() && (
              <motion.button
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                type="submit"
                className="whitespace-nowrap rounded-xl bg-primary-600 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-primary-600/20"
              >
                Tạo nhanh
              </motion.button>
            )}
          </AnimatePresence>

          {isExpanded && (
            <button
              type="button"
              onClick={resetForm}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              className="border-t border-gray-100"
            >
              <div className="space-y-4 p-5">
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Người phụ trách</label>
                  <div className="flex flex-wrap gap-2">
                    {assigneeOptions.map((option) => {
                      const selected = selectedAssignees.includes(option.email);
                      return (
                        <button
                          key={option.email}
                          type="button"
                          onClick={() => onSelectedAssigneesChange(toggleSelection(selectedAssignees, option.email))}
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
                    <div className="flex items-center gap-2 text-xs font-medium text-gray-400">
                      <UserPlus size={15} />
                      Chưa có người tham gia nào để giao việc.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Ưu tiên</label>
                    <select
                      value={priority}
                      onChange={(event) => onPriorityChange(event.target.value as ActionItem['priority'])}
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
                    <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                      <Calendar size={14} className="text-gray-400" />
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(event) => onDueDateChange(event.target.value)}
                        className="w-full bg-transparent text-xs font-black text-gray-700 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 transition hover:text-gray-600"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !title.trim()}
                    className="rounded-xl bg-primary-600 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-primary-600/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? 'Đang tạo...' : 'Tạo công việc'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </form>
    </div>
  );
};

export default ActionItemComposer;
