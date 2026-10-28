import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Send } from 'lucide-react';
import { api } from '../../api/client';
import type { AssignmentView, Grade, QueueRow, Submission } from '../../api/types';
import { Badge, Checkbox, ConfirmDialog, EmptyState, ErrorSummary, FileLink, QueryView, TextAreaField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDocumentTitle } from '../../hooks/misc';
import { formatBytes, formatDateTime, initials } from '../../utils/format';
import { useCourse } from '../course/CourseLayout';

interface Work { student: { id: string; fullName: string; email: string }; submissions: Submission[]; grade: (Grade & { version: number; gradedBy?: string }) | null }

function queueMeta(r: QueueRow) {
  if (r.needsGrading) return 'Needs grading';
  if (r.score != null && r.releasedAt) return 'Released';
  if (r.score != null) return 'Graded · held back';
  if (r.submittedAt) return 'Submitted';
  return 'No submission';
}

function GradingStudent({ assignmentId, studentId, points, writable }: { assignmentId: string; studentId: string; points: number; writable: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['work', assignmentId, studentId], queryFn: () => api.get<Work>(`/assignments/${assignmentId}/submissions/${studentId}`) });
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [release, setRelease] = useState(false);
  const [scoreError, setScoreError] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (q.data) {
      setScore(q.data.grade ? String(q.data.grade.score) : '');
      setFeedback(q.data.grade?.feedback ?? '');
      setRelease(Boolean(q.data.grade?.releasedAt));
    }
  }, [q.data]);

  useEffect(() => {
    if (q.data) headingRef.current?.focus({ preventScroll: true });
  }, [studentId, q.data]);

  const save = useMutation({
    mutationFn: () => api.put<{ version: number; newlyReleased: boolean }>(`/assignments/${assignmentId}/grades/${studentId}`, {
      score: Number(score), feedback, release, expectedVersion: q.data?.grade?.version ?? null,
    }),
    onSuccess: (r) => {
      toast(r.newlyReleased ? 'Grade saved and released to the learner' : 'Grade saved');
      qc.invalidateQueries({ queryKey: ['work', assignmentId, studentId] });
      qc.invalidateQueries({ queryKey: ['queue', assignmentId] });
      qc.invalidateQueries({ queryKey: ['assignment', assignmentId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(score);
    if (score === '' || Number.isNaN(n) || n < 0 || n > points) { setScoreError(`Enter a score from 0 to ${points}`); return; }
    setScoreError(undefined);
    save.mutate();
  }

  return (
    <QueryView q={q}>
      {(w) => {
        const latest = w.submissions[0];
        return (
          <>
            <main className="grade-stage" aria-labelledby="work-h">
              <article className="grade-post">
                <header className="grade-post__head">
                  <span className="avatar grade-post__avatar" aria-hidden="true">{initials(w.student.fullName)}</span>
                  <div className="grade-post__who">
                    <h3 id="work-h" tabIndex={-1} ref={headingRef}>{w.student.fullName}</h3>
                    <p className="grade-post__meta">
                      {latest
                        ? <>Attempt {latest.attempt} · {formatDateTime(latest.submittedAt)}{latest.isLate ? ' · Late' : ''}</>
                        : 'No submission yet'}
                    </p>
                  </div>
                  {latest && <Badge tone="brand">Latest</Badge>}
                </header>
                {w.submissions.length === 0 ? (
                  <EmptyState title="No submission">You can still record a grade, for example for work handed in another way.</EmptyState>
                ) : (
                  <div className="grade-post__stack">
                    {w.submissions.map((s) => (
                      <section key={s.id} className="grade-post__attempt">
                        {w.submissions.length > 1 && (
                          <p className="grade-post__attempt-label">
                            Attempt {s.attempt} · {formatDateTime(s.submittedAt)}
                            {s.isLate && <> · <span className="grade-post__late">Late</span></>}
                          </p>
                        )}
                        {s.body && <div className="submission-body submission-body--post">{s.body}</div>}
                        {s.fileId && <FileLink id={s.fileId} name={s.fileName} size={formatBytes(s.fileSize)} />}
                      </section>
                    ))}
                  </div>
                )}
              </article>
            </main>
            <aside className="grade-rail" aria-labelledby="grade-h">
              <div className="grade-rail__head">
                <h3 id="grade-h">Grade</h3>
                {w.grade?.releasedAt ? <Badge tone="ok">Released</Badge> : w.grade ? <Badge tone="info">Not released</Badge> : null}
              </div>
              <form className="grade-rail__form stack" onSubmit={submit} noValidate>
                <ErrorSummary error={save.error} />
                <TextField label={`Score out of ${points}`} type="number" inputMode="decimal" min={0} max={points} step="0.5" value={score}
                  onChange={(e) => setScore(e.target.value)} error={scoreError} disabled={!writable} />
                <TextAreaField label="Feedback for the learner" hint="Specific, kind and actionable. The learner sees this when the grade is released." value={feedback}
                  onChange={(e) => setFeedback(e.target.value)} maxLength={20000} disabled={!writable} />
                <Checkbox label="Release to the learner" hint="Released grades are visible to the learner and they are notified." checked={release}
                  onChange={(e) => setRelease(e.target.checked)} disabled={!writable || Boolean(w.grade?.releasedAt)} />
                {w.grade && (
                  <p className="meta grade-rail__saved">
                    Last saved {formatDateTime(w.grade.gradedAt)}
                    {w.grade.gradedBy ? ` by ${w.grade.gradedBy}` : ''} · version {w.grade.version}
                  </p>
                )}
                {writable && (
                  <div className="form-actions grade-rail__actions">
                    <button className="btn btn--primary btn--block" type="submit" disabled={save.isPending}>
                      {save.isPending ? 'Saving…' : 'Save grade'}
                    </button>
                  </div>
                )}
              </form>
            </aside>
          </>
        );
      }}
    </QueryView>
  );
}

export default function Grading() {
  const { assignmentId = '' } = useParams();
  const { course } = useCourse();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selected = params.get('student');
  const [confirmRelease, setConfirmRelease] = useState(false);
  const a = useQuery({ queryKey: ['assignment', assignmentId], queryFn: () => api.get<AssignmentView>(`/assignments/${assignmentId}`) });
  const queue = useQuery({ queryKey: ['queue', assignmentId], queryFn: () => api.get<{ items: QueueRow[] }>(`/assignments/${assignmentId}/submissions`) });
  useDocumentTitle(a.data ? `Grading · ${a.data.assignment.title}` : 'Grading');
  const releaseAll = useMutation({
    mutationFn: () => api.post<{ released: number }>(`/assignments/${assignmentId}/grades/release`),
    onSuccess: (r) => { toast(`${r.released} grades released`); setConfirmRelease(false); qc.invalidateQueries({ queryKey: ['queue', assignmentId] }); qc.invalidateQueries({ queryKey: ['assignment', assignmentId] }); qc.invalidateQueries({ queryKey: ['work'] }); },
  });

  return (
    <QueryView q={a}>
      {(view) => (
        <div className="grade-page">
          <QueryView q={queue}>
            {(qd) => (
              <div className="grade-shell">
                <header className="grade-bar">
                  <Link
                    className="grade-bar__back"
                    to={`/courses/${course.id}/assignments/${assignmentId}`}
                    aria-label={`Back to ${view.assignment.title}`}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Link>
                  <div className="grade-bar__main">
                    <h2 tabIndex={-1} data-page-heading className="grade-bar__title">{view.assignment.title}</h2>
                    <p className="grade-bar__meta">
                      <span className="code-tag code-tag--sm">{course.code}</span>
                      Grading · {view.assignment.pointsPossible} pts
                      {qd.items.length > 0 && <> · {qd.items.filter((r) => r.needsGrading).length} need grading</>}
                    </p>
                  </div>
                  {view.writable && (view.stats?.unreleasedCount ?? 0) > 0 && (
                    <button type="button" className="btn btn--secondary btn--sm grade-bar__action" onClick={() => setConfirmRelease(true)}>
                      <Send aria-hidden="true" />Release {view.stats?.unreleasedCount}
                    </button>
                  )}
                </header>
                <div className="grade-workspace">
                <aside className="grade-queue" aria-label="Learners">
                  <p className="grade-queue__label">Learners</p>
                  <ul className="grade-queue__list">
                    {qd.items.map((r) => (
                      <li key={r.studentId}>
                        <button
                          type="button"
                          className={`grade-queue__item${selected === r.studentId ? ' is-active' : ''}${r.needsGrading ? ' grade-queue__item--attention' : ''}`}
                          aria-current={selected === r.studentId ? 'true' : undefined}
                          onClick={() => setParams({ student: r.studentId })}
                        >
                          <span className="avatar grade-queue__avatar" aria-hidden="true">{initials(r.fullName)}</span>
                          <span className="grade-queue__copy">
                            <span className="grade-queue__name">{r.fullName}</span>
                            <span className="grade-queue__meta">{queueMeta(r)}</span>
                          </span>
                          <span className="grade-queue__score tabular">
                            {r.score ?? '—'}<span className="grade-queue__denom">/{view.assignment.pointsPossible}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>

                {selected ? (
                  <GradingStudent
                    key={selected}
                    assignmentId={assignmentId}
                    studentId={selected}
                    points={view.assignment.pointsPossible}
                    writable={Boolean(view.writable)}
                  />
                ) : (
                  <>
                    <main className="grade-stage grade-stage--empty">
                      <p className="grade-stage__placeholder">Select a learner to read their submission.</p>
                    </main>
                    <aside className="grade-rail grade-rail--empty" aria-hidden="true" />
                  </>
                )}
                </div>
              </div>
            )}
          </QueryView>

          <ConfirmDialog open={confirmRelease} onClose={() => setConfirmRelease(false)} title="Release all saved grades?" confirmLabel="Release grades"
            busy={releaseAll.isPending} onConfirm={() => releaseAll.mutate()}
            body={<p>{view.stats?.unreleasedCount} learners will see their grade and feedback and receive a notification.</p>} />
        </div>
      )}
    </QueryView>
  );
}
