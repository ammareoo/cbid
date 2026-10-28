import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, GraduationCap } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, EmptyState, PageHeader, QueryView } from '../../components/ui';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate, percent } from '../../utils/format';

interface Row {
  courseId: string; courseCode: string; courseTitle: string; assignmentId: string; title: string; dueAt: string;
  pointsPossible: number; score: number | null; releasedAt: string | null; submitted: boolean;
}

export function GradeStatus({ r }: { r: Pick<Row, 'score' | 'submitted' | 'dueAt'> }) {
  if (r.score != null) return <Badge tone="ok">Graded</Badge>;
  if (r.submitted) return <Badge tone="info">Submitted · awaiting grade</Badge>;
  if (new Date(r.dueAt) < new Date()) return <Badge tone="danger">Missing</Badge>;
  return <Badge tone="outline">Not yet due</Badge>;
}

export default function Grades() {
  useDocumentTitle('Grades');
  const q = useQuery({ queryKey: ['grades', 'mine'], queryFn: () => api.get<{ items: Row[] }>('/me/grades') });
  return (
    <Page>
      <PageHeader title="Grades" lede="Grades appear once your trainer releases them. Totals count released grades only." />
      <QueryView q={q}>
        {(d) => {
          if (!d.items.length) {
            return (
              <EmptyState title="No graded work yet" icon={<GraduationCap aria-hidden="true" />}>
                Assignments from your courses will be listed here.
              </EmptyState>
            );
          }
          const byCourse = new Map<string, Row[]>();
          d.items.forEach((r) => byCourse.set(r.courseId, [...(byCourse.get(r.courseId) ?? []), r]));
          return (
            <div className="my-grades">
              {[...byCourse.values()].map((rows) => {
                const c = rows[0]!;
                const graded = rows.filter((r) => r.score != null);
                const earned = graded.reduce((n, r) => n + (r.score ?? 0), 0);
                const possible = graded.reduce((n, r) => n + r.pointsPossible, 0);
                const pct = percent(earned, possible);
                return (
                  <section key={c.courseId} className="my-grades__course" aria-labelledby={`g-${c.courseId}`}>
                    <header className="my-grades__head">
                      <div className="my-grades__identity">
                        <span className="code-tag">{c.courseCode}</span>
                        <h2 id={`g-${c.courseId}`} className="my-grades__title">{c.courseTitle}</h2>
                      </div>
                      <div className="course-stat-strip my-grades__total" role="status">
                        <span className="course-stat-strip__label">Released total</span>
                        <span className="course-stat-strip__value tabular">
                          {pct == null ? '—' : `${pct}%`}
                        </span>
                        <span className="course-stat-strip__meta">
                          {pct == null ? 'No released grades yet' : `${earned} of ${possible} points released`}
                        </span>
                      </div>
                    </header>
                    <ul className="work-list" aria-label={`Grades for ${c.courseTitle}`}>
                      {rows.map((r) => (
                        <li key={r.assignmentId} className="work-row">
                          <span className="work-row__glyph" aria-hidden="true"><ClipboardList width={16} height={16} /></span>
                          <div className="work-row__main">
                            <Link className="work-row__title" to={`/courses/${r.courseId}/assignments/${r.assignmentId}`}>
                              {r.title}
                            </Link>
                            <span className="work-row__meta">
                              <span>Due {formatDate(r.dueAt)}</span>
                              <span className="tabular">{r.pointsPossible} pts</span>
                            </span>
                          </div>
                          <div className="work-row__aside">
                            <GradeStatus r={r} />
                            <span className="work-row__stat tabular">
                              {r.score != null ? r.score : '—'} / {r.pointsPossible}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          );
        }}
      </QueryView>
    </Page>
  );
}
