import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  Calendar,
  Camera,
  Check,
  Edit,
  Eye,
  EyeOff,
  Globe,
  LogOut,
  Mail,
  Shield,
  Upload,
  User,
  X,
} from 'lucide-react';

import { useAuth } from '../../../context/AuthContext';
import { useOrgStore } from '../../../stores';
import api from '../../../services/api';
import type { Organization } from '../../../types';

type ProfileTab = 'profile' | 'organizations' | 'notifications' | 'security';

const roleLabelMap: Record<string, string> = {
  'system-admin': 'Quản trị hệ thống',
  'org-admin': 'Quản trị tổ chức',
  'group-admin': 'Quản trị nhóm',
  member: 'Thành viên',
  viewer: 'Chỉ xem',
};

const initialsFor = (value?: string) =>
  (value || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

const Profile: React.FC = () => {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { orgs, setCurrentOrg } = useOrgStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<ProfileTab>('profile');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [avatarMsg, setAvatarMsg] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [language, setLanguage] = useState(user?.language || 'vi');
  const [timezone, setTimezone] = useState(user?.timezone || 'Asia/Ho_Chi_Minh');

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPass, setShowOldPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [notifPrefs, setNotifPrefs] = useState({
    meetingSummaries: user?.notificationPreferences?.meetingSummaries ?? true,
    groupAnnouncements: user?.notificationPreferences?.groupAnnouncements ?? true,
    slackIntegration: user?.notificationPreferences?.slackIntegration ?? false,
  });
  const [notifSaving, setNotifSaving] = useState(false);

  const tabs: Array<{ key: ProfileTab; label: string; icon: React.ReactNode }> = [
    { key: 'profile', label: 'Cá nhân', icon: <User size={16} /> },
    { key: 'organizations', label: 'Tổ chức', icon: <Building2 size={16} /> },
    { key: 'notifications', label: 'Thông báo', icon: <Bell size={16} /> },
    { key: 'security', label: 'Bảo mật', icon: <Shield size={16} /> },
  ];

  const userOrgs: Array<{ org: Organization; role: string }> = useMemo(() => {
    if (!user?.orgMemberships) return [];
    return user.orgMemberships
      .map((membership) => ({
        org: orgs.find((o) => o.id === membership.orgId),
        role: membership.role,
      }))
      .filter((item) => Boolean(item.org)) as Array<{ org: Organization; role: string }>;
  }, [orgs, user]);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
    setBio(user?.bio || '');
    setLanguage(user?.language || 'vi');
    setTimezone(user?.timezone || 'Asia/Ho_Chi_Minh');
  }, [user?.bio, user?.displayName, user?.language, user?.timezone]);

  const resetProfileDraft = () => {
    setDisplayName(user?.displayName || '');
    setBio(user?.bio || '');
    setLanguage(user?.language || 'vi');
    setTimezone(user?.timezone || 'Asia/Ho_Chi_Minh');
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMsg('');
    try {
      const [firstName, ...rest] = displayName.trim().split(' ');
      await api.patch('/api/profile', {
        first_name: firstName || '',
        last_name: rest.join(' ') || '',
        bio: bio.trim() || null,
        language,
        timezone,
      });
      await refreshUser();
      setSaveMsg('Đã lưu hồ sơ thành công.');
      setIsEditing(false);
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err: any) {
      setSaveMsg(err?.response?.data?.detail || 'Không thể lưu hồ sơ.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarPick = () => fileInputRef.current?.click();

  const handleAvatarSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);
    setAvatarUploading(true);
    setAvatarMsg('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post('/api/profile/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await refreshUser();
      setAvatarMsg('Đã cập nhật ảnh đại diện.');
    } catch (err: any) {
      setAvatarMsg(err?.response?.data?.detail || 'Không tải được ảnh đại diện.');
      setAvatarPreview(null);
    } finally {
      setAvatarUploading(false);
      event.target.value = '';
      setTimeout(() => setAvatarMsg(''), 3000);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      setPasswordMsg('Vui lòng nhập đầy đủ thông tin.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg('Mật khẩu mới không khớp.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg('Mật khẩu mới phải ít nhất 6 ký tự.');
      return;
    }
    setPasswordLoading(true);
    setPasswordMsg('');
    try {
      await api.post('/api/profile/change-password', {
        old_password: oldPassword,
        new_password: newPassword,
      });
      setPasswordMsg('Đổi mật khẩu thành công.');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordMsg('');
      }, 1500);
    } catch (err: any) {
      setPasswordMsg(err?.response?.data?.detail || 'Đổi mật khẩu thất bại.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleNotifPrefChange = async (key: string, value: boolean) => {
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    setNotifSaving(true);
    try {
      await api.patch('/api/profile', { notification_preferences: updated });
    } catch {
      setNotifPrefs((prev) => ({ ...prev, [key]: !value }));
    } finally {
      setNotifSaving(false);
    }
  };

  const displayAvatar = avatarPreview || user?.avatarUrl;

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="bg-gradient-to-r from-primary-50 via-white to-blue-50 px-6 py-8 dark:from-primary-950/20 dark:via-slate-900 dark:to-blue-950/20">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="flex items-start gap-5">
              <div className="relative">
                {displayAvatar ? (
                  <img
                    src={displayAvatar}
                    alt={user?.displayName || user?.email || 'Avatar'}
                    className="h-24 w-24 rounded-full border-4 border-white object-cover shadow-lg dark:border-slate-800"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-white bg-primary-100 text-3xl font-black text-primary-700 shadow-lg dark:border-slate-800 dark:bg-primary-900/40 dark:text-primary-200">
                    {initialsFor(user?.displayName || user?.email)}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleAvatarPick}
                  className="absolute -bottom-1 -right-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white shadow-lg transition hover:bg-primary-600"
                  title="Đổi ảnh đại diện"
                >
                  <Camera size={16} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleAvatarSelected}
                  className="hidden"
                />
              </div>

              <div className="space-y-2">
                <div>
                  <h1 className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">
                    {user?.displayName || user?.email}
                  </h1>
                  <p className="mt-1 text-sm font-medium text-gray-600 dark:text-slate-300">{user?.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                    {roleLabelMap[user?.systemRole || 'member'] || 'Thành viên'}
                  </span>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-600 dark:bg-slate-800 dark:text-slate-300">
                    Tham gia từ {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('vi-VN') : 'N/A'}
                  </span>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-gray-600 dark:text-slate-300">
                  {user?.bio || 'Thêm một bio ngắn để mọi người hiểu hơn về vai trò và cách bạn làm việc trong hệ thống.'}
                </p>
                {avatarMsg && (
                  <p className={`text-xs font-bold ${avatarMsg.includes('Đã') ? 'text-emerald-600' : 'text-red-600'}`}>
                    {avatarUploading ? 'Đang tải ảnh đại diện...' : avatarMsg}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleAvatarPick}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Upload size={16} />
                {avatarUploading ? 'Đang tải ảnh...' : 'Đổi ảnh đại diện'}
              </button>
              <button
                type="button"
                onClick={() => setIsEditing((current) => !current)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-700"
              >
                <Edit size={16} />
                {isEditing ? 'Đang chỉnh sửa' : 'Chỉnh sửa hồ sơ'}
              </button>
            </div>
          </div>
        </div>
      </motion.section>

      <div className="rounded-3xl border border-gray-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap border-b border-gray-100 px-2 dark:border-slate-800">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
                activeTab === tab.key
                  ? 'border-primary-600 text-primary-600 dark:border-primary-300 dark:text-primary-300'
                  : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Thông tin cá nhân</h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Cập nhật tên hiển thị, bio và tuỳ chọn hiển thị cơ bản của bạn.</p>
                </div>
                <div className="flex items-center gap-2">
                  {saveMsg && (
                    <span className={`text-sm font-semibold ${saveMsg.includes('thành công') ? 'text-emerald-600' : 'text-red-600'}`}>
                      {saveMsg}
                    </span>
                  )}
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => {
                          setIsEditing(false);
                          resetProfileDraft();
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <X size={14} />
                        Hủy
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
                      >
                        <Check size={14} />
                        {isSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-200">
                    <User size={14} className="mr-1 inline" />
                    Tên hiển thị
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    disabled={!isEditing}
                    className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-primary-900/30 dark:disabled:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-200">
                    <Mail size={14} className="mr-1 inline" />
                    Email
                  </label>
                  <input
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-200">Bio ngắn</label>
                  <textarea
                    rows={4}
                    maxLength={220}
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                    disabled={!isEditing}
                    placeholder="Ví dụ: Phụ trách vận hành, tối ưu quy trình họp và theo dõi action items xuyên nhóm."
                    className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-primary-900/30 dark:disabled:bg-slate-900"
                  />
                  <p className="mt-1 text-right text-xs text-gray-400">{bio.length}/220</p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-200">
                    <Globe size={14} className="mr-1 inline" />
                    Ngôn ngữ
                  </label>
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    disabled={!isEditing}
                    className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-primary-900/30 dark:disabled:bg-slate-900"
                  >
                    <option value="vi">Tiếng Việt</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-200">
                    <Calendar size={14} className="mr-1 inline" />
                    Múi giờ
                  </label>
                  <select
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    disabled={!isEditing}
                    className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-primary-900/30 dark:disabled:bg-slate-900"
                  >
                    <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC+7)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'organizations' && (
            <div className="space-y-4">
              <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Tổ chức của tôi ({userOrgs.length})</h3>
              {userOrgs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-slate-700">
                  <Building2 size={32} className="mx-auto mb-3 text-gray-400" />
                  <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">Bạn chưa tham gia tổ chức nào.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {userOrgs.map(({ org, role }) => (
                    <div key={org.id} className="rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-slate-600">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/40">
                            <Building2 size={20} className="text-primary-600 dark:text-primary-300" />
                          </div>
                          <div>
                            <h4 className="text-base font-bold text-gray-900 dark:text-slate-100">{org.name}</h4>
                            <p className="text-sm text-gray-600 dark:text-slate-300">{org.description}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                                {roleLabelMap[role] || role}
                              </span>
                              <span>{org.memberCount} thành viên</span>
                              <span>{org.groupCount} nhóm</span>
                              <span>{org.meetingCount} cuộc họp</span>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setCurrentOrg(org.id);
                            navigate('/dashboard');
                          }}
                          className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-700"
                        >
                          Chuyển sang tổ chức
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Tuỳ chọn thông báo</h3>
                {notifSaving && <span className="text-sm text-gray-500">Đang lưu...</span>}
              </div>
              <div className="space-y-3">
                {[
                  { key: 'meetingSummaries', label: 'Tóm tắt cuộc họp', desc: 'Nhận bản tổng hợp do AI tạo sau mỗi cuộc họp.' },
                  { key: 'groupAnnouncements', label: 'Thông báo nhóm', desc: 'Nhận cập nhật quan trọng từ các nhóm bạn tham gia.' },
                  { key: 'slackIntegration', label: 'Tích hợp Slack', desc: 'Đồng bộ thông báo chính sang Slack nếu đã kết nối.' },
                ].map((pref) => (
                  <div key={pref.key} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{pref.label}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{pref.desc}</p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={notifPrefs[pref.key as keyof typeof notifPrefs]}
                        onChange={(e) => handleNotifPrefChange(pref.key, e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:ring-2 peer-focus:ring-primary-100 dark:bg-slate-700 dark:peer-focus:ring-primary-900"></div>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Bảo mật tài khoản</h3>
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/50">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Đổi mật khẩu</h4>
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Cập nhật mật khẩu để bảo vệ tài khoản của bạn.</p>
                  <button
                    onClick={() => setShowPasswordModal(true)}
                    className="mt-3 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700"
                  >
                    Đổi mật khẩu
                  </button>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/50">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Xác thực hai lớp (2FA)</h4>
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Tính năng này sẽ được bổ sung trong bước nâng cấp bảo mật tiếp theo.</p>
                  <button className="mt-3 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                    Bật 2FA
                  </button>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleLogout}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30"
                  >
                    <LogOut size={14} />
                    Đăng xuất
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">Đổi mật khẩu</h3>
              <button onClick={() => { setShowPasswordModal(false); setPasswordMsg(''); }} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-slate-200">Mật khẩu cũ</label>
                <div className="relative">
                  <input type={showOldPass ? 'text' : 'password'} value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} className="w-full rounded-lg border border-gray-200 px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-800" />
                  <button type="button" onClick={() => setShowOldPass(!showOldPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showOldPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-slate-200">Mật khẩu mới</label>
                <div className="relative">
                  <input type={showNewPass ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded-lg border border-gray-200 px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-800" />
                  <button type="button" onClick={() => setShowNewPass(!showNewPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showNewPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700 dark:text-slate-200">Xác nhận mật khẩu mới</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-slate-700 dark:bg-slate-800" />
              </div>
              {passwordMsg && <p className={`text-sm ${passwordMsg.includes('thành công') ? 'text-green-600' : 'text-red-600'}`}>{passwordMsg}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => { setShowPasswordModal(false); setPasswordMsg(''); }} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  Hủy
                </button>
                <button onClick={handleChangePassword} disabled={passwordLoading} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                  {passwordLoading ? 'Đang đổi...' : 'Đổi mật khẩu'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Profile;
