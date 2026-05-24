import React from 'react';
import { Check, User, Users } from 'lucide-react';
import type { GroupMember } from '../../../hooks/useGroupMembers';

interface ParticipantSelectorProps {
  members: GroupMember[];
  selectedIds: string[];
  loading: boolean;
  onToggleAll: () => void;
  onToggleMember: (userId: string) => void;
}

const ParticipantSelector: React.FC<ParticipantSelectorProps> = ({
  members,
  selectedIds,
  loading,
  onToggleAll,
  onToggleMember,
}) => {
  const allSelected = members.length > 0 && selectedIds.length === members.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-gray-400 dark:text-slate-500">
        <div className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
        Đang tải thành viên...
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-slate-800">
          <Users size={20} className="text-gray-300 dark:text-slate-600" />
        </div>
        <p className="text-sm font-medium text-gray-500 dark:text-slate-400">
          Chưa có thành viên nào trong nhóm
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Select all */}
      <button
        type="button"
        onClick={onToggleAll}
        className={`flex w-full items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 text-sm transition-all ${
          allSelected
            ? 'border-primary-200 bg-primary-50/60 dark:border-primary-800 dark:bg-primary-900/10'
            : 'border-gray-200 bg-white hover:border-gray-300 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-slate-600'
        }`}
      >
        <div
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
            allSelected
              ? 'border-primary-500 bg-primary-500 text-white'
              : 'border-gray-300 dark:border-slate-600'
          }`}
        >
          {allSelected && <Check size={12} strokeWidth={3} />}
        </div>
        <Users size={16} className={allSelected ? 'text-primary-500' : 'text-gray-400 dark:text-slate-500'} />
        <span className={`font-semibold ${allSelected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-slate-300'}`}>
          Chọn tất cả
        </span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${
          allSelected
            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
            : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'
        }`}>
          {members.length}
        </span>
      </button>

      {/* Member list */}
      <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/50 p-1.5 dark:border-slate-800 dark:bg-slate-800/20">
        {members.map((member) => {
          const isSelected = selectedIds.includes(member.user_id);
          return (
            <button
              key={member.user_id}
              type="button"
              onClick={() => onToggleMember(member.user_id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                isSelected
                  ? 'bg-white shadow-sm ring-1 ring-primary-200/50 dark:bg-slate-800 dark:ring-primary-800/50'
                  : 'hover:bg-white/80 dark:hover:bg-slate-800/60'
              }`}
            >
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
                  isSelected
                    ? 'border-primary-500 bg-primary-500 text-white'
                    : 'border-gray-300 dark:border-slate-600'
                }`}
              >
                {isSelected && <Check size={12} strokeWidth={3} />}
              </div>
              <div className="relative shrink-0">
                {member.avatar_url ? (
                  <img src={member.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-white dark:ring-slate-800" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-gray-500 dark:from-slate-600 dark:to-slate-700 dark:text-slate-400">
                    <User size={14} />
                  </div>
                )}
                {isSelected && (
                  <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary-500 ring-2 ring-white dark:ring-slate-800">
                    <Check size={8} strokeWidth={3} className="text-white" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`truncate font-medium ${isSelected ? 'text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-400'}`}>
                  {member.name}
                </p>
                {member.email && (
                  <p className="truncate text-xs text-gray-400 dark:text-slate-500">{member.email}</p>
                )}
              </div>
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                isSelected
                  ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
                  : 'bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-500'
              }`}>
                {member.role}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ParticipantSelector;
