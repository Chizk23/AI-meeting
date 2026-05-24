import React from 'react';

import type { ActionItemAssignee } from '../../../types/actionItem';

type AssigneeSummaryProps = {
  assignees: ActionItemAssignee[];
  expanded?: boolean;
  onToggleExpanded?: () => void;
  emptyLabel?: string;
};

const initialsFor = (label: string) =>
  label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

const AssigneeSummary: React.FC<AssigneeSummaryProps> = ({
  assignees,
  expanded = false,
  onToggleExpanded,
  emptyLabel = 'Chưa giao',
}) => {
  if (assignees.length === 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
        {emptyLabel}
      </span>
    );
  }

  const visibleAssignees = expanded ? assignees : assignees.slice(0, 2);
  const hiddenCount = Math.max(0, assignees.length - visibleAssignees.length);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visibleAssignees.map((assignee) => {
        const label = assignee.display_name || assignee.email;
        return (
          <span
            key={assignee.id || assignee.email}
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-[10px] font-black text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
              {initialsFor(label)}
            </span>
            <span className="max-w-[140px] truncate">{label}</span>
          </span>
        );
      })}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold text-gray-600 transition hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          +{hiddenCount}
        </button>
      )}
      {expanded && assignees.length > 2 && onToggleExpanded && (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="text-xs font-bold text-primary-600 transition hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200"
        >
          Thu gọn
        </button>
      )}
    </div>
  );
};

export default AssigneeSummary;
