import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import ForgotPassword from './ForgotPassword';

const postMock = vi.fn();
vi.mock('../../../services/api', () => ({
  default: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const renderForgotPassword = () =>
  render(
    <BrowserRouter>
      <ForgotPassword />
    </BrowserRouter>
  );

describe('ForgotPassword Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Step 1 elements correctly', () => {
    renderForgotPassword();

    expect(screen.getByRole('heading', { name: /Quên mật khẩu\?/i })).toBeInTheDocument();
    expect(screen.getByText(/Email đăng ký/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gửi mã xác thực/i })).toBeInTheDocument();
  });

  it('shows error for invalid email', async () => {
    renderForgotPassword();

    const emailInput = screen.getByPlaceholderText(/name@company.com/i);
    const submitBtn = screen.getByRole('button', { name: /Gửi mã xác thực/i });

    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Email không/i)).toBeInTheDocument();
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  it('transitions to Step 2 when email is valid and API responds successfully', async () => {
    postMock.mockResolvedValue({});
    renderForgotPassword();

    const emailInput = screen.getByPlaceholderText(/name@company.com/i);
    const submitBtn = screen.getByRole('button', { name: /Gửi mã xác thực/i });

    fireEvent.change(emailInput, { target: { value: 'test@company.com' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/api/auth/forgot-password', { email: 'test@company.com' });
    });

    // Should transition to Step 2
    expect(await screen.findByText(/Mã xác thực \(6 chữ số\)/i)).toBeInTheDocument();
  });

  // TDD RED TEST: Kiểm tra sự tồn tại của thiết kế OTP inputs với ring Emerald cao cấp
  it('has premium OTP design with emerald ring indicators', async () => {
    postMock.mockResolvedValue({});
    renderForgotPassword();

    const emailInput = screen.getByPlaceholderText(/name@company.com/i);
    const submitBtn = screen.getByRole('button', { name: /Gửi mã xác thực/i });

    fireEvent.change(emailInput, { target: { value: 'test@company.com' } });
    fireEvent.click(submitBtn);

    // Transition to Step 2
    const otpLabel = await screen.findByText(/Mã xác thực \(6 chữ số\)/i);
    expect(otpLabel).toBeInTheDocument();

    // Check that OTP inputs contain modern glow rings focus:ring-emerald-500
    const firstOtpInput = document.querySelector('input[inputmode="numeric"]');
    expect(firstOtpInput).toBeInTheDocument();
    
    // Bản mới sẽ có 'focus:ring-emerald-500' thay vì 'focus:ring-indigo-500'. Lớp test này sẽ RED trước, GREEN sau.
    expect(firstOtpInput).toHaveClass('focus:ring-emerald-500');
  });
});
