import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import CreateGroupModal from './CreateGroupModal';

const useOrgStoreMock = vi.fn();
const usePermissionMock = vi.fn();
const postMock = vi.fn();

vi.mock('../../../services/api', () => ({
  default: {
    post: (...args: unknown[]) => postMock(...args),
  },
}));

vi.mock('../../../stores', () => ({
  useOrgStore: () => useOrgStoreMock(),
}));

vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => usePermissionMock(),
}));

const renderModal = (isOpen = true, onClose = vi.fn()) =>
  render(
    <BrowserRouter>
      <CreateGroupModal isOpen={isOpen} onClose={onClose} />
    </BrowserRouter>
  );

describe('CreateGroupModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgStoreMock.mockReturnValue({
      currentOrg: { id: 'org-1', name: 'ABC Company' },
      members: [],
      loadGroups: vi.fn(),
    });
    usePermissionMock.mockReturnValue({
      hasPermission: vi.fn(() => true),
      isOrgAdmin: true,
      isSystemAdmin: false,
    });
  });

  it('renders the main fields', () => {
    renderModal();

    expect(screen.getByText(/Create New Group/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Group Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
    expect(screen.getByText(/Privacy Level/i)).toBeInTheDocument();
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    renderModal(true, onClose);

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('allows editing name and description', () => {
    renderModal();

    const nameInput = screen.getByLabelText(/Group Name/i) as HTMLInputElement;
    const descInput = screen.getByLabelText(/Description/i) as HTMLTextAreaElement;

    fireEvent.change(nameInput, { target: { value: 'New AI Project' } });
    fireEvent.change(descInput, { target: { value: 'Team for AI features' } });

    expect(nameInput.value).toBe('New AI Project');
    expect(descInput.value).toBe('Team for AI features');
  });

  it('blocks submit when the user lacks permission', () => {
    usePermissionMock.mockReturnValue({
      hasPermission: vi.fn(() => false),
      isOrgAdmin: false,
      isSystemAdmin: false,
    });

    renderModal();

    expect(screen.getByText(/Ban can quyen quan tri to chuc/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Group/i })).toBeDisabled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('shows a friendly 403 error from backend', async () => {
    postMock.mockRejectedValue({
      response: {
        status: 403,
        data: { detail: 'Forbidden' },
      },
    });

    renderModal();

    fireEvent.change(screen.getByLabelText(/Group Name/i), {
      target: { value: 'New Team' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Group/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Ban can quyen quan tri to chuc/i).length).toBeGreaterThan(0);
    });
  });
});
