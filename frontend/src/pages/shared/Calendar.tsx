import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, ClipboardList, FileQuestion, MapPin } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { CalendarEntry } from '../../api/types';
import { EmptyState, PageHeader, QueryView } from '../../components/ui';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { dayKey, displayTimeZone, formatTime, fromLocalInput } from '../../utils/format';

type Filter = 'all' | 'event' | 'assignment' | 'quiz';

const TYPE = {
  event: { label: 'Event', icon: CalendarClock, tone: 'event' as const },
  assignment: { label: 'Assignment due', icon: ClipboardList, tone: 'assignment' as const },
  quiz: { label: 'Quiz closes', icon: FileQuestion, tone: 'quiz' as const },
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'assignment', label: 'Assignments' },
  { id: 'quiz', label: 'Quizzes' },
  { id: 'event', label: 'Events' },
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function zoneParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: displayTimeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), weekday: p.weekday ?? '' };
}

function dateAtNoon(y: number, m: number, d: number) {
  return new Date(fromLocalInput(`${y}-${pad(m)}-${pad(d)}T12:00`));
}

function monthLabel(y: number, m: number) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)));
}

function monthName(m: number) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2020, m - 1, 1)));
}

function mondayOffset(weekdayShort: string) {
  const i = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekdayShort);
  return i < 0 ? 0 : i;
}

