import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AIConfigSection from './AIConfigSection';

describe('AIConfigSection', () => {
  it('shows recording and AI notes as mandatory always-on features', () => {
    render(<AIConfigSection language="vi" onLanguageChange={vi.fn()} />);

    expect(screen.getByText('Ghi âm')).toBeInTheDocument();
    expect(screen.getByText('AI biên bản')).toBeInTheDocument();
    expect(screen.getAllByText('Luôn bật')).toHaveLength(2);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
