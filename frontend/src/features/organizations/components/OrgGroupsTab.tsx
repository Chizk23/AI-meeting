import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive,
  BarChart3,
  Building2,
  Clock3,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe,
  Lock,
  MoreVertical,
  Search,
  Settings,
  Users,
} from 'lucide-react';

import { PageState } from '../../../components/ui';
import { toast } from '../../../components/ui/Toast';
import api from '../../../services/api';
import { useOrgStore } from '../../../stores';
import type { Group, PrivacyLevel } from '../../../types';

interface OrgGroupsTabProps {
  orgId: string;
}

const privacyConfig: Record<
  PrivacyLevel,
  {
    label: string;
    icon: React.ReactNode;
    badgeClass: string;
  }
> = {
  private: {
    label: 'Riêng tư',
    icon: <Lock size={14} className="text-gray-500" />,
    badgeClass:
      'bg-gray-100 text-gray-700 border border-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  },
  internal: {
    label: 'Nội bộ',
    icon: <Building2 size={14} className="text-blue-500" />,
    badgeClass:
      'bg-blue-50 text-blue-700 border border-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:border-blue-900/40',
  },
  public: {
    label: 'Công khai',
    icon: <Globe size={14} className="text-emerald-500" />,
    badgeClass:
      'bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/40',
  },
};

const formatHours = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0h';
  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
};

