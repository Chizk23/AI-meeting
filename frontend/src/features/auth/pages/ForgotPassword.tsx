import React, { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Check, Mail, Lock, Eye, EyeOff, ArrowRight, Clock, KeyRound, ShieldCheck } from 'lucide-react';
import { Button, Input, Logo } from '../../../components/ui';
import api from '../../../services/api';

// Step 1 schema
const step1Schema = z.object({
  email: z.string().email('Email không hợp lệ'),
});

// Step 2 schema
const step2Schema = z
  .object({
    otp: z
      .string()
      .length(6, 'Mã xác thực phải đúng 6 chữ số')
      .regex(/^\d+$/, 'Mã xác thực chỉ gồm chữ số'),
    newPassword: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirmPassword'],
  });

type Step1Data = z.infer<typeof step1Schema>;
type Step2Data = z.infer<typeof step2Schema>;

const securityRules = [
  { text: 'Mã OTP có hiệu lực trong vòng 10 phút', icon: Clock },
  { text: 'Mật khẩu mới phải từ 8 ký tự trở lên', icon: KeyRound },
  { text: 'Sử dụng kết hợp chữ, số và ký tự đặc biệt', icon: ShieldCheck },
];

const getPasswordStrength = (password: string): { level: number; label: string; color: string } => {
  if (!password) return { level: 0, label: '', color: '' };
  if (password.length < 6) return { level: 1, label: 'Yếu', color: 'bg-red-500' };
  if (password.length < 10) return { level: 2, label: 'Trung bình', color: 'bg-amber-500' };
  return { level: 3, label: 'Mạnh', color: 'bg-emerald-500' };
};

