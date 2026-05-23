/**
 * AdminLayout - Layout riêng biệt cho trang Quản trị Hệ thống
 * Tách biệt hoàn toàn khỏi Sidebar và Header của người dùng
 * Đã tối ưu hóa: Không còn lặp lại Sidebar
 */
import React from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { 
  Shield, 
  LayoutDashboard, 
  Building2, 
  Users, 
  Cpu, 
  Settings, 
  ArrowLeft,
  ArrowRightLeft,
  Bell,
  Search,
  TerminalSquare,
  History,
  Sparkles,
  LogOut,
  Eye,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getViewAsOrg, endViewAsOrg, subscribeViewAsOrg } from '../services/viewAsOrg';
import { toast } from '../components/ui/Toast';

const AdminLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [viewAs, setViewAs] = React.useState(getViewAsOrg());
  React.useEffect(() => subscribeViewAsOrg(() => setViewAs(getViewAsOrg())), []);

  const handleExitViewAs = async () => {
    try {
      await endViewAsOrg();
      toast.success('Da thoat che do view-as');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Khong thoat duoc che do view-as');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleBackToUser = () => {
    navigate('/dashboard');
  };

  const navItems = [
    { label: 'Tổng quan', path: '/admin/console', icon: <LayoutDashboard size={20} /> },
    { label: 'Tổ chức', path: '/admin/organizations', icon: <Building2 size={20} /> },
    { label: 'Người dùng', path: '/admin/users', icon: <Users size={20} /> },
    { label: 'Dịch vụ AI', path: '/admin/ai-services', icon: <Cpu size={20} /> },
    { label: 'AI Prompts', path: '/admin/prompts', icon: <TerminalSquare size={20} /> },
    { label: 'Thông báo', path: '/admin/notifications', icon: <Bell size={20} /> },
    { label: 'Nhật ký', path: '/admin/audit-logs', icon: <History size={20} /> },
    { label: 'Cấu hình', path: '/admin/settings', icon: <Settings size={20} /> },
  ];

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#020617]">
      {/* Admin Sidebar */}
      <aside className="w-72 flex-shrink-0 border-r border-slate-200 bg-slate-900 text-slate-300 dark:border-slate-800 shadow-2xl z-20">
        <div className="flex h-full flex-col">
          {/* Logo Section */}
          <div className="p-8">
            <Link to="/admin/console" className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 p-0.5 shadow-lg shadow-red-500/20">
                <div className="flex h-full w-full items-center justify-center rounded-[0.9rem] bg-white/10 backdrop-blur-sm">
                  <Shield size={24} className="text-white" />
                </div>
              </div>
              <div>
                <h2 className="text-lg font-black tracking-tight text-white leading-tight">MUTI ADMIN</h2>
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest">System Root</p>
                </div>
              </div>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1.5 px-4 py-4 overflow-y-auto custom-scrollbar">
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition-all duration-200 ${
                    active 
                      ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 translate-x-1' 
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <span className={active ? "text-white" : "text-slate-500"}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Sidebar Footer */}
          <div className="p-6 border-t border-slate-800 space-y-3">
            <button
              onClick={handleBackToUser}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-slate-800 px-4 py-3.5 text-sm font-bold text-slate-300 transition-all hover:bg-indigo-500 hover:text-white hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95"
            >
              <ArrowRightLeft size={18} />
              Chuyển User Dashboard
            </button>
            <button
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-red-900/40 bg-red-900/20 px-4 py-3.5 text-sm font-bold text-red-400 transition-all hover:bg-red-600 hover:text-white hover:shadow-lg hover:shadow-red-500/20 active:scale-95"
            >
              <LogOut size={18} />
              Đăng xuất
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden relative">
        {viewAs && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-400 bg-amber-100 px-6 py-3 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Eye size={16} />
              Dang xem voi tu cach org-admin cua <span className="font-black">{viewAs.organization_name}</span> — moi hanh dong duoc ghi vao audit log.
            </div>
            <button
              type="button"
              onClick={handleExitViewAs}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-200 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-300 dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
            >
              <X size={14} />
              Thoat
            </button>
          </div>
        )}
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-red-500/5 blur-[120px] rounded-full -mr-48 -mt-48 pointer-events-none" />

        {/* Admin Header */}
        <header className="flex h-20 items-center justify-between border-b border-slate-200 bg-white/80 px-10 backdrop-blur-md dark:border-slate-800 dark:bg-[#020617]/80 z-10">
          <div className="flex items-center gap-6">
            <div className="relative w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Tìm kiếm tài nguyên hệ thống..." 
                className="w-full rounded-2xl border border-slate-100 bg-slate-50 pl-12 pr-4 py-2.5 text-sm outline-none transition-all focus:border-red-400 focus:ring-4 focus:ring-red-400/5 dark:border-slate-800 dark:bg-slate-900/50"
              />
            </div>
            <div className="hidden xl:flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/20">
              <Sparkles size={14} className="text-green-600" />
              <span className="text-[10px] font-bold text-green-700 dark:text-green-400 uppercase tracking-wider">Tất cả dịch vụ đang Online</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <button className="relative rounded-xl p-2.5 text-slate-500 hover:bg-slate-100 transition-colors dark:hover:bg-slate-800">
              <Bell size={22} />
              <span className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500 dark:border-slate-900" />
            </button>
            <div className="h-10 w-px bg-slate-100 dark:bg-slate-800" />
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-black text-slate-900 dark:text-white leading-none mb-1">{user?.displayName}</p>
                <p className="text-[10px] font-extrabold text-red-500 uppercase tracking-tighter">Administrator Account</p>
              </div>
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center font-black text-slate-600 dark:text-slate-300 shadow-sm border border-slate-200 dark:border-slate-700">
                {(user?.displayName?.[0] || 'A').toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        {/* Content View */}
        <main className="flex-1 overflow-y-auto p-10 custom-scrollbar">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
