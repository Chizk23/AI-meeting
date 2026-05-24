import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import GroupDetail from './GroupDetail';
import { usePermission } from '../../../hooks';

// Mock dependencies
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: 'group-1' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../../../hooks', () => ({
  usePermission: vi.fn(),
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', displayName: 'Test User' },
  }),
}));

vi.mock('../../../stores', () => ({
  useGroupStore: () => ({
    currentGroup: { id: 'group-1', name: 'Test Group' },
    group: { 
      id: 'group-1', 
      name: 'Test Group', 
      description: 'A test group', 
      privacyLevel: 'internal', 
      memberCount: 5, 
      meetingCount: 10, 
      totalHours: 12 
    },
    loadGroup: vi.fn().mockResolvedValue(null),
    loadMembers: vi.fn().mockResolvedValue(null),
    loadMeetings: vi.fn().mockResolvedValue(null),
    members: [
        { id: 'user-1', email: 'user1@test.com', displayName: 'User 1', groupMemberships: [{ groupId: 'group-1', role: 'member' }] }
    ],
    meetings: [],
  }),
  useOrgStore: () => ({
    currentOrg: { id: 'org-1', name: 'Org Test' },
    members: [],
    loadGroups: vi.fn(),
  }),
  useAppStore: () => ({
    meetings: [],
    loadMeetings: vi.fn(),
    fetchStats: vi.fn().mockResolvedValue({ totalMeetings: 0, totalHours: 0, processingCount: 0 }),
  }),
}));

const renderComponent = () => {
  return render(
    <BrowserRouter>
      <GroupDetail />
    </BrowserRouter>
  );
};

describe('GroupDetail Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hiển thị Tab Cài đặt cho Group Admin', async () => {
    vi.mocked(usePermission).mockReturnValue({
      isGroupAdmin: true,
      isOrgAdmin: false,
    } as any);

    renderComponent();
    expect(await screen.findByText(/Cài đặt/i)).toBeInTheDocument();
  });

  it('hiển thị Tab Cài đặt cho Org Admin', async () => {
    vi.mocked(usePermission).mockReturnValue({
      isGroupAdmin: false,
      isOrgAdmin: true,
    } as any);

    renderComponent();
    expect(await screen.findByText(/Cài đặt/i)).toBeInTheDocument();
  });

  it('KHÔNG hiển thị Tab Cài đặt cho Member bình thường', async () => {
    vi.mocked(usePermission).mockReturnValue({
      isGroupAdmin: false,
      isOrgAdmin: false,
    } as any);

    renderComponent();
    await screen.findByText('Test Group');
    expect(screen.queryByText(/Cài đặt/i)).not.toBeInTheDocument();
  });

  it('hiển thị nội dung Tab Cài đặt khi Org Admin click vào', async () => {
    vi.mocked(usePermission).mockReturnValue({
      isGroupAdmin: false,
      isOrgAdmin: true,
    } as any);

    renderComponent();
    await screen.findByText('Test Group');
    
    const settingsTab = screen.getByRole('button', { name: /Cài đặt/i });
    fireEvent.click(settingsTab);

    expect(await screen.findByText(/Cài đặt Cấu hình Nhóm/i)).toBeInTheDocument();
  });

  it('hiển thị nút "Mời thành viên" cho Group Admin trong Tab Thành viên', async () => {
    vi.mocked(usePermission).mockReturnValue({
      isGroupAdmin: true,
      isOrgAdmin: false,
    } as any);

    renderComponent();
    await screen.findByText('Test Group');

    const membersTab = screen.getByRole('button', { name: /Thành viên/i });
    fireEvent.click(membersTab);

    expect(await screen.findByText(/Mời thành viên/i)).toBeInTheDocument();
  });

  it('KHÔNG hiển thị nút "Mời thành viên" cho Member bình thường trong Tab Thành viên', async () => {
    vi.mocked(usePermission).mockReturnValue({
      isGroupAdmin: false,
      isOrgAdmin: false,
    } as any);

    renderComponent();
    await screen.findByText('Test Group');

    const membersTab = screen.getByRole('button', { name: /Thành viên/i });
    fireEvent.click(membersTab);

    expect(screen.queryByText(/Mời thành viên/i)).not.toBeInTheDocument();
  });
});
