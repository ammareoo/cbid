import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Assignment } from '../../api/types';
import { Checkbox, Dialog, ErrorSummary, SelectField, TextAreaField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { displayTimeZone, fromLocalInput, toLocalInput } from '../../utils/format';

export function AssignmentForm({ courseId, assignment, open, onClose }: { courseId: string; assignment?: Assignment; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const defaultDue = () => { const d = new Date(Date.now() + 7 * 86_400_000); d.setHours(17, 0, 0, 0); return d.toISOString(); };
  const [title, setTitle] = useState(assignment?.title ?? '');
  const [instructions, setInstructions] = useState(assignment?.instructions ?? '');
  const [due, setDue] = useState(toLocalInput(assignment?.dueAt ?? defaultDue()));
  const [allowLate, setAllowLate] = useState(Boolean(assignment?.lateUntil));
  const [lateUntil, setLateUntil] = useState(toLocalInput(assignment?.lateUntil ?? null));
  const [points, setPoints] = useState(String(assignment?.pointsPossible ?? 20));
  const [type, setType] = useState<Assignment['submissionType']>(assignment?.submissionType ?? 'text_or_file');
  const [attempts, setAttempts] = useState(String(assignment?.maxAttempts ?? 3));
  const [publish, setPublish] = useState(assignment?.status === 'published');
  const [local, setLocal] = useState<Record<string, string>>({});

  const m = useMutation({
    mutationFn: () => {
      const body = {
        title, instructions, dueAt: fromLocalInput(due), lateUntil: allowLate && lateUntil ? fromLocalInput(lateUntil) : null,
        pointsPossible: Number(points), submissionType: type, maxAttempts: Number(attempts), status: publish ? 'published' : 'draft',
      };
      return assignment ? api.patch<{ id: string }>(`/assignments/${assignment.id}`, body) : api.post<{ id: string }>(`/courses/${courseId}/assignments`, body);
    },
    onSuccess: (r) => {
      toast(assignment ? 'Assignment saved' : publish ? 'Assignment published. Learners have been notified.' : 'Draft assignment created');
      qc.invalidateQueries({ queryKey: ['assignments', courseId] });
      qc.invalidateQueries({ queryKey: ['assignment'] });
      onClose();
      if (!assignment) navigate(`/courses/${courseId}/assignments/${r.id}`);
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (title.trim().length < 3) errs.title = 'Give the assignment a title of at least 3 characters';
    if (!due) errs.due = 'Choose a due date and time';
    if (!(Number(points) > 0)) errs.points = 'Points must be more than 0';
    if (allowLate && (!lateUntil || lateUntil <= due)) errs.late = 'The late cut-off must be after the due date';
    setLocal(errs);
    if (!Object.keys(errs).length) m.mutate();
  }

  return (
    <Dialog open={open} onClose={onClose} title={assignment ? 'Edit assignment' : 'New assignment'} wide>
      <form className="stack" onSubmit={submit} noValidate>
        <ErrorSummary error={m.error} />
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={local.title} maxLength={200} />
        <TextAreaField label="Instructions" hint="Explain the task, length and how it will be marked. Markdown is supported." value={instructions} onChange={(e) => setInstructions(e.target.value)} className="textarea--tall" maxLength={20000} />
        <div className="form-grid">
          <TextField label="Due" type="datetime-local" hint={`Time zone: ${displayTimeZone()}`} value={due} onChange={(e) => setDue(e.target.value)} error={local.due} />
          <TextField label="Points available" type="number" min={1} max={1000} step="0.5" value={points} onChange={(e) => setPoints(e.target.value)} error={local.points} />
          <SelectField label="Learners submit" value={type} onChange={(e) => setType(e.target.value as Assignment['submissionType'])}>
            <option value="text_or_file">Written response or a file</option>
            <option value="text">Written response only</option>
            <option value="file">File upload only</option>
          </SelectField>
          <TextField label="Attempts allowed" type="number" min={1} max={20} value={attempts} onChange={(e) => setAttempts(e.target.value)} hint="Each new attempt keeps the earlier ones." />
        </div>
        <Checkbox label="Accept late submissions until a cut-off" hint="Late work is clearly marked as late." checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} />
        {allowLate && <TextField label="Late cut-off" type="datetime-local" value={lateUntil} onChange={(e) => setLateUntil(e.target.value)} error={local.late} />}
        <Checkbox label="Publish to learners" hint="Publishing notifies every enrolled learner." checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Save assignment'}</button><button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}
