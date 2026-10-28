import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
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
    <div className="course-work">
      <SectionTitle title="Assignments" lede={isStaff ? 'Deadlines, submissions and marks.' : 'Coursework for this course.'}
        actions={isStaff && course.writable && <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New assignment</button>} />
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title="No assignments yet">{isStaff ? 'Create the first assignment for this course.' : 'Your trainer has not set any assignments yet.'}</EmptyState> : (
          <ul className="work-list" aria-label={`Assignments in ${course.title}`}>
            {d.items.map((a) => (
              <li key={a.id} className="work-row">
                <span className="work-row__glyph" aria-hidden="true"><ClipboardList width={16} height={16} /></span>
                <div className="work-row__main">
                  <Link className="work-row__title" to={`/courses/${course.id}/assignments/${a.id}`}>{a.title}</Link>
                  <span className="work-row__meta">
                    <span className="nowrap">Due {formatDateTime(a.dueAt)}</span>
                    <span>{relative(a.dueAt)}</span>
                    <span className="tabular">{a.pointsPossible} pts</span>
                  </span>
                </div>
                <div className="work-row__aside">
                  {isStaff ? (
                    <>
                      <PublishBadge status={a.status} />
                      <span className="work-row__stat tabular" title="Submitted">{a.submittedCount}/{a.studentCount} in</span>
                      <span className="work-row__stat tabular" title="Graded">{a.gradedCount} graded</span>
                    </>
                  ) : (
                    <LearnerStatus a={a} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      {creating && <AssignmentForm courseId={course.id} open onClose={() => setCreating(false)} />}
    </div>
  );
}
