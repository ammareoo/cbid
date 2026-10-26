import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { AdminUser, Department, Paged } from '../../api/types';
import { Badge, Dialog, EmptyState, ErrorSummary, PageHeader, Pagination, QueryView, SelectField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDebounced, useDocumentTitle } from '../../hooks/misc';
import { formatDate } from '../../utils/format';
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
      <PageHeader eyebrow="Administration" title="People" lede="Learners, trainers and administrators. Deactivating an account signs the person out everywhere immediately."
        actions={<button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><UserPlus aria-hidden="true" />Add a person</button>} />
      <form className="row" style={{ alignItems: 'flex-end', marginBottom: 'var(--s-5)' }} onSubmit={(e) => e.preventDefault()} role="search">
        <div style={{ flex: '1 1 260px' }}><TextField label="Search name or email" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div style={{ flex: '0 1 180px' }}><SelectField label="Role" value={role} onChange={(e) => set({ role: e.target.value })}>
          <option value="">All roles</option><option value="student">Learners</option><option value="teacher">Trainers</option><option value="admin">Administrators</option>
        </SelectField></div>
        <div style={{ flex: '0 1 180px' }}><SelectField label="Status" value={status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option><option value="active">Active</option><option value="deactivated">Deactivated</option>
        </SelectField></div>
      </form>
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title="No people match these filters" /> : (
          <>
            <div className="table-wrap"><table className="table">
              <caption className="sr-only">People, page {d.page} of {d.totalPages}</caption>
              <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Programme area</th><th scope="col">Last sign-in</th></tr></thead>
              <tbody>{d.items.map((u) => (
                <tr key={u.id}>
                  <th scope="row"><span className="person-line">{u.role === 'teacher' && <TeacherAvatar />}<span><Link to={`/admin/users/${u.id}`}>{u.fullName}</Link><br /><span className="meta">{u.email}</span></span></span></th>
                  <td>{roleLabel[u.role]}</td>
                  <td>{u.status === 'active' ? <Badge tone="ok">Active</Badge> : <Badge tone="danger">Deactivated</Badge>}</td>
                  <td>{u.departmentName ?? <span className="muted">—</span>}</td>
                  <td className="nowrap">{u.lastLoginAt ? formatDate(u.lastLoginAt) : <span className="muted">Never</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={(p) => set({ page: String(p) })} noun="people" />
          </>
        )}
      </QueryView>
      {creating && <CreateUser open onClose={() => setCreating(false)} />}
    </Page>
  );
}
