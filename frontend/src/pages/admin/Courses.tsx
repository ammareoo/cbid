import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Users } from 'lucide-react';
import { api, qs } from '../../api/client';
import { DELIVERY_LABEL, type AdminCourse, type DeliveryMode, type Paged, type Term } from '../../api/types';
import { Dialog, EmptyState, ErrorSummary, PageHeader, Pagination, PublishBadge, QueryView, SelectField, TextAreaField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDebounced, useDocumentTitle } from '../../hooks/misc';
import { useDepartments } from './Users';
import { coursePhoto, coursePhotoFocus, TeacherAvatar } from '../../components/CourseMedia';

export function useTerms() {
  return useQuery({ queryKey: ['admin', 'terms'], queryFn: () => api.get<{ items: Term[] }>('/admin/terms'), staleTime: 60_000 });
}

function CreateCourse({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const terms = useTerms();
  const depts = useDepartments();
  const [f, setF] = useState({ code: '', title: '', summary: '', termId: '', departmentId: '', audience: '', deliveryMode: 'online' as DeliveryMode });
  const m = useMutation({
    mutationFn: () => api.post<{ id: string }>('/admin/courses', { ...f, code: f.code.toUpperCase(), departmentId: f.departmentId || null }),
    onSuccess: (r) => { toast('Course created as a draft'); qc.invalidateQueries({ queryKey: ['admin', 'courses'] }); onClose(); navigate(`/admin/courses/${r.id}`); },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Create a course" description="New courses start as drafts that learners cannot see.">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} noValidate>
        <ErrorSummary error={m.error} />
        <div className="form-grid">
          <TextField label="Course code" hint="Letters then numbers, e.g. DET201" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={12} />
          <SelectField label="Term" value={f.termId} onChange={(e) => setF({ ...f, termId: e.target.value })}>
            <option value="">Choose a term</option>
            {terms.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
        </div>
        <TextField label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={160} />
        <TextAreaField label="Summary" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} maxLength={500} />
        <SelectField label="Programme area" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
          <option value="">None</option>
          {depts.data?.items.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </SelectField>
        <div className="form-grid">
          <TextField label="Who it is for (optional)" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} maxLength={200} />
          <SelectField label="Delivery" value={f.deliveryMode} onChange={(e) => setF({ ...f, deliveryMode: e.target.value as DeliveryMode })}>
            {(Object.keys(DELIVERY_LABEL) as DeliveryMode[]).map((mode) => <option key={mode} value={mode}>{DELIVERY_LABEL[mode]}</option>)}
          </SelectField>
        </div>
        <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={m.isPending}>Create course</button><button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

function AdminCourseCard({ course: c }: { course: AdminCourse }) {
  const meta = [c.termName, c.departmentName].filter(Boolean).join(' · ');
  return (
    <Link className="admin-course" to={`/admin/courses/${c.id}`}>
      <img
        className="admin-course__cover"
        src={coursePhoto(c.code || c.id)}
        alt=""
        width={120}
        height={90}
        loading="lazy"
        style={{ objectPosition: coursePhotoFocus(c.code || c.id) }}
      />
      <span className="admin-course__body">
        <span className="admin-course__top">
          <span className="code-tag">{c.code}</span>
          <PublishBadge status={c.status} />
        </span>
        <span className="admin-course__title">{c.title}</span>
        <span className="admin-course__meta">
          {meta && <span>{meta}</span>}
          <span className="admin-course__trainers">
            <TeacherAvatar />
            {c.teachers || 'No trainers assigned'}
          </span>
        </span>
      </span>
      <span className="admin-course__stats" aria-label="Course stats">
        <span className="admin-course__stat">
          <span className="admin-course__stat-value">
            <Users aria-hidden="true" width={15} height={15} />
            {c.studentCount}{c.capacity != null ? `/${c.capacity}` : ''}
          </span>
          <span className="admin-course__stat-label">Learners</span>
        </span>
        <span className="admin-course__stat">
          <span className="admin-course__stat-value admin-course__stat-value--text">
            {c.enrollmentOpen ? 'Open' : 'Invite only'}
          </span>
          <span className="admin-course__stat-label">Access</span>
        </span>
      </span>
      <ChevronRight className="admin-course__chevron" aria-hidden="true" width={18} height={18} />
    </Link>
  );
}

export default function AdminCourses() {
  useDocumentTitle('Courses');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const status = params.get('status') ?? '';
  const termId = params.get('termId') ?? '';
  const page = Number(params.get('page') ?? 1);
  const term = useDebounced(search.trim(), 300);
  const terms = useTerms();
  const set = (patch: Record<string, string>) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); if (!('page' in patch)) n.delete('page'); return n; });
  const q = useQuery({
    queryKey: ['admin', 'courses', term, status, termId, page],
    queryFn: () => api.get<Paged<AdminCourse>>(`/admin/courses${qs({ search: term, status, termId, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });
  return (
    <Page>
      <div className="admin-courses-page">
        <PageHeader
          title="Courses"
          lede="Drafts, trainers, and enrolment."
          actions={<button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" />Create course</button>}
        />
        <form className="admin-courses-toolbar" onSubmit={(e) => e.preventDefault()} role="search">
          <TextField label="Search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title or code" />
          <SelectField label="Status" value={status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </SelectField>
          <SelectField label="Term" value={termId} onChange={(e) => set({ termId: e.target.value })}>
            <option value="">All terms</option>
            {terms.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
        </form>
        <QueryView q={q}>
          {(d) => d.items.length === 0 ? <EmptyState title="No courses match these filters" /> : (
            <>
              <ul className="admin-courses-list" aria-label="Courses">
                {d.items.map((c) => (
                  <li key={c.id}><AdminCourseCard course={c} /></li>
                ))}
              </ul>
              <Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={(p) => set({ page: String(p) })} noun="courses" />
            </>
          )}
        </QueryView>
      </div>
      {creating && <CreateCourse open onClose={() => setCreating(false)} />}
    </Page>
  );
}