function civilAdd(y: number, m: number, d: number, delta: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function buildMonthCells(y: number, m: number) {
  const first = dateAtNoon(y, m, 1);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = mondayOffset(zoneParts(first).weekday);
  const total = Math.ceil((lead + dim) / 7) * 7;

  const cells: { date: Date; inMonth: boolean; key: string; day: number }[] = [];
  for (let i = 0; i < total; i++) {
    const civil = civilAdd(y, m, 1, i - lead);
    const date = dateAtNoon(civil.y, civil.m, civil.d);
    cells.push({
      date,
      inMonth: civil.y === y && civil.m === m,
      key: dayKey(date),
      day: civil.d,
    });
  }
  return cells;
}

function dayStartIso(date: Date) {
  const p = zoneParts(date);
  return fromLocalInput(`${p.y}-${pad(p.m)}-${pad(p.d)}T00:00`);
}

export default function CalendarPage() {
  useDocumentTitle('Calendar');
  const today = useMemo(() => new Date(), []);
  const todayParts = zoneParts(today);
  const todayKey = dayKey(today);

  const [viewY, setViewY] = useState(todayParts.y);
  const [viewM, setViewM] = useState(todayParts.m);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedKey, setSelectedKey] = useState(todayKey);

  const cells = useMemo(() => buildMonthCells(viewY, viewM), [viewY, viewM]);
  const from = useMemo(() => dayStartIso(cells[0]!.date), [cells]);
  const to = useMemo(() => {
    const end = new Date(dayStartIso(cells[cells.length - 1]!.date));
    end.setTime(end.getTime() + 86_400_000);
    return end.toISOString();
  }, [cells]);

  const q = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => api.get<{ items: CalendarEntry[] }>(`/calendar${qs({ from, to })}`),
  });

  function shiftMonth(delta: number) {
    let m = viewM + delta;
    let y = viewY;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setViewY(y);
    setViewM(m);
  }

  return (
    <Page wide>
      <div className="cal">
        <PageHeader
          title="Calendar"
          actions={(
            <div className="courses-header-actions">
              <div className="courses-tabs" role="tablist" aria-label="Filter calendar">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    className={`courses-tabs__tab${filter === f.id ? ' is-active' : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        />
        <header className="cal__toolbar">
          <div className="cal__nav">
            <button type="button" className="cal__month-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <p className="cal__title" aria-live="polite">{monthLabel(viewY, viewM)}</p>
            <button type="button" className="cal__month-btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </header>

        <QueryView q={q}>
          {(d) => {
            const items = d.items.filter((i) => filter === 'all' || i.type === filter);
            const byDay = new Map<string, CalendarEntry[]>();
            for (const i of items) {
              const k = dayKey(i.startsAt);
              const list = byDay.get(k) ?? [];
              list.push(i);
              byDay.set(k, list);
            }
            for (const list of byDay.values()) {
              list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
            }

            const selectedItems = byDay.get(selectedKey) ?? [];
            const selectedCell = cells.find((c) => c.key === selectedKey)
              ?? cells.find((c) => c.key === todayKey)
              ?? cells[0]!;
            const selectedParts = zoneParts(selectedCell.date);
            const cellLabel = (cell: typeof cells[number], count: number) => {
              const label = new Intl.DateTimeFormat('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: displayTimeZone(),
              }).format(cell.date);
              return count ? `${label}, ${count} item${count === 1 ? '' : 's'}` : label;
            };

            return (
              <div className="cal__body">
                <div className="cal__grid-wrap">
                  <div className="cal__weekdays" aria-hidden="true">
                    {WEEKDAYS.map((w) => <div key={w} className="cal__weekday">{w}</div>)}
                  </div>
                  <div className="cal__grid" role="grid" aria-label={`${monthLabel(viewY, viewM)} calendar`}>
                    {cells.map((cell) => {
                      const dayItems = byDay.get(cell.key) ?? [];
                      const isToday = cell.key === todayKey;
                      const isSelected = cell.key === selectedKey;
                      const shown = dayItems.slice(0, 3);
                      const more = dayItems.length - shown.length;
                      return (
                        <button
                          key={cell.key}
                          type="button"
                          role="gridcell"
                          aria-selected={isSelected}
                          aria-current={isToday ? 'date' : undefined}
                          aria-label={cellLabel(cell, dayItems.length)}
                          className={[
                            'cal__cell',
                            cell.inMonth ? '' : ' cal__cell--muted',
                            isToday ? ' cal__cell--today' : '',
                            isSelected ? ' cal__cell--selected' : '',
                            dayItems.length ? ' cal__cell--has' : '',
                          ].join('')}
                          onClick={() => setSelectedKey(cell.key)}
                        >
                          <span className="cal__daynum">{cell.day}</span>
                          <span className="cal__chips">
                            {shown.map((i) => (
                              <span key={i.type + i.id} className={`cal__chip cal__chip--${TYPE[i.type].tone}`}>
                                <span className="cal__chip-label">{i.title}</span>
                              </span>
                            ))}
                            {more > 0 && <span className="cal__more">+{more} more</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="cal__rail">
                  <aside className="cal__side" aria-live="polite">
                    <div className="cal__side-head">
                      <p className="cal__side-kicker">{selectedParts.weekday}</p>
                      <h2 className="cal__side-title">{selectedParts.d} {monthName(selectedParts.m)}</h2>
                      <p className="cal__side-count">
                        {selectedItems.length === 0
                          ? 'Nothing scheduled'
                          : `${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <div className="cal__side-main">
                      {selectedItems.length === 0 ? (
                        <EmptyState title="Free day" icon={<CalendarClock aria-hidden="true" />}>
                          Pick another date, or change the filter above.
                        </EmptyState>
                      ) : (
                        <ul className="cal__side-list">
                          {selectedItems.map((i) => {
                            const T = TYPE[i.type];
                            return (
                              <li key={i.type + i.id} className={`cal__side-item cal__side-item--${T.tone}`}>
                                <div className="cal__side-item-top">
                                  <span className={`cal__tag cal__tag--${T.tone}`}>
                                    <T.icon aria-hidden="true" />
                                    {T.label}
                                  </span>
                                  <span className="meta">
                                    {formatTime(i.startsAt)}
                                    {i.type === 'event' && i.endsAt !== i.startsAt ? `–${formatTime(i.endsAt)}` : ''}
                                  </span>
                                </div>
                                {i.link
                                  ? <Link to={i.link} className="cal__side-link"><strong>{i.title}</strong></Link>
                                  : <strong>{i.title}</strong>}
                                {i.courseCode && <span className="code-tag">{i.courseCode}</span>}
                                {i.location && (
                                  <span className="meta cal__loc"><MapPin aria-hidden="true" width={14} height={14} />{i.location}</span>
                                )}
                                {i.description && <p className="cal__desc muted">{i.description}</p>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </aside>
                  <aside className="cal__key" aria-labelledby="cal-key-h">
                    <h3 className="cal__key-title" id="cal-key-h">Key</h3>
                    <ul className="cal__key-list">
                      <li className="cal__key-item cal__key-item--assignment"><span className="cal__key-swatch" aria-hidden="true" />Assignment</li>
                      <li className="cal__key-item cal__key-item--quiz"><span className="cal__key-swatch" aria-hidden="true" />Quiz</li>
                      <li className="cal__key-item cal__key-item--event"><span className="cal__key-swatch" aria-hidden="true" />Event</li>
                    </ul>
                  </aside>
                </div>
              </div>
            );
          }}
        </QueryView>
      </div>
    </Page>
  );
}
