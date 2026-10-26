import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import type { Quiz, QuizQuestion } from '../../api/types';
import { Checkbox, Dialog, ErrorSummary, SelectField, TextAreaField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { displayTimeZone, fromLocalInput, toLocalInput } from '../../utils/format';

interface DraftOption { label: string; correct: boolean }
interface DraftQuestion { kind: 'single' | 'multiple' | 'short'; prompt: string; points: string; options: DraftOption[]; accepted: string }

const blank = (): DraftQuestion => ({ kind: 'single', prompt: '', points: '1', options: [{ label: '', correct: true }, { label: '', correct: false }], accepted: '' });

function fromExisting(qs: QuizQuestion[]): DraftQuestion[] {
  return qs.map((q) => ({
    kind: q.kind, prompt: q.prompt, points: String(q.points),
    options: q.options.map((o) => ({ label: o.label, correct: Boolean(q.correctOptionIds?.includes(o.id)) })),
    accepted: (q.acceptedAnswers ?? []).join('\n'),
  }));
}

/** Question editor with keyboard-operable reordering (move up/down) instead of drag-and-drop. */
export function QuizBuilder({ courseId, quiz, questions, locked, open, onClose }: {
  courseId: string; quiz?: Quiz; questions?: QuizQuestion[]; locked?: boolean; open: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const now = new Date();
  const [title, setTitle] = useState(quiz?.title ?? '');
  const [description, setDescription] = useState(quiz?.description ?? '');
  const [opensAt, setOpensAt] = useState(toLocalInput(quiz?.opensAt ?? now.toISOString()));
  const [closesAt, setClosesAt] = useState(toLocalInput(quiz?.closesAt ?? new Date(now.getTime() + 7 * 86_400_000).toISOString()));
  const [limit, setLimit] = useState(quiz?.timeLimitMinutes ? String(quiz.timeLimitMinutes) : '');
  const [attempts, setAttempts] = useState(String(quiz?.maxAttempts ?? 1));
  const [publish, setPublish] = useState(quiz?.status === 'published');
  const [qs, setQs] = useState<DraftQuestion[]>(questions?.length ? fromExisting(questions) : [blank()]);

  const update = (i: number, patch: Partial<DraftQuestion>) => setQs((xs) => xs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const moveQ = (i: number, d: -1 | 1) => setQs((xs) => { const n = [...xs]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); return n; });

  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        title, description, opensAt: fromLocalInput(opensAt), closesAt: fromLocalInput(closesAt),
        timeLimitMinutes: limit ? Number(limit) : null, maxAttempts: Number(attempts), status: publish ? 'published' : 'draft',
      };
      if (!locked) {
        body.questions = qs.map((q) => ({
          kind: q.kind, prompt: q.prompt, points: Number(q.points),
          ...(q.kind === 'short'
            ? { acceptedAnswers: q.accepted.split('\n').map((s) => s.trim()).filter(Boolean) }
            : { options: q.options.filter((o) => o.label.trim()).map((o) => ({ label: o.label, correct: o.correct })) }),
        }));
      }
      return quiz ? api.patch<{ id: string }>(`/quizzes/${quiz.id}`, body) : api.post<{ id: string }>(`/courses/${courseId}/quizzes`, body);
    },
    onSuccess: (r) => {
      toast(quiz ? 'Quiz saved' : 'Quiz created');
      qc.invalidateQueries({ queryKey: ['quizzes', courseId] });
      qc.invalidateQueries({ queryKey: ['quiz'] });
      onClose();
      if (!quiz) navigate(`/courses/${courseId}/quizzes/${r.id}`);
    },
  });

  return (
    <Dialog open={open} onClose={onClose} title={quiz ? 'Edit quiz' : 'New quiz'} wide>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} noValidate>
        <ErrorSummary error={m.error} />
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <TextAreaField label="Instructions for learners" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
        <div className="form-grid">
          <TextField label="Opens" type="datetime-local" hint={`Time zone: ${displayTimeZone()}`} value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
          <TextField label="Closes" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
          <TextField label="Time limit in minutes (optional)" type="number" min={1} max={600} hint="Learners with extra-time adjustments: set a longer limit or contact an administrator." value={limit} onChange={(e) => setLimit(e.target.value)} />
          <TextField label="Attempts allowed" type="number" min={1} max={10} value={attempts} onChange={(e) => setAttempts(e.target.value)} />
        </div>
        <Checkbox label="Publish to learners" checked={publish} onChange={(e) => setPublish(e.target.checked)} />

        <fieldset className="field" disabled={locked}>
          <legend style={{ fontSize: 'var(--text-lg)' }}>Questions</legend>
          {locked && <p className="hint">Questions are locked because learners have started this quiz. You can still change the dates and settings.</p>}
          <ol className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {qs.map((q, i) => (
              <li key={i} className="panel">
                <div className="panel__head">
                  <h3 style={{ fontSize: 'var(--text-md)' }}>Question {i + 1}</h3>
                  <div className="row" style={{ gap: 0 }}>
                    <button type="button" className="icon-btn" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => moveQ(i, -1)}><ArrowUp aria-hidden="true" /></button>
                    <button type="button" className="icon-btn" aria-label={`Move question ${i + 1} down`} disabled={i === qs.length - 1} onClick={() => moveQ(i, 1)}><ArrowDown aria-hidden="true" /></button>
                    <button type="button" className="icon-btn" aria-label={`Remove question ${i + 1}`} disabled={qs.length === 1} onClick={() => setQs((xs) => xs.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" /></button>
                  </div>
                </div>
                <div className="panel__body stack">
                  <div className="form-grid">
                    <SelectField label="Question type" value={q.kind} onChange={(e) => update(i, { kind: e.target.value as DraftQuestion['kind'] })}>
                      <option value="single">One correct answer</option>
                      <option value="multiple">Several correct answers</option>
                      <option value="short">Short typed answer</option>
                    </SelectField>
                    <TextField label="Points" type="number" min={0.5} max={100} step="0.5" value={q.points} onChange={(e) => update(i, { points: e.target.value })} />
                  </div>
                  <TextAreaField label="Question" value={q.prompt} onChange={(e) => update(i, { prompt: e.target.value })} maxLength={5000} />
                  {q.kind === 'short' ? (
                    <TextAreaField label="Accepted answers" hint="One per line. Matching ignores capital letters and extra spaces." value={q.accepted} onChange={(e) => update(i, { accepted: e.target.value })} />
                  ) : (
                    <fieldset className="field">
                      <legend>Options <span className="hint">(tick the correct {q.kind === 'single' ? 'one' : 'ones'})</span></legend>
                      {q.options.map((o, oi) => (
                        <div key={oi} className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
                          <label className="check" style={{ paddingBottom: 10 }}>
                            <input type={q.kind === 'single' ? 'radio' : 'checkbox'} name={`correct-${i}`} checked={o.correct}
                              onChange={(e) => update(i, { options: q.options.map((x, xi) => ({ ...x, correct: q.kind === 'single' ? xi === oi : xi === oi ? e.target.checked : x.correct })) })} />
                            <span className="sr-only">Option {oi + 1} is correct</span>
                          </label>
                          <div style={{ flex: 1 }}>
                            <TextField label={`Option ${oi + 1}`} value={o.label} onChange={(e) => update(i, { options: q.options.map((x, xi) => (xi === oi ? { ...x, label: e.target.value } : x)) })} />
                          </div>
                          <button type="button" className="icon-btn" aria-label={`Remove option ${oi + 1}`} disabled={q.options.length <= 2}
                            onClick={() => update(i, { options: q.options.filter((_, xi) => xi !== oi) })}><Trash2 aria-hidden="true" /></button>
                        </div>
                      ))}
                      {q.options.length < 8 && <div><button type="button" className="btn btn--ghost btn--sm" onClick={() => update(i, { options: [...q.options, { label: '', correct: false }] })}><Plus aria-hidden="true" />Add option</button></div>}
                    </fieldset>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {!locked && <div><button type="button" className="btn btn--secondary btn--sm" onClick={() => setQs((xs) => [...xs, blank()])}><Plus aria-hidden="true" />Add question</button></div>}
        </fieldset>
        <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Save quiz'}</button><button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}
