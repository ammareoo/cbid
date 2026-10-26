import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, PageHeader, QueryView } from '../../components/ui';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime, relative } from '../../utils/format';

interface Dash {
  counts: Record<'activeStudents' | 'activeTeachers' | 'deactivatedUsers' | 'publishedCourses' | 'draftCourses' | 'archivedCourses' | 'activeEnrollments' | 'submissionsLast7Days' | 'activeUsersLast7Days', number>;
  attention: { id: string; code: string; title: string; status: string; teacherCount: number; studentCount: number; capacity: number | null }[];
  recentActivity: { id: number; action: string; entityType: string | null; createdAt: string; actorName: string | null }[];
}

const LABELS: Record<string, string> = {
  'auth.login': 'Signed in', 'auth.logout': 'Signed out', 'auth.login_failed': 'Failed sign-in', 'auth.password_changed': 'Changed password',
  'auth.password_reset_requested': 'Requested password reset', 'auth.password_reset': 'Reset password', 'user.created': 'Created account',
  'user.updated': 'Updated account', 'user.role_changed': 'Changed role', 'user.reset_sent': 'Sent reset link', 'course.created': 'Created course',
  'course.updated': 'Updated course', 'course.status_published': 'Published course', 'course.status_archived': 'Archived course',
  'course.teacher_assigned': 'Assigned trainer', 'course.teacher_removed': 'Removed trainer', 'enrollment.admin_enrolled': 'Enrolled learners',
  'enrollment.self_enrolled': 'Self-enrolled', 'enrollment.self_withdrew': 'Withdrew from course', 'grade.saved': 'Saved grade',
  'grade.released': 'Released grades', 'submission.created': 'Submitted work', 'quiz.attempt_submitted': 'Submitted quiz', 'settings.updated': 'Changed settings',
};
export const actionLabel = (a: string) => LABELS[a] ?? a.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());

export default function AdminOverview() {
  useDocumentTitle('Administration');
  const q = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => api.get<Dash>('/admin/dashboard') });
  return (
    <Page>
      <PageHeader eyebrow="Administration" title="Institute overview" lede="Live figures from the database. Use the navigation above to manage people, courses and settings." />
      <QueryView q={q}>
        {(d) => (
          <div className="stack-lg">
            <section aria-labelledby="people-h" className="stack">
              <h2 id="people-h" className="sr-only">Key figures</h2>
              <div className="stats">
                {([
                  ['Active learners', d.counts.activeStudents, '/admin/users?role=student'],
                  ['Active trainers', d.counts.activeTeachers, '/admin/users?role=teacher'],
                  ['Published courses', d.counts.publishedCourses, '/admin/courses?status=published'],
                  ['Active enrolments', d.counts.activeEnrollments, '/admin/courses'],
                  ['Submissions, last 7 days', d.counts.submissionsLast7Days, null],
                  ['People signed in, last 7 days', d.counts.activeUsersLast7Days, null],
                ] as const).map(([label, value, to]) => (
                  <div key={label} className="stat">
                    <p className="stat__value">{value}</p>
                    <p className="stat__label">{to ? <Link to={to}>{label}</Link> : label}</p>
                  </div>
                ))}
              </div>
              <p className="meta">{d.counts.draftCourses} draft and {d.counts.archivedCourses} archived courses · {d.counts.deactivatedUsers} deactivated accounts</p>
            </section>
            <div className="columns columns--even">
              <section className="panel" aria-labelledby="att-h">
                <div className="panel__head"><h2 id="att-h">Courses needing attention</h2><AlertTriangle aria-hidden="true" /></div>
                <div className="panel__body">
                  {d.attention.length === 0 ? <p className="muted">Every active course has a trainer and spare capacity.</p> : (
                    <ul className="list">{d.attention.map((c) => (
                      <li key={c.id} className="list-item">
                        <span><Link to={`/admin/courses/${c.id}`}><span className="code-tag">{c.code}</span> {c.title}</Link></span>
                        <span className="row" style={{ gap: 6 }}>
                          {c.teacherCount === 0 && <Badge tone="danger">No trainer</Badge>}
                          {c.capacity != null && c.studentCount >= c.capacity && <Badge tone="warn">Full ({c.studentCount}/{c.capacity})</Badge>}
                        </span>
                      </li>
                    ))}</ul>
                  )}
                </div>
              </section>
              <section className="panel" aria-labelledby="act-h">
                <div className="panel__head"><h2 id="act-h">Recent activity</h2><Link to="/admin/audit">Audit log</Link></div>
                <div className="panel__body">
                  <ul className="list">{d.recentActivity.map((a) => (
                    <li key={a.id} className="list-item">
                      <span><strong>{actionLabel(a.action)}</strong><br /><span className="meta">{a.actorName ?? 'System or anonymous'}</span></span>
                      <span className="meta nowrap" title={formatDateTime(a.createdAt)}>{relative(a.createdAt)}</span>
                    </li>
                  ))}</ul>
                </div>
              </section>
            </div>
          </div>
        )}
      </QueryView>
    </Page>
  );
}
