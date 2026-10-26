import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Download, ExternalLink } from 'lucide-react';
import { api } from '../../api/client';
import type { ItemDetail } from '../../api/types';
import { Notice, QueryView } from '../../components/ui';
import { Markdown } from '../../components/Markdown';
import { useToast } from '../../components/Toast';
import { useDocumentTitle } from '../../hooks/misc';
import { formatBytes } from '../../utils/format';
import { useCourse } from './CourseLayout';

export default function ItemView() {
  const { itemId = '' } = useParams();
  const { course } = useCourse();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['item', itemId], queryFn: () => api.get<ItemDetail>(`/items/${itemId}`) });
  useDocumentTitle(q.data?.title);
  const learner = course.relationship === 'learner';
  const toggle = useMutation({
    mutationFn: (complete: boolean) => complete ? api.post(`/items/${itemId}/complete`) : api.del(`/items/${itemId}/complete`),
    onSuccess: (_r, complete) => {
      toast(complete ? 'Marked as complete' : 'Marked as not complete');
      qc.invalidateQueries({ queryKey: ['item', itemId] });
      qc.invalidateQueries({ queryKey: ['modules', course.id] });
      qc.invalidateQueries({ queryKey: ['course', course.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  return (
    <QueryView q={q}>
      {(it) => (
        <article className="stack-lg" style={{ maxWidth: 820 }}>
          <div className="stack-sm">
            <nav className="crumbs" aria-label="Breadcrumb"><ol><li><Link to={`/courses/${course.id}/modules`}>Content</Link></li><li><span aria-current="page">{it.moduleTitle}</span></li></ol></nav>
            <h2 tabIndex={-1} data-page-heading style={{ fontSize: 'var(--text-2xl)' }}>{it.title}</h2>
            {it.estimatedMinutes && <p className="meta">About {it.estimatedMinutes} minutes</p>}
            {!it.published && <Notice tone="warn"><p>This item is hidden from learners.</p></Notice>}
          </div>

          {it.kind === 'page' && it.body && <Markdown source={it.body} />}
          {it.kind === 'link' && it.url && (
            <div className="panel"><div className="panel__body stack">
              <p>This activity opens on another website in a new tab.</p>
              <div><a className="btn btn--primary" href={it.url} target="_blank" rel="noopener noreferrer">Open {new URL(it.url).hostname}<ExternalLink aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></div>
              <p className="meta" style={{ wordBreak: 'break-all' }}>{it.url}</p>
            </div></div>
          )}
          {it.kind === 'file' && it.fileId && (
            <div className="panel"><div className="panel__body stack">
              <p><strong>{it.fileName}</strong> <span className="meta">{formatBytes(it.fileSize)}</span></p>
              <div className="row">
                <a className="btn btn--primary" href={`/api/files/${it.fileId}`}><Download aria-hidden="true" />Download</a>
                {it.fileType === 'application/pdf' && <a className="btn btn--secondary" href={`/api/files/${it.fileId}?inline=1`} target="_blank" rel="noopener noreferrer">Open in browser<span className="sr-only"> (new tab)</span></a>}
              </div>
            </div></div>
          )}

          {learner && (
            <div className="panel"><div className="panel__body row-between">
              <p className="row" style={{ gap: 8 }}>{it.completed ? <><CheckCircle2 aria-hidden="true" color="var(--ok)" /> You have completed this item.</> : <><Circle aria-hidden="true" /> Mark this item complete when you have finished it.</>}</p>
              <button type="button" className={`btn ${it.completed ? 'btn--secondary' : 'btn--primary'}`} onClick={() => toggle.mutate(!it.completed)} disabled={toggle.isPending} aria-pressed={it.completed}>
                {it.completed ? 'Mark as not complete' : 'Mark as complete'}
              </button>
            </div></div>
          )}

          <nav className="row-between" aria-label="Previous and next item">
            {it.previous ? <Link className="btn btn--ghost" to={`/courses/${course.id}/items/${it.previous.id}`}><ArrowLeft aria-hidden="true" />Previous: {it.previous.title}</Link> : <span />}
            {it.next ? <Link className="btn btn--ghost" to={`/courses/${course.id}/items/${it.next.id}`}>Next: {it.next.title}<ArrowRight aria-hidden="true" /></Link> : <Link className="btn btn--ghost" to={`/courses/${course.id}/modules`}>Back to all content</Link>}
          </nav>
        </article>
      )}
    </QueryView>
  );
}
