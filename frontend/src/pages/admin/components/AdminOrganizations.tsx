import React from 'react';
import {
  Building2,
  CheckCircle2,
  Clock3,
  Search,
  ShieldCheck,
  XCircle,
  Ban,
  ChevronRight,
  X,
  Users,
  Video,
  Layers,
  Activity,
  User as UserIcon,
  Shield,
  Lock,
  Globe
} from 'lucide-react';
import { clsx } from 'clsx';
import api from '../../../services/api';
import { normalizeOrganization, normalizeUser, normalizeGroup } from '../../../services/mappers';
import { toast } from '../../../components/ui/Toast';
import type { Organization, User, Group } from '../../../types';

type TabType = 'overview' | 'members' | 'groups';

const AdminOrganizations: React.FC = () => {
  const [organizations, setOrganizations] = React.useState<Organization[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [error, setError] = React.useState('');
  const [actionId, setActionId] = React.useState<string | null>(null);
  
  // Selected Org for Slide-over
  const [selectedOrg, setSelectedOrg] = React.useState<Organization | null>(null);
  
  // Tabs & Drill-down data
  const [activeTab, setActiveTab] = React.useState<TabType>('overview');
  const [orgMembers, setOrgMembers] = React.useState<User[]>([]);
  const [orgGroups, setOrgGroups] = React.useState<Group[]>([]);
  const [isLoadingTabs, setIsLoadingTabs] = React.useState(false);

  const loadOrganizations = React.useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      // System admin gets the dedicated admin endpoint which supports filtering
      // by approval_status (pending/active/rejected/suspended/all).
      const response = await api.get('/api/admin/organizations');
      setOrganizations(
        Array.isArray(response.data) ? response.data.map(normalizeOrganization) : [],
      );
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Không tải được danh sách tổ chức.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadOrganizations();
  }, [loadOrganizations]);

  // Fetch detailed data when org changes
  React.useEffect(() => {
    if (!selectedOrg) {
      setActiveTab('overview');
      setOrgMembers([]);
      setOrgGroups([]);
      return;
    }

    const fetchOrgDetails = async () => {
      setIsLoadingTabs(true);
      try {
        const [membersRes, groupsRes] = await Promise.allSettled([
          api.get(`/api/organizations/${selectedOrg.id}/members`),
          api.get(`/api/groups`, { params: { org_id: selectedOrg.id } })
        ]);

        if (membersRes.status === 'fulfilled') {
          setOrgMembers(Array.isArray(membersRes.value.data) ? membersRes.value.data.map(normalizeUser) : []);
        }
        if (groupsRes.status === 'fulfilled') {
          setOrgGroups(Array.isArray(groupsRes.value.data) ? groupsRes.value.data.map(normalizeGroup) : []);
        }
      } catch (err) {
        console.error("Lỗi khi fetch data chi tiết", err);
      } finally {
        setIsLoadingTabs(false);
      }
    };

    fetchOrgDetails();
  }, [selectedOrg?.id]);

  const handleApprove = async (organizationId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActionId(organizationId);
    setError('');
    try {
      const response = await api.post(`/api/admin/organizations/${organizationId}/approve`);
      const approvedOrganization = normalizeOrganization(response.data);
      setOrganizations((current) =>
        current.map((organization) =>
          organization.id === approvedOrganization.id ? approvedOrganization : organization,
        ),
      );
      if (selectedOrg?.id === organizationId) {
        setSelectedOrg(approvedOrganization);
      }
      toast.success('Đã phê duyệt tổ chức');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Không phê duyệt được tổ chức.');
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (organizationId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm('Bạn có chắc muốn từ chối tổ chức này?')) return;
    setActionId(organizationId);
    try {
      await api.post(`/api/admin/organizations/${organizationId}/reject`);
      setOrganizations((current) =>
        current.map((org) =>
          org.id === organizationId ? { ...org, approvalStatus: 'rejected' } : org,
        ),
      );
      if (selectedOrg?.id === organizationId) {
        setSelectedOrg(prev => prev ? { ...prev, approvalStatus: 'rejected' } : null);
      }
      toast.success('Đã từ chối tổ chức');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Không từ chối được tổ chức.');
    } finally {
      setActionId(null);
    }
  };

  const handleSuspend = async (organizationId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm('Bạn có chắc muốn tạm ngưng tổ chức này?')) return;
    setActionId(organizationId);
    try {
      await api.post(`/api/admin/organizations/${organizationId}/suspend`);
      setOrganizations((current) =>
        current.map((org) =>
          org.id === organizationId ? { ...org, approvalStatus: 'suspended' } : org,
        ),
      );
      if (selectedOrg?.id === organizationId) {
        setSelectedOrg(prev => prev ? { ...prev, approvalStatus: 'suspended' } : null);
      }
      toast.success('Đã tạm ngưng tổ chức');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Không tạm ngưng được tổ chức.');
    } finally {
      setActionId(null);
    }
  };

  const filteredOrganizations = organizations.filter((organization) => {
    const haystack = `${organization.name} ${organization.description || ''} ${organization.domain || ''}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  const pendingOrganizations = filteredOrganizations.filter(
    (organization) => organization.approvalStatus === 'pending',
  );
  const approvedOrganizations = filteredOrganizations.filter(
    (organization) => organization.approvalStatus !== 'pending',
  );

  return (
    <div className="relative min-h-screen">
      <div className={clsx("space-y-6 transition-all duration-300", selectedOrg ? "pr-[440px]" : "")}>
        
        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] transition-all hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] dark:border-slate-800 dark:bg-slate-900">
            <div className="absolute -right-4 -top-4 rounded-full bg-blue-50/50 p-8 transition-transform group-hover:scale-150 dark:bg-blue-900/10"></div>
            <div className="relative flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                <Building2 size={24} strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">
                  {organizations.length}
                </p>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                  Tổng tổ chức
                </p>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] transition-all hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] dark:border-slate-800 dark:bg-slate-900">
            <div className="absolute -right-4 -top-4 rounded-full bg-amber-50/50 p-8 transition-transform group-hover:scale-150 dark:bg-amber-900/10"></div>
            <div className="relative flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                <Clock3 size={24} strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">
                  {pendingOrganizations.length}
                </p>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                  Chờ duyệt
                </p>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] transition-all hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] dark:border-slate-800 dark:bg-slate-900">
            <div className="absolute -right-4 -top-4 rounded-full bg-green-50/50 p-8 transition-transform group-hover:scale-150 dark:bg-green-900/10"></div>
            <div className="relative flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                <CheckCircle2 size={24} strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">
                  {organizations.filter((organization) => organization.approvalStatus === 'active').length}
                </p>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                  Đã kích hoạt
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm kiếm tổ chức theo tên, mô tả hoặc domain..."
            className="w-full rounded-3xl border border-gray-200 bg-white/50 px-12 py-4 text-sm font-medium outline-none backdrop-blur-xl transition-all focus:border-primary-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(99,102,241,0.1)] dark:border-slate-800 dark:bg-slate-900/50 dark:focus:border-primary-500 dark:focus:bg-slate-900"
          />
        </div>
        {error && <p className="text-sm font-semibold text-red-500">{error}</p>}

        {/* Pending Approval Section */}
        {pendingOrganizations.length > 0 && (
          <div className="overflow-hidden rounded-3xl border border-amber-200/60 bg-gradient-to-br from-amber-50 to-orange-50/30 p-1 dark:border-amber-900/40 dark:from-amber-950/20 dark:to-orange-950/10">
            <div className="rounded-[22px] bg-white/60 p-5 backdrop-blur-xl dark:bg-slate-900/60">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
                  <Clock3 size={20} strokeWidth={2.5} />
                </div>
                <div>
                  <h2 className="text-lg font-black text-gray-900 dark:text-slate-100">
                    Cần phê duyệt ({pendingOrganizations.length})
                  </h2>
                  <p className="text-xs font-medium text-amber-700/70 dark:text-amber-400/70">
                    Tổ chức mới đang chờ bạn xem xét để kích hoạt.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pendingOrganizations.map((organization) => (
                  <div
                    key={organization.id}
                    onClick={() => setSelectedOrg(organization)}
                    className="group relative cursor-pointer overflow-hidden rounded-2xl border border-amber-200/50 bg-white p-4 shadow-sm transition-all hover:border-amber-300 hover:shadow-md dark:border-amber-900/30 dark:bg-slate-800/80"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 text-amber-700 dark:from-amber-900/40 dark:to-orange-900/40 dark:text-amber-400">
                        {organization.logoUrl ? (
                          <img src={organization.logoUrl} alt="Logo" className="h-full w-full rounded-xl object-cover" />
                        ) : (
                          <Building2 size={20} />
                        )}
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <h3 className="truncate text-base font-bold text-gray-900 dark:text-slate-100">
                          {organization.name}
                        </h3>
                        <p className="truncate text-xs font-medium text-gray-500">
                          {organization.domain || 'Không có domain'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => handleApprove(organization.id, e)}
                        disabled={actionId === organization.id}
                        className="flex-1 rounded-xl bg-amber-500 py-2.5 text-xs font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
                      >
                        {actionId === organization.id ? '...' : 'Phê duyệt'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleReject(organization.id, e)}
                        disabled={actionId === organization.id}
                        className="flex h-[36px] w-[36px] items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
                      >
                        <XCircle size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* All Organizations Table */}
        <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-800">
            <h2 className="text-lg font-black text-gray-900 dark:text-slate-100">
              Danh sách Tổ chức
            </h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50/50 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:bg-slate-800/30">
                <tr>
                  <th className="px-6 py-4">Tổ chức</th>
                  <th className="px-6 py-4">Tài nguyên</th>
                  <th className="px-6 py-4">Ngày duyệt</th>
                  <th className="px-6 py-4">Trạng thái</th>
                  <th className="px-6 py-4 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
                        <span className="text-sm font-medium text-gray-500">Đang tải dữ liệu...</span>
                      </div>
                    </td>
                  </tr>
                ) : approvedOrganizations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm font-medium text-gray-500">
                      Không có tổ chức nào.
                    </td>
                  </tr>
                ) : (
                  approvedOrganizations.map((organization) => (
                    <tr 
                      key={organization.id}
                      onClick={() => setSelectedOrg(organization)}
                      className="group cursor-pointer bg-white transition-colors hover:bg-gray-50/80 dark:bg-slate-900 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                            {organization.logoUrl ? (
                              <img src={organization.logoUrl} alt="Logo" className="h-full w-full rounded-xl object-cover" />
                            ) : (
                              <Building2 size={20} />
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-slate-100">{organization.name}</p>
                            <p className="text-xs font-medium text-gray-500">{organization.domain || '---'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4 text-xs font-semibold text-gray-600 dark:text-slate-400">
                          <span className="flex items-center gap-1.5" title="Members">
                            <Users size={14} className="text-blue-500" /> {organization.memberCount}
                          </span>
                          <span className="flex items-center gap-1.5" title="Meetings">
                            <Video size={14} className="text-green-500" /> {organization.meetingCount}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs font-medium text-gray-500 dark:text-slate-400">
                        {organization.approvedAt
                          ? new Date(organization.approvedAt).toLocaleDateString('vi-VN')
                          : '--'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={clsx(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
                          organization.approvalStatus === 'suspended'
                            ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                            : organization.approvalStatus === 'rejected'
                            ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                            : "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400"
                        )}>
                          {organization.approvalStatus === 'suspended' && <Ban size={10} />}
                          {organization.approvalStatus === 'rejected' && <XCircle size={10} />}
                          {organization.approvalStatus === 'active' && <CheckCircle2 size={10} />}
                          {organization.approvalStatus}
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

      {/* Slide-over Panel for Organization Details & Deep Dive */}
      <div 
        className={clsx(
          "fixed bottom-0 right-0 top-0 z-40 w-[440px] transform bg-white/80 backdrop-blur-2xl transition-transform duration-300 ease-in-out dark:bg-slate-900/90",
          selectedOrg ? "translate-x-0 border-l border-gray-200/50 shadow-2xl dark:border-slate-800/50" : "translate-x-full"
        )}
      >
        {selectedOrg && (
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Chi tiết Tổ chức</h3>
              <button 
                onClick={() => setSelectedOrg(null)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-100 px-6 dark:border-slate-800">
              <div className="flex gap-6">
                {[
                  { id: 'overview', label: 'Tổng quan' },
                  { id: 'members', label: `Thành viên (${orgMembers.length})` },
                  { id: 'groups', label: `Nhóm (${orgGroups.length})` }
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id as TabType)}
                    className={clsx(
                      "relative pb-3 text-sm font-bold transition-colors",
                      activeTab === t.id 
                        ? "text-primary-600 dark:text-primary-400" 
                        : "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
                    )}
                  >
                    {t.label}
                    {activeTab === t.id && (
                      <span className="absolute bottom-0 left-0 h-0.5 w-full bg-primary-600 dark:bg-primary-400 rounded-t-md" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Body content based on active tab */}
            <div className="flex-1 overflow-y-auto p-6">
              {isLoadingTabs ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
                </div>
              ) : (
                <>
                  {activeTab === 'overview' && (
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="mb-8 flex flex-col items-center text-center">
                        <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-50 to-indigo-50 text-primary-600 shadow-inner dark:from-primary-900/40 dark:to-indigo-900/40 dark:text-primary-400">
                          {selectedOrg.logoUrl ? (
                            <img src={selectedOrg.logoUrl} alt="Logo" className="h-full w-full rounded-3xl object-cover" />
                          ) : (
                            <Building2 size={40} strokeWidth={2} />
                          )}
                        </div>
                        <h2 className="text-2xl font-black text-gray-900 dark:text-slate-100">{selectedOrg.name}</h2>
                        <span className={clsx(
                          "mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider",
                          selectedOrg.approvalStatus === 'suspended' ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                            : selectedOrg.approvalStatus === 'pending' ? "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
                            : selectedOrg.approvalStatus === 'rejected' ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                            : "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400"
                        )}>
                          {selectedOrg.approvalStatus}
                        </span>
                      </div>

                      <div className="space-y-6">
                        {/* Info Card */}
                        <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30">
                          <h4 className="mb-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Thông tin chung</h4>
                          <dl className="space-y-3 text-sm">
                            <div className="flex justify-between">
                              <dt className="font-medium text-gray-500">Domain</dt>
                              <dd className="font-bold text-gray-900 dark:text-slate-100">{selectedOrg.domain || '---'}</dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="font-medium text-gray-500">Mô tả</dt>
                              <dd className="max-w-[200px] truncate font-medium text-gray-900 dark:text-slate-100" title={selectedOrg.description}>
                                {selectedOrg.description || 'Không có mô tả'}
                              </dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="font-medium text-gray-500">Ngày tạo</dt>
                              <dd className="font-medium text-gray-900 dark:text-slate-100">
                                {new Date(selectedOrg.createdAt).toLocaleDateString('vi-VN')}
                              </dd>
                            </div>
                            {selectedOrg.approvedAt && (
                              <div className="flex justify-between">
                                <dt className="font-medium text-gray-500">Ngày duyệt</dt>
                                <dd className="font-medium text-gray-900 dark:text-slate-100">
                                  {new Date(selectedOrg.approvedAt).toLocaleDateString('vi-VN')}
                                </dd>
                              </div>
                            )}
                          </dl>
                        </div>

                        {/* Stats Grid */}
                        <div>
                          <h4 className="mb-3 text-[10px] font-black uppercase tracking-widest text-gray-400">Tài nguyên & Sử dụng</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                              <div className="flex items-center gap-2 text-blue-500">
                                <Users size={16} /> <span className="text-[10px] font-bold uppercase tracking-widest">Thành viên</span>
                              </div>
                              <span className="text-2xl font-black text-gray-900 dark:text-slate-100">{selectedOrg.memberCount}</span>
                            </div>
                            <div className="flex flex-col gap-1 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                              <div className="flex items-center gap-2 text-purple-500">
                                <Layers size={16} /> <span className="text-[10px] font-bold uppercase tracking-widest">Nhóm</span>
                              </div>
                              <span className="text-2xl font-black text-gray-900 dark:text-slate-100">{selectedOrg.groupCount}</span>
                            </div>
                            <div className="flex flex-col gap-1 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                              <div className="flex items-center gap-2 text-green-500">
                                <Video size={16} /> <span className="text-[10px] font-bold uppercase tracking-widest">Cuộc họp</span>
                              </div>
                              <span className="text-2xl font-black text-gray-900 dark:text-slate-100">{selectedOrg.meetingCount}</span>
                            </div>
                            <div className="flex flex-col gap-1 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                              <div className="flex items-center gap-2 text-amber-500">
                                <Activity size={16} /> <span className="text-[10px] font-bold uppercase tracking-widest">Giờ họp</span>
                              </div>
                              <span className="text-2xl font-black text-gray-900 dark:text-slate-100">{selectedOrg.totalHours.toFixed(1)}h</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'members' && (
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                      {orgMembers.length === 0 ? (
                        <p className="text-center text-sm font-medium text-gray-500 py-10">Không có thành viên nào.</p>
                      ) : (
                        <div className="space-y-3">
                          {orgMembers.map(member => {
                            // Find their specific role in this org
                            const membership = member.orgMemberships?.find(m => m.orgId === selectedOrg.id);
                            const role = membership?.role || 'member';
                            
                            return (
                              <div key={member.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 text-xs font-black uppercase text-gray-600 dark:from-gray-800 dark:to-gray-700 dark:text-gray-300">
                                  {member.avatarUrl ? (
                                    <img src={member.avatarUrl} alt="Avatar" className="h-full w-full rounded-xl object-cover" />
                                  ) : (
                                    (member.displayName?.[0] || member.email?.[0] || 'U')
                                  )}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                  <p className="truncate font-bold text-gray-900 dark:text-slate-100">{member.displayName || member.username}</p>
                                  <p className="truncate text-xs font-medium text-gray-500">{member.email}</p>
                                </div>
                                <div className="shrink-0">
                                  {(role as string) === 'org-admin' || (role as string) === 'owner' ? (
                                    <span className="inline-flex items-center gap-1 rounded-lg bg-purple-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                                      <Shield size={12} strokeWidth={2.5} /> Admin
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:bg-slate-800 dark:text-gray-400">
                                      <UserIcon size={12} /> Member
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'groups' && (
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                      {orgGroups.length === 0 ? (
                        <p className="text-center text-sm font-medium text-gray-500 py-10">Tổ chức này chưa có nhóm nào.</p>
                      ) : (
                        <div className="space-y-3">
                          {orgGroups.map(group => (
                            <div key={group.id} className="flex flex-col gap-2 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                                    <Layers size={18} />
                                  </div>
                                  <div>
                                    <p className="font-bold text-gray-900 dark:text-slate-100">{group.name}</p>
                                    <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                                      <span className="flex items-center gap-1"><Users size={12} /> {group.memberCount} thành viên</span>
                                      <span>•</span>
                                      <span className="flex items-center gap-1"><Video size={12} /> {group.meetingCount} cuộc họp</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <span className={clsx(
                                  "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-widest",
                                  group.privacyLevel === 'public' 
                                    ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                    : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-400"
                                )}>
                                  {group.privacyLevel === 'public' ? <Globe size={12} /> : <Lock size={12} />}
                                  {group.privacyLevel}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer Actions (Only show for Overview to not clutter) */}
            {activeTab === 'overview' && (
              <div className="border-t border-gray-100 bg-gray-50/50 p-6 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex gap-3">
                  {selectedOrg.approvalStatus === 'pending' && (
                    <>
                      <button
                        onClick={() => handleApprove(selectedOrg.id)}
                        disabled={actionId === selectedOrg.id}
                        className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-bold text-white transition hover:bg-amber-600 disabled:opacity-50"
                      >
                        {actionId === selectedOrg.id ? '...' : 'Phê duyệt'}
                      </button>
                      <button
                        onClick={() => handleReject(selectedOrg.id)}
                        disabled={actionId === selectedOrg.id}
                        className="flex-1 rounded-xl border border-red-200 bg-white py-3 text-sm font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"
                      >
                        Từ chối
                      </button>
                    </>
                  )}

                  {selectedOrg.approvalStatus === 'active' && (
                    <button
                      onClick={() => handleSuspend(selectedOrg.id)}
                      disabled={actionId === selectedOrg.id}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 py-3 text-sm font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/30 dark:bg-amber-900/20 dark:text-amber-400"
                    >
                      <Ban size={16} />
                      Tạm ngưng hoạt động
                    </button>
                  )}
                  
                  {selectedOrg.approvalStatus === 'suspended' && (
                    <button
                      onClick={() => handleApprove(selectedOrg.id)}
                      disabled={actionId === selectedOrg.id}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 py-3 text-sm font-bold text-white transition hover:bg-green-600 disabled:opacity-50"
                    >
                      <CheckCircle2 size={16} />
                      Kích hoạt lại
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};

export default AdminOrganizations;
