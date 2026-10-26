import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Send } from 'lucide-react';
import { api } from '../../api/client';
import type { AssignmentView, Grade, QueueRow, Submission } from '../../api/types';
import { Badge, Checkbox, ConfirmDialog, EmptyState, ErrorSummary, FileLink, QueryView, TextAreaField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDocumentTitle } from '../../hooks/misc';
import { formatBytes, formatDateTime } from '../../utils/format';
import { useCourse } from '../course/CourseLayout';

interface Work { student: { id: string; fullName: string; email: string }; submissions: Submission[]; grade: (Grade & { version: number; gradedBy?: string }) | null }

function rowStatus(r: QueueRow) {
  if (r.needsGrading) return <Badge tone="warn">Needs grading</Badge>;
  if (r.score != null && r.releasedAt) return <Badge tone="ok" icon={<CheckCircle2 aria-hidden="true" />}>Released</Badge>;
  if (r.score != null) return <Badge tone="info">Graded · not released</Badge>;
  return <Badge tone="outline">No submission</Badge>;
}

function GradePanel({ assignmentId, studentId, points, writable }: { assignmentId: string; studentId: string; points: number; writable: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['work', assignmentId, studentId], queryFn: () => api.get<Work>(`/assignments/${assignmentId}/submissions/${studentId}`) });
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [release, setRelease] = useState(false);
  const [scoreError, setScoreError] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const loaded = Boolean(q.data);
  useEffect(() => {
    if (loaded) { headingRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); headingRef.current?.focus({ preventScroll: true }); }
  }, [loaded]);
  useEffect(() => {
    if (q.data) {
      setScore(q.data.grade ? String(q.data.grade.score) : '');
      setFeedback(q.data.grade?.feedback ?? '');
      setRelease(Boolean(q.data.grade?.releasedAt));
    }
  }, [q.data]);

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
      {(w) => (
        <div className="split">
          <section className="stack" aria-labelledby="work-h">
            <h3 id="work-h" tabIndex={-1} ref={headingRef}>{w.student.fullName}</h3>
            {w.submissions.length === 0 ? <EmptyState title="No submission">You can still record a grade, for example for work handed in another way.</EmptyState> : (
              <ol className="list">
                {w.submissions.map((s) => (
                  <li key={s.id} className="stack-sm">
                    <span className="row" style={{ gap: 8 }}><strong>Attempt {s.attempt}</strong><span className="meta">{formatDateTime(s.submittedAt)}</span>{s.isLate && <Badge tone="warn">Late</Badge>}{s.attempt === w.submissions[0]?.attempt && <Badge tone="brand">Latest</Badge>}</span>
                    {s.body && <div className="submission-body">{s.body}</div>}
                    {s.fileId && <FileLink id={s.fileId} name={s.fileName} size={formatBytes(s.fileSize)} />}
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="panel" aria-labelledby="grade-h" style={{ position: 'sticky', top: 'calc(var(--topbar-h) + 16px)' }}>
            <div className="panel__head"><h3 id="grade-h">Grade</h3>{w.grade?.releasedAt ? <Badge tone="ok">Released</Badge> : w.grade ? <Badge tone="info">Not released</Badge> : null}</div>
            <form className="panel__body stack" onSubmit={submit} noValidate>
              <ErrorSummary error={save.error} />
              <TextField label={`Score out of ${points}`} type="number" inputMode="decimal" min={0} max={points} step="0.5" value={score}
                onChange={(e) => setScore(e.target.value)} error={scoreError} disabled={!writable} />
              <TextAreaField label="Feedback for the learner" hint="Specific, kind and actionable. The learner sees this when the grade is released." value={feedback}
                onChange={(e) => setFeedback(e.target.value)} maxLength={20000} disabled={!writable} />
              <Checkbox label="Release to the learner" hint="Released grades are visible to the learner and they are notified." checked={release}
                onChange={(e) => setRelease(e.target.checked)} disabled={!writable || Boolean(w.grade?.releasedAt)} />
              {w.grade && <p className="meta">Last saved {formatDateTime(w.grade.gradedAt)}{w.grade.gradedBy ? ` by ${w.grade.gradedBy}` : ''} · version {w.grade.version}</p>}
              {writable && <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save grade'}</button></div>}
            </form>
          </section>
        </div>
      )}
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
        <div className="stack-lg">
          <div className="stack-sm">
            <nav className="crumbs" aria-label="Breadcrumb"><ol>
              <li><Link to={`/courses/${course.id}/assignments`}>Assignments</Link></li>
              <li><Link to={`/courses/${course.id}/assignments/${assignmentId}`}>{view.assignment.title}</Link></li>
              <li><span aria-current="page">Grading</span></li>
            </ol></nav>
            <div className="row-between">
              <h2 tabIndex={-1} data-page-heading style={{ fontSize: 'var(--text-2xl)' }}>Grading: {view.assignment.title}</h2>
              {view.writable && (view.stats?.unreleasedCount ?? 0) > 0 && (
                <button type="button" className="btn btn--secondary" onClick={() => setConfirmRelease(true)}><Send aria-hidden="true" />Release {view.stats?.unreleasedCount} {view.stats?.unreleasedCount === 1 ? 'grade' : 'grades'}</button>
              )}
            </div>
          </div>
          <QueryView q={queue}>
            {(qd) => (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">Learners and submission status</caption>
                  <thead><tr><th scope="col">Learner</th><th scope="col">Latest submission</th><th scope="col">Status</th><th scope="col" className="num">Score</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
                  <tbody>
                    {qd.items.map((r) => (
                      <tr key={r.studentId} aria-current={selected === r.studentId ? 'true' : undefined} style={selected === r.studentId ? { background: 'var(--brand-tint)' } : undefined}>
                        <th scope="row">{r.fullName}</th>
                        <td>{r.submittedAt ? <><span className="nowrap">{formatDateTime(r.submittedAt)}</span> {r.isLate && <Badge tone="warn">Late</Badge>}<br /><span className="meta">{r.attempts} attempt{r.attempts === 1 ? '' : 's'}</span></> : <span className="muted">—</span>}</td>
                        <td>{rowStatus(r)}</td>
                        <td className="num tabular">{r.score ?? '—'} / {view.assignment.pointsPossible}</td>
                        <td><button type="button" className="btn btn--secondary btn--sm" onClick={() => setParams({ student: r.studentId })}>{r.score != null ? 'Review' : 'Grade'}<span className="sr-only"> {r.fullName}</span></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryView>
          {selected ? <GradePanel key={selected} assignmentId={assignmentId} studentId={selected} points={view.assignment.pointsPossible} writable={Boolean(view.writable)} />
            : <p className="muted">Choose a learner to view their work and record a grade.</p>}
          <ConfirmDialog open={confirmRelease} onClose={() => setConfirmRelease(false)} title="Release all saved grades?" confirmLabel="Release grades"
            busy={releaseAll.isPending} onConfirm={() => releaseAll.mutate()}
            body={<p>{view.stats?.unreleasedCount} learners will see their grade and feedback and receive a notification.</p>} />
        </div>
      )}
    </QueryView>
  );
}
