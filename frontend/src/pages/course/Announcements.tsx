import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Trash2 } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { Announcement, Paged } from '../../api/types';
import { Checkbox, ConfirmDialog, EmptyState, ErrorSummary, Pagination, QueryView, SectionTitle, TextAreaField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime } from '../../utils/format';
import { useCourse } from './CourseLayout';

export default function CourseAnnouncements() {
  const { course, isStaff } = useCourse();
  useDocumentTitle(`Announcements · ${course.code}`);
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notify, setNotify] = useState(true);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const q = useQuery({
    queryKey: ['announcements', course.id, page],
    queryFn: () => api.get<Paged<Announcement>>(`/announcements${qs({ courseId: course.id, page, pageSize: 10 })}`),
  });
  const post = useMutation({
    mutationFn: () => api.post(`/courses/${course.id}/announcements`, { title, body, notify }),
    onSuccess: () => { toast(notify ? 'Posted. Enrolled learners have been notified.' : 'Posted'); setTitle(''); setBody(''); qc.invalidateQueries({ queryKey: ['announcements'] }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/announcements/${id}`),
    onSuccess: () => { toast('Announcement deleted'); setDeleting(null); qc.invalidateQueries({ queryKey: ['announcements'] }); },
  });
  const canPost = isStaff && course.writable;

  return (
    <>
      <SectionTitle title="Announcements" lede="Updates from the training team for this course." />
      <div className={canPost ? 'columns' : undefined}>
        <QueryView q={q}>
          {(d) => d.items.length === 0 ? <EmptyState title="No announcements yet" icon={<Megaphone aria-hidden="true" />} /> : (
            <div className="stack">
              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {d.items.map((a) => (
                  <li key={a.id}>
                    <article className="panel" aria-labelledby={`a-${a.id}`}>
                      <div className="panel__body stack-sm">
                        <div className="row-between">
                          <span className="meta">{a.authorName} · <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time></span>
                          {canPost && <button type="button" className="icon-btn" aria-label={`Delete announcement ${a.title}`} onClick={() => setDeleting(a)}><Trash2 aria-hidden="true" /></button>}
                        </div>
                        <h3 id={`a-${a.id}`}>{a.title}</h3>
                        <p style={{ whiteSpace: 'pre-wrap', maxWidth: '70ch' }}>{a.body}</p>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
              <Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} noun="announcements" />
            </div>
          )}
        </QueryView>
        {canPost && (
          <aside className="panel" aria-labelledby="post-h">
            <div className="panel__head"><h3 id="post-h">Post an announcement</h3></div>
            <form className="panel__body stack" onSubmit={(e) => { e.preventDefault(); post.mutate(); }}>
              <ErrorSummary error={post.error} />
              <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              <TextAreaField label="Message" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
              <Checkbox label="Notify enrolled learners" hint="In-app, and by email for learners who opted in." checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={post.isPending || title.trim().length < 3 || !body.trim()}>Post</button></div>
            </form>
          </aside>
        )}
      </div>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} danger confirmLabel="Delete" busy={del.isPending}
        title="Delete this announcement?" onConfirm={() => deleting && del.mutate(deleting.id)} body={<p>“{deleting?.title}” will be removed for everyone.</p>} />
    </>
  );
}
