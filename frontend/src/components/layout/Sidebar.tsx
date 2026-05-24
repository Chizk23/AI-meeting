/**
 * Sidebar Component (v3 - Simplified)
 * Organization/Group hierarchy navigation
 * Removed: Team management, Org admin section, Group admin section
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LogOut,
  X,
  Settings,
  Shield,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePermission } from '../../hooks';
import { useOrgStore } from '../../stores';
import { Logo } from '../ui';
import OrgSelector from './OrgSelector';
import GroupNav from './GroupNav';
import QuickAccess from './QuickAccess';
import CreateGroupModal from '../../features/groups/components/CreateGroupModal';

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onClose }) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isSystemAdmin, isOrgAdmin, isGroupAdmin, isViewer } = usePermission();
  const { currentOrg } = useOrgStore();
  const [isCreateGroupOpen, setIsCreateGroupOpen] = React.useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleGroupSelect = () => {
    // Auto-close mobile sidebar on selection
    if (window.innerWidth < 1024) {
      onClose();
    }
  };

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/35 transition-opacity lg:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 transform border-r border-gray-200 bg-white/95 transition-transform duration-300 dark:border-slate-800 dark:bg-slate-900/95 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Logo & Close */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4 dark:border-slate-800">
            <Logo
              size="sm"
              className="px-0"
              variant="light"
              showSubtext={false}
            />
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="custom-scrollbar flex-1 overflow-y-auto py-3">
            {/* Organization Selector */}
            <div className="px-2 pb-3">
              <OrgSelector />
            </div>

            {/* Groups Section */}
            <div className="mb-3">
              <div className="px-4 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Phòng ban / Danh mục
                </p>
              </div>
              <GroupNav 
                onGroupSelect={handleGroupSelect} 
                onCreateGroup={() => setIsCreateGroupOpen(true)}
              />
            </div>

            {/* Divider */}
            <div className="mx-4 my-3 border-t border-gray-200 dark:border-slate-700" />

            {/* Quick Access */}
            <div className="mb-3">
              <div className="px-4 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  Truy cập nhanh
                </p>
              </div>
              <QuickAccess />
            </div>

            {/* Admin Access */}
            {(isSystemAdmin || isOrgAdmin) && (
              <>
                <div className="mx-4 my-3 border-t border-gray-200 dark:border-slate-700" />
                <div className="mb-3">
                  <div className="px-4 pb-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Quản trị
                    </p>
                  </div>
                  <nav className="space-y-1 px-2">
                    {isSystemAdmin && (
                      <Link
                        to="/admin/console"
                        onClick={onClose}
                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/10"
                      >
                        <Shield size={18} />
                        Hệ thống (Root)
                      </Link>
                    )}
                    {isOrgAdmin && (
                      <Link
                        to="/org/admin"
                        onClick={onClose}
                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 hover:text-primary-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-primary-400"
                      >
                        <Settings size={18} />
                        Quản trị tổ chức
                      </Link>
                    )}
                  </nav>
                </div>
              </>
            )}
          </div>

          {/* User Profile & Logout */}
          <div className="border-t border-gray-100 p-4 dark:border-slate-800">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-100 text-sm font-bold text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
                  {(user?.displayName?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-800 dark:text-slate-100">
                    {user?.displayName || user?.email || 'Unknown'}
                  </p>
                  <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                    {currentOrg?.name || 'Chưa chọn tổ chức'}
                  </p>
                  {/* Role badge */}
                  {(isSystemAdmin || isOrgAdmin || isGroupAdmin || isViewer) && (
                    <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white ${
                      isSystemAdmin ? 'bg-red-600' :
                      isOrgAdmin ? 'bg-amber-600' :
                      isGroupAdmin ? 'bg-cyan-600' :
                      isViewer ? 'bg-gray-400' : 'bg-blue-500'
                    }`}>
                      {isSystemAdmin ? 'Quản trị Hệ thống' :
                       isOrgAdmin ? 'Quản trị tổ chức' :
                       isGroupAdmin ? 'Quản trị nhóm' :
                       isViewer ? 'Người xem' : 'Thành viên'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
            >
              <LogOut size={16} />
              Đăng xuất
            </button>
          </div>
        </div>
      </aside>

      <CreateGroupModal 
        isOpen={isCreateGroupOpen} 
        onClose={() => setIsCreateGroupOpen(false)} 
      />
    </>
  );
};

export default Sidebar;