const OrgGroupsTab: React.FC<OrgGroupsTabProps> = ({ orgId }) => {
  const navigate = useNavigate();
  const { currentOrg, groups, loadGroups } = useOrgStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [privacyFilter, setPrivacyFilter] = useState<string>('all');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const orgGroups = useMemo(
    () => groups.filter((group) => group.organization_id === orgId || group.orgId === orgId),
    [groups, orgId],
  );

  const filteredGroups = useMemo(
    () =>
      orgGroups.filter((group) => {
        const haystack = `${group.name} ${group.description || ''}`.toLowerCase();
        const matchesSearch = haystack.includes(searchTerm.toLowerCase());
        const matchesPrivacy = privacyFilter === 'all' || group.privacyLevel === privacyFilter;
        return matchesSearch && matchesPrivacy;
      }),
    [orgGroups, privacyFilter, searchTerm],
  );

  const stats = useMemo(() => {
    const totalGroups = orgGroups.length;
    const totalMembers = orgGroups.reduce((sum, group) => sum + (group.memberCount || 0), 0);
    const totalMeetings = orgGroups.reduce((sum, group) => sum + (group.meetingCount || 0), 0);
    return { totalGroups, totalMembers, totalMeetings };
  }, [orgGroups]);

  const handleArchive = async (group: Group) => {
    try {
      await api.patch(`/api/groups/${group.id}`, {
        settings: {
          ...(group.settings || {}),
          archived: true,
          archivedAt: new Date().toISOString(),
        },
      });
      toast.success(`Đã lưu trữ nhóm ${group.name}`);
      await loadGroups(orgId);
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể lưu trữ nhóm');
    }
  };

  const emptyForFilters = orgGroups.length > 0;

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between px-1"
      >
        <div>
          <h2 className="text-4xl font-black tracking-tight text-gray-900 dark:text-slate-100">
            Nhóm trong tổ chức
            {currentOrg?.name && (
              <span className="ml-3 text-lg font-bold text-gray-400 dark:text-slate-500">
                / {currentOrg.name}
              </span>
            )}
          </h2>
        </div>

        <Link
          to="/groups/create"
          className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-xs font-black text-white shadow-lg shadow-primary-600/20 transition-all hover:-translate-y-0.5 hover:bg-primary-700 hover:shadow-primary-600/30"
        >
          <FolderPlus size={14} className="stroke-[3]" />
          Tạo nhóm
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="sticky top-0 z-20 -mx-4 px-4 py-3 backdrop-blur-md lg:mx-0 lg:px-0"
      >
        <div className="rounded-[1.5rem] border border-gray-100 bg-white/80 p-3 shadow-xl shadow-gray-200/20 dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-black/10">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500"
                size={16}
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Tìm nhóm theo tên hoặc mô tả..."
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-primary-900/30"
              />
            </div>
            <select
              value={privacyFilter}
              onChange={(event) => setPrivacyFilter(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold outline-none transition focus:border-primary-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Tất cả phạm vi</option>
              <option value="private">Riêng tư</option>
              <option value="internal">Nội bộ</option>
              <option value="public">Công khai</option>
            </select>
          </div>
        </div>
      </motion.div>

      {filteredGroups.length === 0 ? (
        <PageState
          title={
            emptyForFilters
              ? 'Không có nhóm nào khớp bộ lọc hiện tại'
              : 'Tổ chức này chưa có nhóm nào'
          }
          description={
            emptyForFilters
              ? 'Thử mở rộng từ khóa tìm kiếm hoặc đổi bộ lọc quyền riêng tư để xem thêm nhóm.'
              : 'Tạo nhóm đầu tiên để bắt đầu chia không gian cộng tác theo phòng ban, dự án hoặc chức năng.'
          }
          tone="empty"
          action={
            !emptyForFilters ? (
              <Link
                to="/groups/create"
                className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-8 py-4 text-sm font-black text-white shadow-xl shadow-gray-900/20 transition-all hover:-translate-y-1"
              >
                <FolderPlus size={18} className="stroke-[3]" />
                Tạo nhóm đầu tiên
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => {
            const privacy = privacyConfig[group.privacyLevel];
            return (
              <motion.div
                key={group.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-gray-300 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900/70 dark:hover:border-slate-600"
              >
                <div className="flex items-start justify-between gap-5">
                  <div className="min-w-0 flex-1">
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-100 dark:bg-slate-800">
                        {privacy.icon}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-black text-gray-900 dark:text-slate-100">
                          {group.name}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">
                          <span className={`rounded-full px-2.5 py-1 ${privacy.badgeClass}`}>
                            {privacy.label}
                          </span>
                          <span>{group.memberCount} thành viên</span>
                          <span>·</span>
                          <span>{group.meetingCount} cuộc họp</span>
                          <span>·</span>
                          <span>{formatHours(group.totalHours)}</span>
                        </div>
                      </div>
                    </div>

                    <p className="mb-4 text-sm leading-6 text-gray-600 dark:text-slate-300">
                      {group.description || 'Nhóm này chưa có mô tả chi tiết. Hãy bổ sung mục tiêu và phạm vi cộng tác để mọi người dễ theo dõi hơn.'}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Users size={14} />
                        {group.memberCount} thành viên
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <FileText size={14} />
                        {group.meetingCount} cuộc họp
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-semibold text-gray-900 dark:text-slate-100">
                        <Clock3 size={14} />
                        {formatHours(group.totalHours)}
                      </span>
                    </div>
                  </div>

                  <div className="relative flex items-center gap-2">
                    <Link
                      to={`/groups/${group.id}`}
                      className="rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-black text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Xem nhóm
                    </Link>
                    <button
                      onClick={() => setOpenMenuId((prev) => (prev === group.id ? null : group.id))}
                      className="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <MoreVertical size={16} />
                    </button>
                    {openMenuId === group.id && (
                      <div className="absolute right-0 top-12 z-20 w-48 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                        <button
                          onClick={() => navigate(`/groups/${group.id}`)}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Settings size={14} />
                          Cài đặt nhóm
                        </button>
                        <button
                          onClick={() => navigate(`/groups/${group.id}`)}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <BarChart3 size={14} />
                          Xem phân tích
                        </button>
                        <button
                          onClick={() => handleArchive(group)}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/20"
                        >
                          <Archive size={14} />
                          Lưu trữ nhóm
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrgGroupsTab;
