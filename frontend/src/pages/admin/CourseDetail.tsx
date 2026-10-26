import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ExternalLink, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { api, qs } from '../../api/client';
import { Badge, Checkbox, ConfirmDialog, EmptyState, ErrorSummary, PageHeader, PublishBadge, QueryView, SelectField, TextAreaField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDebounced, useDocumentTitle } from '../../hooks/misc';
import { formatDate } from '../../utils/format';
import { DELIVERY_LABEL, type DeliveryMode } from '../../api/types';
import { useDepartments } from './Users';
import { useTerms } from './Courses';
import { CourseCover, TeacherAvatar } from '../../components/CourseMedia';

interface Detail {
  course: { id: string; code: string; title: string; summary: string; description: string; status: 'draft' | 'published' | 'archived'; enrollmentOpen: boolean; capacity: number | null; termId: string; departmentId: string | null; createdAt: string; archivedAt: string | null; audience: string; deliveryMode: DeliveryMode };
  teachers: { id: string; fullName: string; email: string; isLead: boolean }[];
  enrollments: { id: string; status: string; enrolledAt: string; userId: string; fullName: string; email: string }[];
}

function PersonPicker({ kind: role, label, onPick, exclude }: { kind: 'student' | 'teacher'; label: string; onPick: (id: string, name: string) => void; exclude: string[] }) {
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 250);
  const q = useQuery({
    queryKey: ['admin', 'people', role, term],
    queryFn: () => api.get<{ items: { id: string; fullName: string; email: string }[] }>(`/admin/people${qs({ search: term, role })}`),
    enabled: term.length >= 2,
  });
  const results = (q.data?.items ?? []).filter((p) => !exclude.includes(p.id));
  return (
    <div className="stack-sm">
      <TextField label={label} type="search" hint="Type at least two letters of a name or email." value={search} onChange={(e) => setSearch(e.target.value)} />
      {term.length >= 2 && (
        <div aria-live="polite">
          {q.isPending ? <p className="meta">Searching…</p> : results.length === 0 ? <p className="meta">No matching {role}s.</p> : (
            <ul className="list">{results.map((p) => (
              <li key={p.id} className="list-item" style={{ alignItems: 'center' }}>
                <span className="person-line">{role === 'teacher' && <TeacherAvatar />}<span>{p.fullName}<br /><span className="meta">{p.email}</span></span></span>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => { onPick(p.id, p.fullName); setSearch(''); }}><UserPlus aria-hidden="true" />Add<span className="sr-only"> {p.fullName}</span></button>
              </li>
            ))}</ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminCourseDetail() {
  const { courseId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const terms = useTerms();
  const depts = useDepartments();
  const q = useQuery({ queryKey: ['admin', 'course', courseId], queryFn: () => api.get<Detail>(`/admin/courses/${courseId}`) });
  useDocumentTitle(q.data ? `${q.data.course.code} administration` : 'Course');
  const [f, setF] = useState<Detail['course'] | null>(null);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | 'publish' | null>(null);
  useEffect(() => { if (q.data) setF(q.data.course); }, [q.data]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin', 'course', courseId] }); qc.invalidateQueries({ queryKey: ['admin', 'courses'] }); qc.invalidateQueries({ queryKey: ['course', courseId] }); };
  const fail = (e: Error) => { toast(e.message, 'error'); setConfirm(null); };

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/admin/courses/${courseId}`, patch),
    onSuccess: () => { toast('Course updated'); setConfirm(null); refresh(); },
    onError: fail,
  });
  const del = useMutation({ mutationFn: () => api.del(`/admin/courses/${courseId}`), onSuccess: () => { toast('Draft course deleted'); navigate('/admin/courses'); }, onError: fail });
  const addTeacher = useMutation({ mutationFn: ({ id }: { id: string; name: string }) => api.put(`/admin/courses/${courseId}/teachers/${id}`, { isLead: false }), onSuccess: (_r, v) => { toast(`${v.name} assigned`); refresh(); }, onError: fail });
  const setLead = useMutation({ mutationFn: (id: string) => api.put(`/admin/courses/${courseId}/teachers/${id}`, { isLead: true }), onSuccess: refresh, onError: fail });
  const removeTeacher = useMutation({ mutationFn: (id: string) => api.del(`/admin/courses/${courseId}/teachers/${id}`), onSuccess: () => { toast('Trainer removed'); refresh(); }, onError: fail });
  const enrol = useMutation({ mutationFn: ({ id }: { id: string; name: string }) => api.post(`/admin/courses/${courseId}/enrollments`, { userIds: [id] }), onSuccess: (_r, v) => { toast(`${v.name} enrolled`); refresh(); }, onError: fail });
  const setEnrolment = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/admin/enrollments/${id}`, { status }), onSuccess: () => { toast('Enrolment updated'); refresh(); }, onError: fail });

  return (
    <Page>
      <QueryView q={q}>
        {(d) => f && (
          <>
            <PageHeader crumbs={[{ label: 'Courses', to: '/admin/courses' }, { label: d.course.code }]} title={d.course.title}
              lede={<>Created {formatDate(d.course.createdAt)}{d.course.archivedAt ? ` · archived ${formatDate(d.course.archivedAt)}` : ''}</>}
              actions={<><PublishBadge status={d.course.status} /><Link className="btn btn--secondary btn--sm" to={`/courses/${courseId}`}>Open course<ExternalLink aria-hidden="true" /></Link></>} />
            <CourseCover courseKey={d.course.code || d.course.id} className="admin-course-cover" />
            <div className="columns">
              <div className="stack-lg">
                <section className="panel" aria-labelledby="set-h">
                  <div className="panel__head"><h2 id="set-h">Course settings</h2></div>
                  <form className="panel__body stack" onSubmit={(e) => { e.preventDefault(); save.mutate({ code: f.code, title: f.title, summary: f.summary, termId: f.termId, departmentId: f.departmentId, enrollmentOpen: f.enrollmentOpen, capacity: f.capacity, audience: f.audience, deliveryMode: f.deliveryMode }); }} noValidate>
                    <ErrorSummary error={save.error} />
                    <div className="form-grid">
                      <TextField label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
                      <SelectField label="Term" value={f.termId} onChange={(e) => setF({ ...f, termId: e.target.value })}>
                        {terms.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </SelectField>
                      <div className="span-2"><TextField label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
                      <div className="span-2"><TextAreaField label="Summary" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} maxLength={500} /></div>
                      <SelectField label="Programme area" value={f.departmentId ?? ''} onChange={(e) => setF({ ...f, departmentId: e.target.value || null })}>
                        <option value="">None</option>{depts.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </SelectField>
                      <TextField label="Capacity (optional)" type="number" min={1} hint="Applies to self-enrolment." value={f.capacity ?? ''} onChange={(e) => setF({ ...f, capacity: e.target.value ? Number(e.target.value) : null })} />
                      <div className="span-2"><TextField label="Who it is for" hint="Shown in the catalogue, e.g. Employers, HR teams and line managers." value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} maxLength={200} /></div>
                      <SelectField label="Delivery" value={f.deliveryMode} onChange={(e) => setF({ ...f, deliveryMode: e.target.value as DeliveryMode })}>
                        {(Object.keys(DELIVERY_LABEL) as DeliveryMode[]).map((m) => <option key={m} value={m}>{DELIVERY_LABEL[m]}</option>)}
                      </SelectField>
                    </div>
                    <Checkbox label="Learners can enrol themselves from the catalogue" hint="Also requires self-enrolment to be enabled in institute settings." checked={f.enrollmentOpen} onChange={(e) => setF({ ...f, enrollmentOpen: e.target.checked })} />
                    <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={save.isPending}>Save settings</button></div>
                  </form>
                </section>

                <section className="panel" aria-labelledby="enr-h">
                  <div className="panel__head"><h2 id="enr-h">Enrolment ({d.enrollments.filter((e) => e.status === 'active').length} active)</h2></div>
                  <div className="panel__body stack">
                    <PersonPicker kind="student" label="Enrol a learner" exclude={d.enrollments.filter((e) => e.status === 'active').map((e) => e.userId)} onPick={(id, name) => enrol.mutate({ id, name })} />
                    {d.enrollments.length === 0 ? <EmptyState title="No learners enrolled" /> : (
                      <div className="table-wrap"><table className="table">
                        <thead><tr><th scope="col">Learner</th><th scope="col">Since</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Change status</span></th></tr></thead>
                        <tbody>{d.enrollments.map((e) => (
                          <tr key={e.id}>
                            <th scope="row"><Link to={`/admin/users/${e.userId}`}>{e.fullName}</Link><br /><span className="meta">{e.email}</span></th>
                            <td>{formatDate(e.enrolledAt)}</td>
                            <td><Badge tone={e.status === 'active' ? 'ok' : e.status === 'completed' ? 'info' : 'outline'}>{e.status}</Badge></td>
                            <td>
                              <label className="sr-only" htmlFor={`st-${e.id}`}>Status for {e.fullName}</label>
                              <select id={`st-${e.id}`} className="select" style={{ minHeight: 36, width: 'auto' }} value={e.status} onChange={(ev) => setEnrolment.mutate({ id: e.id, status: ev.target.value })}>
                                <option value="active">Active</option><option value="completed">Completed</option><option value="dropped">Withdrawn</option>
                              </select>
                            </td>
                          </tr>
                        ))}</tbody>
                      </table></div>
                    )}
                  </div>
                </section>
              </div>

              <aside className="stack-lg">
                <section className="panel" aria-labelledby="pub-h"><div className="panel__body stack">
                  <h2 id="pub-h" style={{ fontSize: 'var(--text-lg)' }}>Publication</h2>
                  {d.course.status === 'draft' && <><p className="muted">Learners cannot see draft courses.</p><button type="button" className="btn btn--primary" onClick={() => setConfirm('publish')}>Publish course</button>
                    <button type="button" className="btn btn--ghost" onClick={() => setConfirm('delete')}><Trash2 aria-hidden="true" />Delete draft</button></>}
                  {d.course.status === 'published' && <><p className="muted">Archive at the end of term. Archived courses are read-only but keep all records.</p><button type="button" className="btn btn--secondary" onClick={() => setConfirm('archive')}><Archive aria-hidden="true" />Archive course</button></>}
                  {d.course.status === 'archived' && <><p className="muted">This course is read-only.</p><button type="button" className="btn btn--secondary" onClick={() => save.mutate({ status: 'published' })}>Restore to published</button></>}
                </div></section>

                <section className="panel" aria-labelledby="tea-h"><div className="panel__body stack">
                  <h2 id="tea-h" style={{ fontSize: 'var(--text-lg)' }}>Training team</h2>
                  {d.teachers.length === 0 ? <p className="muted">No trainer assigned yet.</p> : (
                    <ul className="list">{d.teachers.map((t) => (
                      <li key={t.id} className="list-item" style={{ alignItems: 'center' }}>
                        <span className="person-line"><TeacherAvatar /><span>{t.fullName} {t.isLead && <Badge tone="brand">Lead</Badge>}<br /><span className="meta">{t.email}</span></span></span>
                        <span className="row" style={{ gap: 0 }}>
                          {!t.isLead && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLead.mutate(t.id)}>Make lead<span className="sr-only"> {t.fullName}</span></button>}
                          <button type="button" className="icon-btn" aria-label={`Remove ${t.fullName}`} onClick={() => removeTeacher.mutate(t.id)}><UserMinus aria-hidden="true" /></button>
                        </span>
                      </li>
                    ))}</ul>
                  )}
                  <PersonPicker kind="teacher" label="Assign a trainer" exclude={d.teachers.map((t) => t.id)} onPick={(id, name) => addTeacher.mutate({ id, name })} />
                </div></section>
              </aside>
            </div>
            <ConfirmDialog open={confirm === 'publish'} onClose={() => setConfirm(null)} confirmLabel="Publish" busy={save.isPending} title="Publish this course?"
              onConfirm={() => save.mutate({ status: 'published' })} body={<p>Enrolled learners and the catalogue will show this course immediately.</p>} />
            <ConfirmDialog open={confirm === 'archive'} onClose={() => setConfirm(null)} confirmLabel="Archive" busy={save.isPending} title="Archive this course?"
              onConfirm={() => save.mutate({ status: 'archived', enrollmentOpen: false })} body={<p>Trainers can no longer change content or grades. Learners keep read access to their work and grades.</p>} />
            <ConfirmDialog open={confirm === 'delete'} onClose={() => setConfirm(null)} danger confirmLabel="Delete" busy={del.isPending} title="Delete this draft course?"
              onConfirm={() => del.mutate()} body={<p>This removes the course and its draft content permanently.</p>} />
          </>
        )}
      </QueryView>
    </Page>
  );
}
