import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Mail, Shield, User, Eye, ArrowRight } from 'lucide-react';
import { Button, Logo } from '../../../components/ui';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { useOrgStore } from '../../../stores';

interface InvitationPreview {
  email: string;
  organization_id: string;
  organization_name?: string;
  role: 'org-admin' | 'member' | 'viewer';
  status: string;
  expires_at: string;
}

const roleMeta = {
  'org-admin': { label: 'Quản trị tổ chức', icon: <Shield size={16} className="text-amber-500" /> },
  member: { label: 'Thành viên', icon: <User size={16} className="text-blue-500" /> },
  viewer: { label: 'Người xem', icon: <Eye size={16} className="text-slate-500" /> },
};

const Invite: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const { isAuthenticated, user, refreshUser } = useAuth();
  const { acceptInvitation, setCurrentOrg } = useOrgStore();
  const [preview, setPreview] = React.useState<InvitationPreview | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isAccepting, setIsAccepting] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!token) {
      setError('Liên kết lời mời không hợp lệ.');
      setIsLoading(false);
      return;
    }

    const loadPreview = async () => {
      try {
        const response = await api.get(`/api/invitations/preview?token=${encodeURIComponent(token)}`);
        setPreview(response.data);
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Không thể tải thông tin lời mời.');
      } finally {
        setIsLoading(false);
      }
    };

    loadPreview();
  }, [token]);

  const handleAccept = async () => {
    if (!token || !preview) return;
    setIsAccepting(true);
    setError('');
    try {
      const organizationId = await acceptInvitation(token);
      await refreshUser();
      setCurrentOrg(organizationId || preview.organization_id);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Không thể tham gia tổ chức.');
    } finally {
      setIsAccepting(false);
    }
  };

  const loginHref = `/login?inviteToken=${encodeURIComponent(token)}`;
  const registerHref = `/register?inviteToken=${encodeURIComponent(token)}`;
  const emailMismatch = Boolean(isAuthenticated && user?.email && preview?.email && user.email.toLowerCase() !== preview.email.toLowerCase());

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4 py-12 selection:bg-primary-500/30">
      <div className="absolute inset-0 dot-grid opacity-[0.15] pointer-events-none" />
      <div className="w-full max-w-2xl relative z-10 rounded-[2.5rem] border border-white/10 bg-white/[0.04] p-8 sm:p-12 backdrop-blur-3xl shadow-2xl">
        <div className="mb-10 flex justify-center">
          <Logo variant="dark" />
        </div>

        {isLoading ? (
          <div className="text-center text-slate-300">Đang tải lời mời...</div>
        ) : error ? (
          <div className="space-y-6 text-center">
            <h1 className="text-3xl font-black text-white">Lời mời không khả dụng</h1>
            <p className="text-slate-400">{error}</p>
            <Button onClick={() => navigate('/login')} className="rounded-2xl px-8">Đến trang đăng nhập</Button>
          </div>
        ) : preview ? (
          <div className="space-y-8 text-white">
            <div className="text-center space-y-3">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-primary-500/10 text-primary-300">
                <Building2 size={36} />
              </div>
              <h1 className="text-4xl font-black tracking-tight">Lời mời tham gia tổ chức</h1>
              <p className="text-slate-400">Bạn đã được mời tham gia workspace trên CONVIA.</p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Tổ chức</p>
                <p className="mt-2 text-2xl font-bold text-white">{preview.organization_name || preview.organization_id}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Email được mời</p>
                  <p className="mt-2 flex items-center gap-2 text-slate-200"><Mail size={14} /> {preview.email}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Vai trò</p>
                  <p className="mt-2 flex items-center gap-2 text-slate-200">{roleMeta[preview.role].icon} {roleMeta[preview.role].label}</p>
                </div>
              </div>
              <p className="text-sm text-slate-400">Hết hạn: {new Date(preview.expires_at).toLocaleString('vi-VN')}</p>
            </div>

            {emailMismatch && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                Bạn đang đăng nhập bằng <strong>{user?.email}</strong>, nhưng lời mời này dành cho <strong>{preview.email}</strong>. Hãy đổi tài khoản hoặc đăng ký đúng email được mời.
              </div>
            )}

            {!isAuthenticated ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Button onClick={() => navigate(loginHref)} className="h-14 rounded-2xl text-base font-bold">
                  Đăng nhập để tham gia
                  <ArrowRight size={18} className="ml-2" />
                </Button>
                <Button variant="secondary" onClick={() => navigate(registerHref)} className="h-14 rounded-2xl text-base font-bold">
                  Tạo tài khoản mới
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Button
                  onClick={handleAccept}
                  disabled={emailMismatch}
                  loading={isAccepting}
                  className="w-full h-14 rounded-2xl text-base font-bold"
                >
                  Tham gia tổ chức
                </Button>
                {emailMismatch && (
                  <Button variant="secondary" onClick={() => navigate('/login')} className="w-full rounded-2xl">
                    Đổi tài khoản
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Invite;