const ForgotPassword: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = React.useState<1 | 2>(1);
  const [savedEmail, setSavedEmail] = React.useState('');
  const [apiError, setApiError] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [otpDigits, setOtpDigits] = React.useState(['', '', '', '', '', '']);
  const [showNewPassword, setShowNewPassword] = React.useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false);
  const [passwordValue, setPasswordValue] = React.useState('');

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Step 1 form
  const step1Form = useForm<Step1Data>({
    resolver: zodResolver(step1Schema),
  });

  // Step 2 form
  const step2Form = useForm<Step2Data>({
    resolver: zodResolver(step2Schema),
  });

  const watchedPassword = step2Form.watch('newPassword', '');
  React.useEffect(() => {
    setPasswordValue(watchedPassword || '');
  }, [watchedPassword]);

  const passwordStrength = getPasswordStrength(passwordValue);

  // OTP input handlers
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...otpDigits];
    newDigits[index] = value.slice(-1);
    setOtpDigits(newDigits);
    // Set combined OTP value in form
    step2Form.setValue('otp', newDigits.join(''), { shouldValidate: true });
    // Auto-focus next
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newDigits = [...otpDigits];
    pasted.split('').forEach((char, i) => {
      if (i < 6) newDigits[i] = char;
    });
    setOtpDigits(newDigits);
    step2Form.setValue('otp', newDigits.join(''), { shouldValidate: true });
    otpRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const onStep1Submit = async (data: Step1Data) => {
    setIsLoading(true);
    setApiError('');
    try {
      await api.post('/api/auth/forgot-password', { email: data.email });
      setSavedEmail(data.email);
      setStep(2);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setApiError('Email không tồn tại trong hệ thống.');
      } else {
        setApiError('Có lỗi xảy ra. Vui lòng thử lại.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onStep2Submit = async (data: Step2Data) => {
    setIsLoading(true);
    setApiError('');
    try {
      await api.post('/api/auth/reset-password', {
        email: savedEmail,
        otp: data.otp,
        newPassword: data.newPassword,
      });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 400 || status === 422) {
        setApiError('Mã xác thực không hợp lệ hoặc đã hết hạn.');
      } else {
        setApiError('Có lỗi xảy ra. Vui lòng thử lại.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsLoading(true);
    setApiError('');
    try {
      await api.post('/api/auth/forgot-password', { email: savedEmail });
    } catch {
      setApiError('Không thể gửi lại mã. Vui lòng thử lại.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#030712] relative overflow-hidden px-4 selection:bg-emerald-500/30 font-sans">
      {/* Premium Minimalist Background */}
      <div className="absolute inset-0 dot-grid opacity-[0.05] pointer-events-none" />
      
      {/* Static Light Orbs - Ultra High Performance */}
      <div className="absolute top-[10%] left-[-10%] w-[600px] h-[600px] bg-emerald-500/[0.03] rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[550px] h-[550px] bg-green-600/[0.03] rounded-full blur-[110px] pointer-events-none" />

      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-16 items-center relative z-10 my-8">
        {/* Left Content - Desktop Presentation */}
        <div className="hidden lg:block space-y-12">
          <div className="flex items-center gap-3">
            <Logo variant="dark" size="sm" showSubtext={false} className="origin-left scale-105" />
          </div>

          <div className="space-y-8">
            <h1 className="text-6xl font-black text-white leading-[1.15] tracking-tight">
              Khôi phục <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-slate-200 to-green-500">
                truy cập.
              </span>
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed max-w-md font-medium">
              Đừng lo lắng, chúng tôi sẽ hỗ trợ bạn thiết lập lại mật khẩu và lấy lại quyền truy cập hệ thống một cách an toàn, bảo mật nhất.
            </p>
          </div>

          <div className="space-y-4">
            <p className="text-xs font-black text-emerald-400 uppercase tracking-[0.3em]">Quy tắc bảo mật</p>
            {securityRules.map((rule, i) => {
              const IconComponent = rule.icon;
              return (
                <div 
                  key={i}
                  className="flex items-center gap-4 text-slate-300"
                >
                  <div className="w-8 h-8 rounded-xl bg-white/[0.005] border border-white/5 flex items-center justify-center">
                    <IconComponent size={12} className="text-emerald-400" />
                  </div>
                  <span className="font-bold text-sm text-slate-300">{rule.text}</span>
                </div>
              );
            })}
          </div>

          <Link
            to="/login"
            className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-black uppercase tracking-widest text-xs transition-all hover:gap-3"
          >
            <ArrowLeft size={16} />
            Quay lại đăng nhập
          </Link>
        </div>

        {/* Right Content - Form */}
        <div className="relative">
          <div className="bg-slate-900/30 border border-slate-800/60 backdrop-blur-2xl p-8 sm:p-12 rounded-3xl shadow-2xl relative overflow-hidden transition-all duration-300 group/card">
            {/* Minimalist Top Accent Line */}
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
            
            {/* Mobile View Logo */}
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <Logo variant="dark" size="sm" showSubtext={false} />
            </div>

            <div className="mb-6">
              <h2 className="text-3xl font-black text-white tracking-tight mb-2">Quên mật khẩu?</h2>
              <p className="text-slate-400 text-sm font-semibold leading-relaxed">
                {step === 1
                  ? 'Nhập email của bạn để nhận mã xác thực OTP.'
                  : `Mã xác thực đã được gửi tới ${savedEmail}`}
              </p>
            </div>

            {/* Progress Indicator */}
            <div className="flex gap-2 mb-8">
              <div className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${step >= 1 ? 'bg-gradient-to-r from-emerald-500 to-green-500 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-white/10'}`} />
              <div className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${step >= 2 ? 'bg-gradient-to-r from-emerald-500 to-green-500 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'bg-white/10'}`} />
            </div>

            {apiError && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {apiError}
              </div>
            )}

            {success && (
              <div className="p-8 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-6">
                  <Check size={28} className="text-emerald-400" />
                </div>
                <h3 className="text-white text-xl font-black mb-2">Thành công!</h3>
                <p className="text-slate-400 text-sm font-semibold">Mật khẩu của bạn đã được cập nhật thành công.</p>
              </div>
            )}

            {!success && (
              <div>
                {step === 1 ? (
                  <div>
                    <form onSubmit={step1Form.handleSubmit(onStep1Submit)} noValidate className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Email đăng ký</label>
                        <Input
                          type="email"
                          placeholder="name@company.com"
                          error={step1Form.formState.errors.email?.message}
                          disabled={isLoading}
                          leftIcon={<Mail size={16} className="text-slate-500" />}
                          className="bg-white/[0.01] border-white/5 text-white placeholder:text-slate-600 focus:border-emerald-500/30 focus:bg-white/[0.02] h-12 rounded-xl transition-all focus:ring-1 focus:ring-emerald-500/10"
                          {...step1Form.register('email')}
                        />
                      </div>
                      <Button
                        type="submit"
                        className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition-all hover:scale-[1.005] active:scale-[0.995] mt-6 flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                        loading={isLoading}
                      >
                        Gửi mã xác thực
                        <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
                      </Button>
                    </form>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <form onSubmit={step2Form.handleSubmit(onStep2Submit)} className="space-y-6">
                      <div className="space-y-4">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Mã xác thực (6 chữ số)</label>
                        <div className="flex gap-2 justify-between">
                          {otpDigits.map((digit, index) => (
                            <input
                              key={index}
                              ref={(el) => { otpRefs.current[index] = el; }}
                              type="text"
                              inputMode="numeric"
                              maxLength={1}
                              value={digit}
                              onChange={(e) => handleOtpChange(index, e.target.value)}
                              onKeyDown={(e) => handleOtpKeyDown(index, e)}
                              onPaste={handleOtpPaste}
                              disabled={isLoading}
                              className="w-full h-12 text-center text-lg font-black rounded-xl border border-white/5 bg-white/[0.01] text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all focus:bg-white/[0.02]"
                            />
                          ))}
                        </div>
                        {step2Form.formState.errors.otp && (
                          <p className="text-xs text-red-400 font-bold ml-1">{step2Form.formState.errors.otp.message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Mật khẩu mới</label>
                        <div className="relative">
                          <Input
                            type={showNewPassword ? 'text' : 'password'}
                            placeholder="Tối thiểu 8 ký tự"
                            error={step2Form.formState.errors.newPassword?.message}
                            disabled={isLoading}
                            leftIcon={<Lock size={16} className="text-slate-500" />}
                            className="bg-white/[0.01] border-white/5 text-white placeholder:text-slate-600 focus:border-emerald-500/30 focus:bg-white/[0.02] h-12 rounded-xl transition-all focus:ring-1 focus:ring-emerald-500/10"
                            {...step2Form.register('newPassword')}
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-emerald-400 transition-colors"
                          >
                            {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        {passwordValue && (
                          <div className="px-1 pt-2">
                            <div className="flex gap-1.5 h-1.5">
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
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Xác nhận mật khẩu</label>
                        <div className="relative">
                          <Input
                            type={showConfirmPassword ? 'text' : 'password'}
                            placeholder="Nhập lại mật khẩu"
                            error={step2Form.formState.errors.confirmPassword?.message}
                            disabled={isLoading}
                            leftIcon={<Lock size={16} className="text-slate-500" />}
                            className="bg-white/[0.01] border-white/5 text-white placeholder:text-slate-600 focus:border-emerald-500/30 focus:bg-white/[0.02] h-12 rounded-xl transition-all focus:ring-1 focus:ring-emerald-500/10"
                            {...step2Form.register('confirmPassword')}
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-emerald-400 transition-colors"
                          >
                            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>

                      <Button
                        type="submit"
                        className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition-all hover:scale-[1.005] active:scale-[0.995] mt-6 flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
                        loading={isLoading}
                      >
                        Cập nhật mật khẩu
                        <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
                      </Button>

                      <button
                        type="button"
                        onClick={handleResendCode}
                        disabled={isLoading}
                        className="w-full text-center text-xs font-black text-slate-500 hover:text-emerald-400 uppercase tracking-widest transition-colors mt-2"
                      >
                        Gửi lại mã xác nhận
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-white/5 text-center lg:hidden">
              <Link
                to="/login"
                className="text-emerald-400 hover:text-emerald-300 font-black uppercase tracking-widest text-xs transition-colors inline-flex items-center gap-2"
              >
                <ArrowLeft size={16} />
                Quay lại đăng nhập
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
