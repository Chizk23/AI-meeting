/**
 * GroupMembersTab Component
 * Quản lý thành viên trong group với vai trò (roles)
 */
import React, { useEffect, useState } from 'react';
import { Search, Plus, Eye, MoreVertical, Users, Filter, ShieldCheck, Shield, Loader2 } from 'lucide-react';
import type { User as UserType, SystemRole } from '../../../types';
import { getRoleDisplayInfo } from '../../../data';
import { Button, Badge } from '../../../components/ui';
import { toast } from '../../../components/ui/Toast';
import { usePermission } from '../../../hooks';
import api from '../../../services/api';
import { useGroupStore } from '../../../stores';

interface GroupMembersTabProps {
  groupId: string;
  members: UserType[];
  currentUserId?: string;
  onInviteMember?: (email: string) => void;
}

type RoleFilter = 'all' | 'group-admin' | 'member' | 'viewer';
type AssignableGroupRole = 'member' | 'group-admin';

interface SearchableUser {
  id: string;
  email: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
}

const GroupMembersTab: React.FC<GroupMembersTabProps> = ({
  groupId,
  members,
  currentUserId = 'user-001',
  onInviteMember,
}) => {
  const { isGroupAdmin, isOrgAdmin } = usePermission();
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState<SearchableUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<SearchableUser | null>(null);
  const [inviteRole, setInviteRole] = useState<AssignableGroupRole>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [isSearchingInvitees, setIsSearchingInvitees] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const { group } = useGroupStore();

  const canInvite = isGroupAdmin || isOrgAdmin;

  useEffect(() => {
    if (!showInviteModal) return;

    const term = inviteQuery.trim();
    if (selectedUser) {
      setInviteResults([]);
      setIsSearchingInvitees(false);
      return;
    }

    let cancelled = false;
    setIsSearchingInvitees(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get(`/api/groups/${groupId}/users/search`, {
          params: term ? { q: term } : {},
        });
        if (!cancelled) {
          setInviteError('');
          setInviteResults(Array.isArray(response.data) ? response.data : []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setInviteResults([]);
          setInviteError(err.response?.data?.detail || 'Không tìm được thành viên phù hợp.');
        }
      } finally {
        if (!cancelled) {
          setIsSearchingInvitees(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [groupId, inviteQuery, selectedUser, showInviteModal]);

  // Group members by role with filtering
  const groupedMembers = React.useMemo(() => {
    const filtered = members.filter((member) => {
      const matchesSearch =
        (member.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.email.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesRole = roleFilter === 'all' || member.groupMemberships?.some(
        (gm) => gm.groupId === groupId && gm.role === roleFilter
      );

      return matchesSearch && matchesRole;
    });

    const admins = filtered.filter((m) =>
      m.groupMemberships?.some((gm) => gm.groupId === groupId && gm.role === 'group-admin')
    );
    const regularMembers = filtered.filter((m) =>
      m.groupMemberships?.some((gm) => gm.groupId === groupId && gm.role === 'member')
    );
    const viewers = filtered.filter((m) =>
      m.groupMemberships?.some((gm) => gm.groupId === groupId && gm.role === 'viewer')
    );

    return { admins, regularMembers, viewers, totalCount: filtered.length };
  }, [members, groupId, searchTerm, roleFilter]);

  const getMemberRole = (member: UserType): string => {
    const membership = member.groupMemberships?.find((gm) => gm.groupId === groupId);
    return membership?.role || 'member';
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !groupId) {
      setInviteError('Vui lòng chọn một thành viên trong tổ chức.');
      return;
    }

    setIsInviting(true);
    setInviteError('');
    try {
      await api.post(`/api/groups/${groupId}/members`, {
        user_id: selectedUser.id,
        role: inviteRole,
      });
      if (onInviteMember) onInviteMember(selectedUser.email);
      toast.success(`Đã thêm ${selectedUser.email} vào nhóm`);
      setInviteQuery('');
      setInviteResults([]);
      setSelectedUser(null);
      setShowInviteModal(false);
    } catch (err: any) {
      const message = err.response?.data?.detail || 'Lỗi khi thêm thành viên';
      setInviteError(message);
      toast.error(message);
    } finally {
      setIsInviting(false);
    }
  };

  const closeInviteModal = () => {
    setShowInviteModal(false);
    setInviteQuery('');
    setInviteResults([]);
    setSelectedUser(null);
    setInviteRole('member');
    setInviteError('');
  };

  const roleIcon = (role: string) => {
    switch (role) {
      case 'group-admin': return <ShieldCheck size={14} className="text-amber-500" />;
      case 'member': return <Shield size={14} className="text-primary-500" />;
      case 'viewer': return <Eye size={14} className="text-gray-400" />;
      default: return null;
    }
  };

  const MemberCard: React.FC<{ member: UserType }> = ({ member }) => {
    const role = getMemberRole(member);
    const isCurrentUser = member.id === currentUserId;
    const roleInfo = getRoleDisplayInfo(role as SystemRole);

    return (
      <div className="group flex items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 transition-all hover:border-primary-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-primary-900/50">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 text-lg font-black text-primary-700 dark:from-primary-900/20 dark:to-primary-800/20 dark:text-primary-300">
              {(member.displayName?.[0] || member.email[0]).toUpperCase()}
            </div>
            {isCurrentUser && (
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 border-2 border-white dark:border-slate-900" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-gray-900 dark:text-slate-100">
                {member.displayName || member.email.split('@')[0]}
                {isCurrentUser && <span className="ml-2 text-[10px] font-black uppercase text-primary-500">(Bạn)</span>}
              </p>
              {roleIcon(role)}
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">{member.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge 
            variant={role === 'group-admin' ? 'primary' : 'secondary'} 
            className="text-[10px] font-bold uppercase tracking-wider"
          >
            {roleInfo.displayName}
          </Badge>

          {!isCurrentUser && (
            <button className="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800">
              <MoreVertical size={18} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Search & Actions */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm kiếm theo tên hoặc email..."
            className="h-12 w-full rounded-2xl border border-gray-100 bg-white pl-12 pr-4 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-500/5 dark:border-slate-800 dark:bg-slate-900"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
             <Filter size={14} className="absolute left-3 text-gray-400" />
             <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
              className="h-12 appearance-none rounded-2xl border border-gray-100 bg-white pl-9 pr-8 text-sm font-bold text-gray-600 outline-none transition focus:border-primary-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            >
              <option value="all">Tất cả vai trò</option>
              <option value="group-admin">Quản trị viên</option>
              <option value="member">Thành viên</option>
              <option value="viewer">Người xem</option>
            </select>
          </div>
          {canInvite && (
            <Button 
              variant="primary" 
              className="h-12 rounded-2xl px-6" 
              onClick={() => setShowInviteModal(true)}
              icon={<Plus size={18} />}
            >
              Mời thành viên
            </Button>
          )}
        </div>
      </div>

      {/* Members List */}
      <div className="space-y-8">
        {groupedMembers.totalCount > 0 ? (
          <>
            {/* Admins */}
            {groupedMembers.admins.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">Quản trị viên ({groupedMembers.admins.length})</h4>
                <div className="grid grid-cols-1 gap-3">
                  {groupedMembers.admins.map((member) => (
                    <MemberCard key={member.id} member={member} />
                  ))}
                </div>
              </div>
            )}

            {/* Regular Members */}
            {groupedMembers.regularMembers.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-500">Thành viên ({groupedMembers.regularMembers.length})</h4>
                <div className="grid grid-cols-1 gap-3">
                  {groupedMembers.regularMembers.map((member) => (
                    <MemberCard key={member.id} member={member} />
                  ))}
                </div>
              </div>
            )}

            {/* Viewers */}
            {groupedMembers.viewers.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Người xem ({groupedMembers.viewers.length})</h4>
                <div className="grid grid-cols-1 gap-3">
                  {groupedMembers.viewers.map((member) => (
                    <MemberCard key={member.id} member={member} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-50 text-gray-400 dark:bg-slate-800">
              <Search size={32} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {members.length === 0 ? 'Nhóm chưa có thành viên nào' : 'Không tìm thấy kết quả'}
            </h3>
            <p className="text-sm text-gray-500">
              {members.length === 0
                ? 'Hãy mời thành viên từ tổ chức vào nhóm để bắt đầu cộng tác và giao việc.'
                : 'Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc.'}
            </p>
          </div>
        )}
      </div>

      {/* Role Info Footer */}
      <div className="rounded-3xl border border-gray-100 bg-gray-50/50 p-6 dark:border-slate-800 dark:bg-slate-900/30">
        <h4 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-400">
          <Users size={14} /> Giải thích vai trò
        </h4>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex gap-3">
            <ShieldCheck size={18} className="shrink-0 text-amber-500" />
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-white">Quản trị viên</p>
              <p className="text-[10px] text-gray-500">Toàn quyền quản lý thành viên, cuộc họp và cài đặt nhóm.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Shield size={18} className="shrink-0 text-primary-500" />
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-white">Thành viên</p>
              <p className="text-[10px] text-gray-500">Có thể tạo cuộc họp mới, xem và thảo luận trong nhóm.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Eye size={18} className="shrink-0 text-gray-400" />
            <div>
              <p className="text-xs font-bold text-gray-900 dark:text-white">Người xem</p>
              <p className="text-[10px] text-gray-500">Chỉ có quyền xem các biên bản họp, không thể tạo nội dung.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Polished Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[2rem] border border-white/20 bg-white shadow-2xl dark:bg-slate-900">
            <div className="bg-primary-600 p-8 text-white">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
                <Users size={24} />
              </div>
              <h3 className="text-2xl font-black">Mời thành viên</h3>
              <p className="mt-2 text-sm text-primary-100">Chỉ thêm những thành viên đã thuộc tổ chức nhưng chưa có trong nhóm này.</p>
            </div>
            
            <form onSubmit={handleInvite} className="p-8">
              <div className="space-y-4">
                {inviteError && (
                  <div className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600 dark:bg-red-900/20 dark:text-red-300">
                    {inviteError}
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Tìm thành viên trong tổ chức</label>
                  <input
                    autoFocus
                    value={selectedUser ? selectedUser.email : inviteQuery}
                    onChange={(e) => {
                      setSelectedUser(null);
                      setInviteQuery(e.target.value);
                      setInviteError('');
                    }}
                    placeholder="Nhập Gmail hoặc tên thành viên..."
                    className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium outline-none transition focus:border-primary-400 dark:border-slate-800 dark:bg-slate-800"
                  />
                  <div className="min-h-[96px] rounded-xl border border-gray-100 bg-gray-50 p-2 dark:border-slate-800 dark:bg-slate-800/60">
                    {isSearchingInvitees ? (
                      <div className="flex h-20 items-center justify-center gap-2 text-xs font-semibold text-slate-500">
                        <Loader2 size={14} className="animate-spin" />
                        Đang tìm...
                      </div>
                    ) : selectedUser ? (
                      <div className="flex items-center justify-between rounded-lg bg-white p-3 dark:bg-slate-900">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
                            {(selectedUser.displayName?.[0] || selectedUser.email[0]).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-900 dark:text-white">
                              {selectedUser.displayName || selectedUser.email}
                            </p>
                            <p className="text-xs text-slate-500">{selectedUser.email}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedUser(null);
                            setInviteQuery('');
                          }}
                          className="text-xs font-bold text-slate-500 hover:text-red-500"
                        >
                          Đổi
                        </button>
                      </div>
                    ) : inviteResults.length === 0 ? (
                      <div className="flex h-20 items-center justify-center text-center text-xs font-semibold text-slate-500">
                        Không có thành viên phù hợp, hoặc người này đã ở trong nhóm.
                      </div>
                    ) : (
                      <div className="max-h-44 space-y-1 overflow-y-auto">
                        {inviteResults.map((user) => (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => {
                              setSelectedUser(user);
                              setInviteQuery(user.email);
                              setInviteResults([]);
                            }}
                            className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-white dark:hover:bg-slate-900"
                          >
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
                              {(user.displayName?.[0] || user.email[0]).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                                {user.displayName || user.email}
                              </p>
                              <p className="truncate text-xs text-slate-500">{user.email}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Vai trò trong nhóm</label>
                  <select 
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as AssignableGroupRole)}
                    className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium outline-none dark:border-slate-800 dark:bg-slate-800"
                  >
                    <option value="member">Thành viên (Member)</option>
                    {isOrgAdmin && <option value="group-admin">Quản trị nhóm (Group Admin)</option>}
                  </select>
                </div>
              </div>
              
              <div className="mt-8 flex gap-3">
                <Button
                  variant="ghost"
                  className="flex-1 rounded-xl"
                  onClick={closeInviteModal}
                  type="button"
                >
                  Hủy
                </Button>
                <Button
                  variant="primary"
                  className="flex-1 rounded-xl shadow-lg shadow-primary-500/20"
                  type="submit"
                  isLoading={isInviting}
                  disabled={!selectedUser}
                >
                  Thêm vào nhóm
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupMembersTab;
