import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Mail, Lock, ArrowRight, Eye, EyeOff, UserRound, Phone, CalendarDays, Mic, Sparkles, Users, ShieldCheck } from 'lucide-react';
import { Button, Input, Logo } from '../../../components/ui';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';

const registerSchema = z
  .object({
    firstName: z.string().min(1, 'Vui long nhap ho'),
    lastName: z.string().min(1, 'Vui long nhap ten'),
    username: z.string().min(3, 'Username toi thieu 3 ky tu').max(50, 'Username toi da 50 ky tu').optional().or(z.literal('')),
    email: z.string().email('Email khong hop le'),
    phone: z.string().regex(/^(0|\+84)\d{9,10}$/, 'SDT khong hop le').optional().or(z.literal('')),
    gender: z.enum(['male', 'female', 'other', '']).optional(),
    dateOfBirth: z.string().min(1, 'Vui long chon ngay sinh').refine((val) => {
      const birthDate = new Date(val);
      if (Number.isNaN(birthDate.getTime())) return false;
      const age = (Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      return age >= 13;
    }, { message: 'Ban phai tu 13 tuoi tro len' }),
    password: z.string().min(8, 'Mat khau toi thieu 8 ky tu'),
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'Vui long dong y dieu khoan su dung' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Mat khau xac nhan khong khop',
    path: ['confirmPassword'],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

const featureHighlights = [
  { text: 'Phien am tu dong voi AI', icon: Mic },
  { text: 'Tong hop bien ban thong minh', icon: Sparkles },
  { text: 'Cong tac nhom de dang', icon: Users },
  { text: 'Bao mat cap doanh nghiep', icon: ShieldCheck },
];

const getPasswordStrength = (
  password: string,
): { level: number; label: string; color: string } => {
  if (!password) return { level: 0, label: '', color: '' };
  if (password.length < 6) return { level: 1, label: 'Yeu', color: 'bg-red-500' };
  if (password.length < 10) return { level: 2, label: 'Trung binh', color: 'bg-amber-500' };
  return { level: 3, label: 'Manh', color: 'bg-emerald-500' };
};

const formatApiError = (err: unknown): string => {
  const response = (err as { response?: { status?: number; data?: any } })?.response;
  const detail = response?.data?.detail;

  if (Array.isArray(detail) && detail.length > 0) {
    const firstIssue = detail[0];
    const field = Array.isArray(firstIssue?.loc) ? firstIssue.loc.at(-1) : undefined;
    const message = firstIssue?.msg || 'Du lieu khong hop le.';
    if (field) {
      return `Dang ky that bai: truong "${field}" khong hop le - ${message}`;
    }
    return `Dang ky that bai: ${message}`;
  }

  if (typeof detail === 'string' && detail.trim()) {
    const normalized = detail.toLowerCase();
    if (normalized.includes('email already registered')) {
      return 'Dang ky that bai: email da duoc su dung.';
    }
    if (normalized.includes('username already registered')) {
      return 'Dang ky that bai: username da duoc su dung.';
    }
    if (normalized.includes('invitation email does not match')) {
      return 'Dang ky that bai: email dang ky khong trung voi email duoc moi.';
    }
    if (normalized.includes('invalid or expired invitation token')) {
      return 'Dang ky that bai: loi moi khong hop le hoac da het han.';
    }
    return `Dang ky that bai: ${detail}`;
  }

  if (response?.status === 409) {
    return 'Dang ky that bai: email da duoc su dung.';
  }

  if (response?.status === 422) {
    return 'Dang ky that bai: thong tin nhap vao chua hop le.';
  }

  return 'Dang ky that bai. Vui long thu lai.';
};

const Register: React.FC = () => {
  const navigate = useNavigate();
  const { registerAndSetSession } = useAuth();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('inviteToken');
  const [apiError, setApiError] = React.useState('');
  const [success, setSuccess] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [passwordValue, setPasswordValue] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteOrgName, setInviteOrgName] = React.useState('');

  const {
    register,
    handleSubmit,
    setFocus,
    setValue,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const watchedPassword = watch('password', '');
  React.useEffect(() => {
    setPasswordValue(watchedPassword || '');
  }, [watchedPassword]);

  React.useEffect(() => {
    if (!inviteToken) return;

    const loadInvitation = async () => {
      try {
        const response = await api.get(
          `/api/invitations/preview?token=${encodeURIComponent(inviteToken)}`,
        );
        const preview = response.data;
        setInviteEmail(preview.email || '');
        setInviteOrgName(preview.organization_name || '');
        if (preview.email) {
          setValue('email', preview.email, { shouldValidate: true });
        }
      } catch {
        setApiError('Loi moi khong hop le hoac da het han.');
      }
    };

    loadInvitation();
  }, [inviteToken, setValue]);

  const passwordStrength = getPasswordStrength(passwordValue);

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    setApiError('');
    try {
      const payload = {
        email: data.email,
        password: data.password,
        first_name: data.firstName,
        last_name: data.lastName,
        username: data.username || undefined,
        phone: data.phone || undefined,
        gender: data.gender || undefined,
        date_of_birth: data.dateOfBirth,
      };

      const response = inviteToken
        ? await api.post(`/api/auth/register-by-invite?token=${encodeURIComponent(inviteToken)}`, payload)
        : await api.post('/api/auth/register', payload);

      const { access_token, user } = response.data;
      registerAndSetSession(user, access_token);

      setSuccess(true);
      setTimeout(() => {
        if (user.systemRole === 'system-admin') {
          navigate('/admin/console');
        } else if (!user.orgMemberships || user.orgMemberships.length === 0) {
          navigate('/setup-organization');
        } else {
          navigate('/dashboard');
        }
      }, 2000);
    } catch (err) {
      setApiError(formatApiError(err));
      setFocus('firstName');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#030712] px-4 py-12 selection:bg-emerald-500/30">
      {/* Premium Minimalist Background */}
      <div className="pointer-events-none absolute inset-0 dot-grid opacity-[0.05]" />
      
      {/* Static Light Orbs - Ultra High Performance */}
      <div className="pointer-events-none absolute right-[-10%] top-[-10%] h-[600px] w-[600px] rounded-full bg-emerald-500/[0.03] blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-10%] left-[5%] h-[550px] w-[550px] rounded-full bg-green-600/[0.03] blur-[110px]" />

      <div className="relative z-10 grid w-full max-w-6xl items-center gap-16 lg:grid-cols-2">
        {/* Left Content - Presentation */}
        <div className="hidden space-y-12 lg:block">
          <div className="flex items-center gap-3">
            <Logo variant="dark" size="sm" showSubtext={false} className="origin-left scale-105" />
          </div>

          <div className="space-y-8">
            <h1 className="text-6xl font-black leading-[1.15] tracking-tight text-white">
              Tham gia
              <br />
              <span className="bg-gradient-to-r from-emerald-400 via-slate-200 to-green-500 bg-clip-text text-transparent">
                workspace AI.
              </span>
            </h1>
            <p className="max-w-md text-lg font-medium leading-relaxed text-slate-400">
              Tạo tài khoản cá nhân, gia nhập hệ thống điều hành cuộc họp thông minh và bắt đầu tối ưu hiệu suất công việc của bạn.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {featureHighlights.map((item) => {
              const IconComponent = item.icon;
              return (
                <div
                  key={item.text}
                  className="group flex items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.005] p-5 transition-all duration-200 hover:border-emerald-500/20 hover:bg-white/[0.01]"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 transition-colors">
                    <IconComponent size={16} className="text-emerald-400" />
                  </div>
                  <span className="text-base font-bold text-slate-200 transition-colors group-hover:text-white">
                    {item.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Content - Form */}
        <div className="relative">
          <div className="relative overflow-hidden rounded-3xl border border-slate-800/60 bg-slate-900/30 p-8 shadow-2xl backdrop-blur-2xl sm:p-12 transition-all duration-300">
            {/* Minimalist Top Accent Line */}
            <div className="absolute left-0 right-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />

            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <Logo variant="dark" size="sm" showSubtext={false} />
            </div>

            <div className="mb-8">
              <h2 className="mb-2 text-3xl font-black tracking-tight text-white">Dang ky</h2>
              <p className="font-semibold text-slate-400 text-sm">
                Hoan tat tai khoan de tao hoac gia nhap to chuc lam viec.
              </p>
            </div>

            {success && (
              <div className="mb-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-8 text-center">
                <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20">
                  <Check size={28} className="text-emerald-400" />
                </div>
                <h3 className="mb-2 text-xl font-black text-white">Dang ky thanh cong</h3>
                <p className="font-semibold text-slate-400 text-sm">
                  He thong dang chuyen huong ban tiep tuc...
                </p>
              </div>
            )}

            {apiError && (
              <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-semibold text-red-400">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                {apiError}
              </div>
            )}

            {inviteToken && inviteOrgName && (
              <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 text-xs text-slate-200">
                Bạn đang được mời tham gia tổ chức <strong>{inviteOrgName}</strong> bằng email{' '}
                <strong>{inviteEmail}</strong>. Hoàn tất đăng ký để gia nhập ngay.
              </div>
            )}

            {!success && (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                
                {/* Segment 1: Personal Info */}
                <div className="border-b border-white/5 pb-5">
                  <span className="text-emerald-400 font-black text-sm tracking-widest uppercase mb-4 block ml-1">
                    Thông tin cá nhân
                  </span>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          Ho
                        </label>
                        <Input
                          placeholder="Họ của bạn"
                          error={errors.firstName?.message}
                          disabled={isLoading}
                          className="h-12 rounded-xl border-white/5 bg-white/[0.01] text-white placeholder:text-slate-700 focus:border-emerald-500/30 focus:bg-white/[0.02] focus:ring-1 focus:ring-emerald-500/10"
                          {...register('firstName')}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          Ten
                        </label>
                        <Input
                          placeholder="Tên của bạn"
                          error={errors.lastName?.message}
                          disabled={isLoading}
                          className="h-12 rounded-xl border-white/5 bg-white/[0.01] text-white placeholder:text-slate-700 focus:border-emerald-500/30 focus:bg-white/[0.02] focus:ring-1 focus:ring-emerald-500/10"
                          {...register('lastName')}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          Gioi tinh
                        </label>
                        <select
                          disabled={isLoading}
                          className="h-12 w-full rounded-xl border border-white/5 bg-white/[0.01] px-4 text-xs font-bold text-white outline-none transition focus:border-emerald-500/30 focus:bg-white/[0.02] focus:ring-1 focus:ring-emerald-500/10"
                          {...register('gender')}
                        >
                          <option value="" className="bg-[#0b0f19]">Không chọn</option>
                          <option value="male" className="bg-[#0b0f19]">Nam</option>
                          <option value="female" className="bg-[#0b0f19]">Nữ</option>
                          <option value="other" className="bg-[#0b0f19]">Khác</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          Ngay sinh
                        </label>
                        <Input
                          type="date"
                          error={errors.dateOfBirth?.message}
                          disabled={isLoading}
                          leftIcon={<CalendarDays size={16} className="text-slate-500" />}
                          className="h-12 rounded-xl border-white/5 bg-white/[0.01] text-white placeholder:text-slate-700 focus:border-emerald-500/30 focus:bg-white/[0.02] focus:ring-1 focus:ring-emerald-500/10"
                          {...register('dateOfBirth')}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Segment 2: Account Info */}
                <div>
                  <span className="text-emerald-400 font-black text-sm tracking-widest uppercase mb-4 block ml-1">
                    Thông tin tài khoản
                  </span>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Ten dang nhap (Username)
                      </label>
                      <Input
                        placeholder="Để trống để tự tạo từ email"
                        error={errors.username?.message}
                        disabled={isLoading}
                        leftIcon={<UserRound size={16} className="text-slate-500" />}
                        className="h-12 rounded-xl border-white/5 bg-white/[0.01] text-white placeholder:text-slate-600 focus:border-emerald-500/30 focus:bg-white/[0.02] focus:ring-1 focus:ring-emerald-500/10"
                        {...register('username')}
                      />
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          Email cong viec
                        </label>
                        <Input
                          type="email"
                          placeholder="name@company.com"
                          error={errors.email?.message}
                          disabled={isLoading || Boolean(inviteToken && inviteEmail)}
                          leftIcon={<Mail size={16} className="text-slate-500" />}
                          className="h-12 rounded-xl border-white/5 bg-white/[0.01] text-white placeholder:text-slate-600 focus:border-emerald-500/30 focus:bg-white/[0.02] focus:ring-1 focus:ring-emerald-500/10"
                          {...register('email')}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          So dien thoai
                        </label>
                        <Input
                          placeholder="0901234567"
                          error={errors.phone?.message}
                          disabled={isLoading}
                          leftIcon={<Phone size={16} className="text-slate-500" />}
                          className="h-12 rounded-xl border-white/5 bg-white/[0.01] text-white placeholder:text-slate-700 focus:border-emerald-500/30 focus:bg-white/[0.02] focus:ring-1 focus:ring-emerald-500/10"
                          {...register('phone')}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center ml-1">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                          Mat khau
                        </label>
                        {passwordValue && (
                          <span className={`text-[9px] font-black uppercase tracking-widest ${
                            passwordStrength.level === 1 ? 'text-red-400' :
                            passwordStrength.level === 2 ? 'text-amber-400' :
                            'text-emerald-400'
                          }`}>
                            {passwordStrength.label}
                          </span>
                        )}
                      </div>
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Toi thieu 8 ky tu"
                        error={errors.password?.message}
                        disabled={isLoading}
                        leftIcon={<Lock size={16} className="text-slate-500" />}
                        rightIcon={
                          <button
                            type="button"
                            onClick={() => setShowPassword((prev) => !prev)}
                            className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-emerald-400 focus:outline-none"
                          >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        }
                        className="h-12 rounded-xl border-white/5 bg-white/[0.01] text-white placeholder:text-slate-600 focus:border-emerald-500/30 focus:bg-white/[0.02] focus:ring-1 focus:ring-emerald-500/10"
                        {...register('password')}
                      />
                      {passwordValue && (
                        <div className="px-1 pt-2">
                          <div className="flex h-1.5 gap-1.5">
                            {[1, 2, 3].map((level) => (
                              <div
                                key={level}
                                className={`flex-1 rounded-full transition-all duration-200 ${
                                  level <= passwordStrength.level
                                    ? passwordStrength.level === 1 ? 'bg-red-500' :
                                      passwordStrength.level === 2 ? 'bg-amber-500' :
                                      'bg-emerald-500'
                                    : 'bg-white/5'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Xac nhan mat khau
                      </label>
                      <Input
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder="Nhap lai mat khau"
                        error={errors.confirmPassword?.message}
                        disabled={isLoading}
                        leftIcon={<Lock size={16} className="text-slate-500" />}
                        rightIcon={
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword((prev) => !prev)}
                            className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-emerald-400 focus:outline-none"
                          >
                            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        }
                        className="h-12 rounded-xl border-white/5 bg-white/[0.01] text-white placeholder:text-slate-600 focus:border-emerald-500/30 focus:bg-white/[0.02] focus:ring-1 focus:ring-emerald-500/10"
                        {...register('confirmPassword')}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <label className="group flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500/10 focus:ring-offset-0 focus:outline-none"
                      {...register('acceptTerms')}
                    />
                    <span className="text-xs font-semibold leading-relaxed text-slate-500 group-hover:text-slate-400 transition-colors">
                      Toi dong y voi dieu khoa su dung va chinh sach bao mat cua he thong.
                    </span>
                  </label>
                  {errors.acceptTerms && (
                    <p className="mt-2 text-xs font-bold text-red-400">
                      {errors.acceptTerms.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="mt-6 h-12 w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-black text-white shadow-lg shadow-emerald-500/10 transition-all hover:scale-[1.005] active:scale-[0.995] flex items-center justify-center gap-2"
                  loading={isLoading}
                >
                  Tao tai khoan ngay
                  <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
                </Button>
              </form>
            )}

            <div className="mt-8 border-t border-white/5 pt-6 text-center">
              <p className="text-xs font-semibold text-slate-500">
                Đã có tài khoản?{' '}
                <Link
                  to="/login"
                  className="ml-1 font-black text-white underline decoration-emerald-500/20 underline-offset-4 transition-colors hover:text-emerald-400"
                >
                  Dang nhap ngay
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
