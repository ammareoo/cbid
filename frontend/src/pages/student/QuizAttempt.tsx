import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import type { AttemptView, QuizQuestion } from '../../api/types';
import { Badge, ConfirmDialog, Notice, PageHeader, QueryView } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle, useNow } from '../../hooks/misc';
import { formatDateTime } from '../../utils/format';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function Countdown({ deadline, offsetMs, onExpire }: { deadline: string; offsetMs: number; onExpire: () => void }) {
  const now = useNow(1000);
  const left = Math.max(0, new Date(deadline).getTime() - (now.getTime() + offsetMs));
  const [announce, setAnnounce] = useState('');
  const fired = useRef(false);
  const mins = Math.floor(left / 60000);
  useEffect(() => {
    if (left === 0 && !fired.current) { fired.current = true; onExpire(); }
    if (mins === 5 || mins === 1) setAnnounce(`${mins} ${mins === 1 ? 'minute' : 'minutes'} remaining`);
  }, [left, mins, onExpire]);
  if (left > 24 * 3600_000) return <span className="meta">Closes {formatDateTime(deadline)}</span>;
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span className="row" style={{ gap: 6 }}>
      <Clock aria-hidden="true" width={18} height={18} />
      <span className="timer" aria-hidden="true">{String(Math.floor(left / 3600000)).padStart(2, '0')}:{String(mins % 60).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>
      <span className="sr-only">Time remaining is shown here. You will hear a reminder at 5 minutes and 1 minute.</span>
      <span className="sr-only" aria-live="assertive">{announce}</span>
    </span>
  );
}

