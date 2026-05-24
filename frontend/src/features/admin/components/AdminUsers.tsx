import React from 'react';
import {
  Search,
  Shield,
  Users,
  UserCheck,
  UserMinus,
  Trash2,
  ArrowUpDown,
  ChevronRight,
  X,
  Mail,
  Phone,
  Calendar,
  Building2,
  Layers,
  User as UserIcon,
  Clock,
  ShieldCheck,
  MoreVertical,
  Activity
} from 'lucide-react';
import { clsx } from 'clsx';
import api from '../../../services/api';
import { normalizeUser } from '../../../services/mappers';
import { toast } from '../../../components/ui/Toast';
import type { User } from '../../../types';

type FilterType = 'all' | 'active' | 'disabled' | 'admin';

const AdminUsers: React.FC = () => {
  const [users, setUsers] = React.useState<User[]>([]);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<FilterType>('all');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);

  // Selected User for Slide-over
  const [selectedUser, setSelectedUser] = React.useState<User | null>(null);
  const [showActionMenu, setShowActionMenu] = React.useState(false);

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/admin/users');
      const rows = Array.isArray(response.data) ? response.data.map(normalizeUser) : [];
      setUsers(rows);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Không tải được danh sách người dùng');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleToggleStatus = async (user: User) => {
    setUpdatingId(user.id);
    try {
      const response = await api.patch(`/api/admin/users/${user.id}/status`, {
        is_active: !user.isActive,
      });
      const updated = normalizeUser(response.data);
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (selectedUser?.id === user.id) setSelectedUser(updated);
      toast.success(updated.isActive ? 'Đã kích hoạt tài khoản' : 'Đã vô hiệu hóa tài khoản');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không cập nhật được trạng thái');
    } finally {
      setUpdatingId(null);
      setShowActionMenu(false);
    }
  };

  const handleChangeRole = async (user: User) => {
    const newRole = user.systemRole === 'system-admin' ? 'member' : 'system-admin';
    if (!confirm(`Bạn có chắc muốn đổi role của ${user.email} thành ${newRole}?`)) return;
    setUpdatingId(user.id);
    try {
      const response = await api.patch(`/api/admin/users/${user.id}/role`, { role: newRole });
      const updated = normalizeUser(response.data);
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (selectedUser?.id === user.id) setSelectedUser(updated);
      toast.success(`Đã đổi role thành ${newRole}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không đổi được role');
    } finally {
      setUpdatingId(null);
      setShowActionMenu(false);
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (!confirm(`Bạn có chắc muốn vô hiệu hóa vĩnh viễn tài khoản ${user.email}?`)) return;
    setUpdatingId(user.id);
    try {
      await api.delete(`/api/admin/users/${user.id}`);
      setUsers((current) => current.map((item) => (item.id === user.id ? { ...item, isActive: false } : item)));
      if (selectedUser?.id === user.id) setSelectedUser(prev => prev ? { ...prev, isActive: false } : null);
      toast.success('Đã vô hiệu hóa tài khoản');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không xóa được tài khoản');
    } finally {
      setUpdatingId(null);
      setShowActionMenu(false);
    }
  };

  const filteredUsers = users.filter((user) => {
    const haystack = `${user.displayName || ''} ${user.email} ${user.username || ''}`.toLowerCase();
    const matchesQuery = haystack.includes(query.trim().toLowerCase());
    
    let matchesFilter = true;
    if (filter === 'active') matchesFilter = user.isActive;
    if (filter === 'disabled') matchesFilter = !user.isActive;
    if (filter === 'admin') matchesFilter = user.systemRole === 'system-admin';

    return matchesQuery && matchesFilter;
  });

  const totalUsers = users.length;
  const activeUsers = users.filter((user) => user.isActive).length;
  const disabledUsers = totalUsers - activeUsers;
  const systemAdminUsers = users.filter((user) => user.systemRole === 'system-admin').length;

  const stats = [
    { label: 'Tổng người dùng', value: String(totalUsers), icon: <Users size={24} strokeWidth={2.5} />, color: 'blue' },
    { label: 'Đang hoạt động', value: String(activeUsers), icon: <UserCheck size={24} strokeWidth={2.5} />, color: 'green' },
    { label: 'Bị vô hiệu hóa', value: String(disabledUsers), icon: <UserMinus size={24} strokeWidth={2.5} />, color: 'red' },
    { label: 'System Admin', value: String(systemAdminUsers), icon: <Shield size={24} strokeWidth={2.5} />, color: 'purple' },
  ];

  return (
    <div className="relative min-h-screen">
      <div className={clsx("space-y-6 transition-all duration-300", selectedUser ? "pr-[400px]" : "")}>
        
        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => {
            const colorStyles = {
              blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
              green: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400',
              purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
              red: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
            }[s.color as 'blue' | 'green' | 'purple' | 'red'];

            const hoverStyles = {
              blue: 'group-hover:bg-blue-50/50 dark:group-hover:bg-blue-900/10',
              green: 'group-hover:bg-green-50/50 dark:group-hover:bg-green-900/10',
              purple: 'group-hover:bg-purple-50/50 dark:group-hover:bg-purple-900/10',
              red: 'group-hover:bg-red-50/50 dark:group-hover:bg-red-900/10',
            }[s.color as 'blue' | 'green' | 'purple' | 'red'];

            return (
              <div key={s.label} className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] transition-all hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] dark:border-slate-800 dark:bg-slate-900">
                <div className={clsx("absolute -right-4 -top-4 rounded-full p-8 transition-transform group-hover:scale-150", hoverStyles)}></div>
                <div className="relative flex items-center gap-4">
                  <div className={clsx('flex h-12 w-12 items-center justify-center rounded-2xl', colorStyles)}>
                    {s.icon}
                  </div>
                  <div>
                    <p className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">{s.value}</p>
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">{s.label}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Toolbar: Search + Filters */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm kiếm người dùng bằng tên, email, username..."
              className="w-full rounded-3xl border border-gray-200 bg-white/50 px-12 py-4 text-sm font-medium outline-none backdrop-blur-xl transition-all focus:border-primary-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(99,102,241,0.1)] dark:border-slate-800 dark:bg-slate-900/50 dark:focus:border-primary-500 dark:focus:bg-slate-900"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto rounded-3xl border border-gray-200 bg-white p-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {[
              { id: 'all', label: 'Tất cả' },
              { id: 'active', label: 'Hoạt động' },
              { id: 'disabled', label: 'Đã khóa' },
              { id: 'admin', label: 'Admins' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as FilterType)}
                className={clsx(
                  "rounded-2xl px-5 py-2.5 text-xs font-bold transition-all",
                  filter === f.id
                    ? "bg-gray-900 text-white dark:bg-slate-100 dark:text-gray-900 shadow-md"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm font-semibold text-red-500">{error}</p>}

        {/* Users Table */}
        <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-800">
            <h2 className="text-lg font-black text-gray-900 dark:text-slate-100">
              Danh sách Người dùng
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50/50 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:bg-slate-800/30">
                <tr>
                  <th className="px-6 py-4">Người dùng</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Tổ chức/Nhóm</th>
                  <th className="px-6 py-4">Trạng thái</th>
                  <th className="px-6 py-4 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
                        <span className="text-sm font-medium text-gray-500">Đang tải dữ liệu...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm font-medium text-gray-500">
                      Không có người dùng nào phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr 
                      key={user.id} 
                      onClick={() => setSelectedUser(user)}
                      className="group cursor-pointer bg-white transition-colors hover:bg-gray-50/80 dark:bg-slate-900 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 text-xs font-black uppercase text-indigo-700 dark:from-indigo-900/40 dark:to-purple-900/40 dark:text-indigo-400">
                            {user.avatarUrl ? (
                              <img src={user.avatarUrl} alt="Avatar" className="h-full w-full rounded-xl object-cover" />
                            ) : (
                              (user.displayName?.[0] || user.email?.[0] || 'U')
                            )}
                          </div>
                          <div>
                            <span className="block font-bold text-gray-900 dark:text-slate-100">
                              {user.displayName || user.username || 'No Name'}
                            </span>
                            <span className="block text-xs font-medium text-gray-500">{user.email}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {user.systemRole === 'system-admin' ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                            <Shield size={12} strokeWidth={2.5} /> System Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:bg-slate-800 dark:text-gray-400">
                            <UserIcon size={12} /> Member
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4 text-xs font-semibold text-gray-600 dark:text-slate-400">
                          <span className="flex items-center gap-1.5" title="Organizations">
                            <Building2 size={14} className="text-blue-500" /> {user.orgMemberships?.length || 0}
                          </span>
                          <span className="flex items-center gap-1.5" title="Groups">
                            <Layers size={14} className="text-green-500" /> {user.groupMemberships?.length || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={clsx(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest",
                          user.isActive
                            ? "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400"
                            : "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        )}>
                          {user.isActive ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-400 opacity-0 shadow-sm transition-all group-hover:opacity-100 dark:bg-slate-800">
                          <ChevronRight size={16} />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Slide-over Panel for User Details */}
      <div 
        className={clsx(
          "fixed bottom-0 right-0 top-0 z-40 w-[400px] transform bg-white/80 backdrop-blur-2xl transition-transform duration-300 ease-in-out dark:bg-slate-900/90",
          selectedUser ? "translate-x-0 border-l border-gray-200/50 shadow-2xl dark:border-slate-800/50" : "translate-x-full"
        )}
      >
        {selectedUser && (
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5 dark:border-slate-800">
              <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Hồ sơ Người dùng</h3>
              <div className="flex items-center gap-2">
                {/* Action Menu Trigger */}
                <div className="relative">
                  <button 
                    onClick={() => setShowActionMenu(!showActionMenu)}
                    className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  >
                    <MoreVertical size={20} />
                  </button>
                  {/* Action Menu Dropdown */}
                  {showActionMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowActionMenu(false)} />
                      <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
                        <div className="flex flex-col p-1">
                          <button
                            onClick={() => handleChangeRole(selectedUser)}
                            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <ShieldCheck size={16} className="text-purple-500" />
                            Đổi Role
                          </button>
                          <button
                            onClick={() => handleToggleStatus(selectedUser)}
                            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            {selectedUser.isActive ? (
                              <><UserMinus size={16} className="text-amber-500" /> Vô hiệu hóa</>
                            ) : (
                              <><UserCheck size={16} className="text-green-500" /> Kích hoạt lại</>
                            )}
                          </button>
                          <div className="my-1 h-px w-full bg-gray-100 dark:bg-slate-800"></div>
                          <button
                            onClick={() => handleDeleteUser(selectedUser)}
                            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm font-bold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                          >
                            <Trash2 size={16} /> Xóa tài khoản
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <button 
                  onClick={() => { setSelectedUser(null); setShowActionMenu(false); }}
                  className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-8 flex flex-col items-center text-center">
                <div className="mb-4 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 text-4xl font-black uppercase text-indigo-600 shadow-inner dark:from-indigo-900/40 dark:to-purple-900/40 dark:text-indigo-400">
                  {selectedUser.avatarUrl ? (
                    <img src={selectedUser.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    (selectedUser.displayName?.[0] || selectedUser.email?.[0] || 'U')
                  )}
                </div>
                <h2 className="text-2xl font-black text-gray-900 dark:text-slate-100">{selectedUser.displayName || selectedUser.username}</h2>
                <p className="font-medium text-gray-500">@{selectedUser.username}</p>
                
                <div className="mt-3 flex items-center gap-2">
                  <span className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider",
                    selectedUser.systemRole === 'system-admin' 
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  )}>
                    {selectedUser.systemRole === 'system-admin' ? <Shield size={12} strokeWidth={2.5} /> : <UserIcon size={12} strokeWidth={2.5} />}
                    {selectedUser.systemRole}
                  </span>

                  <span className={clsx(
                    "inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider",
                    selectedUser.isActive
                      ? "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400"
                      : "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                  )}>
                    {selectedUser.isActive ? 'Active' : 'Disabled'}
                  </span>
                </div>
              </div>

              <div className="space-y-6">
                {/* Contact Info */}
                <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30">
                  <h4 className="mb-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Thông tin cá nhân</h4>
                  <ul className="space-y-3 text-sm">
                    <li className="flex items-center gap-3">
                      <Mail size={16} className="text-gray-400" />
                      <span className="font-medium text-gray-900 dark:text-slate-100">{selectedUser.email}</span>
                    </li>
                    {selectedUser.phone && (
                      <li className="flex items-center gap-3">
                        <Phone size={16} className="text-gray-400" />
                        <span className="font-medium text-gray-900 dark:text-slate-100">{selectedUser.phone}</span>
                      </li>
                    )}
                    {selectedUser.dateOfBirth && (
                      <li className="flex items-center gap-3">
                        <Calendar size={16} className="text-gray-400" />
                        <span className="font-medium text-gray-900 dark:text-slate-100">
                          {new Date(selectedUser.dateOfBirth).toLocaleDateString('vi-VN')}
                        </span>
                      </li>
                    )}
                    <li className="flex items-center gap-3">
                      <Activity size={16} className="text-gray-400" />
                      <span className="font-medium text-gray-500">Tham gia: <span className="font-bold text-gray-900 dark:text-slate-100">{selectedUser.createdAt ? new Date(selectedUser.createdAt).toLocaleDateString('vi-VN') : '---'}</span></span>
                    </li>
                    <li className="flex items-center gap-3">
                      <Clock size={16} className="text-gray-400" />
                      <span className="font-medium text-gray-500">Lần cuối: <span className="font-bold text-gray-900 dark:text-slate-100">{selectedUser.lastLoginAt ? new Date(selectedUser.lastLoginAt).toLocaleDateString('vi-VN') : 'Chưa đăng nhập'}</span></span>
                    </li>
                  </ul>
                </div>

                {/* Memberships */}
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Thành viên tổ chức ({selectedUser.orgMemberships?.length || 0})</h4>
                  {selectedUser.orgMemberships && selectedUser.orgMemberships.length > 0 ? (
                    <div className="space-y-2">
                      {selectedUser.orgMemberships.map(org => (
                        <div key={org.orgId} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                              <Building2 size={14} />
                            </div>
                            <span className="font-bold text-gray-900 dark:text-slate-100">{org.orgName}</span>
                          </div>
                          <span className="rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:bg-slate-800 dark:text-gray-400">
                            {org.role}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-gray-500">Người dùng chưa tham gia tổ chức nào.</p>
                  )}
                </div>

                <div className="space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Thành viên nhóm ({selectedUser.groupMemberships?.length || 0})</h4>
                  {selectedUser.groupMemberships && selectedUser.groupMemberships.length > 0 ? (
                    <div className="space-y-2">
                      {selectedUser.groupMemberships.map(group => (
                        <div key={group.groupId} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                              <Layers size={14} />
                            </div>
                            <span className="font-bold text-gray-900 dark:text-slate-100">{group.groupName}</span>
                          </div>
                          <span className="rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:bg-slate-800 dark:text-gray-400">
                            {group.role}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-gray-500">Người dùng chưa tham gia nhóm nào.</p>
                  )}
                </div>

              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminUsers;
