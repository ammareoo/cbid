import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Bell, CheckCheck, GraduationCap, Megaphone, ClipboardList, FileQuestion, Info } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { Notification, Paged } from '../../api/types';
import { Badge, EmptyState, PageHeader, Pagination, QueryView } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime, relative } from '../../utils/format';

const ICONS: Record<string, typeof Bell> = { grade: GraduationCap, announcement: Megaphone, assignment: ClipboardList, quiz: FileQuestion, system: Info, certificate: Award };

export default function Notifications() {
  useDocumentTitle('Notifications');
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = useQuery({
    queryKey: ['notifications', 'list', page, unreadOnly],
    queryFn: () => api.get<Paged<Notification>>(`/notifications${qs({ page, pageSize: 20, unread: unreadOnly ? 'true' : undefined })}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markAll = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: (r) => { refresh(); toast(r.updated ? `Marked ${r.updated} as read` : 'Everything was already read'); },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const markOne = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: refresh });

  return (
    <Page>
      <PageHeader title="Notifications" lede="Grades, announcements and new work from your courses. Notifications older than six months are removed automatically."
        actions={<button type="button" className="btn btn--secondary" onClick={() => markAll.mutate()} disabled={markAll.isPending}><CheckCheck aria-hidden="true" />Mark all as read</button>} />
      <label className="check" style={{ marginBottom: 'var(--s-4)' }}>
        <input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} />Show unread only
      </label>
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title={unreadOnly ? 'No unread notifications' : 'No notifications yet'} icon={<Bell aria-hidden="true" />} /> : (
          <>
            <div className="panel"><ul className="list panel__body">
              {d.items.map((n) => {
                const Icon = ICONS[n.kind] ?? Bell;
                return (
                  <li key={n.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <span className="avatar" aria-hidden="true" style={{ background: n.readAt ? 'var(--surface-2)' : 'var(--brand-tint)' }}><Icon width={18} height={18} /></span>
                    <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
                      <span className="row" style={{ gap: 8 }}>
                        {!n.readAt && <Badge tone="brand">New</Badge>}
                        {n.link ? <Link to={n.link} onClick={() => !n.readAt && markOne.mutate(n.id)}><strong>{n.title}</strong></Link> : <strong>{n.title}</strong>}
                      </span>
                      {n.body && <span className="muted">{n.body}</span>}
                      <span className="meta"><time dateTime={n.createdAt}>{formatDateTime(n.createdAt)}</time> · {relative(n.createdAt)}</span>
                    </div>
                    {!n.readAt && (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => markOne.mutate(n.id)}>Mark read<span className="sr-only">: {n.title}</span></button>
                    )}
                  </li>
                );
              })}
            </ul></div>
            <Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} noun="notifications" />
          </>
        )}
      </QueryView>
    </Page>
  );
}
