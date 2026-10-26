import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Play } from 'lucide-react';
import { api } from '../../api/client';
import type { QuizView } from '../../api/types';
import { Badge, ConfirmDialog, Notice, PublishBadge, QueryView } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime } from '../../utils/format';
import { useCourse } from './CourseLayout';
import { QuizBuilder } from './QuizBuilder';
import { QuizWindowBadge, windowState } from './Quizzes';

interface ResultRow { id: string; fullName: string; attemptNo: number; status: string; submittedAt: string | null; score: number | null; maxScore: number | null }

function StaffQuiz({ v }: { v: QuizView }) {
  const [editing, setEditing] = useState(false);
  const results = useQuery({ queryKey: ['quiz', v.quiz.id, 'results'], queryFn: () => api.get<{ items: ResultRow[] }>(`/quizzes/${v.quiz.id}/results`) });
  return (
    <div className="stack-lg">
      <div className="row">
        <PublishBadge status={v.quiz.status} /><QuizWindowBadge q={v.quiz} />
        <span className="meta">{v.questions?.length} questions · {v.totalPoints} points · {v.quiz.maxAttempts} attempt{v.quiz.maxAttempts > 1 ? 's' : ''}{v.quiz.timeLimitMinutes ? ` · ${v.quiz.timeLimitMinutes} minutes` : ''}</span>
        {v.writable && <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(true)}><Pencil aria-hidden="true" />Edit quiz</button>}
      </div>
      <section aria-labelledby="qs-h" className="stack">
        <h3 id="qs-h">Questions and answer key</h3>
        <ol className="stack" style={{ paddingLeft: '1.25rem' }}>
          {v.questions?.map((q) => (
            <li key={q.id} className="stack-sm">
              <p><strong>{q.prompt}</strong> <span className="meta">({q.points} pt{q.points === 1 ? '' : 's'})</span></p>
              {q.kind === 'short' ? <p className="meta">Accepted: {q.acceptedAnswers?.join(', ')}</p> : (
                <ul>
                  {q.options.map((o) => {
                    const ok = q.correctOptionIds?.includes(o.id);
                    return <li key={o.id}>{o.label} {ok && <Badge tone="ok" icon={<CheckCircle2 aria-hidden="true" />}>Correct</Badge>}</li>;
                  })}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="res-h" className="stack">
        <h3 id="res-h">Results</h3>
        <QueryView q={results}>
          {(r) => r.items.length === 0 ? <p className="muted">No attempts yet.</p> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th scope="col">Learner</th><th scope="col">Attempt</th><th scope="col">Submitted</th><th scope="col" className="num">Score</th></tr></thead>
              <tbody>{r.items.map((x) => (
                <tr key={x.id}><th scope="row">{x.fullName}</th><td>{x.attemptNo}</td>
                  <td>{x.status === 'submitted' ? formatDateTime(x.submittedAt) : <Badge tone="warn">In progress</Badge>}</td>
                  <td className="num tabular">{x.score != null ? `${x.score} / ${x.maxScore}` : '—'}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </QueryView>
      </section>
      {editing && <QuizBuilder courseId={v.quiz.courseId} quiz={v.quiz} questions={v.questions} locked={(v.attemptCount ?? 0) > 0} open onClose={() => setEditing(false)} />}
    </div>
  );
}

function LearnerQuiz({ v }: { v: QuizView }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const attempts = v.attempts ?? [];
  const open = attempts.find((a) => a.status === 'in_progress' && new Date(a.deadlineAt) > new Date());
  const used = attempts.length;
  const state = windowState(v.quiz);
  const start = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/quizzes/${v.quiz.id}/attempts`),
    onSuccess: (r) => navigate(`/attempts/${r.id}`),
    onError: (e: Error) => { setConfirm(false); toast(e.message, 'error'); },
  });
  const canStart = state === 'open' && used < v.quiz.maxAttempts;
  return (
    <div className="columns">
      <div className="stack-lg">
        {v.quiz.description && <p style={{ maxWidth: '65ch', whiteSpace: 'pre-wrap' }}>{v.quiz.description}</p>}
        <dl className="panel panel__body stack-sm" style={{ margin: 0 }}>
          <div className="row-between"><dt>Questions</dt><dd style={{ margin: 0 }}>{v.questionCount} ({v.totalPoints} points)</dd></div>
          <div className="row-between"><dt>Time limit</dt><dd style={{ margin: 0 }}>{v.quiz.timeLimitMinutes ? `${v.quiz.timeLimitMinutes} minutes from when you start` : 'None'}</dd></div>
          <div className="row-between"><dt>Attempts</dt><dd style={{ margin: 0 }}>{used} of {v.quiz.maxAttempts} used</dd></div>
          <div className="row-between"><dt>Window</dt><dd style={{ margin: 0 }}>{formatDateTime(v.quiz.opensAt)} – {formatDateTime(v.quiz.closesAt)}</dd></div>
        </dl>
        <Notice><p>If you need extra time or another adjustment, contact your trainer before you start. Time keeps running if you leave the page.</p></Notice>
        <div className="row">
          {open ? <Link className="btn btn--primary" to={`/attempts/${open.id}`}><Play aria-hidden="true" />Resume attempt {open.attemptNo}</Link>
            : canStart ? <button type="button" className="btn btn--primary" onClick={() => setConfirm(true)}><Play aria-hidden="true" />Start attempt {used + 1}</button>
            : <p className="muted">{state === 'upcoming' ? `This quiz opens ${formatDateTime(v.quiz.opensAt)}.` : state === 'closed' ? 'This quiz has closed.' : 'You have used all your attempts.'}</p>}
        </div>
      </div>
      <aside className="panel" aria-labelledby="att-h">
        <div className="panel__head"><h3 id="att-h">Your attempts</h3></div>
        <div className="panel__body">
          {attempts.length === 0 ? <p className="muted">No attempts yet.</p> : (
            <ul className="list">{attempts.map((a) => (
              <li key={a.id} className="list-item">
                <span><Link to={`/attempts/${a.id}`}>Attempt {a.attemptNo}</Link><br /><span className="meta">{a.status === 'submitted' ? formatDateTime(a.submittedAt) : 'In progress'}</span></span>
                <strong className="tabular">{a.score != null ? `${a.score} / ${a.maxScore}` : '—'}</strong>
              </li>
            ))}</ul>
          )}
        </div>
      </aside>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Start the quiz?" confirmLabel="Start now" busy={start.isPending} onConfirm={() => start.mutate()}
        body={<p>{v.quiz.timeLimitMinutes ? `You will have ${v.quiz.timeLimitMinutes} minutes. ` : ''}This uses attempt {used + 1} of {v.quiz.maxAttempts}.</p>} />
    </div>
  );
}

export default function QuizDetail() {
  const { quizId = '' } = useParams();
  const { course } = useCourse();
  const q = useQuery({ queryKey: ['quiz', quizId], queryFn: () => api.get<QuizView>(`/quizzes/${quizId}`) });
  useDocumentTitle(q.data?.quiz.title);
  return (
    <QueryView q={q}>
      {(v) => (
        <div className="stack-lg">
          <div className="stack-sm">
            <nav className="crumbs" aria-label="Breadcrumb"><ol><li><Link to={`/courses/${course.id}/quizzes`}>Quizzes</Link></li><li><span aria-current="page">{v.quiz.title}</span></li></ol></nav>
            <h2 tabIndex={-1} data-page-heading style={{ fontSize: 'var(--text-2xl)' }}>{v.quiz.title}</h2>
          </div>
          {v.relationship === 'staff' ? <StaffQuiz v={v} /> : <LearnerQuiz v={v} />}
        </div>
      )}
    </QueryView>
  );
}
