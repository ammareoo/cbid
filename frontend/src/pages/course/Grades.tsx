import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Badge, EmptyState, QueryView, SectionTitle } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate, percent } from '../../utils/format';
import { useCourse } from './CourseLayout';
import { GradeStatus } from '../student/Grades';

interface MyRow { assignmentId: string; title: string; dueAt: string; pointsPossible: number; score: number | null; feedback: string | null; releasedAt: string | null; submittedAt: string | null }
interface Book {
  assignments: { id: string; title: string; pointsPossible: number; dueAt: string }[];
  students: { id: string; fullName: string }[];
  cells: { studentId: string; assignmentId: string; score: number | null; released: boolean; submitted: boolean; late: boolean }[];
}

function LearnerGrades({ courseId }: { courseId: string }) {
  const q = useQuery({ queryKey: ['course-grades', courseId], queryFn: () => api.get<{ items: MyRow[] }>(`/courses/${courseId}/my-grades`) });
  return (
    <QueryView q={q}>
      {(d) => {
        if (!d.items.length) return <EmptyState title="No assignments yet" />;
        const graded = d.items.filter((r) => r.score != null);
        const earned = graded.reduce((n, r) => n + (r.score ?? 0), 0);
        const possible = graded.reduce((n, r) => n + r.pointsPossible, 0);
        return (
          <div className="stack">
            <p><strong>Current total: {percent(earned, possible) ?? '—'}{possible ? '%' : ''}</strong> <span className="meta">({earned} of {possible} points from released grades)</span></p>
            <div className="table-wrap"><table className="table">
              <thead><tr><th scope="col">Assignment</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col" className="num">Score</th></tr></thead>
              <tbody>{d.items.map((r) => (
                <tr key={r.assignmentId}>
                  <th scope="row"><Link to={`/courses/${courseId}/assignments/${r.assignmentId}`}>{r.title}</Link></th>
                  <td className="nowrap">{formatDate(r.dueAt)}</td>
                  <td><GradeStatus r={{ score: r.score, submitted: Boolean(r.submittedAt), dueAt: r.dueAt }} /></td>
                  <td className="num tabular">{r.score ?? '—'} / {r.pointsPossible}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        );
      }}
    </QueryView>
  );
}

function Gradebook({ courseId }: { courseId: string }) {
  const q = useQuery({ queryKey: ['gradebook', courseId], queryFn: () => api.get<Book>(`/courses/${courseId}/gradebook`) });
  return (
    <QueryView q={q}>
      {(b) => {
        if (!b.students.length) return <EmptyState title="No learners enrolled yet" />;
        if (!b.assignments.length) return <EmptyState title="No published assignments yet" />;
        const cell = (s: string, a: string) => b.cells.find((c) => c.studentId === s && c.assignmentId === a);
        return (
          <div className="stack">
            <p className="meta">Scores in brackets are saved but not yet released to the learner. “Sub.” means submitted and waiting for a grade.</p>
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 200 + b.assignments.length * 140 }}>
                <caption className="sr-only">Gradebook: learners in rows, assignments in columns</caption>
                <thead><tr>
                  <th scope="col" style={{ position: 'sticky', left: 0, background: 'var(--surface-2)', zIndex: 1 }}>Learner</th>
                  {b.assignments.map((a) => <th key={a.id} scope="col" className="num"><Link to={`/courses/${courseId}/assignments/${a.id}/grading`}>{a.title}</Link><br /><span className="meta">/{a.pointsPossible}</span></th>)}
                  <th scope="col" className="num">Total</th>
                </tr></thead>
                <tbody>{b.students.map((s) => {
                  let earned = 0; let possible = 0;
                  return (
                    <tr key={s.id}>
                      <th scope="row" style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>{s.fullName}</th>
                      {b.assignments.map((a) => {
                        const c = cell(s.id, a.id);
                        if (c?.score != null) { earned += c.score; possible += a.pointsPossible; }
                        return (
                          <td key={a.id} className="num tabular">
                            {c?.score != null ? (c.released ? c.score : `(${c.score})`) : c?.submitted ? <Badge tone="warn">Sub.</Badge> : <span className="muted">—</span>}
                            {c?.late && <span className="sr-only"> (late)</span>}
                          </td>
                        );
                      })}
                      <td className="num tabular"><strong>{percent(earned, possible) ?? '—'}{possible ? '%' : ''}</strong></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>
        );
      }}
    </QueryView>
  );
}

export default function CourseGrades() {
  const { course, isStaff } = useCourse();
  useDocumentTitle(`${isStaff ? 'Gradebook' : 'My grades'} · ${course.code}`);
  return (
    <>
      <SectionTitle title={isStaff ? 'Gradebook' : 'My grades'} lede={isStaff ? 'Every enrolled learner against every published assignment. Totals use graded work only.' : 'Only grades your trainer has released are shown.'} />
      {isStaff ? <Gradebook courseId={course.id} /> : <LearnerGrades courseId={course.id} />}
    </>
  );
}
