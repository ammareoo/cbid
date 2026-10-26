import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, MessageSquareText } from 'lucide-react';
import { api } from '../../api/client';
import type { Announcement, Paged, StudentDashboard, TeacherDashboard } from '../../api/types';
import { useUser } from '../../auth/AuthProvider';
import { Badge, EmptyState, PageHeader, QueryView } from '../../components/ui';
import { CourseCard } from '../../components/CourseCard';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate, formatDateTime, percent, relative } from '../../utils/format';

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name}`;
}

function AnnouncementsPanel() {
  const q = useQuery({ queryKey: ['announcements', 'feed', 1, 3], queryFn: () => api.get<Paged<Announcement>>('/announcements?pageSize=3') });
  return (
    <section className="panel" aria-labelledby="ann-h">
      <div className="panel__head"><h2 id="ann-h">Announcements</h2><Link to="/announcements">View all</Link></div>
      <div className="panel__body">
        <QueryView q={q}>
          {(d) => d.items.length === 0 ? <p className="muted">No announcements yet.</p> : (
            <ul className="list">
              {d.items.map((a) => (
                <li key={a.id} className="stack-sm">
                  <span className="meta">{a.courseCode ?? 'Institute'} · {formatDate(a.createdAt)}</span>
                  <strong>{a.title}</strong>
                  <p className="muted" style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{a.body}</p>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </div>
    </section>
  );
}

function StudentView({ d, name }: { d: StudentDashboard; name: string }) {
  const pending = d.upcoming.filter((u) => !u.done);
  return (
    <>
      <PageHeader
        eyebrow={formatDate(new Date())}
        title={greeting(name)}
        lede={pending.length === 0 ? 'Nothing is due in the next three weeks.' : `You have ${pending.length} ${pending.length === 1 ? 'thing' : 'things'} to finish in the next three weeks.`}
      />
      <div className="columns">
        <div className="stack-lg">
          <section aria-labelledby="courses-h" className="stack">
            <div className="row-between"><h2 id="courses-h">Your courses</h2><Link to="/catalogue">Browse the catalogue</Link></div>
            {d.courses.length === 0 ? (
              <EmptyState title="You are not enrolled in any courses yet" action={<Link className="btn btn--primary" to="/catalogue">Find a course</Link>}>
                Courses you join appear here with your progress and next deadline.
              </EmptyState>
            ) : (
              <ul className="course-grid">{d.courses.map((c) => <li key={c.id}><CourseCard course={c} /></li>)}</ul>
            )}
          </section>
          <section aria-labelledby="fb-h" className="panel">
            <div className="panel__head"><h2 id="fb-h">Recent feedback</h2><Link to="/grades">All grades</Link></div>
            <div className="panel__body">
              {d.feedback.length === 0 ? <p className="muted">Released grades and trainer comments will appear here.</p> : (
                <ul className="list">
                  {d.feedback.map((f) => (
                    <li key={f.assignmentId} className="list-item">
                      <div className="stack-sm">
                        <Link to={`/courses/${f.courseId}/assignments/${f.assignmentId}`}><strong>{f.title}</strong></Link>
                        <span className="meta">{f.courseCode} · released {formatDate(f.releasedAt)}</span>
                      </div>
                      <span className="tabular" style={{ fontWeight: 700 }}>{f.score} / {f.pointsPossible}<span className="meta"> ({percent(f.score, f.pointsPossible)}%)</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
        <aside className="stack-lg priority-first" aria-label="Upcoming and announcements">
          <section className="sign" aria-labelledby="next-h">
            <div className="sign__head"><h2 id="next-h">Next up</h2><span>{pending.length} open</span></div>
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
          </section>
          <AnnouncementsPanel />
        </aside>
      </div>
    </>
  );
}

function TeacherView({ d, name }: { d: TeacherDashboard; name: string }) {
  const totalToGrade = d.courses.reduce((n, c) => n + (c.needsGrading ?? 0), 0);
  return (
    <>
      <PageHeader eyebrow={formatDate(new Date())} title={greeting(name)}
        lede={totalToGrade ? `${totalToGrade} ${totalToGrade === 1 ? 'submission needs' : 'submissions need'} grading across your courses.` : 'You are up to date with grading.'} />
      <div className="columns">
        <div className="stack-lg">
          <section className="panel" aria-labelledby="grade-h">
            <div className="panel__head"><h2 id="grade-h">Needs grading</h2><ClipboardCheck aria-hidden="true" /></div>
            <div className="panel__body panel__body--flush">
              {d.toGrade.length === 0 ? <div className="panel__body"><p className="muted">No submissions are waiting. New work appears here as learners submit.</p></div> : (
                <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
                  <table className="table">
                    <thead><tr><th scope="col">Learner</th><th scope="col">Assignment</th><th scope="col">Submitted</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
                    <tbody>
                      {d.toGrade.map((g) => (
                        <tr key={g.assignmentId + g.studentId}>
                          <th scope="row">{g.studentName}</th>
                          <td><span className="code-tag">{g.courseCode}</span> {g.title}</td>
                          <td><span className="nowrap">{formatDateTime(g.submittedAt)}</span> {g.isLate && <Badge tone="warn">Late</Badge>}</td>
                          <td><Link className="btn btn--secondary btn--sm" to={`/courses/${g.courseId}/assignments/${g.assignmentId}/grading?student=${g.studentId}`}>Grade<span className="sr-only"> {g.studentName}</span></Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
          <section className="stack" aria-labelledby="tc-h">
            <h2 id="tc-h">Your courses</h2>
            {d.courses.length === 0 ? <EmptyState title="You are not assigned to any courses yet">An administrator assigns trainers to courses.</EmptyState> : (
              <ul className="course-grid">{d.courses.map((c) => <li key={c.id}><CourseCard course={c} teacher /></li>)}</ul>
            )}
          </section>
        </div>
        <aside className="stack-lg" aria-label="Deadlines and announcements">
          <section className="sign" aria-labelledby="up-h">
            <div className="sign__head"><h2 id="up-h">Deadlines ahead</h2><MessageSquareText aria-hidden="true" width={18} height={18} /></div>
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
          </section>
          <AnnouncementsPanel />
        </aside>
      </div>
    </>
  );
}

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const user = useUser();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<StudentDashboard | TeacherDashboard>('/me/dashboard') });
  const name = user.preferredName ?? user.fullName.split(' ').find((p) => !/^(Dr|Prof)\.?$/i.test(p)) ?? user.fullName;
  return (
    <Page>
      <QueryView q={q} loadingLabel="Loading your dashboard">
        {(d) => (d.role === 'student' ? <StudentView d={d} name={name} /> : <TeacherView d={d} name={user.fullName} />)}
      </QueryView>
    </Page>
  );
}
