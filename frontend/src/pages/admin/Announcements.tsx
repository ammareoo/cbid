import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Trash2 } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { Announcement, Paged } from '../../api/types';
import { Checkbox, ConfirmDialog, EmptyState, ErrorSummary, PageHeader, Pagination, QueryView, TextAreaField, TextField } from '../../components/ui';
import { TeacherAvatar } from '../../components/CourseMedia';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime, relative } from '../../utils/format';

export default function AdminAnnouncements() {
  useDocumentTitle('Institute announcements');
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notify, setNotify] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['announcements', 'feed', page],
    queryFn: () => api.get<Paged<Announcement>>(`/announcements${qs({ page, pageSize: 10 })}`),
  });
  const post = useMutation({
    mutationFn: () => api.post('/announcements', { title, body, notify }),
    onSuccess: () => {
      toast('Announcement posted to everyone');
      setTitle(''); setBody(''); setConfirm(false);
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: () => setConfirm(false),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/announcements/${id}`),
    onSuccess: () => {
      toast('Announcement deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
  });

  return (
    <Page>
      <div className="course-ann course-ann--compose admin-ann">
        <PageHeader
          title="Announcements"
          lede="Institute-wide updates for every active account."
        />

        <div className="course-ann__feed">
          <QueryView q={q}>
            {(d) => d.items.length === 0 ? (
              <EmptyState title="No announcements yet" icon={<Megaphone aria-hidden="true" />}>
                Post the first institute-wide update.
              </EmptyState>
            ) : (
              <>
                <ul className="ann-feed" aria-label="Institute announcements">
                  {d.items.map((a) => (
                    <li key={a.id}>
                      <article className="ann-post" aria-labelledby={`a-${a.id}`}>
                        <header className="ann-post__head">
                          <TeacherAvatar />
                          <div className="ann-post__by">
                            <p className="ann-post__author">{a.authorName ?? 'CBID Institute'}</p>
                            <p className="ann-post__when">
                              <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
                              <span aria-hidden="true"> · </span>
                              <span>{relative(a.createdAt)}</span>
                              {a.courseCode && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span className="code-tag">{a.courseCode}</span>
                                </>
                              )}
                            </p>
                          </div>
                          <div className="route-tools ann-post__tools">
                            <button
                              type="button"
                              className="route-tools__btn route-tools__btn--danger"
                              aria-label={`Delete announcement ${a.title}`}
                              onClick={() => setDeleting(a)}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          </div>
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

        <aside className="ann-compose" aria-labelledby="post-h">
          <div className="ann-compose__head">
            <p className="ann-compose__kicker" id="post-h">Compose</p>
            <p className="ann-compose__lead">Reach everyone at the institute</p>
          </div>
          <form className="ann-compose__form" onSubmit={(e) => { e.preventDefault(); setConfirm(true); }}>
            <ErrorSummary error={post.error} />
            <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            <TextAreaField label="Message" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
            <Checkbox
              label="Send an in-app notification to everyone"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />
            <div className="form-actions">
              <button
                className="btn btn--primary btn--block"
                type="submit"
                disabled={title.trim().length < 3 || !body.trim()}
              >
                Post to everyone
              </button>
            </div>
          </form>
        </aside>
      </div>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Post to the whole institute?"
        confirmLabel="Post"
        busy={post.isPending}
        onConfirm={() => post.mutate()}
        body={<p>“{title}” will be visible to every active account{notify ? ' and each person gets a notification' : ''}.</p>}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        confirmLabel="Delete"
        busy={del.isPending}
        title="Delete this announcement?"
        onConfirm={() => deleting && del.mutate(deleting.id)}
        body={<p>“{deleting?.title}” will be removed for everyone.</p>}
      />
    </Page>
  );
}
