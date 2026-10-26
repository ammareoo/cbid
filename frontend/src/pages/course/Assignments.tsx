import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../api/client';
import type { Assignment } from '../../api/types';
import { Badge, EmptyState, PublishBadge, QueryView, SectionTitle } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime, relative } from '../../utils/format';
import { useCourse } from './CourseLayout';
import { AssignmentForm } from './AssignmentForm';

export function LearnerStatus({ a }: { a: Assignment }) {
  if (a.score != null) return <Badge tone="ok">Graded {a.score}/{a.pointsPossible}</Badge>;
  if ((a.attemptsUsed ?? 0) > 0) return <Badge tone="info">Submitted</Badge>;
  const close = a.lateUntil ?? a.dueAt;
  if (new Date(close) < new Date()) return <Badge tone="danger">Missing</Badge>;
  if (new Date(a.dueAt) < new Date()) return <Badge tone="warn">Late window open</Badge>;
  return <Badge tone="outline">To do</Badge>;
}

export default function Assignments() {
  const { course, isStaff } = useCourse();
  useDocumentTitle(`Assignments · ${course.code}`);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['assignments', course.id], queryFn: () => api.get<{ items: Assignment[]; writable: boolean }>(`/courses/${course.id}/assignments`) });
  return (
    <>
      <SectionTitle title="Assignments" lede={isStaff ? 'Create work, set deadlines and follow submissions.' : 'Coursework for this course. Deadlines are shown in your time zone.'}
        actions={isStaff && course.writable && <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New assignment</button>} />
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title="No assignments yet">{isStaff ? 'Create the first assignment for this course.' : 'Your trainer has not set any assignments yet.'}</EmptyState> : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Assignments in {course.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Assignment</th><th scope="col">Due</th><th scope="col">{isStaff ? 'Status' : 'Your status'}</th>
                  {isStaff && <th scope="col" className="num">Submitted</th>}
                  {isStaff && <th scope="col" className="num">Graded</th>}
                  <th scope="col" className="num">Points</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((a) => (
                  <tr key={a.id}>
                    <th scope="row"><Link to={`/courses/${course.id}/assignments/${a.id}`}>{a.title}</Link></th>
                    <td><span className="nowrap">{formatDateTime(a.dueAt)}</span><br /><span className="meta">{relative(a.dueAt)}</span></td>
                    <td>{isStaff ? <PublishBadge status={a.status} /> : <LearnerStatus a={a} />}</td>
                    {isStaff && <td className="num tabular">{a.submittedCount} / {a.studentCount}</td>}
                    {isStaff && <td className="num tabular">{a.gradedCount}</td>}
                    <td className="num tabular">{a.pointsPossible}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
      {creating && <AssignmentForm courseId={course.id} open onClose={() => setCreating(false)} />}
    </>
  );
}
