import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileQuestion, Plus } from 'lucide-react';
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
    <div className="course-work">
      <SectionTitle title="Quizzes" lede={isStaff ? 'Short checks marked automatically.' : 'Practice checks. Scores are set when you submit.'}
        actions={isStaff && course.writable && <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New quiz</button>} />
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title="No quizzes yet" /> : (
          <ul className="work-list" aria-label={`Quizzes in ${course.title}`}>
            {d.items.map((x) => (
              <li key={x.id} className="work-row">
                <span className="work-row__glyph" aria-hidden="true"><FileQuestion width={16} height={16} /></span>
                <div className="work-row__main">
                  <Link className="work-row__title" to={`/courses/${course.id}/quizzes/${x.id}`}>{x.title}</Link>
                  <span className="work-row__meta">
                    <span className="nowrap">Closes {formatDateTime(x.closesAt)}</span>
                    {x.timeLimitMinutes ? <span>{x.timeLimitMinutes} min limit</span> : null}
                    {isStaff && x.questionCount != null ? <span className="tabular">{x.questionCount} questions</span> : null}
                  </span>
                </div>
                <div className="work-row__aside">
                  <QuizWindowBadge q={x} />
                  {isStaff ? (
                    <>
                      <PublishBadge status={x.status} />
                      <span className="work-row__stat tabular">{x.submittedCount ?? 0} submitted</span>
                    </>
                  ) : (
                    <>
                      {x.openAttemptId
                        ? <Badge tone="warn">In progress</Badge>
                        : <span className="work-row__stat">{x.attemptsUsed} of {x.maxAttempts}</span>}
                      <span className="work-row__stat tabular">
                        {x.bestScore != null ? `${x.bestScore}/${x.maxScore}` : '—'}
                      </span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      {creating && <QuizBuilder courseId={course.id} open onClose={() => setCreating(false)} />}
    </div>
  );
}
