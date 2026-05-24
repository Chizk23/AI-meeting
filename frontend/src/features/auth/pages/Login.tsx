import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Crown, User, ChevronDown, Check, Lock, ArrowRight, Eye, EyeOff, Mic, Sparkles, Users } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { Button, Input, Logo } from '../../../components/ui';

const loginSchema = z.object({
  username: z.string().min(1, 'Vui lòng nhập tên đăng nhập'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

type LoginFormData = z.infer<typeof loginSchema>;

const leftFeatures = [
  { text: 'Phiên âm tự động với độ chính xác 99%+', icon: Mic },
  { text: 'Tổng hợp biên bản thông minh bằng AI', icon: Sparkles },
  { text: 'Cộng tác nhóm và phân công công việc', icon: Users },
];

const testimonials = [
  {
    text: "CONVIA tiết kiệm cho team chúng tôi hơn 10 giờ mỗi tuần. Thật sự kinh ngạc!",
    author: "Nguyễn Văn An",
    role: "CTO · TechViet Solutions"
  },
  {
    text: "Công nghệ STT và Diarization chính xác nhất mà tôi từng trải nghiệm trên thị trường.",
    author: "Trần Minh Tâm",
    role: "Product Manager · Vingroup"
  },
  {
    text: "Giao diện hiện đại, dễ sử dụng và tính năng bảo mật tuyệt đối khiến tôi hoàn toàn yên tâm.",
    author: "Lê Thị Hồng",
    role: "COO · StartupHub"
  }
];

const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('inviteToken');
  const [apiError, setApiError] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [activeTestimonial, setActiveTestimonial] = React.useState(0);
  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  React.useEffect(() => {
    const interval = setInterval(() => {
      setActiveTestimonial(prev => (prev + 1) % testimonials.length);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setApiError('');
    try {
      const nextUser = await login(data.username, data.password);
      const isSystemAdmin = nextUser.systemRole === 'system-admin';
      const hasApprovedOrganizations = Boolean(
        nextUser.orgMemberships?.some((membership) => membership.approvalStatus !== 'pending'),
      );

      if (inviteToken) {
        navigate(`/invite?token=${encodeURIComponent(inviteToken)}`);
      } else if (isSystemAdmin) {
        navigate('/admin/console');
      } else if (!hasApprovedOrganizations) {
        navigate('/setup-organization');
      } else {
        navigate('/dashboard');
      }
    } catch {
      setApiError('Đăng nhập thất bại. Vui lòng thử lại.');
      setFocus('username');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#030712] relative overflow-hidden px-4 selection:bg-emerald-500/30">
      {/* Premium Minimalist Background */}
      <div className="absolute inset-0 dot-grid opacity-[0.05] pointer-events-none" />
      
      {/* Static Light Orbs - Ultra High Performance */}
      <div className="absolute top-[-10%] left-[-15%] w-[600px] h-[600px] bg-emerald-500/[0.03] rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[550px] h-[550px] bg-green-600/[0.03] rounded-full blur-[110px] pointer-events-none" />

      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-16 items-center relative z-10 my-8">
        {/* Left Content - Desktop Presentation */}
        <div className="hidden lg:block space-y-12">
          <div className="flex items-center gap-3">
            <Logo variant="dark" size="sm" showSubtext={false} className="origin-left scale-105" />
          </div>

          <div className="space-y-8">
            <h1 className="text-6xl font-black text-white leading-[1.15] tracking-tight">
              Nâng tầm <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-slate-200 to-green-500">
                cuộc họp AI.
              </span>
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed max-w-md font-medium">
              Hệ thống điều phối, ghi biên bản và phân tích dữ liệu cuộc họp hàng đầu, giúp doanh nghiệp tối ưu hiệu suất thông qua sức mạnh AI.
            </p>
          </div>

          <div className="space-y-6">
            <p className="text-xs font-black text-emerald-400 uppercase tracking-[0.3em]">Tại sao chọn MULTIMinutes?</p>
            <ul className="grid grid-cols-1 gap-4">
              {leftFeatures.map((item, i) => {
                const IconComponent = item.icon;
                return (
                  <li key={i} className="flex items-center gap-4 group">
                    <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-white/[0.01] border border-white/5 flex items-center justify-center group-hover:border-emerald-500/30 transition-all duration-200">
                      <IconComponent size={14} className="text-emerald-400" />
                    </div>
                    <span className="text-slate-300 font-semibold group-hover:text-white transition-colors">{item.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Premium Testimonial Slider Card - Ultra light static */}
          <div className="relative h-28 max-w-md">
            <div className="absolute inset-0 flex flex-col justify-center p-6 rounded-2xl bg-slate-900/30 border border-slate-800/40 backdrop-blur-sm">
              <p className="text-slate-300 italic text-sm mb-3">"{testimonials[activeTestimonial].text}"</p>
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-white text-[9px] font-black">
                  {testimonials[activeTestimonial].author[0]}
                </div>
                <div>
                  <p className="text-xs font-black text-white">{testimonials[activeTestimonial].author}</p>
                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-wider">{testimonials[activeTestimonial].role}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Content - Login Form */}
        <div className="relative">
          <div className="bg-slate-900/30 border border-slate-800/60 backdrop-blur-2xl p-8 sm:p-12 rounded-3xl shadow-2xl relative overflow-hidden transition-all duration-300 group/card">
            {/* Minimalist Top Accent Line */}
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
            
            {/* Mobile View Logo */}
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <Logo variant="dark" size="sm" showSubtext={false} />
            </div>

            <div className="mb-8">
              <h2 className="text-3xl font-black text-white tracking-tight mb-2">Đăng nhập</h2>
              <p className="text-slate-400 text-sm font-semibold">Hệ thống điều phối cuộc họp AI.</p>
            </div>

            {apiError && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {apiError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Tên đăng nhập</label>
                <div className="relative group/input">
                  <Input
                    placeholder="Nhập tên đăng nhập"
                    autoComplete="username"
                    error={errors.username?.message}
                    disabled={isLoading}
                    leftIcon={<User size={16} className="text-slate-500 group-focus-within/input:text-emerald-400 transition-colors" />}
                    className="bg-white/[0.01] border-white/5 text-white placeholder:text-slate-600 focus:border-emerald-500/30 focus:bg-white/[0.02] h-12 rounded-xl transition-all focus:ring-1 focus:ring-emerald-500/10"
                    {...register('username')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Mật khẩu</label>
                  <Link
                    to="/forgot-password"
                    className="text-[9px] text-emerald-400 hover:text-emerald-300 font-black uppercase tracking-wider transition-colors"
                  >
                    Quên mật khẩu?
                  </Link>
                </div>
                <div className="relative group/input">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Nhập mật khẩu"
                    autoComplete="current-password"
                    error={errors.password?.message}
                    disabled={isLoading}
                    leftIcon={<Lock size={16} className="text-slate-500 group-focus-within/input:text-emerald-400 transition-colors" />}
                    rightIcon={
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="p-1 rounded-lg hover:bg-white/5 text-slate-500 hover:text-emerald-400 transition-colors focus:outline-none"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    }
                    className="bg-white/[0.01] border-white/5 text-white placeholder:text-slate-600 focus:border-emerald-500/30 focus:bg-white/[0.02] h-12 rounded-xl transition-all focus:ring-1 focus:ring-emerald-500/10"
                    {...register('password')}
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition-all hover:scale-[1.005] active:scale-[0.995] mt-6 flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                loading={isLoading}
              >
                Đăng nhập ngay
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
              </Button>
            </form>

            <div className="mt-8 pt-6 border-t border-white/5 text-center">
              <p className="text-slate-500 text-xs font-semibold">
                Chưa có tài khoản?{' '}
                <Link
                  to={inviteToken ? `/register?inviteToken=${encodeURIComponent(inviteToken)}` : '/register'}
                  className="text-white hover:text-emerald-400 font-black transition-colors ml-1 underline underline-offset-4 decoration-emerald-500/20"
                >
                  Đăng ký miễn phí
                </Link>
              </p>
            </div>

            {/* Trial Accounts Dropdown */}
            <details className="mt-6 group/demo">
              <summary className="flex items-center justify-center gap-2 cursor-pointer text-[9px] font-black text-slate-600 hover:text-slate-400 uppercase tracking-[0.2em] transition-colors list-none">
                <div className="w-4 h-4 rounded-full bg-slate-800/40 border border-white/5 flex items-center justify-center">
                  <ChevronDown size={10} className="group-open/demo:rotate-180 transition-transform" />
                </div>
                Tài khoản dùng thử
              </summary>
              <div className="mt-4 p-4 rounded-xl bg-white/[0.005] border border-white/5 grid grid-cols-2 gap-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <Crown size={12} />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Admin</span>
                  </div>
                  <p className="text-xs font-black text-white">admin</p>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <User size={12} />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Member</span>
                  </div>
                  <p className="text-xs font-black text-white">user</p>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
