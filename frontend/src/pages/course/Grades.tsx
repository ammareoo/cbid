import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
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
          <>
            <div className="course-stat-strip" role="status">
              <span className="course-stat-strip__label">Current total</span>
              <span className="course-stat-strip__value tabular">{percent(earned, possible) ?? '—'}{possible ? '%' : ''}</span>
              <span className="course-stat-strip__meta">{earned} of {possible} points from released grades</span>
            </div>
            <ul className="work-list" aria-label="Your grades for this course">
              {d.items.map((r) => (
                <li key={r.assignmentId} className="work-row">
                  <span className="work-row__glyph" aria-hidden="true"><ClipboardList width={16} height={16} /></span>
                  <div className="work-row__main">
                    <Link className="work-row__title" to={`/courses/${courseId}/assignments/${r.assignmentId}`}>{r.title}</Link>
                    <span className="work-row__meta">
                      <span>Due {formatDate(r.dueAt)}</span>
                      <span className="tabular">{r.pointsPossible} pts</span>
                    </span>
                  </div>
                  <div className="work-row__aside">
                    <GradeStatus r={{ score: r.score, submitted: Boolean(r.submittedAt), dueAt: r.dueAt }} />
                    <span className="work-row__stat tabular">{r.score ?? '—'} / {r.pointsPossible}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
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
          <>
            <ul className="gradebook-legend" aria-label="How to read the gradebook">
              <li><span className="gradebook-legend__sample gradebook-legend__sample--released">12</span> Released</li>
              <li><span className="gradebook-legend__sample gradebook-legend__sample--saved">(12)</span> Saved, not released</li>
              <li><Badge tone="warn">Sub.</Badge> Submitted, not graded</li>
            </ul>
            <div className="gradebook-wrap table-wrap">
              <table className="table gradebook-table" style={{ minWidth: 200 + b.assignments.length * 140 }}>
                <caption className="sr-only">Gradebook: learners in rows, assignments in columns</caption>
                <thead>
                  <tr>
                    <th scope="col" className="gradebook-table__sticky">Learner</th>
                    {b.assignments.map((a) => (
                      <th key={a.id} scope="col" className="num gradebook-table__assign">
                        <Link to={`/courses/${courseId}/assignments/${a.id}/grading`}>{a.title}</Link>
                        <span className="gradebook-table__pts">/{a.pointsPossible}</span>
                      </th>
                    ))}
                    <th scope="col" className="num gradebook-table__total">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {b.students.map((s) => {
                    let earned = 0;
                    let possible = 0;
                    return (
                      <tr key={s.id}>
                        <th scope="row" className="gradebook-table__sticky">{s.fullName}</th>
                        {b.assignments.map((a) => {
                          const c = cell(s.id, a.id);
                          if (c?.score != null) {
                            earned += c.score;
                            possible += a.pointsPossible;
                          }
                          const scoreClass = c?.score != null
                            ? (c.released ? 'gradebook-cell--released' : 'gradebook-cell--saved')
                            : c?.submitted ? 'gradebook-cell--sub' : 'gradebook-cell--empty';
                          return (
                            <td key={a.id} className="num">
                              <span className={`gradebook-cell tabular ${scoreClass}`}>
                                {c?.score != null
                                  ? (c.released ? c.score : `(${c.score})`)
                                  : c?.submitted
                                    ? 'Sub.'
                                    : '—'}
                              </span>
                              {c?.late && <span className="sr-only"> (late)</span>}
                            </td>
                          );
                        })}
                        <td className="num">
                          <span className="gradebook-cell gradebook-cell--total tabular">
                            {percent(earned, possible) ?? '—'}{possible ? '%' : ''}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    </QueryView>
  );
}

export default function CourseGrades() {
  const { course, isStaff } = useCourse();
  useDocumentTitle(`${isStaff ? 'Gradebook' : 'My grades'} · ${course.code}`);
  return (
    <div className="course-grades">
      <SectionTitle
        title={isStaff ? 'Gradebook' : 'My grades'}
        lede={isStaff ? 'Learners by assignment. Totals use graded work only.' : 'Only released grades are shown.'}
      />
      {isStaff ? <Gradebook courseId={course.id} /> : <LearnerGrades courseId={course.id} />}
    </div>
  );
}
