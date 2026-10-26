import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { MyCourse } from '../../api/types';
import { useUser } from '../../auth/AuthProvider';
import { CourseCard } from '../../components/CourseCard';
import { EmptyState, PageHeader, QueryView } from '../../components/ui';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';

export default function MyCourses() {
  useDocumentTitle('My courses');
  const user = useUser();
  const q = useQuery({ queryKey: ['courses', 'mine'], queryFn: () => api.get<{ items: MyCourse[] }>('/courses?scope=mine') });
  const isTeacher = user.role === 'teacher';
  return (
    <Page>
      <PageHeader title="My courses" lede={isTeacher ? 'Courses you teach this term and earlier.' : 'Courses you are studying, including completed ones.'}
        actions={!isTeacher && <Link className="btn btn--secondary" to="/catalogue">Browse the catalogue</Link>} />
      <QueryView q={q}>
        {(d) => {
          const current = d.items.filter((c) => c.status !== 'archived');
          const past = d.items.filter((c) => c.status === 'archived');
          if (d.items.length === 0) {
            return <EmptyState title={isTeacher ? 'No courses assigned to you yet' : 'You have not joined any courses yet'}
              action={!isTeacher ? <Link className="btn btn--primary" to="/catalogue">Find a course</Link> : undefined}>
              {isTeacher ? 'An administrator assigns trainers to courses.' : 'Open courses in the catalogue let you enrol yourself.'}
            </EmptyState>;
          }
          return (
            <div className="stack-lg">
              <section aria-labelledby="cur-h" className="stack">
                <h2 id="cur-h">Current</h2>
                {current.length ? <ul className="course-grid">{current.map((c) => <li key={c.id}><CourseCard course={c} teacher={isTeacher} /></li>)}</ul>
                  : <p className="muted">No current courses.</p>}
              </section>
              {past.length > 0 && (
                <section aria-labelledby="past-h" className="stack">
                  <h2 id="past-h">Archived</h2>
                  <p className="muted">Archived courses are read-only. Your grades and feedback remain available.</p>
                  <ul className="course-grid">{past.map((c) => <li key={c.id}><CourseCard course={c} teacher={isTeacher} /></li>)}</ul>
                </section>
              )}
            </div>
          );
        }}
      </QueryView>
    </Page>
  );
}