function QuestionBlock({ q, index, attemptId, locked, onSaveState }: {
  q: QuizQuestion; index: number; attemptId: string; locked: boolean; onSaveState: (id: string, s: SaveState) => void;
}) {
  const [selected, setSelected] = useState<string[]>(q.answer?.selectedOptionIds ?? []);
  const [text, setText] = useState(q.answer?.textAnswer ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useMutation({
    mutationFn: (body: { selectedOptionIds?: string[]; textAnswer?: string }) => api.put(`/attempts/${attemptId}/answers/${q.id}`, body),
    onMutate: () => onSaveState(q.id, 'saving'),
    onSuccess: () => onSaveState(q.id, 'saved'),
    onError: () => onSaveState(q.id, 'error'),
  });

  const choose = (id: string, checked: boolean) => {
    const next = q.kind === 'single' ? [id] : checked ? [...selected, id] : selected.filter((x) => x !== id);
    setSelected(next);
    save.mutate({ selectedOptionIds: next });
  };
  const typeAnswer = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save.mutate({ textAnswer: v }), 600);
  };

  const result = q.answer?.isCorrect;
  return (
    <fieldset className="question" disabled={locked}>
      <legend>
        <span className="meta" style={{ display: 'block', fontWeight: 700 }}>Question {index + 1} · {q.points} {q.points === 1 ? 'point' : 'points'}{q.kind === 'multiple' ? ' · choose all that apply' : ''}</span>
        {q.prompt}
      </legend>
      {q.kind === 'short' ? (
        <div className="field">
          <label htmlFor={`ans-${q.id}`}>Your answer</label>
          <input id={`ans-${q.id}`} className="input" value={text} onChange={(e) => typeAnswer(e.target.value)} maxLength={2000} autoComplete="off" />
        </div>
      ) : (
        <div className="options">
          {q.options.map((o) => (
            <label key={o.id} className="option">
              <input type={q.kind === 'single' ? 'radio' : 'checkbox'} name={`q-${q.id}`} checked={selected.includes(o.id)}
                onChange={(e) => choose(o.id, e.target.checked)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
      {locked && result != null && (
        <p style={{ marginTop: 'var(--s-3)' }}>
          {result ? <Badge tone="ok" icon={<CheckCircle2 aria-hidden="true" />}>Correct · {q.answer?.pointsAwarded} points</Badge>
            : <Badge tone="danger" icon={<XCircle aria-hidden="true" />}>Not correct · 0 points</Badge>}
        </p>
      )}
      {locked && !q.answer && <p className="meta" style={{ marginTop: 'var(--s-3)' }}>Not answered</p>}
    </fieldset>
  );
}

export default function QuizAttempt() {
  const { attemptId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['attempt', attemptId], queryFn: () => api.get<AttemptView>(`/attempts/${attemptId}`), staleTime: Infinity });
  useDocumentTitle(q.data?.attempt.quizTitle ?? 'Quiz');
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [confirm, setConfirm] = useState(false);
  const offset = useMemo(() => (q.data ? new Date(q.data.attempt.serverNow).getTime() - Date.now() : 0), [q.data]);

  const submit = useMutation({
    mutationFn: () => api.post<{ score: number; maxScore: number }>(`/attempts/${attemptId}/submit`),
    onSuccess: (r) => {
      setConfirm(false);
      toast(`Submitted. You scored ${r.score} out of ${r.maxScore}.`);
      qc.invalidateQueries({ queryKey: ['attempt', attemptId] });
      qc.invalidateQueries({ queryKey: ['quiz'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => { setConfirm(false); toast(e.message, 'error'); qc.invalidateQueries({ queryKey: ['attempt', attemptId] }); },
  });

  return (
    <Page>
      <QueryView q={q}>
        {(d) => {
          const a = d.attempt;
          const done = a.status === 'submitted';
          const answered = d.questions.filter((x) => saves[x.id] === 'saved' || (x.answer && (x.answer.selectedOptionIds.length || x.answer.textAnswer))).length;
          const anySaving = Object.values(saves).includes('saving');
          const anyError = Object.values(saves).includes('error');
          return (
            <>
              <PageHeader
                crumbs={[{ label: 'Quizzes', to: `/courses/${a.courseId}/quizzes` }, { label: a.quizTitle, to: `/courses/${a.courseId}/quizzes/${a.quizId}` }, { label: `Attempt ${a.attemptNo}` }]}
                title={a.quizTitle}
                lede={done ? `Submitted ${formatDateTime(a.submittedAt)}` : 'Answers save automatically as you go. Submit when you are finished.'}
                actions={!done && <Countdown deadline={a.deadlineAt} offsetMs={offset} onExpire={() => submit.mutate()} />}
              />
              {done && (
                <div className="stack" style={{ marginBottom: 'var(--s-6)' }}>
                  <Notice tone="ok"><p><strong>Score: {a.score} out of {a.maxScore}.</strong> Each question shows whether your answer was correct.</p></Notice>
                  <div><Link className="btn btn--secondary" to={`/courses/${a.courseId}/quizzes/${a.quizId}`}>Back to the quiz</Link></div>
                </div>
              )}
              <div className="stack" style={{ maxWidth: 820 }}>
                {d.questions.map((qq, i) => (
                  <QuestionBlock key={qq.id} q={qq} index={i} attemptId={attemptId} locked={done || submit.isPending}
                    onSaveState={(id, s) => setSaves((x) => ({ ...x, [id]: s }))} />
                ))}
                {!done && (
                  <div className="panel"><div className="panel__body row-between">
                    <p aria-live="polite">
                      {anyError ? <Badge tone="danger">An answer did not save. Check your connection and try again.</Badge>
                        : anySaving ? 'Saving…' : `${answered} of ${d.questions.length} answered · all changes saved`}
                    </p>
                    <button type="button" className="btn btn--primary" onClick={() => setConfirm(true)} disabled={anySaving || submit.isPending}>Submit quiz</button>
                  </div></div>
                )}
              </div>
              <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Submit this attempt?" confirmLabel="Submit"
                busy={submit.isPending} onConfirm={() => submit.mutate()}
                body={<p>{answered < d.questions.length ? <><strong>{d.questions.length - answered} questions are unanswered.</strong> </> : null}You cannot change your answers after submitting.</p>} />
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}
