import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, UserX, UserCheck } from 'lucide-react';
import { api } from '../../api/client';
import type { Role } from '../../api/types';
import { roleLabel, useUser } from '../../auth/AuthProvider';
import { Badge, ConfirmDialog, ErrorSummary, Notice, PageHeader, QueryView, SelectField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate, formatDateTime } from '../../utils/format';
import { useDepartments } from './Users';
import { TeacherAvatar } from '../../components/CourseMedia';

interface Detail {
  user: { id: string; email: string; fullName: string; preferredName: string | null; role: Role; status: 'active' | 'deactivated'; departmentId: string | null; lastLoginAt: string | null; createdAt: string };
  enrollments: { id: string; status: string; enrolledAt: string; courseId: string; code: string; title: string }[];
  teaching: { courseId: string; code: string; title: string; status: string; isLead: boolean }[];
}

export default function AdminUserDetail() {
  const { userId = '' } = useParams();
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const depts = useDepartments();
  const q = useQuery({ queryKey: ['admin', 'user', userId], queryFn: () => api.get<Detail>(`/admin/users/${userId}`) });
  useDocumentTitle(q.data?.user.fullName);
  const [form, setForm] = useState({ fullName: '', email: '', role: 'student' as Role, departmentId: '' });
  const [confirm, setConfirm] = useState<'deactivate' | 'activate' | 'reset' | null>(null);
  useEffect(() => {
    if (q.data) setForm({ fullName: q.data.user.fullName, email: q.data.user.email, role: q.data.user.role, departmentId: q.data.user.departmentId ?? '' });
  }, [q.data]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin', 'user', userId] }); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); };
  const save = useMutation({
    mutationFn: () => {
      const u = q.data!.user;
      const patch: Record<string, unknown> = {};
      if (form.fullName !== u.fullName) patch.fullName = form.fullName;
      if (form.email !== u.email) patch.email = form.email;
      if (form.role !== u.role) patch.role = form.role;
      if ((form.departmentId || null) !== u.departmentId) patch.departmentId = form.departmentId || null;
      return api.patch(`/admin/users/${userId}`, patch);
    },
    onSuccess: () => { toast('Changes saved and recorded in the audit log'); refresh(); },
  });
  const status = useMutation({
    mutationFn: (s: 'active' | 'deactivated') => api.patch(`/admin/users/${userId}`, { status: s }),
    onSuccess: (_r, s) => { toast(s === 'deactivated' ? 'Account deactivated and signed out everywhere' : 'Account reactivated'); setConfirm(null); refresh(); },
    onError: (e: Error) => { toast(e.message, 'error'); setConfirm(null); },
  });
  const reset = useMutation({
    mutationFn: () => api.post(`/admin/users/${userId}/send-reset`),
    onSuccess: () => { toast('Password reset link emailed'); setConfirm(null); },
    onError: (e: Error) => { toast(e.message, 'error'); setConfirm(null); },
  });

  return (
    <Page>
      <QueryView q={q}>
        {(d) => {
          const u = d.user;
          const self = u.id === me.id;
          const protectedAccount = u.role === 'admin';
          return (
            <>
              <PageHeader crumbs={[{ label: 'People', to: '/admin/users' }, { label: u.fullName }]} title={u.fullName}
                lede={<>{roleLabel[u.role]} · joined {formatDate(u.createdAt)} · last sign-in {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'never'}</>}
                actions={<span className="person-line">{u.role === 'teacher' && <TeacherAvatar className="teacher-avatar--large" />}{u.status === 'active' ? <Badge tone="ok">Active</Badge> : <Badge tone="danger">Deactivated</Badge>}</span>} />
              {(self || protectedAccount) && (
                <Notice tone="warn"><p>{self ? 'This is your own account. Your role and status can only be changed by the system owner.' : 'Administrator accounts are managed by the system owner from the server, not through this page.'}</p></Notice>
              )}
              <div className="columns" style={{ marginTop: 'var(--s-5)' }}>
                <section className="panel" aria-labelledby="det-h">
                  <div className="panel__head"><h2 id="det-h">Account details</h2></div>
                  <form className="panel__body stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate>
                    <ErrorSummary error={save.error} />
                    <fieldset disabled={self || protectedAccount} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
                      <div className="form-grid">
                        <TextField label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                        <TextField label="Email address" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                        <SelectField label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                          hint="Remove this person from the courses they train, and end active enrolments, before changing the role.">
                          {protectedAccount && <option value="admin">Administrator</option>}
                          <option value="student">Learner</option><option value="teacher">Trainer</option>
                        </SelectField>
                        <SelectField label="Programme area" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                          <option value="">None</option>
                          {depts.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </SelectField>
                      </div>
                      <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={save.isPending}>Save changes</button></div>
                    </fieldset>
                  </form>
                </section>
                <aside className="stack">
                  <section className="panel" aria-labelledby="acc-h"><div className="panel__body stack">
                    <h2 id="acc-h" style={{ fontSize: 'var(--text-lg)' }}>Access</h2>
                    <button type="button" className="btn btn--secondary" disabled={u.status !== 'active'} onClick={() => setConfirm('reset')}><KeyRound aria-hidden="true" />Send password reset link</button>
                    {!self && !protectedAccount && (u.status === 'active'
                      ? <button type="button" className="btn btn--danger" onClick={() => setConfirm('deactivate')}><UserX aria-hidden="true" />Deactivate account</button>
                      : <button type="button" className="btn btn--secondary" onClick={() => setConfirm('activate')}><UserCheck aria-hidden="true" />Reactivate account</button>)}
                  </div></section>
                  {d.teaching.length > 0 && (
                    <section className="panel" aria-labelledby="t-h"><div className="panel__body stack-sm">
                      <h2 id="t-h" style={{ fontSize: 'var(--text-lg)' }}>Courses as trainer</h2>
                      <ul className="list">{d.teaching.map((t) => <li key={t.courseId}><Link to={`/admin/courses/${t.courseId}`}><span className="code-tag">{t.code}</span> {t.title}</Link>{t.isLead && ' (lead)'}</li>)}</ul>
                    </div></section>
                  )}
                  {d.enrollments.length > 0 && (
                    <section className="panel" aria-labelledby="e-h"><div className="panel__body stack-sm">
                      <h2 id="e-h" style={{ fontSize: 'var(--text-lg)' }}>Enrolments</h2>
                      <ul className="list">{d.enrollments.map((e) => <li key={e.id} className="list-item"><Link to={`/admin/courses/${e.courseId}`}><span className="code-tag">{e.code}</span> {e.title}</Link><Badge tone={e.status === 'active' ? 'ok' : 'outline'}>{e.status}</Badge></li>)}</ul>
                    </div></section>
                  )}
                </aside>
              </div>
              <ConfirmDialog open={confirm === 'deactivate'} onClose={() => setConfirm(null)} danger confirmLabel="Deactivate" busy={status.isPending}
                title={`Deactivate ${u.fullName}?`} onConfirm={() => status.mutate('deactivated')}
                body={<p>They are signed out immediately and cannot sign in. Their records, submissions and grades are kept.</p>} />
              <ConfirmDialog open={confirm === 'activate'} onClose={() => setConfirm(null)} confirmLabel="Reactivate" busy={status.isPending}
                title={`Reactivate ${u.fullName}?`} onConfirm={() => status.mutate('active')} body={<p>They will be able to sign in again with their existing password.</p>} />
              <ConfirmDialog open={confirm === 'reset'} onClose={() => setConfirm(null)} confirmLabel="Send link" busy={reset.isPending}
                title="Send a password reset link?" onConfirm={() => reset.mutate()} body={<p>We will email {u.email} a single-use link valid for 30 minutes.</p>} />
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}
