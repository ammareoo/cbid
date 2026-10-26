import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Markdown } from '../../src/components/Markdown';
import { ErrorSummary, QueryView, TextField, DueLabel, PublishBadge } from '../../src/components/ui';
import { ApiError } from '../../src/api/client';
import type { UseQueryResult } from '@tanstack/react-query';

describe('Markdown rendering (stored XSS defence)', () => {
  it('removes scripts, event handlers and javascript: links', () => {
    const { container } = render(
      <Markdown source={'## Title\n\n<script>alert(1)</script>\n<img src=x onerror="alert(2)">\n[click](javascript:alert(3)) <a href="#" onclick="alert(4)">x</a>'} />,
    );
    expect(container.querySelector('h2')).toHaveTextContent('Title');
    expect(container.querySelectorAll('script, img, iframe')).toHaveLength(0);
    const all = [...container.querySelectorAll('*')];
    expect(all.some((el) => [...el.attributes].some((a) => a.name.startsWith('on')))).toBe(false);
    expect(all.some((el) => /^\s*javascript:/i.test(el.getAttribute('href') ?? ''))).toBe(false);
  });
  it('opens external links safely', () => {
    render(<Markdown source="[UN CRPD](https://www.un.org/crpd)" />);
    const link = screen.getByRole('link', { name: 'UN CRPD' });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('form accessibility', () => {
  it('associates labels, hints and errors with the input', () => {
    render(<TextField label="Title" hint="Short and clear" error="Enter a title" />);
    const input = screen.getByLabelText('Title');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby')!.split(' ');
    expect(describedBy).toHaveLength(2);
    expect(document.getElementById(describedBy[1]!)).toHaveTextContent('Error: Enter a title');
  });
  it('lists server validation errors and takes focus', () => {
    const err = new ApiError(400, 'validation_error', 'Some fields need attention', [{ path: 'dueAt', message: 'Use a full date and time' }]);
    render(<ErrorSummary error={err} />);
    const box = screen.getByRole('alert');
    expect(box).toHaveFocus();
    expect(within(box).getByText(/Due At: Use a full date and time/)).toBeInTheDocument();
  });
});

describe('status is never conveyed by colour alone', () => {
  it('renders text for publication state and past-due state', () => {
    render(<><PublishBadge status="draft" /><DueLabel iso="2020-01-01T00:00:00Z" /></>);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Past due')).toBeInTheDocument();
  });
});

describe('QueryView states', () => {
  const q = (s: Partial<UseQueryResult<string>>) => s as UseQueryResult<string>;
  it('shows a labelled loading state', () => {
    render(<QueryView q={q({ isPending: true })}>{(d) => d}</QueryView>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
  it('shows an error with a retry action', async () => {
    const refetch = vi.fn();
    render(<MemoryRouter><QueryView q={q({ isPending: false, isError: true, error: new ApiError(500, 'internal_error', 'Server down'), refetch: refetch as never })}>{(d) => d}</QueryView></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Server down');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
  it('renders data when ready', () => {
    render(<QueryView q={q({ isPending: false, isError: false, data: 'Loaded content' })}>{(d) => <p>{d}</p>}</QueryView>);
    expect(screen.getByText('Loaded content')).toBeInTheDocument();
  });
});

afterEach(() => vi.restoreAllMocks());
export const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
