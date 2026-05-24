import React from 'react';
import { ChevronDown, FolderOpen } from 'lucide-react';
import type { Group } from '../../../types';

interface GroupSelectorProps {
  groups: Group[];
  selectedId: string;
  onChange: (id: string) => void;
  label?: string;
}

const GroupSelector: React.FC<GroupSelectorProps> = ({
  groups,
  selectedId,
  onChange,
  label = 'Nhóm / Phòng ban',
}) => (
  <div>
    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
      {label}
    </label>
    <div className="relative">
      <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500">
        <FolderOpen size={16} />
      </div>
      <select
        value={selectedId}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full appearance-none rounded-xl border border-gray-200 bg-white pl-10 pr-10 text-sm font-medium text-gray-700 shadow-sm transition-all focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:focus:border-primary-600"
      >
        {groups.length === 0 && <option value="">Chưa có nhóm</option>}
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-gray-100 p-0.5 dark:bg-slate-700">
        <ChevronDown size={14} className="text-gray-500 dark:text-slate-400" />
      </div>
    </div>
  </div>
);

export default GroupSelector;
