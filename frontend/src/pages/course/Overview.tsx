import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Award, Pencil } from 'lucide-react';
import { api } from '../../api/client';
import { DELIVERY_LABEL, type CourseModule } from '../../api/types';
import { ConfirmDialog, Dialog, ErrorSummary, Notice, ProgressBar, TextAreaField, TextField } from '../../components/ui';
import { Markdown } from '../../components/Markdown';
import { TeacherAvatar } from '../../components/CourseMedia';
import { useToast } from '../../components/Toast';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate } from '../../utils/format';
import { useCourse } from './CourseLayout';

function EditCourse({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { course } = useCourse();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(course.title);
  const [summary, setSummary] = useState(course.summary);
  const [description, setDescription] = useState(course.description);
  const m = useMutation({
    mutationFn: () => api.patch(`/courses/${course.id}`, { title, summary, description }),
    onSuccess: () => { toast('Course details saved'); qc.invalidateQueries({ queryKey: ['course', course.id] }); onClose(); },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Edit course details" wide description="Code, term, audience, delivery and publication are managed by administrators.">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <ErrorSummary error={m.error} />
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
        <TextAreaField label="Summary" hint="One or two sentences shown in the catalogue." value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} />
        <TextAreaField label="Description" hint="Supports Markdown: ## headings, **bold**, lists and links." value={description} onChange={(e) => setDescription(e.target.value)} className="textarea--tall" maxLength={20000} />
        <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={m.isPending}>Save</button><button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

export default function Overview() {
  const { course, isStaff } = useCourse();
  useDocumentTitle(course.title);
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const learner = course.relationship === 'learner';
  const modules = useQuery({
    queryKey: ['modules', course.id],
    queryFn: () => api.get<{ modules: CourseModule[] }>(`/courses/${course.id}/modules`),
    enabled: learner,
  });
  const nextItem = modules.data?.modules.flatMap((m) => m.items).find((i) => !i.completed);
  const withdraw = useMutation({
    mutationFn: () => api.post(`/courses/${course.id}/withdraw`),
    onSuccess: () => { toast(`You withdrew from ${course.code}`); qc.invalidateQueries(); setLeaving(false); },
    onError: (e: Error) => { toast(e.message, 'error'); setLeaving(false); },
  });

  return (
    <div className="columns">
      <div className="stack-lg">
        <section className="stack" aria-labelledby="about-h">
          <div className="row-between">
            <h2 id="about-h" tabIndex={-1} data-page-heading>About this course</h2>
            {isStaff && course.writable && <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(true)}><Pencil aria-hidden="true" />Edit details</button>}
          </div>
          <p className="muted" style={{ fontSize: 'var(--text-lg)', maxWidth: '62ch' }}>{course.summary}</p>
          {course.description ? <Markdown source={course.description} /> : <p className="muted">No description yet.</p>}
        </section>
        {course.relationship === 'visitor' && (
          <Notice><p>You are viewing the public outline. <Link to="/catalogue">Enrol from the catalogue</Link> to see modules, assignments and quizzes.</p></Notice>
        )}
      </div>
      <aside className="stack" aria-label="Course facts">
        {learner && (
          <section className="panel" aria-labelledby="prog-h">
            <div className="panel__body stack">
              <h2 id="prog-h" style={{ fontSize: 'var(--text-lg)' }}>Your progress</h2>
              <ProgressBar value={course.progress} label="Content completed" />
              {nextItem ? (
                <Link className="btn btn--primary" to={`/courses/${course.id}/items/${nextItem.id}`}>Continue: {nextItem.title}<ArrowRight aria-hidden="true" /></Link>
              ) : modules.data ? <p className="muted">You have completed all published content.</p> : null}
            </div>
          </section>
        )}
        {learner && course.certificate && (
          <section className="panel panel--accent" aria-labelledby="cert-h">
            <div className="panel__body stack-sm">
              <h2 id="cert-h" className="row" style={{ fontSize: 'var(--text-lg)', gap: 8 }}><Award aria-hidden="true" />Certificate awarded</h2>
              <p className="muted">Issued {formatDate(course.certificate.issuedAt)} · serial <span className="serial">{course.certificate.serial}</span></p>
              <Link className="btn btn--secondary btn--sm" to={`/certificates/${course.certificate.id}`}>View and print</Link>
            </div>
          </section>
        )}
        <section className="panel" aria-labelledby="facts-h">
          <div className="panel__body stack-sm">
            <h2 id="facts-h" style={{ fontSize: 'var(--text-lg)' }}>Course facts</h2>
            <dl className="stack-sm" style={{ margin: 0 }}>
              <div><dt className="meta">Term</dt><dd style={{ margin: 0 }}>{course.termName} ({formatDate(course.termStartsOn)} – {formatDate(course.termEndsOn)})</dd></div>
              {course.departmentName && <div><dt className="meta">Programme area</dt><dd style={{ margin: 0 }}>{course.departmentName}</dd></div>}
              <div><dt className="meta">Training team</dt><dd style={{ margin: 0 }}>{course.teachers.length ? course.teachers.map((t) => <span className="teacher-line" key={t.id}><TeacherAvatar />{t.fullName}{t.isLead ? ' (lead)' : ''}</span>) : 'To be assigned'}</dd></div>
              {course.audience && <div><dt className="meta">Who it is for</dt><dd style={{ margin: 0 }}>{course.audience}</dd></div>}
              <div><dt className="meta">Delivery</dt><dd style={{ margin: 0 }}>{DELIVERY_LABEL[course.deliveryMode]}</dd></div>
              <div><dt className="meta">Assessment and certificate</dt><dd style={{ margin: 0 }}>{course.deliveryMode === 'online'
                ? 'Online coursework and quizzes. Completing learners receive a CBID Institute certificate.'
                : 'Online coursework, then a supervised assessment at CBID Institute, Karachi. Completing learners receive a CBID Institute certificate.'}</dd></div>
              <div><dt className="meta">Enrolled</dt><dd style={{ margin: 0 }}>{course.enrolledCount}{course.capacity ? ` of ${course.capacity} places` : ' learners'}</dd></div>
            </dl>
          </div>
        </section>
        {learner && course.enrollmentStatus === 'active' && course.status === 'published' && (
          <button type="button" className="btn btn--ghost" onClick={() => setLeaving(true)}>Withdraw from this course</button>
        )}
      </aside>
      {isStaff && <EditCourse open={editing} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={leaving} onClose={() => setLeaving(false)} title={`Withdraw from ${course.code}?`} danger confirmLabel="Withdraw"
        busy={withdraw.isPending} onConfirm={() => withdraw.mutate()}
        body={<p>You will lose access to course content. Your submitted work and grades are kept. Re-joining needs the CBID Institute team.</p>} />
    </div>
  );
}
