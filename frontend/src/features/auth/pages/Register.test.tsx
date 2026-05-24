import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import Register from './Register';

const registerAndSetSessionMock = vi.fn();
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    registerAndSetSession: registerAndSetSessionMock,
  }),
}));

const postMock = vi.fn();
const getMock = vi.fn();
vi.mock('../../../services/api', () => ({
  default: {
    post: (...args: unknown[]) => postMock(...args),
    get: (...args: unknown[]) => getMock(...args),
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

const renderRegister = () =>
  render(
    <BrowserRouter>
      <Register />
    </BrowserRouter>
  );

describe('Register Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all key elements', () => {
    renderRegister();

    expect(screen.getByRole('heading', { name: /Dang ky/i })).toBeInTheDocument();
    expect(screen.getByText('Ho')).toBeInTheDocument();
    expect(screen.getByText('Ten')).toBeInTheDocument();
    expect(screen.getByText('Email cong viec')).toBeInTheDocument();
    expect(screen.getByText('Mat khau')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tao tai khoan ngay/i })).toBeInTheDocument();
  });

  it('shows validation errors when fields are empty', async () => {
    renderRegister();

    const submitBtn = screen.getByRole('button', { name: /Tao tai khoan ngay/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Vui long nhap ho/i)).toBeInTheDocument();
    expect(await screen.findByText(/Vui long nhap ten/i)).toBeInTheDocument();
    expect(await screen.findByText(/Email khong hop le/i)).toBeInTheDocument();
    expect(await screen.findByText(/Vui long chon ngay sinh/i)).toBeInTheDocument();
  });

  it('shows password strength indicator when typing password', async () => {
    renderRegister();

    const passwordInput = screen.getByPlaceholderText(/Toi thieu 8 ky tu/i);
    fireEvent.change(passwordInput, { target: { value: 'short' } });

    // Yeu
    expect(await screen.findByText(/Yeu/i)).toBeInTheDocument();
  });

  // TDD RED TEST: Kiểm tra sự tồn tại của thiết kế layout chia nhóm mới (Personal & Account Info) với màu Emerald
  it('has the premium design with segmented headers', () => {
    renderRegister();
    
    // Bản mới sẽ có các tiêu đề phụ chia nhóm "Thông tin cá nhân" và "Thông tin tài khoản"
    const personalHeader = screen.getByText(/Thông tin cá nhân/i);
    const accountHeader = screen.getByText(/Thông tin tài khoản/i);
    
    expect(personalHeader).toBeInTheDocument();
    expect(accountHeader).toBeInTheDocument();
    expect(personalHeader).toHaveClass('text-emerald-400');
  });
});
