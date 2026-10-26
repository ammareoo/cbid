import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, ClipboardList, FileQuestion, MapPin } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { CalendarEntry } from '../../api/types';
import { Badge, EmptyState, PageHeader, QueryView } from '../../components/ui';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { dayKey, dayParts, formatDate, formatTime } from '../../utils/format';

const WINDOW_DAYS = 28;
const TYPE = {
  event: { label: 'Event', icon: CalendarClock, tone: 'info' as const },
  assignment: { label: 'Assignment due', icon: ClipboardList, tone: 'brand' as const },
  quiz: { label: 'Quiz closes', icon: FileQuestion, tone: 'warn' as const },
};

/** Agenda view: a list grouped by day reads well with screen readers and on phones. */
export default function CalendarPage() {
  useDocumentTitle('Calendar');
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<'all' | 'event' | 'assignment' | 'quiz'>('all');
  const { from, to } = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + offset * WINDOW_DAYS);
    const end = new Date(start.getTime() + WINDOW_DAYS * 86_400_000);
    return { from: start.toISOString(), to: end.toISOString() };
  }, [offset]);
  const q = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => api.get<{ items: CalendarEntry[] }>(`/calendar${qs({ from, to })}`),
  });
  const todayKey = dayKey(new Date());

  return (
    <Page>
      <PageHeader title="Calendar" lede="Deadlines, quiz windows and events from your courses and the institute calendar." />
      <div className="row-between" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="row">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOffset((o) => o - 1)}><ChevronLeft aria-hidden="true" />Earlier</button>
          <p aria-live="polite" style={{ fontWeight: 700 }}>{formatDate(from)} – {formatDate(new Date(new Date(to).getTime() - 1))}</p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOffset((o) => o + 1)}>Later<ChevronRight aria-hidden="true" /></button>
          {offset !== 0 && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOffset(0)}>Today</button>}
        </div>
        <label className="row" style={{ gap: 8 }}>
          <span className="meta">Show</span>
          <select className="select" style={{ width: 'auto', minHeight: 40 }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">Everything</option>
            <option value="assignment">Assignments</option>
            <option value="quiz">Quizzes</option>
            <option value="event">Events</option>
          </select>
        </label>
      </div>
      <QueryView q={q}>
        {(d) => {
          const items = d.items.filter((i) => filter === 'all' || i.type === filter);
          if (!items.length) return <EmptyState title="Nothing scheduled in this period" icon={<CalendarClock aria-hidden="true" />}>Try a later period or change the filter.</EmptyState>;
          const groups = new Map<string, CalendarEntry[]>();
          for (const i of items) {
            const k = dayKey(i.startsAt);
            groups.set(k, [...(groups.get(k) ?? []), i]);
          }
          return (
            <div className="panel"><div className="panel__body">
              {[...groups.entries()].map(([k, list]) => {
                const p = dayParts(list[0]!.startsAt);
                return (
                  <section key={k} className="agenda-day" aria-label={`${p.weekday} ${p.day} ${p.month}`}>
                    <div className={`agenda-date${k === todayKey ? ' agenda-date--today' : ''}`} aria-hidden="true">
                      <b>{p.day}</b><small>{p.month} · {p.weekday.slice(0, 3)}</small>{k === todayKey && <><br /><Badge tone="brand">Today</Badge></>}
                    </div>
                    <ul className="list">
                      {list.map((i) => {
                        const T = TYPE[i.type];
                        return (
                          <li key={i.type + i.id} className="stack-sm">
                            <span className="row" style={{ gap: 8 }}>
                              <Badge tone={T.tone} icon={<T.icon aria-hidden="true" />}>{T.label}</Badge>
                              {i.courseCode && <span className="code-tag">{i.courseCode}</span>}
                              <span className="meta">{formatTime(i.startsAt)}{i.type === 'event' && i.endsAt !== i.startsAt ? `–${formatTime(i.endsAt)}` : ''}</span>
                            </span>
                            {i.link ? <Link to={i.link}><strong>{i.title}</strong></Link> : <strong>{i.title}</strong>}
                            {i.location && <span className="meta row" style={{ gap: 6 }}><MapPin aria-hidden="true" width={14} height={14} />{i.location}</span>}
                            {i.description && <span className="muted">{i.description}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div></div>
          );
        }}
      </QueryView>
    </Page>
  );
}
