import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import Login from './Login';

const loginMock = vi.fn();
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    login: loginMock,
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const renderLogin = () =>
  render(
    <BrowserRouter>
      <Login />
    </BrowserRouter>
  );

describe('Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all key elements', () => {
    renderLogin();

    // Headers and labels
    expect(screen.getByRole('heading', { name: /Đăng nhập/i })).toBeInTheDocument();
    expect(screen.getByText(/Tên đăng nhập/i)).toBeInTheDocument();
    expect(screen.getByText('Mật khẩu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Đăng nhập ngay/i })).toBeInTheDocument();
    expect(screen.getByText(/Đăng ký miễn phí/i)).toBeInTheDocument();
  });

  it('shows validation errors when fields are empty', async () => {
    renderLogin();

    const submitBtn = screen.getByRole('button', { name: /Đăng nhập ngay/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Vui lòng nhập tên đăng nhập/i)).toBeInTheDocument();
    expect(await screen.findByText(/Vui lòng nhập mật khẩu/i)).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('submits correctly with username and password', async () => {
    loginMock.mockResolvedValue({
      systemRole: 'member',
      orgMemberships: [],
    });

    renderLogin();

    const usernameInput = screen.getByPlaceholderText(/Nhập tên đăng nhập/i);
    const passwordInput = screen.getByPlaceholderText(/Nhập mật khẩu/i);
    const submitBtn = screen.getByRole('button', { name: /Đăng nhập ngay/i });

    fireEvent.change(usernameInput, { target: { value: 'testuser' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('testuser', 'password123');
    });
  });

  // TDD RED TEST: Kiểm tra sự tồn tại của màu gradient Xanh lá (Emerald-Green) cao cấp tối giản
  it('has the premium design with emerald-green gradient title', () => {
    renderLogin();
    
    // Tìm phần tử tiêu đề chứa gradient "cuộc họp AI."
    const gradientSpan = screen.getByText('cuộc họp AI.');
    expect(gradientSpan).toBeInTheDocument();
    
    // Bản mới sẽ có 'from-emerald-400', bản cũ có 'from-indigo-400'. Lớp test này sẽ RED trước, GREEN sau.
    expect(gradientSpan).toHaveClass('from-emerald-400');
    expect(gradientSpan).toHaveClass('to-green-500');
  });
});
