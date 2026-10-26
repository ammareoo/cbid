import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../api/client';
import type { Quiz } from '../../api/types';
import { Badge, EmptyState, PublishBadge, QueryView, SectionTitle } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime } from '../../utils/format';
import { useCourse } from './CourseLayout';
import { QuizBuilder } from './QuizBuilder';

export function windowState(q: Pick<Quiz, 'opensAt' | 'closesAt'>) {
  const now = Date.now();
  if (now < new Date(q.opensAt).getTime()) return 'upcoming' as const;
  if (now >= new Date(q.closesAt).getTime()) return 'closed' as const;
  return 'open' as const;
}

export function QuizWindowBadge({ q }: { q: Pick<Quiz, 'opensAt' | 'closesAt'> }) {
  const s = windowState(q);
  return s === 'open' ? <Badge tone="ok">Open now</Badge> : s === 'upcoming' ? <Badge tone="info">Opens {formatDateTime(q.opensAt)}</Badge> : <Badge tone="outline">Closed</Badge>;
}

export default function Quizzes() {
  const { course, isStaff } = useCourse();
  useDocumentTitle(`Quizzes · ${course.code}`);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['quizzes', course.id], queryFn: () => api.get<{ items: Quiz[] }>(`/courses/${course.id}/quizzes`) });
  return (
    <>
      <SectionTitle title="Quizzes" lede={isStaff ? 'Short checks marked automatically on the server.' : 'Practice checks. Your answers save as you go; scores are worked out when you submit.'}
        actions={isStaff && course.writable && <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New quiz</button>} />
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title="No quizzes yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Quizzes in {course.title}</caption>
              <thead><tr><th scope="col">Quiz</th><th scope="col">Window</th><th scope="col">Closes</th>{isStaff ? <><th scope="col">Status</th><th scope="col" className="num">Questions</th><th scope="col" className="num">Submitted</th></> : <><th scope="col">Attempts</th><th scope="col" className="num">Best score</th></>}</tr></thead>
              <tbody>
                {d.items.map((x) => (
                  <tr key={x.id}>
                    <th scope="row"><Link to={`/courses/${course.id}/quizzes/${x.id}`}>{x.title}</Link>{x.timeLimitMinutes && <span className="meta" style={{ display: 'block' }}>{x.timeLimitMinutes}-minute limit</span>}</th>
                    <td><QuizWindowBadge q={x} /></td>
                    <td className="nowrap">{formatDateTime(x.closesAt)}</td>
                    {isStaff ? (
                      <><td><PublishBadge status={x.status} /></td><td className="num tabular">{x.questionCount}</td><td className="num tabular">{x.submittedCount}</td></>
                    ) : (
                      <><td>{x.openAttemptId ? <Badge tone="warn">In progress</Badge> : `${x.attemptsUsed} of ${x.maxAttempts}`}</td><td className="num tabular">{x.bestScore != null ? `${x.bestScore} / ${x.maxScore}` : '—'}</td></>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
      {creating && <QuizBuilder courseId={course.id} open onClose={() => setCreating(false)} />}
    </>
  );
}
