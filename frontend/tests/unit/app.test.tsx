import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../../src/App';
import { AuthProvider } from '../../src/auth/AuthProvider';
import { ToastProvider } from '../../src/components/Toast';
import type { Role } from '../../src/api/types';

const user = (role: Role) => ({
  id: 'u1', email: `${role}@cbid.example`, fullName: role === 'student' ? 'Amina Khan' : role === 'teacher' ? 'Dr. Sana Mirza' : 'Nadia Hussain',
  preferredName: null, role, timezone: 'Asia/Karachi',
  permissions: role === 'admin' ? ['admin.users', 'admin.audit'] : role === 'teacher' ? ['grades.manage'] : ['assignments.submit'],
});

/** Fake backend: answers by path so the real pages, router and guards run unmodified. */
function mockApi(role: Role | null, overrides: Record<string, () => Response> = {}) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input).replace(/^\/api/, '').split('?')[0]!;
    if (overrides[url]) return overrides[url]!();
    if (url === '/auth/session') return json(role ? { user: user(role), csrfToken: 'csrf', expiresAt: '2030-01-01T00:00:00Z' } : { user: null });
    if (url === '/notifications/unread-count') return json({ unread: 3 });
    if (url === '/settings/public') return json({ institute_name: 'CBID Institute', maintenance_banner: '' });
    if (url === '/announcements') return json({ items: [], page: 1, pageSize: 3, total: 0, totalPages: 1 });
    if (url === '/me/dashboard') {
      return json(role === 'teacher'
        ? { role: 'teacher', courses: [], toGrade: [], upcoming: [] }
        : { role: 'student', courses: [], upcoming: [], feedback: [] });
    }
    if (url === '/admin/dashboard') return json({ counts: { activeStudents: 10, activeTeachers: 3, deactivatedUsers: 0, publishedCourses: 4, draftCourses: 2, archivedCourses: 1, activeEnrollments: 16, submissionsLast7Days: 3, activeUsersLast7Days: 3 }, attention: [], recentActivity: [] });
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider><AuthProvider><App /></AuthProvider></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
});
afterEach(() => vi.restoreAllMocks());

describe('routing and role-based navigation', () => {
  it('sends signed-out visitors to the sign-in page', async () => {
    mockApi(null);
    renderAt('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows a student their dashboard and student navigation only', async () => {
    mockApi('student');
    renderAt('/dashboard');
    expect(await screen.findByRole('heading', { level: 1, name: /Amina/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Catalogue' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
    expect(screen.getAllByText('You are not enrolled in any courses yet').length).toBe(1);
  });

  it('redirects a student away from administrator pages', async () => {
    mockApi('student');
    renderAt('/admin/users');
    expect(await screen.findByRole('heading', { level: 1, name: /Amina/ })).toBeInTheDocument();
  });

  it('shows administrators the administration navigation', async () => {
    mockApi('admin');
    renderAt('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Audit' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Catalogue' })).not.toBeInTheDocument();
  });

  it('announces unread notifications in the toolbar label', async () => {
    mockApi('teacher');
    renderAt('/dashboard');
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
  });
});

describe('sign-in form', () => {
  it('validates empty fields before calling the server', async () => {
    const f = mockApi(null);
    renderAt('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address')).toBeInTheDocument();
    expect(f.mock.calls.some(([u]) => String(u).includes('/auth/login'))).toBe(false);
  });

  it('shows the server message on failed sign-in and clears the password', async () => {
    mockApi(null, {
      '/auth/login': () => new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Email or password is incorrect, or the account is temporarily locked.' } }), { status: 401, headers: { 'content-type': 'application/json' } }),
    });
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Email address'), 'amina.khan@cbid.example');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});

describe('CBID Institute identity and certificates', () => {
  const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('shows the institute logo and contact details from settings on sign-in', async () => {
    mockApi(null, {
      '/branding': json({ institute_name: 'CBID Institute', organisation_name: 'CBID Network PK Sindh', support_email: 'help@cbid.example',
        contact_phone: '+92 21 1234567', contact_address: 'Gulshan-e-Iqbal, Karachi', website_url: 'https://cbidnetwork.org' }),
    });
    renderAt('/login');
    expect(await screen.findByRole('img', { name: /CBID Institute/ })).toBeInTheDocument();
    expect(await screen.findAllByRole('link', { name: 'help@cbid.example' })).not.toHaveLength(0);
  });

  it('labels roles as Learner and gives learners a Certificates page', async () => {
    mockApi('student', { '/certificates': json({ items: [] }) });
    renderAt('/certificates');
    expect(await screen.findByRole('heading', { level: 1, name: 'Certificates' })).toBeInTheDocument();
    expect(screen.getAllByText('Learner').length).toBeGreaterThan(0);
    expect(await screen.findByText('No certificates yet')).toBeInTheDocument();
  });

  it('verifies a certificate serial without signing in', async () => {
    mockApi(null, {
      '/verify/CBID-2026-ABCD2345': json({ serial: 'CBID-2026-ABCD2345', recipientName: 'Amina Khan', courseCode: 'DET101',
        courseTitle: 'Disability Equality Training', issuedAt: '2026-05-01T09:00:00Z', valid: true, revokedAt: null,
        issuer: 'CBID Institute', organisation: 'CBID Network PK Sindh' }),
    });
    renderAt('/verify');
    await userEvent.type(await screen.findByLabelText('Serial number'), 'not a serial');
    await userEvent.click(screen.getByRole('button', { name: 'Check certificate' }));
    expect(screen.getByText(/Enter the serial exactly as printed/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Serial number'));
    await userEvent.type(screen.getByLabelText('Serial number'), 'cbid-2026-abcd2345');
    await userEvent.click(screen.getByRole('button', { name: 'Check certificate' }));
    expect(await screen.findByText('Valid certificate')).toBeInTheDocument();
    expect(screen.getByText('Amina Khan')).toBeInTheDocument();
  });
});
