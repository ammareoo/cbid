import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Award, BookOpen, Calendar, GraduationCap, MapPin, Pencil, Users } from 'lucide-react';
import { api } from '../../api/client';
import { DELIVERY_LABEL, type CourseModule } from '../../api/types';
import { ConfirmDialog, Dialog, ErrorSummary, Notice, SectionTitle, TextAreaField, TextField } from '../../components/ui';
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
  const progress = Math.min(100, Math.max(0, course.progress ?? 0));
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

  const assessmentNote = course.deliveryMode === 'online'
    ? 'Online coursework and quizzes. Completing learners receive a CBID Institute certificate.'
    : 'Online coursework, then a supervised assessment at CBID Institute, Karachi. Completing learners receive a CBID Institute certificate.';

  const hasAbout = Boolean(course.summary || course.description);

  return (
    <div className="course-overview">
      {learner && (
        <section className="overview-mobile-cta" aria-label="Continue learning">
          <div className="overview-mobile-cta__ring" style={{ '--overview-p': progress } as React.CSSProperties}>
            <span className="overview-mobile-cta__pct tabular">{progress}%</span>
          </div>
          <div className="overview-mobile-cta__copy">
            <p className="overview-mobile-cta__label">Your progress</p>
            {nextItem ? (
              <Link className="overview-mobile-cta__link" to={`/courses/${course.id}/items/${nextItem.id}`}>
                Continue · {nextItem.title}
                <ArrowRight aria-hidden="true" width={18} height={18} />
              </Link>
            ) : modules.data ? (
              <p className="overview-mobile-cta__done">All published content complete</p>
            ) : null}
          </div>
        </section>
      )}

      <article className="overview-main" aria-labelledby="about-h">
        <SectionTitle
          title="About"
          headingId="about-h"
          actions={isStaff && course.writable && (
            <button type="button" className="icon-btn" aria-label="Edit course details" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
            </button>
          )}
        />
        {!hasAbout ? (
          <p className="overview-main__empty muted">No description yet.{isStaff && course.writable ? ' Use edit to add a summary and details.' : ''}</p>
        ) : (
          <>
            {course.summary && <p className="overview-bio">{course.summary}</p>}
            {course.description && (
              <div className="overview-article">
                <Markdown source={course.description} className="prose overview-prose" />
              </div>
            )}
          </>
        )}

        <div className="overview-main__extras">
          {course.audience && (
            <section className="overview-block" aria-labelledby="overview-audience-h">
              <h3 id="overview-audience-h" className="overview-block__title">Who it is for</h3>
              <p className="overview-block__text overview-block__text--accent">{course.audience}</p>
            </section>
          )}
          <section className="overview-block overview-block--assessment" aria-labelledby="overview-assessment-h">
            <h3 id="overview-assessment-h" className="overview-block__title">
              <GraduationCap aria-hidden="true" width={16} height={16} />
              Assessment
            </h3>
            <p className="overview-block__text">{assessmentNote}</p>
          </section>
          <section className="overview-block" aria-labelledby="overview-team-h">
            <h3 id="overview-team-h" className="overview-block__title">Training team</h3>
            {course.teachers.length ? (
              <ul className="overview-team">
                {course.teachers.map((t) => (
                  <li key={t.id} className="overview-team__person">
                    <TeacherAvatar />
                    <span className="overview-team__meta">
                      <span className="overview-team__name">{t.fullName}</span>
                      {t.isLead && <span className="overview-team__role">Lead trainer</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="overview-block__text muted">To be assigned</p>
            )}
          </section>
        </div>
      </article>

      <aside className="overview-rail" aria-label="Course details">
        <div className="overview-sheet">
          {learner && (
            <div className="overview-sheet__hero">
              <div className="overview-sheet__hero-row">
                <div className="overview-ring" style={{ '--overview-p': progress } as React.CSSProperties} role="img" aria-label={`${progress} percent complete`}>
                  <span className="overview-ring__inner tabular">{progress}%</span>
                </div>
                <div className="overview-sheet__hero-copy">
                  <p className="overview-sheet__hero-label">Progress</p>
                  <p className="overview-sheet__hero-stat">Content completed</p>
                </div>
              </div>
              {nextItem ? (
                <Link className="btn btn--primary btn--block overview-sheet__continue" to={`/courses/${course.id}/items/${nextItem.id}`}>
                  <span className="overview-sheet__continue-main">Continue</span>
                  <span className="overview-sheet__continue-sub">{nextItem.title}</span>
                </Link>
              ) : modules.data ? (
                <p className="overview-sheet__hero-note">You have finished all published modules.</p>
              ) : null}
            </div>
          )}

          <div className="overview-sheet__body">
            <ul className="overview-facts">
              <li className="overview-facts__item overview-facts__item--wide">
                <Calendar className="overview-facts__icon" aria-hidden="true" width={17} height={17} />
                <div className="overview-facts__copy">
                  <span className="overview-facts__label">Term</span>
                  <span className="overview-facts__value">{course.termName}</span>
                  <span className="overview-facts__hint">{formatDate(course.termStartsOn)} – {formatDate(course.termEndsOn)}</span>
                </div>
              </li>
              <li className="overview-facts__item">
                <MapPin className="overview-facts__icon" aria-hidden="true" width={17} height={17} />
                <div className="overview-facts__copy">
                  <span className="overview-facts__label">Delivery</span>
                  <span className="overview-facts__value">{DELIVERY_LABEL[course.deliveryMode]}</span>
                </div>
              </li>
              <li className="overview-facts__item">
                <Users className="overview-facts__icon" aria-hidden="true" width={17} height={17} />
                <div className="overview-facts__copy">
                  <span className="overview-facts__label">Enrolled</span>
                  <span className="overview-facts__value">
                    {course.enrolledCount}{course.capacity ? ` / ${course.capacity}` : ''}
                  </span>
                  {course.capacity ? (
                    <span
                      className="overview-facts__meter"
                      role="presentation"
                      style={{ '--enroll-p': `${Math.min(100, (course.enrolledCount / course.capacity) * 100)}%` } as React.CSSProperties}
                    />
                  ) : null}
                </div>
              </li>
              {course.departmentName && (
                <li className="overview-facts__item overview-facts__item--wide">
                  <BookOpen className="overview-facts__icon" aria-hidden="true" width={17} height={17} />
                  <div className="overview-facts__copy">
                    <span className="overview-facts__label">Programme</span>
                    <span className="overview-facts__value">{course.departmentName}</span>
                  </div>
                </li>
              )}
            </ul>

            {learner && course.certificate && (
              <div className="overview-sheet__cert">
                <Award aria-hidden="true" width={20} height={20} />
                <div>
                  <p className="overview-sheet__cert-title">Certificate awarded</p>
                  <p className="meta">{formatDate(course.certificate.issuedAt)} · <span className="serial">{course.certificate.serial}</span></p>
                  <Link className="btn btn--secondary btn--sm" to={`/certificates/${course.certificate.id}`}>View certificate</Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {course.relationship === 'visitor' && (
          <Notice><p>You are viewing the public outline. <Link to="/catalogue">Enrol from the catalogue</Link> to see modules, assignments and quizzes.</p></Notice>
        )}

        {learner && course.enrollmentStatus === 'active' && course.status === 'published' && (
          <button type="button" className="btn btn--ghost overview-withdraw" onClick={() => setLeaving(true)}>
            Withdraw from this course
          </button>
        )}
      </aside>

      {isStaff && <EditCourse open={editing} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={leaving} onClose={() => setLeaving(false)} title={`Withdraw from ${course.code}?`} danger confirmLabel="Withdraw"
        busy={withdraw.isPending} onConfirm={() => withdraw.mutate()}
        body={<p>You will lose access to course content. Your submitted work and grades are kept. Re-joining needs the CBID Institute team.</p>} />
    </div>
  );
}
