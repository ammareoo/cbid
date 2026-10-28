import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, GraduationCap, UserCheck, Users } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, PageHeader, QueryView } from '../../components/ui';
import { BarList, ChartCard, Donut, Kpi } from '../../components/Charts';
import { coursePhoto, coursePhotoFocus } from '../../components/CourseMedia';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate, formatDateTime, relative } from '../../utils/format';
import { AnnouncementsFab } from '../shared/AnnouncementsFeed';

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
      <QueryView q={q}>
        {(d) => {
          const courseTotal = d.counts.publishedCourses + d.counts.draftCourses + d.counts.archivedCourses;
          return (
            <div className="dash admin-dash">
              <PageHeader
                title="Overview"
                lede="Institute health, courses needing attention, and recent activity."
                actions={<span className="meta">{formatDate(new Date())}</span>}
              />

              <section className="dash-kpis" aria-label="Key figures">
                <Kpi
                  icon={<GraduationCap />}
                  value={d.counts.activeStudents}
                  label="Active learners"
                  sub={d.counts.deactivatedUsers
                    ? <Link to="/admin/users?status=deactivated">{d.counts.deactivatedUsers} deactivated</Link>
                    : <Link to="/admin/users?role=student">View people</Link>}
                />
                <Kpi
                  icon={<Users />}
                  tone="teal"
                  value={d.counts.activeTeachers}
                  label="Active trainers"
                  sub={<Link to="/admin/users?role=teacher">View trainers</Link>}
                />
                <Kpi
                  icon={<BookOpen />}
                  tone="accent"
                  value={d.counts.publishedCourses}
                  label="Published courses"
                  sub={`${d.counts.draftCourses} draft · ${d.counts.archivedCourses} archived`}
                />
                <Kpi
                  icon={<UserCheck />}
                  tone="green"
                  value={d.counts.activeEnrollments}
                  label="Active enrolments"
                  sub={<Link to="/admin/courses">Manage courses</Link>}
                />
              </section>

              <div className="dash-charts dash-charts--pair">
                <ChartCard id="status-h" title="Courses by status" action={<Link to="/admin/courses">All courses</Link>}>
                  <Donut
                    centerValue={courseTotal}
                    centerLabel={courseTotal === 1 ? 'course' : 'courses'}
                    segments={[
                      { key: 'published', label: 'Published', value: d.counts.publishedCourses, tone: 'brand' },
                      { key: 'draft', label: 'Draft', value: d.counts.draftCourses, tone: 'accent' },
                      { key: 'archived', label: 'Archived', value: d.counts.archivedCourses, tone: 'muted' },
                    ]}
                  />
                </ChartCard>
                <ChartCard id="week-h" title="Last 7 days">
                  <BarList
                    empty="No activity this week."
                    data={[
                      {
                        key: 'subs',
                        label: 'Submissions',
                        sub: 'Assignments and quizzes',
                        value: d.counts.submissionsLast7Days,
                        display: String(d.counts.submissionsLast7Days),
                        tone: 'accent',
                      },
                      {
                        key: 'signins',
                        label: 'People signed in',
                        sub: 'Unique accounts',
                        value: d.counts.activeUsersLast7Days,
                        display: String(d.counts.activeUsersLast7Days),
                        tone: 'teal',
                      },
                    ]}
                  />
                </ChartCard>
              </div>

              <div className="dash-main dash-main--pair">
                <section className="panel dash-tile" aria-labelledby="att-h">
                  <div className="panel__head">
                    <h2 id="att-h">Needs attention</h2>
                    <AlertTriangle aria-hidden="true" />
                  </div>
                  <div className="panel__body panel__body--flush dash-tile__scroll">
                    {d.attention.length === 0 ? (
                      <p className="sign__empty">Every active course has a trainer and spare capacity.</p>
                    ) : (
                      <ul className="dash-course-list">
                        {d.attention.map((c) => (
                          <li key={c.id}>
                            <Link className="dash-course" to={`/admin/courses/${c.id}`}>
                              <img
                                className="dash-course__cover"
                                src={coursePhoto(c.code || c.id)}
                                alt=""
                                width={44}
                                height={32}
                                loading="lazy"
                                style={{ objectPosition: coursePhotoFocus(c.code || c.id) }}
                              />
                              <span className="dash-course__main">
                                <span className="dash-course__top">
                                  <span className="code-tag">{c.code}</span>
                                  <span className="meta">{c.studentCount} learners</span>
                                </span>
                                <span className="dash-course__title">{c.title}</span>
                              </span>
                              <span className="dash-course__meta">
                                {c.teacherCount === 0 && <Badge tone="danger">No trainer</Badge>}
                                {c.capacity != null && c.studentCount >= c.capacity && (
                                  <Badge tone="warn">Full {c.studentCount}/{c.capacity}</Badge>
                                )}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                <section className="panel dash-tile" aria-labelledby="act-h">
                  <div className="panel__head">
                    <h2 id="act-h">Recent activity</h2>
                    <Link to="/admin/audit">Audit log</Link>
                  </div>
                  <div className="panel__body panel__body--flush dash-tile__scroll">
                    {d.recentActivity.length === 0 ? (
                      <p className="sign__empty">No recent audit events.</p>
                    ) : (
                      <ul className="admin-dash-activity">
                        {d.recentActivity.map((a) => (
                          <li key={a.id}>
                            <div className="admin-dash-activity__row">
                              <span className="admin-dash-activity__main">
                                <strong>{actionLabel(a.action)}</strong>
                                <span className="meta">{a.actorName ?? 'System or anonymous'}</span>
                              </span>
                              <time className="admin-dash-activity__when" dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                                {relative(a.createdAt)}
                              </time>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </div>
            </div>
          );
        }}
      </QueryView>
      <AnnouncementsFab manageTo="/admin/announcements" />
    </Page>
  );
}
