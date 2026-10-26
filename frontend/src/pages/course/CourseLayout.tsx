import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Award, BookOpen, ClipboardList, FileQuestion, GraduationCap, Home, Megaphone, Users } from 'lucide-react';
import { api } from '../../api/client';
import type { CourseDetail } from '../../api/types';
import { Badge, ErrorState, Loading } from '../../components/ui';
import { CourseCover } from '../../components/CourseMedia';
import { useUser } from '../../auth/AuthProvider';

export interface CourseCtx { course: CourseDetail; isStaff: boolean }
export const useCourse = () => useOutletContext<CourseCtx>();

export function useCourseQuery(courseId: string) {
  return useQuery({ queryKey: ['course', courseId], queryFn: () => api.get<CourseDetail>(`/courses/${courseId}`) });
}

export default function CourseLayout() {
  const { courseId = '' } = useParams();
  const q = useCourseQuery(courseId);
  const user = useUser();
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
    <>
      <div className="course-head">
        <div className="course-head__inner">
          <CourseCover courseKey={course.code || course.id} className="course-head__cover" />
          <div className="row" style={{ gap: 8 }}>
            <span className="code-tag">{course.code}</span>
            <span className="meta">{course.termName}</span>
            {course.status !== 'published' && <Badge tone={course.status === 'archived' ? 'outline' : 'warn'}>{course.status === 'archived' ? 'Archived · read-only' : 'Draft · not visible to learners'}</Badge>}
            {isStaff && <Badge tone="brand">{user.role === 'admin' ? 'Administrator view' : 'You are a trainer on this course'}</Badge>}
          </div>
          <h1 style={{ fontSize: 'var(--text-3xl)', lineHeight: 1.15 }}>{course.title}</h1>
          {canSeeTabs && (
            <nav aria-label="Course sections">
              <div className="tabs">
                {tabs.map((t) => (
                  <NavLink key={t.to} to={t.to} end={t.end}><t.icon aria-hidden="true" />{t.label}</NavLink>
                ))}
              </div>
            </nav>
          )}
        </div>
      </div>
      <div className="content">
        <Outlet context={{ course, isStaff } satisfies CourseCtx} />
      </div>
    </>
  );
}
