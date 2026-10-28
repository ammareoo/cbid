import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Trash2 } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { Announcement, Paged } from '../../api/types';
import { Checkbox, ConfirmDialog, EmptyState, ErrorSummary, Pagination, QueryView, SectionTitle, TextAreaField, TextField } from '../../components/ui';
import { TeacherAvatar } from '../../components/CourseMedia';
import { useToast } from '../../components/Toast';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime, relative } from '../../utils/format';
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
    <div className={`course-ann${canPost ? ' course-ann--compose' : ''}`}>
      <SectionTitle title="Announcements" lede="Updates from the training team." />

      <div className="course-ann__feed">
        <QueryView q={q}>
          {(d) => d.items.length === 0 ? (
            <EmptyState title="No announcements yet" icon={<Megaphone aria-hidden="true" />}>
              {canPost ? 'Post the first update for this course.' : 'Your trainer has not posted yet.'}
            </EmptyState>
          ) : (
            <>
              <ul className="ann-feed" aria-label="Course announcements">
                {d.items.map((a) => (
                  <li key={a.id}>
                    <article className="ann-post" aria-labelledby={`a-${a.id}`}>
                      <header className="ann-post__head">
                        <TeacherAvatar />
                        <div className="ann-post__by">
                          <p className="ann-post__author">{a.authorName ?? 'Training team'}</p>
                          <p className="ann-post__when">
                            <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
                            <span aria-hidden="true"> · </span>
                            <span>{relative(a.createdAt)}</span>
                          </p>
                        </div>
                        {canPost && (
                          <div className="route-tools ann-post__tools">
                            <button type="button" className="route-tools__btn route-tools__btn--danger" aria-label={`Delete announcement ${a.title}`} onClick={() => setDeleting(a)}>
                              <Trash2 aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </header>
                      <div className="ann-post__body">
                        <h3 id={`a-${a.id}`} className="ann-post__title">{a.title}</h3>
                        <p className="ann-post__text">{a.body}</p>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
              <Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} noun="announcements" />
            </>
          )}
        </QueryView>
      </div>

      {canPost && (
        <aside className="ann-compose" aria-labelledby="post-h">
          <div className="ann-compose__head">
            <p className="ann-compose__kicker" id="post-h">Compose</p>
            <p className="ann-compose__lead">Reach everyone on this course</p>
          </div>
          <form className="ann-compose__form" onSubmit={(e) => { e.preventDefault(); post.mutate(); }}>
            <ErrorSummary error={post.error} />
            <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            <TextAreaField label="Message" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
            <Checkbox label="Notify enrolled learners" hint="In-app, and by email for learners who opted in." checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <div className="form-actions">
              <button className="btn btn--primary btn--block" type="submit" disabled={post.isPending || title.trim().length < 3 || !body.trim()}>
                Post announcement
              </button>
            </div>
          </form>
        </aside>
      )}

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} danger confirmLabel="Delete" busy={del.isPending}
        title="Delete this announcement?" onConfirm={() => deleting && del.mutate(deleting.id)} body={<p>“{deleting?.title}” will be removed for everyone.</p>} />
    </div>
  );
}
