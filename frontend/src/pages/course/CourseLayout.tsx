import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Award, BookOpen, ClipboardList, FileQuestion, GraduationCap, Home, Megaphone, Users } from 'lucide-react';
import { api } from '../../api/client';
import type { CourseDetail } from '../../api/types';
import { Badge, ErrorState, Loading } from '../../components/ui';
import { coursePhoto, coursePhotoFocus } from '../../components/CourseMedia';

export interface CourseCtx { course: CourseDetail; isStaff: boolean }
export const useCourse = () => useOutletContext<CourseCtx>();

export function useCourseQuery(courseId: string) {
  return useQuery({ queryKey: ['course', courseId], queryFn: () => api.get<CourseDetail>(`/courses/${courseId}`) });
}

export default function CourseLayout() {
  const { courseId = '' } = useParams();
  const q = useCourseQuery(courseId);
  if (q.isPending) return <div className="content"><Loading label="Loading course" /></div>;
  if (q.isError) return <div className="content"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const course = q.data;
  const isStaff = course.relationship === 'staff';
  const base = `/courses/${course.id}`;
  const tabs = [
    { to: base, label: 'Overview', icon: Home, end: true },
    { to: `${base}/modules`, label: 'Content', icon: BookOpen },
    { to: `${base}/assignments`, label: 'Assignments', icon: ClipboardList },
    { to: `${base}/quizzes`, label: 'Quizzes', icon: FileQuestion },
    { to: `${base}/announcements`, label: 'Announcements', icon: Megaphone },
    { to: `${base}/grades`, label: isStaff ? 'Gradebook' : 'My grades', icon: GraduationCap },
    ...(isStaff ? [{ to: `${base}/students`, label: 'Learners', icon: Users }, { to: `${base}/certificates`, label: 'Certificates', icon: Award }] : []),
  ];
  const canSeeTabs = isStaff || course.relationship === 'learner';

  return (
    <div className="course-shell">
      <header
        className="course-head"
        style={{
          '--course-head-photo': `url(${coursePhoto(course.code || course.id)})`,
          '--course-head-focus': coursePhotoFocus(course.code || course.id),
        } as React.CSSProperties}
      >
        <div className="course-head__hero">
          <div className="course-head__inner">
            <div className="course-head__meta">
              <span className="code-tag">{course.code}</span>
              <span className="meta">{course.termName}</span>
              {course.status !== 'published' && (
                <Badge tone={course.status === 'archived' ? 'outline' : 'warn'}>
                  {course.status === 'archived' ? 'Archived · read-only' : 'Draft · not visible to learners'}
                </Badge>
              )}
            </div>
            <h1 tabIndex={-1} data-page-heading className="course-head__title">{course.title}</h1>
          </div>
        </div>
        {canSeeTabs && (
          <div className="course-head__nav-wrap">
            <nav className="course-head__nav" aria-label="Course sections">
              <div className="tabs tabs--course">
                {tabs.map((t) => (
                  <NavLink key={t.to} to={t.to} end={t.end}><t.icon aria-hidden="true" />{t.label}</NavLink>
                ))}
              </div>
            </nav>
          </div>
        )}
      </header>
      <div className="content content--course">
        <div className="course-page">
          <Outlet context={{ course, isStaff } satisfies CourseCtx} />
        </div>
      </div>
    </div>
  );
}
