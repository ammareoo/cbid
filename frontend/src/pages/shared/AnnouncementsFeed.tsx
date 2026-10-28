import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Building2, Megaphone, X } from 'lucide-react';
import { api } from '../../api/client';
import type { Announcement, Paged } from '../../api/types';
import { Dialog } from '../../components/ui';
import { initials, relative } from '../../utils/format';

const SEEN_KEY = 'cbid.announcements.seenAt';

function previewBody(body: string, max = 110) {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return { text: oneLine, clipped: false };
  const cut = oneLine.slice(0, max).replace(/\s+\S*$/, '');
  return { text: cut || oneLine.slice(0, max), clipped: true };
}

function AnnouncementCard({ a }: { a: Announcement }) {
  const [open, setOpen] = useState(false);
  const author = a.authorName ?? 'CBID Institute';
  const context = a.courseCode ?? 'Institute';
  const { text, clipped } = previewBody(a.body);
  const showFull = open || !clipped;

  return (
    <article className="ann-card" aria-labelledby={`ann-${a.id}`}>
      <header className="ann-card__head">
        <span className="avatar ann-card__avatar" aria-hidden="true">{initials(author)}</span>
        <div className="ann-card__who">
          <span className="ann-card__author">{author}</span>
          <span className="ann-card__context">{context}</span>
        </div>
        <time className="ann-card__time" dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()}>
          {relative(a.createdAt)}
        </time>
      </header>
      <div className="ann-card__body">
        <h3 id={`ann-${a.id}`} className="ann-card__title">{a.title}</h3>
        <p className={`ann-card__text${showFull ? ' is-open' : ''}`}>
          {showFull ? a.body : text}
          {clipped && !open && (
            <>
              {' '}
              <button type="button" className="ann-card__more" onClick={() => setOpen(true)}>more</button>
            </>
          )}
        </p>
        {clipped && open && (
          <button type="button" className="ann-card__more" onClick={() => setOpen(false)}>Show less</button>
        )}
      </div>
    </article>
  );
}

function AnnouncementRow({ a, onOpen }: { a: Announcement; onOpen: () => void }) {
  const course = !!a.courseCode;
  const Icon = course ? BookOpen : Building2;
  return (
    <button type="button" className="ann-row" onClick={onOpen} aria-haspopup="dialog">
      <span className={`ann-row__icon${course ? ' ann-row__icon--course' : ''}`} aria-hidden="true">
        <Icon />
      </span>
      <span className="ann-row__copy">
        <span className="ann-row__title">{a.title}</span>
        <span className="ann-row__meta">
          <Megaphone aria-hidden="true" />
          <span>{a.courseCode ?? 'Institute'}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={a.createdAt}>{relative(a.createdAt)}</time>
        </span>
      </span>
    </button>
  );
}

/** Compact announcement cards — used on the dashboard and admin list. */
export function AnnouncementList({ items, stacked }: { items: Announcement[]; stacked?: boolean }) {
  const [active, setActive] = useState<Announcement | null>(null);
  const author = active?.authorName ?? 'CBID Institute';

  return (
    <>
      <ul className={`ann-queue${stacked ? ' ann-queue--stack' : ''}`}>
        {items.map((a) => (
          <li key={a.id} className="ann-queue__item">
            {stacked
              ? <AnnouncementRow a={a} onOpen={() => setActive(a)} />
              : <AnnouncementCard a={a} />}
          </li>
        ))}
      </ul>

      {stacked && (
        <Dialog
          open={!!active}
          onClose={() => setActive(null)}
          title={active?.title ?? 'Announcement'}
          description={active
            ? `${author} · ${active.courseCode ?? 'Institute'} · ${relative(active.createdAt)}`
            : undefined}
        >
          {active && (
            <div className="ann-modal">
              <p className="ann-modal__body">{active.body}</p>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

/** Floating announcements control — bottom-right FAB with unread highlight. */
export function AnnouncementsFab({ manageTo }: { manageTo?: string } = {}) {
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => {
    try { return localStorage.getItem(SEEN_KEY) ?? ''; } catch { return ''; }
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const q = useQuery({
    queryKey: ['announcements', 'feed', 1, 8],
    queryFn: () => api.get<Paged<Announcement>>('/announcements?pageSize=8'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const items = q.data?.items ?? [];
  const newest = items[0]?.createdAt;
  const hasNew = !!newest && (!seenAt || newest > seenAt);

  const markSeen = (at: string) => {
    try { localStorage.setItem(SEEN_KEY, at); } catch { /* ignore */ }
    setSeenAt(at);
  };

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next && newest) markSeen(newest);
      return next;
    });
  };

  useEffect(() => {
    if (open && newest) markSeen(newest);
  }, [open, newest]);

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
    <div className="ann-fab" ref={rootRef}>
      {open && (
        <section className="ann-fab__panel" id={panelId} aria-labelledby={`${panelId}-title`} role="dialog">
          <header className="ann-fab__head">
            <div className="ann-fab__head-main">
              <span className="ann-fab__head-icon" aria-hidden="true"><Megaphone /></span>
              <div className="ann-fab__head-copy">
                <p className="ann-fab__kicker">Institute updates</p>
                <h2 id={`${panelId}-title`} className="ann-fab__title">Announcements</h2>
              </div>
            </div>
            <button type="button" className="icon-btn ann-fab__close" aria-label="Close announcements" onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="ann-fab__body">
            {q.isLoading ? <p className="chart-empty">Loading…</p>
              : q.isError ? <p className="chart-empty">Could not load announcements.</p>
                : items.length === 0 ? <p className="chart-empty">No announcements yet.</p>
                  : <AnnouncementList items={items} stacked />}
          </div>
          {manageTo && (
            <footer className="ann-fab__foot">
              <Link className="btn btn--secondary btn--sm btn--block" to={manageTo} onClick={() => setOpen(false)}>
                Manage announcements
              </Link>
            </footer>
          )}
        </section>
      )}
      <button
        type="button"
        className={`ann-fab__btn${hasNew ? ' ann-fab__btn--new' : ''}${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={hasNew ? 'Announcements, new updates' : 'Announcements'}
        onClick={toggle}
      >
        <Megaphone aria-hidden="true" />
        {hasNew && <span className="ann-fab__dot" aria-hidden="true" />}
      </button>
    </div>
  );
}
