import React from 'react';
import { Search, Filter, SortAsc } from 'lucide-react';
import type { Group } from '../../../types';

interface MeetingFiltersProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  sortBy: string;
  setSortBy: (value: any) => void;
  groupFilter: string;
  setGroupFilter: (value: string) => void;
  uniqueGroups: (Group | undefined)[];
  statusFilter?: string;
  setStatusFilter?: (value: string) => void;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'live_upcoming', label: 'Sắp tới / Đang diễn ra' },
  { value: 'processing', label: 'Đang xử lý' },
  { value: 'done', label: 'Đã xong' },
];

const MeetingFilters: React.FC<MeetingFiltersProps> = ({
  searchTerm,
  setSearchTerm,
  sortBy,
  setSortBy,
  groupFilter,
  setGroupFilter,
  uniqueGroups,
  statusFilter = 'all',
  setStatusFilter,
}) => {
  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Tìm kiếm cuộc họp theo tên, nội dung..."
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-primary-900/30"
        />
      </div>

      <div className="flex gap-2">
        {/* Status Filter */}
        {setStatusFilter && (
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-8 text-sm font-medium outline-none transition focus:border-primary-400 dark:border-slate-700 dark:bg-slate-800"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Group Filter */}
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-8 text-sm font-medium outline-none transition focus:border-primary-400 dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="all">Tất cả nhóm</option>
            {uniqueGroups.map((group) =>
              group ? <option key={group.id} value={group.id}>{group.name}</option> : null,
            )}
          </select>
        </div>

        {/* Sort */}
        <div className="relative">
          <SortAsc className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-8 text-sm font-medium outline-none transition focus:border-primary-400 dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
            <option value="longest">Dài nhất</option>
            <option value="most-attendees">Nhiều người nhất</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default MeetingFilters;
