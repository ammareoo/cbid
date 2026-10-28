import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Bell, CheckCheck, ClipboardList, FileQuestion, GraduationCap, Info, Megaphone } from 'lucide-react';
import { api, qs } from '../api/client';
import type { Notification, Paged } from '../api/types';
import { useToast } from './Toast';
import { relative } from '../utils/format';

const ICONS: Record<string, typeof Bell> = {
  grade: GraduationCap,
  announcement: Megaphone,
  assignment: ClipboardList,
  quiz: FileQuestion,
  system: Info,
  certificate: Award,
};

function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const qc = useQueryClient();
  const toast = useToast();
  const unread = useUnreadCount().data?.unread ?? 0;

  const list = useQuery({
    queryKey: ['notifications', 'panel', unreadOnly],
    queryFn: () => api.get<Paged<Notification>>(`/notifications${qs({
      page: 1,
      pageSize: 30,
      unread: unreadOnly ? 'true' : undefined,
    })}`),
    enabled: open,
    staleTime: 15_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markAll = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: (r) => {
      refresh();
      toast(r.updated ? `Marked ${r.updated} as read` : 'Everything was already read');
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: refresh,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="topbar__menu" ref={rootRef}>
      <button
        type="button"
        className="icon-btn topbar__icon"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell aria-hidden="true" />
        {unread > 0 && <span className="dot-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div id={panelId} className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel__head">
            <h2 className="notif-panel__title">Notifications</h2>
            <div className="notif-panel__actions">
              <label className="notif-panel__filter">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                />
                Unread
              </label>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending || unread === 0}
              >
                <CheckCheck aria-hidden="true" />
                Mark all read
              </button>
            </div>
          </div>
          <div className="notif-panel__body">
            {list.isLoading && <p className="notif-panel__empty muted">Loading…</p>}
            {list.isError && <p className="notif-panel__empty muted" role="alert">Could not load notifications.</p>}
            {list.data && list.data.items.length === 0 && (
              <p className="notif-panel__empty muted">{unreadOnly ? 'No unread notifications' : 'No notifications yet'}</p>
            )}
            {list.data && list.data.items.length > 0 && (
              <ul className="notif-panel__list">
                {list.data.items.map((n) => {
                  const Icon = ICONS[n.kind] ?? Bell;
                  const content = (
                    <>
                      <span className={`notif-panel__icon${n.readAt ? '' : ' notif-panel__icon--new'}`} aria-hidden="true">
                        <Icon width={16} height={16} />
                      </span>
                      <span className="notif-panel__text">
                        <span className="notif-panel__item-title">
                          {!n.readAt && <span className="notif-panel__dot" aria-label="Unread" />}
                          <strong>{n.title}</strong>
                        </span>
                        {n.body && <span className="notif-panel__snippet muted">{n.body}</span>}
                        <span className="meta">{relative(n.createdAt)}</span>
                      </span>
                    </>
                  );
                  return (
                    <li key={n.id} className={`notif-panel__item${n.readAt ? '' : ' notif-panel__item--unread'}`}>
                      {n.link ? (
                        <Link
                          to={n.link}
                          className="notif-panel__link"
                          onClick={() => {
                            if (!n.readAt) markOne.mutate(n.id);
                            setOpen(false);
                          }}
                        >
                          {content}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="notif-panel__link"
                          onClick={() => { if (!n.readAt) markOne.mutate(n.id); }}
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
