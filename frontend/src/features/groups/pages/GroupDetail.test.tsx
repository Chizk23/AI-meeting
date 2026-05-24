import { render, screen } from '@testing-library/react';
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
  usePermission: vi.fn(() => ({
    isGroupAdmin: true,
    isOrgAdmin: false,
    isSystemAdmin: false,
    isViewer: false,
    hasPermission: (p: string) => true,
    hasAllPermissions: (ps: string[]) => true,
    hasAnyPermission: (ps: string[]) => true,
    isRoleAtLeast: (r: any) => true,
    currentRole: 'group-admin',
    roleDisplayName: 'Group Admin',
    roleColor: 'blue'
  })),
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
    members: [],
    meetings: [],
  }),
  useOrgStore: () => ({
    currentOrg: { id: 'org-1', name: 'Org Test' },
    loadGroups: vi.fn(),
  }),
  useAppStore: () => ({
    meetings: [],
    loadMeetings: vi.fn(),
    fetchStats: vi.fn().mockResolvedValue({ totalMeetings: 0, totalHours: 0, processingCount: 0 }),
  }),
}));

vi.mock('../../../data', () => ({
  // No longer used in GroupDetail.tsx
}));

const renderComponent = () => {
  return render(
    <BrowserRouter>
      <GroupDetail />
    </BrowserRouter>
  );
};

describe('GroupDetail Component', () => {
  beforeEach(() => {
    vi.mocked(usePermission).mockReturnValue({
      isGroupAdmin: true,
      isOrgAdmin: false,
      isSystemAdmin: false,
      isViewer: false,
      hasPermission: (p: string) => true,
      hasAllPermissions: (ps: string[]) => true,
      hasAnyPermission: (ps: string[]) => true,
      isRoleAtLeast: (r: any) => true,
      currentRole: 'group-admin',
      roleDisplayName: 'Group Admin',
      roleColor: 'blue'
    } as any);
  });

  it('hiển thị thông tin nhóm cơ bản', async () => {
    renderComponent();
    expect(await screen.findByText('Test Group')).toBeInTheDocument();
    expect(screen.getByText('A test group')).toBeInTheDocument();
  });

  it('hiển thị tab Cài đặt khi là Admin', async () => {
    renderComponent();
    expect(await screen.findByText(/Cài đặt/i)).toBeInTheDocument();
  });

  it('KHÔNG hiển thị tab Cài đặt khi không phải là Admin', async () => {
    vi.mocked(usePermission).mockReturnValue({
      isGroupAdmin: false,
      isOrgAdmin: false,
      isSystemAdmin: false,
      isViewer: false,
      hasPermission: (p: string) => false,
      hasAllPermissions: (ps: string[]) => false,
      hasAnyPermission: (ps: string[]) => false,
      isRoleAtLeast: (r: any) => false,
      currentRole: 'member',
      roleDisplayName: 'Member',
      roleColor: 'gray'
    } as any);
    renderComponent();
    await screen.findByText('Test Group');
    expect(screen.queryByText(/Cài đặt/i)).not.toBeInTheDocument();
  });
  it('hiển thị tab Cài đặt khi là Org Admin dù không phải Group Admin', async () => {
    // Mock user as Org Admin
    vi.mocked(usePermission).mockReturnValue({
      isGroupAdmin: false,
      isOrgAdmin: true,
      isSystemAdmin: false,
      isViewer: false,
      hasPermission: (p: string) => true,
      hasAllPermissions: (ps: string[]) => true,
      hasAnyPermission: (ps: string[]) => true,
      isRoleAtLeast: (r: any) => true,
      currentRole: 'org-admin',
      roleDisplayName: 'Org Admin',
      roleColor: 'blue'
    } as any);

    renderComponent();
    expect(await screen.findByText(/Cài đặt/i)).toBeInTheDocument();
  });
});
