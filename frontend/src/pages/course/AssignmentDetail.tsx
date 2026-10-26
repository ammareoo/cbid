import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Pencil, Send, Trash2, Upload } from 'lucide-react';
import { api } from '../../api/client';
import type { AssignmentView } from '../../api/types';
import { Badge, ConfirmDialog, DueLabel, ErrorSummary, FileLink, Notice, PublishBadge, QueryView, TextAreaField } from '../../components/ui';
import { Markdown } from '../../components/Markdown';
import { useToast } from '../../components/Toast';
import { useDocumentTitle } from '../../hooks/misc';
import { formatBytes, formatDateTime, percent } from '../../utils/format';
import { useCourse } from './CourseLayout';
import { uuid } from '../../utils/id';
import { AssignmentForm } from './AssignmentForm';

function SubmitForm({ view }: { view: AssignmentView }) {
  const a = view.assignment;
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [file, setFile] = useState<{ id: string; name: string; size: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const token = useRef(uuid());
  const fileInput = useRef<HTMLInputElement>(null);
  const allowsText = a.submissionType !== 'file';
  const allowsFile = a.submissionType !== 'text';

  const upload = useMutation({
    mutationFn: (f: File) => api.upload<{ id: string; originalName: string; sizeBytes: number }>(`/courses/${a.courseId}/files?purpose=submission`, f),
    onSuccess: (r) => setFile({ id: r.id, name: r.originalName, size: r.sizeBytes }),
    onError: () => { if (fileInput.current) fileInput.current.value = ''; },
  });
  const submit = useMutation({
    mutationFn: () => api.post(`/assignments/${a.id}/submissions`, { body: allowsText ? body || null : null, fileId: file?.id ?? null, clientToken: token.current }),
    onSuccess: () => {
      toast('Your work has been submitted');
      setBody(''); setFile(null); setConfirm(false);
      token.current = uuid();
      if (fileInput.current) fileInput.current.value = '';
      qc.invalidateQueries({ queryKey: ['assignment', a.id] });
      qc.invalidateQueries({ queryKey: ['assignments', a.courseId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: () => setConfirm(false),
  });
  const empty = !body.trim() && !file;

  return (
    <section className="panel" aria-labelledby="submit-h">
      <div className="panel__head"><h3 id="submit-h">Submit your work</h3><span className="meta">{view.attemptsLeft} of {a.maxAttempts} attempts left</span></div>
      <form className="panel__body stack" onSubmit={(e) => { e.preventDefault(); if (!empty) setConfirm(true); }}>
        {view.willBeLate && <Notice tone="warn"><p>The due date has passed. This submission will be marked <strong>late</strong>.</p></Notice>}
        <ErrorSummary error={submit.error ?? upload.error} />
        {allowsText && <TextAreaField label="Written response" hint="Your text is saved only when you submit." value={body} onChange={(e) => setBody(e.target.value)} className="textarea--tall" maxLength={100000} />}
        {allowsFile && (
          <div className="field">
            <label htmlFor="sub-file">{allowsText ? 'Or attach a file' : 'File'}</label>
            <p className="hint" id="sub-file-hint">PDF, Word, PowerPoint, Excel, images or plain text, up to 25 MB.</p>
            <input ref={fileInput} id="sub-file" type="file" aria-describedby="sub-file-hint" accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />
            {upload.isPending && <p className="meta" role="status"><Upload aria-hidden="true" width={14} height={14} /> Uploading…</p>}
            {file && <p className="meta" role="status">Attached: {file.name} ({formatBytes(file.size)})</p>}
          </div>
        )}
        <div className="form-actions">
          <button className="btn btn--primary" type="submit" disabled={empty || upload.isPending || submit.isPending}><Send aria-hidden="true" />Submit</button>
          {empty && <span className="meta">Add a response{allowsFile ? ' or a file' : ''} to submit.</span>}
        </div>
      </form>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Submit this attempt?" confirmLabel="Submit" busy={submit.isPending}
        onConfirm={() => submit.mutate()} body={<p>You will use one of your {view.attemptsLeft} remaining attempts. Earlier attempts stay on record.</p>} />
    </section>
  );
}

function LearnerView({ view }: { view: AssignmentView }) {
  const a = view.assignment;
  const g = view.grade;
  return (
    <div className="columns">
      <div className="stack-lg">
        <section className="stack" aria-labelledby="ins-h">
          <h3 id="ins-h">Instructions</h3>
          {a.instructions ? <Markdown source={a.instructions} /> : <p className="muted">No written instructions.</p>}
        </section>
        {view.canSubmit ? <SubmitForm view={view} /> : (
          <Notice tone={view.submissions?.length ? 'info' : 'warn'}>
            <p>{view.attemptsLeft === 0 ? 'You have used all your attempts.' : 'Submissions are closed for this assignment.'}</p>
          </Notice>
        )}
        <section className="stack" aria-labelledby="hist-h">
          <h3 id="hist-h">Your submissions</h3>
          {!view.submissions?.length ? <p className="muted">Nothing submitted yet.</p> : (
            <ol className="list">
              {view.submissions.map((s) => (
                <li key={s.id} className="stack-sm">
                  <span className="row" style={{ gap: 8 }}><strong>Attempt {s.attempt}</strong><span className="meta">{formatDateTime(s.submittedAt)}</span>{s.isLate && <Badge tone="warn">Late</Badge>}</span>
                  {s.body && <div className="submission-body">{s.body}</div>}
                  {s.fileId && <FileLink id={s.fileId} name={s.fileName} size={formatBytes(s.fileSize)} />}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <aside className="stack" aria-label="Deadline and grade">
        <div className="panel"><div className="panel__body stack-sm">
          <h3>Deadline</h3>
          <DueLabel iso={a.dueAt} done={Boolean(view.submissions?.length)} />
          {a.lateUntil && <p className="meta">Late work accepted until {formatDateTime(a.lateUntil)}</p>}
          <p className="meta">{a.pointsPossible} points · {a.submissionType === 'text' ? 'written response' : a.submissionType === 'file' ? 'file upload' : 'written response or file'}</p>
        </div></div>
        <div className="panel"><div className="panel__body stack-sm">
          <h3>Grade and feedback</h3>
          {g ? (
            <>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 400 }} className="tabular">{g.score} <span className="meta" style={{ fontSize: 'var(--text-md)' }}>/ {a.pointsPossible} ({percent(g.score, a.pointsPossible)}%)</span></p>
              {g.feedback ? <p style={{ whiteSpace: 'pre-wrap' }}>{g.feedback}</p> : <p className="muted">No written feedback.</p>}
              <p className="meta">Released {formatDateTime(g.releasedAt)}</p>
            </>
          ) : <p className="muted">{view.submissions?.length ? 'Your trainer has not released a grade yet.' : 'Grades appear here once released.'}</p>}
        </div></div>
      </aside>
    </div>
  );
}

function StaffView({ view }: { view: AssignmentView }) {
  const a = view.assignment;
  const s = view.stats!;
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const publish = useMutation({
    mutationFn: () => api.patch(`/assignments/${a.id}`, { status: 'published' }),
    onSuccess: () => { toast('Published. Learners have been notified.'); qc.invalidateQueries({ queryKey: ['assignment', a.id] }); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/assignments/${a.id}`),
    onSuccess: () => { toast('Assignment deleted'); qc.invalidateQueries({ queryKey: ['assignments', a.courseId] }); navigate(`/courses/${a.courseId}/assignments`); },
    onError: (e: Error) => { toast(e.message, 'error'); setDeleting(false); },
  });
  return (
    <div className="columns">
      <div className="stack-lg">
        <section className="stack" aria-labelledby="ins-h">
          <h3 id="ins-h">Instructions</h3>
          {a.instructions ? <Markdown source={a.instructions} /> : <p className="muted">No written instructions.</p>}
        </section>
      </div>
      <aside className="stack" aria-label="Submissions and settings">
        <div className="panel"><div className="panel__body stack">
          <h3>Submissions</h3>
          <dl className="stack-sm" style={{ margin: 0 }}>
            <div className="row-between"><dt>Submitted</dt><dd className="tabular" style={{ margin: 0 }}>{s.submittedCount} of {s.studentCount}</dd></div>
            <div className="row-between"><dt>Graded</dt><dd className="tabular" style={{ margin: 0 }}>{s.gradedCount}</dd></div>
            <div className="row-between"><dt>Grades not yet released</dt><dd className="tabular" style={{ margin: 0 }}>{s.unreleasedCount}</dd></div>
          </dl>
          <Link className="btn btn--primary" to={`/courses/${a.courseId}/assignments/${a.id}/grading`}><ClipboardCheck aria-hidden="true" />Open grading</Link>
        </div></div>
        <div className="panel"><div className="panel__body stack-sm">
          <h3>Settings</h3>
          <DueLabel iso={a.dueAt} done />
          <p className="meta">{a.pointsPossible} points · {a.maxAttempts} attempts{a.lateUntil ? ` · late until ${formatDateTime(a.lateUntil)}` : ' · no late submissions'}</p>
          {view.writable && (
            <div className="row" style={{ marginTop: 'var(--s-2)' }}>
              {a.status === 'draft' && <button type="button" className="btn btn--primary btn--sm" onClick={() => publish.mutate()} disabled={publish.isPending}>Publish</button>}
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(true)}><Pencil aria-hidden="true" />Edit</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDeleting(true)}><Trash2 aria-hidden="true" />Delete</button>
            </div>
          )}
        </div></div>
      </aside>
      {editing && <AssignmentForm courseId={a.courseId} assignment={a} open onClose={() => setEditing(false)} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} danger title="Delete this assignment?" confirmLabel="Delete" busy={del.isPending}
        onConfirm={() => del.mutate()} body={<p>Assignments that already have submissions or grades cannot be deleted.</p>} />
    </div>
  );
}

export default function AssignmentDetail() {
  const { assignmentId = '' } = useParams();
  const { course } = useCourse();
  const q = useQuery({ queryKey: ['assignment', assignmentId], queryFn: () => api.get<AssignmentView>(`/assignments/${assignmentId}`) });
  useDocumentTitle(q.data?.assignment.title);
  return (
    <QueryView q={q}>
      {(v) => (
        <div className="stack-lg">
          <div className="stack-sm">
            <nav className="crumbs" aria-label="Breadcrumb"><ol><li><Link to={`/courses/${course.id}/assignments`}>Assignments</Link></li><li><span aria-current="page">{v.assignment.title}</span></li></ol></nav>
            <div className="row-between">
              <h2 tabIndex={-1} data-page-heading style={{ fontSize: 'var(--text-2xl)' }}>{v.assignment.title}</h2>
              {v.relationship === 'staff' && <PublishBadge status={v.assignment.status} />}
            </div>
          </div>
          {v.relationship === 'staff' ? <StaffView view={v} /> : <LearnerView view={v} />}
        </div>
      )}
    </QueryView>
  );
}
