import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import {
  ArrowLeft,
  Users,
  FileText,
  BarChart3,
  Settings,
  Crown,
  Lock,
  Globe,
  Building2,
  Plus,
  MoreVertical,
  MessageSquare,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useGroupStore, useOrgStore, useAppStore } from '../../../stores';
import { usePermission } from '../../../hooks';
import GroupMeetingsTab from '../components/GroupMeetingsTab';
import GroupMembersTab from '../components/GroupMembersTab';
import GroupChatTab from '../components/GroupChatTab';
import GroupStatsTab from '../components/GroupStatsTab';
import GroupSettingsTab from '../components/GroupSettingsTab';
import CreateGroupModal from '../components/CreateGroupModal';
import { Button, Badge, Card, PageState } from '../../../components/ui';
import type { Group } from '../../../types';

type TabKey = 'meetings' | 'members' | 'chat' | 'stats' | 'settings';

const GroupDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentGroup, group: groupData, loadGroup, loadMembers, loadMeetings, members, meetings } = useGroupStore();
  const { loadGroups } = useOrgStore();
  const { isGroupAdmin, isOrgAdmin } = usePermission();

  const [activeTab, setActiveTab] = useState<TabKey>('meetings');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    const initGroup = async () => {
      if (id) {
        setLoading(true);
        await Promise.all([
          loadGroup(id),
          loadMembers(id),
          loadMeetings(id)
        ]);
        setLoading(false);
      }
    };
    initGroup();
  }, [id, loadGroup, loadMembers, loadMeetings]);

  if (loading) {
    return (
      <PageState
        title="Đang tải nhóm"
        description="Hệ thống đang đồng bộ thông tin nhóm, thành viên và các cuộc họp liên quan."
        tone="loading"
      />
    );
  }

  if (!groupData) {
    return (
      <div className="mx-auto mt-10 max-w-lg">
        <PageState
          title="Không tìm thấy nhóm"
          description={useGroupStore.getState().error || 'Nhóm bạn đang tìm kiếm không tồn tại hoặc bạn không có quyền truy cập.'}
          tone="error"
          action={(
            <Button variant="primary" className="rounded-2xl px-10" onClick={() => navigate('/')}>
              Về trang chủ
            </Button>
          )}
        />
      </div>
    );
  }

  const privacyLabel = (level: string) => {
    switch (level) {
      case 'private': return 'Riêng tư';
      case 'internal': return 'Nội bộ';
      case 'public': return 'Công khai';
      default: return level;
    }
  };

  const privacyIcon = (level: string) => {
    switch (level) {
      case 'private': return <Lock size={14} className="text-rose-500" />;
      case 'internal': return <Building2 size={14} className="text-primary-500" />;
      case 'public': return <Globe size={14} className="text-emerald-500" />;
      default: return null;
    }
  };

  const hasSettingsAccess = isGroupAdmin || isOrgAdmin;
  const visibleMembers = members.slice(0, 3);
  const totalMemberCount = Math.max(groupData.memberCount || 0, members.length);
  const extraMemberCount = Math.max(0, totalMemberCount - visibleMembers.length);
  const getMemberRoleLabel = (memberId: string) => {
    const role = members
      .find((member) => member.id === memberId)
      ?.groupMemberships?.find((membership) => membership.groupId === groupData.id)
      ?.role;

    switch (role) {
      case 'group-admin':
        return 'Quản trị nhóm';
      case 'viewer':
        return 'Người xem';
      default:
        return 'Thành viên';
    }
  };

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    { key: 'meetings', label: 'Cuộc họp', icon: <FileText size={16} /> },
    { key: 'members', label: 'Thành viên', icon: <Users size={16} /> },
    { key: 'chat', label: 'Thảo luận', icon: <MessageSquare size={16} /> },
    { key: 'stats', label: 'Thống kê', icon: <BarChart3 size={16} /> },
    ...(hasSettingsAccess ? [{ key: 'settings' as TabKey, label: 'Cài đặt', icon: <Settings size={16} /> }] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      {/* Premium Header */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[2.5rem] border border-primary-100 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:p-10"
      >
        {/* Background Accent */}
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-primary-50/50 blur-3xl dark:bg-primary-900/10" />

        <div className="relative z-10">
          <nav className="mb-6 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400">
            <Link to="/" className="hover:text-primary-600 transition-colors">Workspace</Link>
            <ChevronRight size={12} />
            <span className="text-gray-900 dark:text-slate-100">Chi tiết Nhóm</span>
          </nav>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-black tracking-tight text-gray-900 dark:text-white sm:text-4xl">
                  {groupData.name}
                </h1>
                <Badge variant="secondary" className="flex items-center gap-1.5 px-3 py-1 text-xs">
                  {privacyIcon(groupData.privacyLevel)}
                  {privacyLabel(groupData.privacyLevel)}
                </Badge>
                {hasSettingsAccess && (
                  <Badge variant="primary" className="gap-1.5 px-3 py-1 text-xs">
                    <ShieldCheck size={12} />
                    Quản trị viên
                  </Badge>
                )}
              </div>

              {groupData.description && (
                <p className="mt-4 max-w-2xl text-lg text-gray-600 dark:text-slate-300">
                  {groupData.description}
                </p>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-6 text-sm font-medium text-gray-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/20">
                    <Users size={16} />
                  </div>
                  <span><b className="text-gray-900 dark:text-white">{groupData.memberCount || 0}</b> thành viên</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/20">
                    <FileText size={16} />
                  </div>
                  <span><b className="text-gray-900 dark:text-white">{groupData.meetingCount || 0}</b> cuộc họp</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20">
                    <BarChart3 size={16} />
                  </div>
                  <span>Tổng cộng <b className="text-gray-900 dark:text-white">{groupData.totalHours || 0}h</b></span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <Button 
                size="lg" 
                onClick={() => navigate(`/meetings/create?groupId=${id}`)}
                className="h-12 rounded-2xl px-8 shadow-lg shadow-primary-500/20"
                icon={<Plus size={18} />}
              >
                Họp ngay
              </Button>
              <Button 
                variant="secondary" 
                size="lg"
                className="h-12 w-12 rounded-2xl p-0 flex items-center justify-center bg-gray-50 dark:bg-slate-800"
              >
                <MoreVertical size={20} />
              </Button>
            </div>
          </div>
        </div>
      </motion.section>

      {(groupData.meetingCount === 0 || totalMemberCount <= 1) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[2rem] border border-dashed border-primary-200 bg-primary-50/50 p-6 dark:border-primary-900/30 dark:bg-primary-900/10"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-primary-600 dark:text-primary-300">
                Thiết lập ban đầu
              </p>
              <h2 className="mt-2 text-2xl font-black text-gray-900 dark:text-white">
                {groupData.meetingCount === 0 ? 'Nhóm này chưa có cuộc họp nào' : 'Nhóm đã tạo nhưng chưa có đủ người cộng tác'}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600 dark:text-slate-300">
                {groupData.meetingCount === 0
                  ? 'Bắt đầu bằng một cuộc họp live hoặc tải ghi âm để nhóm có transcript, AI Notes và việc cần làm đầu tiên.'
                  : 'Mời thêm thành viên để giao việc, thảo luận trong nhóm và tổ chức các cuộc họp đúng phạm vi.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {groupData.meetingCount === 0 && (
                <>
                  <Button
                    size="lg"
                    onClick={() => navigate(`/meetings/create?groupId=${id}`)}
                    className="rounded-2xl px-6"
                    icon={<Plus size={16} />}
                  >
                    Tạo cuộc họp
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => navigate('/upload')}
                    className="rounded-2xl px-6"
                    icon={<FileText size={16} />}
                  >
                    Tải ghi âm
                  </Button>
                </>
              )}
              {totalMemberCount <= 1 && (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => setActiveTab('members')}
                  className="rounded-2xl px-6"
                  icon={<Users size={16} />}
                >
                  Quản lý thành viên
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Horizontal Tab Interface */}
      <div className="space-y-6">
        {/* Sticky Tab Bar */}
        <div className="sticky top-0 z-30 -mx-4 px-4 pb-4 pt-2 backdrop-blur-md">
          <div className="flex items-center justify-between rounded-full border border-gray-100 bg-white/80 p-2 shadow-lg dark:border-slate-800 dark:bg-slate-900/80">
            <div className="flex flex-1 items-center gap-1 overflow-x-auto custom-scrollbar sm:gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={clsx(
                    "flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-all duration-300",
                    activeTab === tab.key
                      ? "bg-primary-600 text-white shadow-md shadow-primary-500/20"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  )}
                >
                  <span className={clsx(
                    "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                    activeTab === tab.key ? "bg-white/20" : "bg-gray-100 dark:bg-slate-800"
                  )}>
                    {React.cloneElement(tab.icon as React.ReactElement<any>, { size: 14 })}
                  </span>
                  {tab.label}
                </button>
              ))}
            </div>
            
            <div className="hidden items-center gap-2 border-l border-gray-100 pl-4 pr-2 dark:border-slate-800 md:flex">
              <div className="flex -space-x-2">
                {visibleMembers.map((member) => (
                  <div
                    key={member.id}
                    className="group relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-primary-100 text-xs font-black text-primary-700 shadow-sm dark:border-slate-900 dark:bg-primary-900/40 dark:text-primary-200"
                  >
                    {(member.displayName?.[0] || member.email?.[0] || 'U').toUpperCase()}
                    <div className="pointer-events-none absolute right-0 top-10 z-50 hidden w-56 rounded-2xl border border-gray-100 bg-white p-3 text-left shadow-xl group-hover:block dark:border-slate-700 dark:bg-slate-900">
                      <p className="truncate text-sm font-black text-gray-900 dark:text-white">
                        {member.displayName || `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email}
                      </p>
                      <p className="mt-0.5 truncate text-xs font-semibold text-gray-500 dark:text-slate-400">{member.email}</p>
                      <p className="mt-2 inline-flex rounded-full bg-primary-50 px-2 py-1 text-[11px] font-black text-primary-700 dark:bg-primary-900/30 dark:text-primary-200">
                        {getMemberRoleLabel(member.id)}
                      </p>
                    </div>
                  </div>
                ))}
                {visibleMembers.length === 0 && (
                  <div className="h-8 w-8 rounded-full border-2 border-white bg-gray-200 shadow-sm dark:border-slate-900 dark:bg-slate-800" />
                )}
              </div>
              {extraMemberCount > 0 && (
                <span className="text-xs font-black text-gray-400">
                  +{extraMemberCount}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="min-h-[500px]"
          >
            <Card className="border-none bg-transparent p-0 shadow-none">
              {activeTab === 'meetings' && (
                <GroupMeetingsTab meetings={meetings} />
              )}

              {activeTab === 'members' && (
                <GroupMembersTab
                  groupId={groupData.id}
                  members={members}
                  currentUserId={user?.id}
                  onInviteMember={() => {
                    loadMembers(groupData.id);
                    loadGroup(groupData.id);
                    loadGroups(groupData.orgId || groupData.organization_id);
                  }}
                />
              )}

              {activeTab === 'chat' && (
                <GroupChatTab groupId={groupData.id} />
              )}

              {activeTab === 'stats' && (
                <GroupStatsTab groupId={groupData.id} />
              )}

              {activeTab === 'settings' && (isGroupAdmin || isOrgAdmin) && (
                <GroupSettingsTab groupId={groupData.id} />
              )}
            </Card>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default GroupDetail;
