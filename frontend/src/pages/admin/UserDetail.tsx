import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, GraduationCap, KeyRound, Shield, UserCheck, UserX } from 'lucide-react';
import { api } from '../../api/client';
import type { Role } from '../../api/types';
import { roleLabel, useUser } from '../../auth/AuthProvider';
import { Badge, ConfirmDialog, ErrorSummary, Notice, QueryView, SelectField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate, formatDateTime, initials } from '../../utils/format';
import { useDepartments } from './Users';
import { TeacherAvatar } from '../../components/CourseMedia';

interface Detail {
  user: { id: string; email: string; fullName: string; preferredName: string | null; role: Role; status: 'active' | 'deactivated'; departmentId: string | null; lastLoginAt: string | null; createdAt: string };
  enrollments: { id: string; status: string; enrolledAt: string; courseId: string; code: string; title: string }[];
  teaching: { courseId: string; code: string; title: string; status: string; isLead: boolean }[];
}

function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <span>{label}</span>
        {hint && <span className="settings-row__hint">{hint}</span>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function CardHead({ id, icon, title, sub, tone }: {
  id: string; icon: ReactNode; title: string; sub?: string; tone?: 'teal' | 'accent';
}) {
  return (
    <header className="admin-user-card__head">
      <div className={`admin-user-card__icon${tone ? ` admin-user-card__icon--${tone}` : ''}`} aria-hidden="true">{icon}</div>
      <div>
        <h2 id={id}>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
    </header>
  );
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
          const locked = self || protectedAccount;
          const active = u.status === 'active';
          return (
            <div className="admin-user-page">
              <nav className="crumbs" aria-label="Breadcrumb">
                <ol>
                  <li><Link to="/admin/users">People</Link></li>
                  <li><span aria-current="page">{u.fullName}</span></li>
                </ol>
              </nav>

              <div className={`admin-user-hero${active ? '' : ' admin-user-hero--inactive'}`}>
                {u.role === 'teacher'
                  ? <TeacherAvatar className="teacher-avatar--large admin-user-hero__avatar" />
                  : (
                    <span className={`admin-user-hero__avatar admin-user-hero__avatar--${u.role}`} aria-hidden="true">
                      {initials(u.fullName)}
                    </span>
                  )}
                <div className="admin-user-hero__meta">
                  <h1 tabIndex={-1} data-page-heading className="admin-user-hero__name">{u.fullName}</h1>
                  <p className="admin-user-hero__email">{u.email}</p>
                  <div className="admin-user-hero__facts">
                    <span className="admin-user-hero__fact">
                      <span className="admin-user-hero__fact-label">Role</span>
                      <span className="admin-user-hero__fact-value">{roleLabel[u.role]}</span>
                    </span>
                    <span className="admin-user-hero__fact">
                      <span className="admin-user-hero__fact-label">Status</span>
                      <span className={`admin-user-hero__fact-value${active ? ' is-active' : ' is-off'}`}>
                        {active ? 'Active' : 'Deactivated'}
                      </span>
                    </span>
                    <span className="admin-user-hero__fact">
                      <span className="admin-user-hero__fact-label">Joined</span>
                      <span className="admin-user-hero__fact-value">{formatDate(u.createdAt)}</span>
                    </span>
                    <span className="admin-user-hero__fact">
                      <span className="admin-user-hero__fact-label">Last sign-in</span>
                      <span className="admin-user-hero__fact-value">
                        {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {(self || protectedAccount) && (
                <Notice tone="warn">
                  <p>{self
                    ? 'This is your own account. Your role and status can only be changed by the system owner.'
                    : 'Administrator accounts are managed by the system owner from the server, not through this page.'}</p>
                </Notice>
              )}

              <div className="admin-user-grid">
                <section className="admin-user-card" aria-labelledby="det-h">
                  <CardHead
                    id="det-h"
                    icon={<Shield width={18} height={18} />}
                    title="Account details"
                    sub="Name, email, role, and programme area."
                  />
                  <form className="settings-form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate>
                    <ErrorSummary error={save.error} />
                    <fieldset disabled={locked} className="admin-user-fieldset">
                      <SettingsRow label="Full name">
                        <TextField label="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                      </SettingsRow>
                      <SettingsRow label="Email">
                        <TextField label="Email address" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                      </SettingsRow>
                      <SettingsRow
                        label="Role"
                        hint="Remove training assignments and end active enrolments before changing role."
                      >
                        <SelectField label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                          {protectedAccount && <option value="admin">Administrator</option>}
                          <option value="student">Learner</option>
                          <option value="teacher">Trainer</option>
                        </SelectField>
                      </SettingsRow>
                      <SettingsRow label="Programme area">
                        <SelectField label="Programme area" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                          <option value="">None</option>
                          {depts.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </SelectField>
                      </SettingsRow>
                    </fieldset>
                    {!locked && (
                      <div className="settings-form__actions">
                        <button className="btn btn--primary" type="submit" disabled={save.isPending}>Save changes</button>
                      </div>
                    )}
                  </form>
                </section>

                <aside className="admin-user-aside">
                  <section className="admin-user-card" aria-labelledby="acc-h">
                    <CardHead
                      id="acc-h"
                      icon={<KeyRound width={18} height={18} />}
                      title="Access"
                      sub="Password and account status."
                      tone="teal"
                    />
                    <div className="admin-user-actions">
                      <button type="button" className="btn btn--secondary" disabled={!active} onClick={() => setConfirm('reset')}>
                        <KeyRound aria-hidden="true" />Send password reset
                      </button>
                      {!self && !protectedAccount && (active
                        ? <button type="button" className="btn btn--danger" onClick={() => setConfirm('deactivate')}><UserX aria-hidden="true" />Deactivate account</button>
                        : <button type="button" className="btn btn--secondary" onClick={() => setConfirm('activate')}><UserCheck aria-hidden="true" />Reactivate account</button>)}
                      <p className="admin-user-actions__hint">Reset links expire after 30 minutes. Deactivating signs them out everywhere.</p>
                    </div>
                  </section>

                  {d.teaching.length > 0 && (
                    <section className="admin-user-card" aria-labelledby="t-h">
                      <CardHead
                        id="t-h"
                        icon={<BookOpen width={18} height={18} />}
                        title={`Training (${d.teaching.length})`}
                        tone="accent"
                      />
                      <ul className="admin-user-links">
                        {d.teaching.map((t) => (
                          <li key={t.courseId}>
                            <Link to={`/admin/courses/${t.courseId}`}>
                              <span className="code-tag">{t.code}</span>
                              <span className="admin-user-links__title">{t.title}</span>
                              {t.isLead && <Badge tone="brand">Lead</Badge>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {d.enrollments.length > 0 && (
                    <section className="admin-user-card" aria-labelledby="e-h">
                      <CardHead
                        id="e-h"
                        icon={<GraduationCap width={18} height={18} />}
                        title={`Enrolments (${d.enrollments.length})`}
                      />
                      <ul className="admin-user-links">
                        {d.enrollments.map((e) => (
                          <li key={e.id}>
                            <Link to={`/admin/courses/${e.courseId}`}>
                              <span className="code-tag">{e.code}</span>
                              <span className="admin-user-links__title">{e.title}</span>
                              <Badge tone={e.status === 'active' ? 'ok' : 'outline'}>{e.status}</Badge>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
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
            </div>
          );
        }}
      </QueryView>
    </Page>
  );
}
