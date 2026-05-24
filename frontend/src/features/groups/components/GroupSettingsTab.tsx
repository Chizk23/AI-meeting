/**
 * GroupSettingsTab - Tab cài đặt nâng cao và Bảo mật Nhóm
 * Thiết kế giao diện Premium UI/UX bởi Chuyên gia Đồ họa & Tương tác
 */
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Save,
  RotateCcw,
  AlertTriangle,
  Lock,
  Building2,
  Globe,
  Users,
  FileText,
  Bell,
  Trash2,
  ShieldAlert,
  ArrowLeftRight,
  Archive,
  ShieldCheck,
  Key,
  EyeOff,
  UserCheck,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useGroupStore } from '../../../stores';
import type { PrivacyLevel } from '../../../types';
import { Button, Badge, Card, Input, FloatingSaveBar } from '../../../components/ui';
import { toast } from '../../../components/ui/Toast';
import api from '../../../services/api';

interface GroupSettingsTabProps {
  groupId: string;
}

const GroupSettingsTab: React.FC<GroupSettingsTabProps> = ({ groupId }) => {
  const navigate = useNavigate();
  const { group, updateGroup } = useGroupStore();
  const groupSettings = (group?.settings ?? {}) as Record<string, boolean | undefined>;
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: group?.name || '',
    description: group?.description || '',
    privacyLevel: group?.privacyLevel || ('internal' as PrivacyLevel),
    allowCreateMeetings: groupSettings.allowCreateMeetings ?? true,
    autoSummarize: groupSettings.autoSummarize ?? true,
    requireApproval: groupSettings.requireApproval ?? false,
    notifications: groupSettings.notifications ?? true,
    encryptData: groupSettings.encryptData ?? true,
  });
  const [initialData, setInitialData] = useState(formData);

  useEffect(() => {
    if (group) {
      const data = {
        name: group.name || '',
        description: group.description || '',
        privacyLevel: group.privacyLevel || ('internal' as PrivacyLevel),
        allowCreateMeetings:
          (group.settings as Record<string, boolean | undefined> | undefined)?.allowCreateMeetings ?? true,
        autoSummarize:
          (group.settings as Record<string, boolean | undefined> | undefined)?.autoSummarize ?? true,
        requireApproval:
          (group.settings as Record<string, boolean | undefined> | undefined)?.requireApproval ?? false,
        notifications:
          (group.settings as Record<string, boolean | undefined> | undefined)?.notifications ?? true,
        encryptData:
          (group.settings as Record<string, boolean | undefined> | undefined)?.encryptData ?? true,
      };
      setFormData(data);
      setInitialData(data);
    }
  }, [group]);

  const isDirty = JSON.stringify(formData) !== JSON.stringify(initialData);

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateGroup(groupId, {
        name: formData.name,
        description: formData.description,
        privacyLevel: formData.privacyLevel,
        settings: {
          allowCreateMeetings: formData.allowCreateMeetings,
          autoSummarize: formData.autoSummarize,
          requireApproval: formData.requireApproval,
          notifications: formData.notifications,
          encryptData: formData.encryptData,
        },
      });
      setInitialData(formData);
      toast.success('Đã cập nhật cấu hình bảo mật thành công!');
    } catch (error) {
      toast.error('Có lỗi xảy ra khi cập nhật cấu hình.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchiveGroup = async () => {
    try {
      await updateGroup(groupId, {
        settings: {
          ...(group?.settings || {}),
          archived: true,
          archivedAt: new Date().toISOString(),
        } as any,
      });
      toast.success('Đã lưu trữ nhóm.');
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể lưu trữ nhóm.');
    }
  };

  const handleDeleteGroup = async () => {
    if (!window.confirm('Bạn chắc chắn muốn xóa nhóm này? Hành động này không thể hoàn tác.')) return;
    try {
      await api.delete(`/api/groups/${groupId}`);
      toast.success('Đã xóa nhóm.');
      navigate('/dashboard');
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể xóa nhóm.');
    }
  };

  const colorStyles: Record<string, string> = {
    primary: 'bg-primary-50/80 text-primary-600 border border-primary-100/50 dark:bg-primary-950/20 dark:text-primary-400 dark:border-primary-900/30',
    blue: 'bg-blue-50/80 text-blue-600 border border-blue-100/50 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30',
    indigo: 'bg-indigo-50/80 text-indigo-600 border border-indigo-100/50 dark:bg-indigo-950/20 dark:text-indigo-400 dark:border-indigo-900/30',
    amber: 'bg-amber-50/80 text-amber-600 border border-amber-100/50 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30',
    rose: 'bg-rose-50/80 text-rose-600 border border-rose-100/50 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/30',
  };

  const privacyOptions: Array<{
    value: PrivacyLevel;
    icon: React.ReactNode;
    label: string;
    desc: string;
    badge: string;
  }> = [
    {
      value: 'private',
      icon: <EyeOff size={18} className="stroke-[2.2]" />,
      label: 'Riêng tư tối đa (Private)',
      desc: 'Chỉ những thành viên được mời đích danh mới có thể tìm kiếm và xem nội dung.',
      badge: 'Highly Secure',
    },
    {
      value: 'internal',
      icon: <Building2 size={18} className="stroke-[2.2]" />,
      label: 'Nội bộ tổ chức (Internal)',
      desc: 'Mọi thành viên thuộc tổ chức đều có thể tìm thấy, theo dõi và tham gia.',
      badge: 'Organization Only',
    },
    {
      value: 'public',
      icon: <Globe size={18} className="stroke-[2.2]" />,
      label: 'Mở công khai (Public)',
      desc: 'Bất kỳ ai có mã liên kết của nhóm đều có thể xem thông tin phòng họp cơ bản.',
      badge: 'Open Connection',
    },
  ];

  const SettingToggle: React.FC<{
    icon: React.ReactNode;
    title: string;
    desc: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    color?: string;
  }> = ({ icon, title, desc, checked, onChange, color = 'primary' }) => (
    <div className="flex items-center justify-between gap-4 p-4 -mx-2 rounded-2xl transition-all duration-300 hover:bg-gray-50/40 dark:hover:bg-slate-800/20 group">
      <div className="flex items-center gap-4 flex-1">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all duration-300 shadow-sm group-hover:scale-105 ${
            colorStyles[color] || colorStyles.primary
          }`}
        >
          {icon}
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-900 dark:text-slate-100 transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-400">
            {title}
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1 leading-normal max-w-sm">
            {desc}
          </p>
        </div>
      </div>
      <label className="relative inline-flex cursor-pointer items-center shrink-0 select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="peer h-6.5 w-12.5 rounded-full bg-gray-200/90 dark:bg-slate-800 transition-all duration-300 after:absolute after:start-[3px] after:top-[3px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-md after:transition-all after:content-[''] peer-checked:bg-primary-500 peer-checked:after:translate-x-6 peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/20" />
      </label>
    </div>
  );

  return (
    <div className="space-y-8 pb-24">
      {/* Custom Styles Injection */}
      <style dangerouslySetInnerHTML={{ __html: `
        .glass-card {
          background: rgba(255, 255, 255, 0.75);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(229, 231, 235, 0.6);
        }
        .dark .glass-card {
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(51, 65, 85, 0.35);
        }
        .shimmer-text {
          background: linear-gradient(to right, #6366f1 0%, #10b981 50%, #6366f1 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmerText 3s linear infinite;
        }
        @keyframes shimmerText {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      ` }} />

      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-gray-150/60 pb-6 dark:border-slate-800/80">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-primary-700 dark:bg-primary-950/20 dark:text-primary-300 mb-2">
            <ShieldCheck size={12} className="text-primary-500" />
            Security & Controls Hub
          </div>
          <h3 className="text-3xl font-black text-gray-900 dark:text-slate-100 tracking-tight">Cài đặt Cấu hình Nhóm</h3>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1.5 leading-relaxed max-w-xl">
            Quản lý quyền riêng tư, phân quyền khởi tạo cuộc họp, chính sách mã hóa AI và các thiết lập an toàn thông tin chuyên sâu của nhóm <b>{group?.name}</b>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="px-3.5 py-1.5 rounded-xl border border-gray-200/50 bg-gray-50/70 font-mono text-[10px] text-gray-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 shadow-sm">
            ID: {groupId}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left Column: Core Identity & Privacy */}
        <div className="space-y-6">
          <section className="space-y-3">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-slate-500 flex items-center gap-1.5">
              <Sparkles size={12} className="text-primary-500" />
              Định danh & Nhận diện Nhóm
            </h4>
            <div className="rounded-3xl border border-gray-150/50 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 transition-all">
              <div className="space-y-5">
                <Input
                  label="Tên hiển thị nhóm"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="h-11 rounded-2xl text-sm font-semibold"
                />
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-500 dark:text-slate-450 uppercase tracking-wider block">Mô tả mục tiêu & Quy định</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => handleChange('description', e.target.value)}
                    rows={4}
                    placeholder="Mô tả mục đích hoạt động và quyền sở hữu thông tin của nhóm..."
                    className="w-full rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm font-medium outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 dark:border-slate-750 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Privacy Level */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-slate-500 flex items-center gap-1.5">
              <Lock size={12} className="text-primary-500" />
              Chế độ hiển thị & Bảo mật
            </h4>
            <div className="grid grid-cols-1 gap-3.5">
              {privacyOptions.map((option) => {
                const isActive = formData.privacyLevel === option.value;
                return (
                  <motion.label
                    key={option.value}
                    whileHover={{ scale: 1.01, y: -1 }}
                    whileTap={{ scale: 0.995 }}
                    className={`relative flex cursor-pointer items-center gap-4 rounded-3xl border p-5 transition-all duration-300 ${
                      isActive
                        ? 'border-primary-500 bg-gradient-to-br from-white to-primary-50/20 ring-4 ring-primary-500/5 dark:from-slate-900 dark:to-primary-950/10 dark:bg-slate-900 shadow-lg'
                        : 'border-gray-150/70 bg-gray-50/30 hover:border-gray-200/80 dark:border-slate-800 dark:bg-slate-950/25'
                    }`}
                  >
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm transition-all duration-300 ${
                        isActive
                          ? 'bg-primary-500 text-white shadow-md shadow-primary-500/20'
                          : 'bg-white dark:bg-slate-950 text-gray-400 border border-gray-100 dark:border-slate-850'
                      }`}
                    >
                      {option.icon}
                    </div>
                    <div className="flex-1 overflow-hidden pr-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-gray-900 dark:text-slate-100">{option.label}</span>
                        {isActive && (
                          <span className="rounded bg-primary-100 dark:bg-primary-950 px-1.5 py-0.5 text-[8px] font-black uppercase text-primary-700 dark:text-primary-400">
                            {option.badge}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-slate-450">{option.desc}</p>
                    </div>
                    <input
                      type="radio"
                      name="privacy"
                      value={option.value}
                      checked={isActive}
                      onChange={(e) => handleChange('privacyLevel', e.target.value)}
                      className="h-5 w-5 text-primary-500 border-gray-300 focus:ring-primary-500 focus:ring-offset-0 shrink-0"
                    />
                  </motion.label>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right Column: Stats & Policies */}
        <div className="space-y-6">
          <section className="space-y-3">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-slate-500 flex items-center gap-1.5">
              <Users size={12} className="text-primary-500" />
              Thống kê hoạt động
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-3xl border border-blue-100/50 bg-gradient-to-br from-blue-50/40 to-indigo-50/10 p-5 dark:border-blue-900/10 dark:from-blue-950/15 dark:to-transparent hover:shadow-sm transition-all duration-300 group">
                <div className="flex items-center gap-2 text-blue-500">
                  <Users size={14} className="group-hover:scale-110 transition-transform" />
                  <span className="text-[9px] font-black uppercase tracking-wider">Thành viên</span>
                </div>
                <p className="text-3xl font-black text-blue-750 dark:text-blue-400 mt-2.5">{group?.memberCount || 0}</p>
                <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">Đã được xác thực</p>
              </div>
              <div className="rounded-3xl border border-emerald-100/50 bg-gradient-to-br from-emerald-50/40 to-teal-50/10 p-5 dark:border-emerald-900/10 dark:from-emerald-950/15 dark:to-transparent hover:shadow-sm transition-all duration-300 group">
                <div className="flex items-center gap-2 text-emerald-500">
                  <FileText size={14} className="group-hover:scale-110 transition-transform" />
                  <span className="text-[9px] font-black uppercase tracking-wider">Cuộc họp</span>
                </div>
                <p className="text-3xl font-black text-emerald-750 dark:text-emerald-400 mt-2.5">{group?.meetingCount || 0}</p>
                <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">AI tóm tắt hoàn tất</p>
              </div>
            </div>
          </section>

          {/* System Policies */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-slate-500 flex items-center gap-1.5">
              <Bell size={12} className="text-primary-500" />
              Quy trình & Chính sách bảo mật AI
            </h4>
            <div className="rounded-3xl border border-gray-150/50 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-2">
              <SettingToggle
                icon={<UserCheck size={18} className="stroke-[2.2]" />}
                title="Yêu cầu phê duyệt tham gia"
                desc="Chỉ cho phép nhân sự mới vào nhóm sau khi quản trị viên phê duyệt thủ công."
                checked={formData.requireApproval}
                onChange={(v) => handleChange('requireApproval', v)}
                color="amber"
              />
              <SettingToggle
                icon={<Key size={18} className="stroke-[2.2]" />}
                title="Mã hóa lưu trữ (AES-256)"
                desc="Tự động mã hóa tệp âm thanh và biên bản họp ngay khi lưu trữ."
                checked={formData.encryptData}
                onChange={(v) => handleChange('encryptData', v)}
                color="indigo"
              />
              <SettingToggle
                icon={<FileText size={18} className="stroke-[2.2]" />}
                title="Quyền tự do khởi tạo"
                desc="Cho phép thành viên nhóm tự tạo phòng họp và ghi âm trực tiếp."
                checked={formData.allowCreateMeetings}
                onChange={(v) => handleChange('allowCreateMeetings', v)}
                color="primary"
              />
              <SettingToggle
                icon={<Bell size={18} className="stroke-[2.2]" />}
                title="Tự động sinh biên bản AI"
                desc="AI tự động phân tích và tạo Summary/Action Items khi cuộc họp kết thúc."
                checked={formData.autoSummarize}
                onChange={(v) => handleChange('autoSummarize', v)}
                color="blue"
              />
            </div>
          </section>

          {/* Danger Zone */}
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-500">Khu vực kiểm soát rủi ro</h4>
              <div className="h-px flex-1 bg-rose-100/70 dark:bg-rose-950/20" />
            </div>

            <div className="rounded-3xl border border-rose-100 bg-rose-50/25 p-6 dark:border-rose-900/20 dark:bg-rose-950/5 shadow-sm">
              <div className="flex flex-col sm:flex-row gap-5 items-start">
                <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 shadow-inner dark:bg-rose-950/30 dark:text-rose-450">
                  <ShieldAlert size={26} className="stroke-[2.2]" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <h5 className="text-sm font-black text-rose-900 dark:text-rose-450 uppercase tracking-wider">Hành động không thể phục hồi</h5>
                  <p className="mt-2 text-xs text-rose-800/60 dark:text-rose-450/60 leading-relaxed">
                    Xóa nhóm sẽ xóa vĩnh viễn toàn bộ cơ sở dữ liệu cuộc họp, bản dịch, tệp âm thanh và tất cả tóm tắt AI.
                  </p>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-xl px-4 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5"
                      onClick={() =>
                        toast.success('Hãy truy cập tab Thành viên để phân quyền quản trị viên thay thế.')
                      }
                    >
                      <ArrowLeftRight size={12} className="stroke-[2.5]" /> Chuyển quyền quản trị
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-xl px-4 text-[10px] font-extrabold uppercase tracking-wider hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20 flex items-center gap-1.5"
                      onClick={handleArchiveGroup}
                    >
                      <Archive size={12} /> Lưu trữ nhóm
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      className="rounded-xl px-4 text-[10px] font-extrabold uppercase tracking-wider shadow-md shadow-rose-600/10 flex items-center gap-1.5"
                      onClick={handleDeleteGroup}
                    >
                      <Trash2 size={12} className="stroke-[2.5]" /> Xóa Nhóm
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Floating Modern Action Bar */}
      <FloatingSaveBar
        isVisible={isDirty}
        isSaving={isSaving}
        onSave={handleSave}
        onCancel={() => setFormData(initialData)}
      />
    </div>
  );
};

export default GroupSettingsTab;
