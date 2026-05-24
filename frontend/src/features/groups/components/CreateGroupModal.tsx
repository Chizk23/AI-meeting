import React, { useState } from 'react';
import {
  X,
  Lock,
  Building2,
  Globe,
  Check,
  CheckCircle,
  PartyPopper,
  Sparkles,
  Info,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '../../../hooks/usePermission';
import { useOrgStore } from '../../../stores';
import api from '../../../services/api';
import type { PrivacyLevel, Group } from '../../../types';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FormData {
  name: string;
  description: string;
  privacyLevel: PrivacyLevel;
  selectedMembers: string[];
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { currentOrg, loadGroups, members = [] } = useOrgStore();
  const { hasPermission, isOrgAdmin, isSystemAdmin } = usePermission();

  const [formData, setFormData] = useState<FormData>({
    name: '',
    description: '',
    privacyLevel: 'private',
    selectedMembers: [],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Group | null>(null);

  const canCreateGroup = hasPermission('create_group') || isOrgAdmin || isSystemAdmin;
  const permissionError =
    'Ban can quyen quan tri to chuc de tao nhom trong organization hien tai.';
  const missingOrgError = 'Vui long chon to chuc truoc khi tao nhom.';

  const toggleMember = (userId: string) => {
    if (!canCreateGroup) return;

    setFormData((prev) => ({
      ...prev,
      selectedMembers: prev.selectedMembers.includes(userId)
        ? prev.selectedMembers.filter((id) => id !== userId)
        : [...prev.selectedMembers, userId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canCreateGroup) {
      setError(permissionError);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (!currentOrg?.id) {
        setError(missingOrgError);
        return;
      }

      const response = await api.post('/api/groups', {
        name: formData.name,
        description: formData.description,
        privacy_level: formData.privacyLevel,
        organization_id: currentOrg.id,
      });

      const newGroup = response.data as Group;
      await Promise.resolve(loadGroups(currentOrg.id));
      setSuccess(newGroup);

      setTimeout(() => {
        navigate('/dashboard');
        onClose();
      }, 2000);
    } catch (err: any) {
      console.error('Failed to create group:', err);

      const status = err.response?.status;
      let errorMsg =
        err.response?.data?.detail || err.message || 'Da co loi xay ra khi tao nhom.';

      if (status === 403) {
        errorMsg = permissionError;
      } else if (status === 401) {
        errorMsg = 'Phien dang nhap da het han. Vui long dang nhap lai.';
      } else if (!currentOrg?.id) {
        errorMsg = missingOrgError;
      }

      setError(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    } finally {
      setIsSubmitting(false);
    }
  };

  const privacyOptions: Array<{
    level: PrivacyLevel;
    icon: React.ReactNode;
    label: string;
    desc: string;
  }> = [
    {
      level: 'private',
      icon: <Lock size={16} />,
      label: 'Private',
      desc: 'Only invited members can see',
    },
    {
      level: 'internal',
      icon: <Building2 size={16} />,
      label: 'Internal',
      desc: 'All org members can see',
    },
    {
      level: 'public',
      icon: <Globe size={16} />,
      label: 'Public',
      desc: 'Anyone can see, request join',
    },
  ];

  if (!isOpen) return null;

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-lg rounded-3xl border border-gray-200 bg-white p-8 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <Check size={32} className="text-green-600 dark:text-green-400" />
            </div>
            <h2 className="mt-4 text-2xl font-bold text-gray-900 dark:text-slate-100">
              <PartyPopper size={24} className="text-green-600" /> Group Created Successfully!
            </h2>
            <p className="mt-2 text-gray-600 dark:text-slate-300">Welcome to "{success.name}"</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              You are now the Group Owner
            </p>

            <div className="mt-6 rounded-xl bg-gray-50 p-4 dark:bg-slate-800/70">
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-200">
                <Sparkles size={14} className="text-primary-600" /> What's next?
              </p>
              <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle size={12} className="text-green-600" /> Invite more members
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={12} className="text-green-600" /> Upload meetings
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={12} className="text-green-600" /> Manage settings
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={12} className="text-green-600" /> View analytics
                </li>
              </ul>
            </div>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={onClose}
                className="rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Go to Dashboard
              </button>
              <button
                onClick={() => navigate(`/groups/${success.id}`)}
                className="rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
              >
                Go to Group
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-slate-800">
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
            Create New Group
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[70vh] overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}

          {!canCreateGroup && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
              {permissionError}
            </div>
          )}

          <div className="mb-5">
            <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-200">
              Organization
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
              <Building2 size={16} className="text-gray-500" />
              <span className="text-sm font-medium text-gray-800 dark:text-slate-100">
                {currentOrg?.name || 'No organization selected'}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              You'll be adding this group to your organization
            </p>
          </div>

          <div className="mb-5">
            <label
              htmlFor="group-name"
              className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-200"
            >
              Group Name <span className="text-red-500">*</span>
            </label>
            <input
              id="group-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder='Ex: "Marketing Q3", "Tech Team", etc'
              required
              disabled={!canCreateGroup}
              className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-primary-900/30"
            />
          </div>

          <div className="mb-5">
            <label
              htmlFor="group-description"
              className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-200"
            >
              Description
            </label>
            <textarea
              id="group-description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional - what's this group for?"
              rows={3}
              disabled={!canCreateGroup}
              className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-primary-900/30"
            />
          </div>

          <div className="mb-5">
            <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-200">
              Privacy Level
            </label>
            <div className="space-y-2">
              {privacyOptions.map((option) => (
                <label
                  key={option.level}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition ${
                    canCreateGroup ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                  } ${
                    formData.privacyLevel === option.level
                      ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="privacy"
                    value={option.level}
                    checked={formData.privacyLevel === option.level}
                    onChange={(e) =>
                      setFormData({ ...formData, privacyLevel: e.target.value as PrivacyLevel })
                    }
                    disabled={!canCreateGroup}
                    className="h-4 w-4 text-primary-600"
                  />
                  <div className="flex items-center gap-2">
                    {option.icon}
                    <div>
                      <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">
                        {option.label}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{option.desc}</p>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="mb-5">
            <label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-200">
              Invite Initial Members (Optional)
            </label>
            <div className="rounded-lg border border-gray-200 dark:border-slate-700">
              <div className="max-h-40 overflow-y-auto p-2">
                {members.map((member) => {
                  const isSelected = formData.selectedMembers.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => toggleMember(member.id)}
                      disabled={!canCreateGroup}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition ${
                        isSelected
                          ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
                          : 'text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800'
                      } ${!canCreateGroup ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="h-4 w-4"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{member.displayName}</p>
                        <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                          {member.email}
                        </p>
                      </div>
                      {isSelected && <Check size={14} />}
                    </button>
                  );
                })}
              </div>
              {formData.selectedMembers.length > 0 && (
                <div className="border-t border-gray-200 px-3 py-2 dark:border-slate-700">
                  <p className="text-xs text-gray-600 dark:text-slate-300">
                    Selected: {formData.selectedMembers.length} member(s)
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mb-6 rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
            <p className="flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-300">
              <Info size={12} /> <strong>Note:</strong> You will be the Group Admin. You can
              manage members, meetings, and settings after creation.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.name || !canCreateGroup || !currentOrg?.id}
              className="rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateGroupModal;
