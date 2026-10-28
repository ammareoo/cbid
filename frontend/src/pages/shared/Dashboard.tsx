import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarClock, CheckCircle2, ClipboardCheck, GraduationCap, ListTodo, MessageSquareText, TrendingUp, Users } from 'lucide-react';
import { api } from '../../api/client';
import type { MyCourse, StudentDashboard, TeacherDashboard } from '../../api/types';
import { useUser } from '../../auth/AuthProvider';
import { Badge, EmptyState, PageHeader, ProgressBar, QueryView } from '../../components/ui';
import { BarList, ChartCard, ColumnChart, Donut, Kpi } from '../../components/Charts';
import { CourseCover } from '../../components/CourseMedia';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate, formatDateTime, percent, relative } from '../../utils/format';
import { AnnouncementsFab } from './AnnouncementsFeed';

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name}`;
}

const mean = (values: number[]) => (values.length ? Math.round(values.reduce((n, v) => n + v, 0) / values.length) : null);

/** Compact course list for the dashboard main column — no cover images. */
function CoursesPanel({ courses, teacher, empty }: { courses: MyCourse[]; teacher?: boolean; empty: ReactNode }) {
  return (
    <section className="panel dash-tile" aria-labelledby="courses-h">
      <div className="panel__head">
        <h2 id="courses-h">Your courses</h2>
        <Link to={teacher ? '/courses' : '/catalogue'}>{teacher ? 'All courses' : 'Browse catalogue'}</Link>
      </div>
      <div className="panel__body panel__body--flush dash-tile__scroll">
        {courses.length === 0 ? <div className="panel__body">{empty}</div> : (
          <ul className="dash-course-list">
            {courses.map((c) => (
              <li key={c.id}>
                <Link className="dash-course" to={`/courses/${c.id}`}>
                  <CourseCover courseKey={c.code || c.id} className="dash-course__cover" />
                  <span className="dash-course__main">
                    <span className="dash-course__top">
                      <span className="code-tag">{c.code}</span>
                      {c.status === 'archived' ? <Badge tone="outline">Archived</Badge>
                        : c.status === 'draft' ? <Badge tone="warn">Draft</Badge>
                        : <span className="meta">{c.termName}</span>}
                    </span>
                    <span className="dash-course__title">{c.title}</span>
                  </span>
                  <span className="dash-course__meta">
                    {teacher ? (
                      <>
                        <span className="meta"><Users aria-hidden="true" width={14} height={14} />{c.studentCount ?? 0}</span>
                        {(c.needsGrading ?? 0) > 0
                          ? <Badge tone="warn">{c.needsGrading} to grade</Badge>
                          : <Badge tone="ok">Up to date</Badge>}
                      </>
                    ) : (
                      <span className="dash-course__progress">
                        <ProgressBar value={c.progress} label={`${c.code} progress`} />
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StudentView({ d, name }: { d: StudentDashboard; name: string }) {
  const active = d.courses.filter((c) => c.status !== 'archived');
  const tracked = active.filter((c) => c.progress != null);
  const avgProgress = mean(tracked.map((c) => c.progress ?? 0));
  const completed = active.filter((c) => c.progress === 100).length;
  const open = d.upcoming.filter((u) => !u.done);
  const grades = d.feedback.map((f) => ({ f, pct: Math.round(percent(f.score, f.pointsPossible) ?? 0) }));
  const avgGrade = mean(grades.map((g) => g.pct));

  return (
    <div className="dash">
      <PageHeader title={greeting(name)} actions={<span className="meta">{formatDate(new Date())}</span>} />

      <section className="dash-kpis" aria-label="Key figures">
        <Kpi icon={<BookOpen />} value={active.length} label="Active courses" sub={completed ? `${completed} completed` : undefined} />
        <Kpi icon={<TrendingUp />} tone="green" value={avgProgress == null ? '—' : `${avgProgress}%`} label="Average progress" />
        <Kpi icon={<ListTodo />} tone="accent" value={open.length} label="Open tasks"
          sub={open[0] ? `Next ${relative(open[0].dueAt)}` : 'Nothing due'} />
        <Kpi icon={<GraduationCap />} tone="teal" value={avgGrade == null ? '—' : `${avgGrade}%`} label="Recent grade average" />
      </section>

      <div className="dash-charts">
        <ChartCard id="prog-h" title="Progress by course" action={<Link to="/courses">My courses</Link>}>
          <BarList
            max={100}
            empty="Join a course to track your progress."
            data={tracked.map((c) => ({
              key: c.id, label: c.title, sub: c.code, value: c.progress ?? 0, display: `${c.progress}%`,
              href: `/courses/${c.id}`, tone: c.progress === 100 ? 'green' : 'brand',
            }))}
          />
        </ChartCard>
        <ChartCard id="grades-h" title="Recent grades" action={<Link to="/grades">All grades</Link>}>
          <ColumnChart
            max={100}
            empty="Released grades will appear here."
            data={grades.map(({ f, pct }) => ({
              key: f.assignmentId, label: f.courseCode, title: f.title, value: pct, display: `${pct}%`,
              href: `/courses/${f.courseId}/assignments/${f.assignmentId}`,
              tone: pct >= 80 ? 'green' : pct >= 50 ? 'teal' : 'accent',
            }))}
          />
        </ChartCard>
        <ChartCard id="tasks-h" title="Tasks, next 3 weeks">
          <Donut
            centerValue={d.upcoming.length}
            centerLabel={d.upcoming.length === 1 ? 'task' : 'tasks'}
            segments={[
              { key: 'done', label: 'Done', value: d.upcoming.length - open.length, tone: 'green' },
              { key: 'assignment', label: 'Assignments open', value: open.filter((u) => u.type === 'assignment').length, tone: 'brand' },
              { key: 'quiz', label: 'Quizzes open', value: open.filter((u) => u.type === 'quiz').length, tone: 'accent' },
            ]}
          />
        </ChartCard>
      </div>

      <div className="dash-main dash-main--pair">
        <section className="sign dash-tile dash-charts__sign" aria-labelledby="next-h">
          <div className="sign__head"><h2 id="next-h">Next up</h2><span>{open.length} open</span></div>
          <div className="dash-tile__scroll">
            {d.upcoming.length === 0 ? <p className="sign__empty">No deadlines in the next three weeks.</p> : (
              <ol>
                {d.upcoming.map((u, i) => (
                  <li key={u.type + u.id}>
                    <Link className="sign__row" to={`/courses/${u.courseId}/${u.type === 'quiz' ? 'quizzes' : 'assignments'}/${u.id}`}>
                      <span className={`sign__num${u.done ? ' sign__num--done' : ''}`} aria-hidden="true">{u.done ? <CheckCircle2 width={18} height={18} /> : i + 1}</span>
                      <span>
                        <span className="sign__title" style={{ display: 'block' }}>{u.title}</span>
                        <span className="sign__sub">{u.courseCode} · {u.type === 'quiz' ? 'Quiz closes' : 'Due'} {formatDateTime(u.dueAt)}{u.done ? ' · done' : ''}</span>
                      </span>
                      <span className="sign__when">{u.done ? <span className="sr-only">Completed</span> : relative(u.dueAt)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
        <CoursesPanel
          courses={d.courses}
          empty={(
            <EmptyState title="You are not enrolled in any courses yet" action={<Link className="btn btn--primary" to="/catalogue">Find a course</Link>}>
              Courses you join appear here with your progress and next deadline.
            </EmptyState>
          )}
        />
      </div>
    </div>
  );
}

function TeacherView({ d, name }: { d: TeacherDashboard; name: string }) {
  const live = d.courses.filter((c) => c.status !== 'archived');
  const count = (status: string) => d.courses.filter((c) => c.status === status).length;
  const learners = live.reduce((n, c) => n + (c.studentCount ?? 0), 0);
  const toGrade = d.courses.reduce((n, c) => n + (c.needsGrading ?? 0), 0);
  const gradingCourses = d.courses.filter((c) => (c.needsGrading ?? 0) > 0).length;
  const drafts = count('draft');

  return (
    <div className="dash">
      <PageHeader title={greeting(name)} actions={<span className="meta">{formatDate(new Date())}</span>} />

      <section className="dash-kpis" aria-label="Key figures">
        <Kpi icon={<BookOpen />} value={count('published')} label="Live courses" sub={drafts ? `${drafts} in draft` : undefined} />
        <Kpi icon={<Users />} tone="teal" value={learners} label="Learners" sub={`Across ${live.length} ${live.length === 1 ? 'course' : 'courses'}`} />
        <Kpi icon={<ClipboardCheck />} tone="accent" value={toGrade} label="To grade"
          sub={toGrade ? `In ${gradingCourses} ${gradingCourses === 1 ? 'course' : 'courses'}` : 'All caught up'} />
        <Kpi icon={<CalendarClock />} tone="green" value={d.upcoming.length} label="Deadlines, next 3 weeks"
          sub={d.upcoming[0] ? `Next ${relative(d.upcoming[0].dueAt)}` : undefined} />
      </section>

      <div className="dash-charts dash-charts--pair">
        <ChartCard id="learners-h" title="Learners by course" action={<Link to="/courses">My courses</Link>}>
          <ColumnChart
            empty="No active courses yet."
            data={live.map((c) => ({
              key: c.id, label: c.code, title: c.title, value: c.studentCount ?? 0, href: `/courses/${c.id}`,
            }))}
          />
        </ChartCard>
        <ChartCard id="status-h" title="Courses by status">
          <Donut
            centerValue={d.courses.length}
            centerLabel={d.courses.length === 1 ? 'course' : 'courses'}
            segments={[
              { key: 'published', label: 'Published', value: count('published'), tone: 'brand' },
              { key: 'draft', label: 'Draft', value: drafts, tone: 'accent' },
              { key: 'archived', label: 'Archived', value: count('archived'), tone: 'green' },
            ]}
          />
        </ChartCard>
      </div>

      <div className="dash-main">
        <section className="panel dash-tile" aria-labelledby="grade-h">
          <div className="panel__head"><h2 id="grade-h">Needs grading</h2><ClipboardCheck aria-hidden="true" /></div>
          <div className="panel__body panel__body--flush dash-tile__scroll">
            {d.toGrade.length === 0 ? <div className="panel__body"><p className="muted">No submissions are waiting. New work appears here as learners submit.</p></div> : (
              <ul className="dash-grade-list">
                {d.toGrade.map((g) => (
                  <li key={g.assignmentId + g.studentId}>
                    <div className="dash-grade">
                      <div className="dash-grade__main">
                        <strong>{g.studentName}</strong>
                        <span className="meta"><span className="code-tag">{g.courseCode}</span> {g.title}</span>
                        <span className="meta">{formatDateTime(g.submittedAt)}{g.isLate ? ' · Late' : ''}</span>
                      </div>
                      <Link className="btn btn--secondary btn--sm" to={`/courses/${g.courseId}/assignments/${g.assignmentId}/grading?student=${g.studentId}`}>Grade<span className="sr-only"> {g.studentName}</span></Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className="sign dash-tile dash-charts__sign" aria-labelledby="up-h">
          <div className="sign__head"><h2 id="up-h">Deadlines ahead</h2><MessageSquareText aria-hidden="true" width={18} height={18} /></div>
          <div className="dash-tile__scroll">
            {d.upcoming.length === 0 ? <p className="sign__empty">No deadlines in the next three weeks.</p> : (
              <ol>
                {d.upcoming.map((u, i) => (
                  <li key={u.id}>
                    <Link className="sign__row" to={`/courses/${u.courseId}/assignments/${u.id}`}>
                      <span className="sign__num" aria-hidden="true">{i + 1}</span>
                      <span>
                        <span className="sign__title" style={{ display: 'block' }}>{u.title}</span>
                        <span className="sign__sub">{u.courseCode} · {u.submittedCount} of {u.studentCount} submitted{u.status === 'draft' ? ' · draft' : ''}</span>
                      </span>
                      <span className="sign__when">{relative(u.dueAt)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
        <CoursesPanel
          courses={d.courses}
          teacher
          empty={<EmptyState title="You are not assigned to any courses yet">An administrator assigns trainers to courses.</EmptyState>}
        />
      </div>
    </div>
  );
}

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const user = useUser();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<StudentDashboard | TeacherDashboard>('/me/dashboard') });
  const name = user.preferredName ?? user.fullName.split(' ').find((p) => !/^(Dr|Prof)\.?$/i.test(p)) ?? user.fullName;
  return (
    <Page wide>
      <QueryView q={q} loadingLabel="Loading your dashboard">
        {(d) => (d.role === 'student' ? <StudentView d={d} name={name} /> : <TeacherView d={d} name={user.fullName} />)}
      </QueryView>
      <AnnouncementsFab />
    </Page>
  );
}
