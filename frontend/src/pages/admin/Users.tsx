import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, UserPlus } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { AdminUser, Department, Paged } from '../../api/types';
import { Dialog, EmptyState, ErrorSummary, PageHeader, Pagination, QueryView, SelectField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDebounced, useDocumentTitle } from '../../hooks/misc';
import { formatDate, initials } from '../../utils/format';
import { roleLabel } from '../../auth/AuthProvider';
import { TeacherAvatar } from '../../components/CourseMedia';

export function useDepartments() {
  return useQuery({ queryKey: ['admin', 'departments'], queryFn: () => api.get<{ items: Department[] }>('/admin/departments'), staleTime: 60_000 });
}

function CreateUser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const depts = useDepartments();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [departmentId, setDepartmentId] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ id: string }>('/admin/users', { email, fullName, role, departmentId: departmentId || null }),
    onSuccess: (r) => { toast(`Account created. An invitation has been emailed to ${email}.`); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); onClose(); navigate(`/admin/users/${r.id}`); },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Add a person" description="They receive an email invitation to set their own password. Administrator accounts are created by the system owner, not here.">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} noValidate>
        <ErrorSummary error={m.error} />
        <TextField label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />
        <TextField label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as 'student' | 'teacher')}>
          <option value="student">Learner</option><option value="teacher">Trainer</option>
        </SelectField>
        <SelectField label="Programme area (optional)" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">None</option>
          {depts.data?.items.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </SelectField>
        <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={m.isPending}>Create and send invitation</button><button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

function PersonCard({ user: u }: { user: AdminUser }) {
  const active = u.status === 'active';
  return (
    <Link className={`admin-person${active ? '' : ' admin-person--inactive'}`} to={`/admin/users/${u.id}`}>
      {u.role === 'teacher'
        ? <TeacherAvatar className="admin-person__avatar-img" />
        : <span className={`admin-person__avatar admin-person__avatar--${u.role}`} aria-hidden="true">{initials(u.fullName)}</span>}
      <span className="admin-person__body">
        <span className="admin-person__name">{u.fullName}</span>
        <span className="admin-person__email">{u.email}</span>
        {u.departmentName && <span className="admin-person__dept">{u.departmentName}</span>}
      </span>
      <span className="admin-person__stats" aria-label="Account details">
        <span className="admin-person__stat">
          <span className="admin-person__stat-value">{roleLabel[u.role]}</span>
          <span className="admin-person__stat-label">Role</span>
        </span>
        <span className="admin-person__stat">
          <span className={`admin-person__stat-value admin-person__status${active ? ' is-active' : ' is-off'}`}>
            {active ? 'Active' : 'Off'}
          </span>
          <span className="admin-person__stat-label">Status</span>
        </span>
        <span className="admin-person__stat">
          <span className="admin-person__stat-value admin-person__stat-value--muted">
            {u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never'}
          </span>
          <span className="admin-person__stat-label">Last sign-in</span>
        </span>
      </span>
      <ChevronRight className="admin-person__chevron" aria-hidden="true" width={18} height={18} />
    </Link>
  );
}

export default function AdminUsers() {
  useDocumentTitle('People');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [creating, setCreating] = useState(false);
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const term = useDebounced(search.trim(), 300);
  const set = (patch: Record<string, string>) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); if (!('page' in patch)) n.delete('page'); return n; });
  const q = useQuery({
    queryKey: ['admin', 'users', term, role, status, page],
    queryFn: () => api.get<Paged<AdminUser>>(`/admin/users${qs({ search: term, role, status, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });

  return (
    <Page>
      <div className="admin-people-page">
        <PageHeader
          title="People"
          lede="Learners, trainers, and administrators."
          actions={<button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><UserPlus aria-hidden="true" />Add a person</button>}
        />
        <form className="admin-people-toolbar" onSubmit={(e) => e.preventDefault()} role="search">
          <TextField label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email" />
          <SelectField label="Role" value={role} onChange={(e) => set({ role: e.target.value })}>
            <option value="">All roles</option>
            <option value="student">Learners</option>
            <option value="teacher">Trainers</option>
            <option value="admin">Administrators</option>
          </SelectField>
          <SelectField label="Status" value={status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
          </SelectField>
        </form>
        <QueryView q={q}>
          {(d) => d.items.length === 0 ? <EmptyState title="No people match these filters" /> : (
            <>
              <ul className="admin-people-list" aria-label={`People, page ${d.page} of ${d.totalPages}`}>
                {d.items.map((u) => (
                  <li key={u.id}><PersonCard user={u} /></li>
                ))}
              </ul>
              <Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={(p) => set({ page: String(p) })} noun="people" />
            </>
          )}
        </QueryView>
      </div>
      {creating && <CreateUser open onClose={() => setCreating(false)} />}
    </Page>
  );
}
