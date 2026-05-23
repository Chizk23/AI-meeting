/**
 * OrgAdminConsole v3 - Dashboard cho Organization Admin
 * Removed: costs tab, budget references
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Building2,
  Clock,
  FileText,
  FolderOpen,
  History,
  Settings,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useOrgStore } from '../../stores';
import { usePermission } from '../../hooks';
import { AnimatedCounter, PageState, StatCard } from '../../components/ui';
import OrgUsersTab from './OrgUsersTab';
import OrgGroupsTab from './OrgGroupsTab';
import OrgSettingsTab from './OrgSettingsTab';
import OrgAuditLogTab from './OrgAuditLogTab';

type AdminTab = 'overview' | 'users' | 'groups' | 'settings' | 'audit-logs';

const OrgAdminConsole: React.FC = () => {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab: string }>();
  const { user } = useAuth();
  const { currentOrg, groups, members, loadOrgDetails } = useOrgStore();
  const { isOrgAdmin } = usePermission();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // Sync URL tab parameter with local state
  React.useEffect(() => {
    if (tab && ['overview', 'users', 'groups', 'settings', 'audit-logs'].includes(tab)) {
      setActiveTab(tab as AdminTab);
    }
  }, [tab]);

  React.useEffect(() => {
    if (currentOrg?.id) {
      loadOrgDetails(currentOrg.id);
    }
  }, [currentOrg?.id, loadOrgDetails]);

  // Update URL when tab changes
  const handleTabChange = (newTab: AdminTab) => {
    setActiveTab(newTab);
    if (newTab === 'overview') {
      navigate('/org/admin', { replace: true });
    } else {
      navigate(`/org/admin/${newTab}`, { replace: true });
    }
  };

  // Redirect if not org admin
  if (!isOrgAdmin) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/40 dark:bg-red-900/20">
        <h2 className="text-2xl font-bold text-red-600 dark:text-red-300">Access Denied</h2>
        <p className="mt-2 text-gray-600 dark:text-slate-300">
          Bạn cần quyền Quản trị tổ chức để xem trang này.
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 rounded-lg bg-primary-600 px-6 py-2 text-sm font-semibold text-white hover:bg-primary-700"
        >
          Về Dashboard
        </button>
      </div>
    );
  }

  const tabs: Array<{ key: AdminTab; label: string; icon: React.ReactNode }> = [
    { key: 'overview', label: 'Tổng quan', icon: <BarChart3 size={16} /> },
    { key: 'users', label: 'Người dùng', icon: <Users size={16} /> },
    { key: 'groups', label: 'Nhóm', icon: <FolderOpen size={16} /> },
    { key: 'audit-logs', label: 'Nhật ký', icon: <History size={16} /> },
    { key: 'settings', label: 'Cài đặt', icon: <Settings size={16} /> },
  ];

  const stats = [
    {
      label: 'Tổng người dùng',
      value: currentOrg?.memberCount || 0,
      icon: <Users size={18} />,
      accent: 'info' as const,
    },
    {
      label: 'Tổng nhóm',
      value: currentOrg?.groupCount || 0,
      icon: <FolderOpen size={18} />,
      accent: 'primary' as const,
    },
    {
      label: 'Tổng cuộc họp',
      value: currentOrg?.meetingCount || 0,
      icon: <FileText size={18} />,
      accent: 'success' as const,
    },
    {
      label: 'Giờ cộng tác',
      value: currentOrg?.totalHours || 0,
      icon: <Clock size={18} />,
      accent: 'warning' as const,
      subtitle: `${Number(currentOrg?.totalHours || 0).toFixed(
        Number(currentOrg?.totalHours || 0) >= 10 ? 0 : 1,
      )}h`,
    },
  ];

  return (
    <div className="space-y-10 pb-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-6 px-1 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <button
            onClick={() => navigate(-1)}
            className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-gray-500 transition hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <ArrowLeft size={14} />
            Quay lại
          </button>
          <div>
            <h1 className="flex flex-wrap items-center gap-3 text-4xl font-black leading-none tracking-tight text-gray-900 dark:text-slate-100">
              <span>Quản trị tổ chức</span>
              {currentOrg?.name && (
                <span className="text-lg font-bold text-gray-400 dark:text-slate-500">
                  / {currentOrg.name}
                </span>
              )}
            </h1>
            <p className="mt-3 text-sm font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">
              {(currentOrg?.memberCount || 0).toString()} người dùng ·{' '}
              {(currentOrg?.groupCount || 0).toString()} nhóm ·{' '}
              {(currentOrg?.meetingCount || 0).toString()} cuộc họp
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => handleTabChange('groups')}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-5 py-2.5 text-xs font-black text-gray-600 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <Building2 size={14} />
            Quản lý nhóm
          </button>
          <button
            onClick={() => handleTabChange('users')}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-xs font-black text-white shadow-lg shadow-primary-600/20 transition-all hover:-translate-y-0.5 hover:bg-primary-700 hover:shadow-primary-600/30"
          >
            <UserPlus size={14} className="stroke-[3]" />
            Mời người dùng
          </button>
        </div>
      </motion.div>

      {/* Quick Stats */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 gap-5 sm:grid-cols-4"
      >
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 + index * 0.04 }}
          >
            <StatCard
              label={stat.label}
              value={<AnimatedCounter value={Number(stat.value) || 0} />}
              subtitle={stat.subtitle}
              icon={stat.icon}
              accent={stat.accent}
            />
          </motion.div>
        ))}
      </motion.div>

      {/* Tabs */}
      <div className="rounded-3xl border border-gray-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-900">
        {/* Tab Headers */}
        <div className="sticky top-0 z-20 rounded-t-3xl border-b border-gray-100 bg-white/85 px-2 py-2 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/85">
          <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                activeTab === tab.key
                  ? 'bg-primary-50 text-primary-700 shadow-sm dark:bg-primary-950/30 dark:text-primary-200'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">
                  Tổng quan tổ chức
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                  Theo dõi các nhóm đang hoạt động mạnh nhất để điều phối tài nguyên và thành viên.
                </p>
              </div>

              {groups.length === 0 ? (
                <PageState
                  title="Tổ chức này chưa có nhóm nào"
                  description="Tạo nhóm đầu tiên để bắt đầu phân tách không gian cộng tác theo phòng ban, dự án hoặc chuyên môn."
                  tone="empty"
                  action={
                    <button
                      onClick={() => handleTabChange('groups')}
                      className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-8 py-4 text-sm font-black text-white shadow-xl shadow-gray-900/20 transition-all hover:-translate-y-1"
                    >
                      <FolderOpen size={18} />
                      Đi tới quản lý nhóm
                    </button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {groups.slice(0, 5).map((group, idx) => (
                    <div
                      key={group.id}
                      className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-xs font-black text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="text-sm font-black text-gray-900 dark:text-slate-100">
                            {group.name}
                          </p>
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">
                            {group.memberCount} thành viên · {group.meetingCount} cuộc họp ·{' '}
                            {group.totalHours}h
                          </p>
                        </div>
                      </div>
                      <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        <TrendingUp size={16} />
                        Đang hoạt động
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'users' && currentOrg && <OrgUsersTab orgId={currentOrg.id} />}
          {activeTab === 'groups' && currentOrg && <OrgGroupsTab orgId={currentOrg.id} />}
          {activeTab === 'audit-logs' && currentOrg && <OrgAuditLogTab orgId={currentOrg.id} />}
          {activeTab === 'settings' && currentOrg && <OrgSettingsTab orgId={currentOrg.id} />}
        </div>
      </div>
    </div>
  );
};

export default OrgAdminConsole;
