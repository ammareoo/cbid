import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
          if (!d.items.length) return <EmptyState title="No graded work yet">Assignments from your courses will be listed here.</EmptyState>;
          const byCourse = new Map<string, Row[]>();
          d.items.forEach((r) => byCourse.set(r.courseId, [...(byCourse.get(r.courseId) ?? []), r]));
          return (
            <div className="stack-lg">
              {[...byCourse.values()].map((rows) => {
                const c = rows[0]!;
                const graded = rows.filter((r) => r.score != null);
                const earned = graded.reduce((n, r) => n + (r.score ?? 0), 0);
                const possible = graded.reduce((n, r) => n + r.pointsPossible, 0);
                const pct = percent(earned, possible);
                return (
                  <section key={c.courseId} aria-labelledby={`g-${c.courseId}`} className="stack">
                    <div className="row-between">
                      <h2 id={`g-${c.courseId}`}><span className="code-tag">{c.courseCode}</span> {c.courseTitle}</h2>
                      <p><strong className="tabular">{pct == null ? 'No released grades' : `${pct}%`}</strong>{pct != null && <span className="meta"> ({earned} of {possible} points released)</span>}</p>
                    </div>
                    <div className="table-wrap">
                      <table className="table">
                        <caption className="sr-only">Grades for {c.courseTitle}</caption>
                        <thead><tr><th scope="col">Assignment</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col" className="num">Score</th></tr></thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.assignmentId}>
                              <th scope="row"><Link to={`/courses/${r.courseId}/assignments/${r.assignmentId}`}>{r.title}</Link></th>
                              <td className="nowrap">{formatDate(r.dueAt)}</td>
                              <td><GradeStatus r={r} /></td>
                              <td className="num tabular">{r.score != null ? `${r.score} / ${r.pointsPossible}` : `— / ${r.pointsPossible}`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
