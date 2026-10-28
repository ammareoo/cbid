import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { homeFor, useAuth } from './auth/AuthProvider';
import { AppShell } from './layouts/AppShell';
import { Loading } from './components/ui';
import type { Role } from './api/types';

const Login = lazy(() => import('./pages/auth/Login'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const Verify = lazy(() => import('./pages/public/Verify'));

const Dashboard = lazy(() => import('./pages/shared/Dashboard'));
const MyCourses = lazy(() => import('./pages/shared/MyCourses'));
const Catalogue = lazy(() => import('./pages/student/Catalogue'));
const StudentGrades = lazy(() => import('./pages/student/Grades'));
const CalendarPage = lazy(() => import('./pages/shared/Calendar'));
const SettingsPage = lazy(() => import('./pages/shared/Settings'));

const CourseLayout = lazy(() => import('./pages/course/CourseLayout'));
const CourseOverview = lazy(() => import('./pages/course/Overview'));
const CourseModules = lazy(() => import('./pages/course/Modules'));
const ItemView = lazy(() => import('./pages/course/ItemView'));
const AssignmentList = lazy(() => import('./pages/course/Assignments'));
const AssignmentDetail = lazy(() => import('./pages/course/AssignmentDetail'));
const Grading = lazy(() => import('./pages/teacher/Grading'));
const QuizList = lazy(() => import('./pages/course/Quizzes'));
const QuizDetail = lazy(() => import('./pages/course/QuizDetail'));
const QuizAttempt = lazy(() => import('./pages/student/QuizAttempt'));
const CourseAnnouncements = lazy(() => import('./pages/course/Announcements'));
const CourseGrades = lazy(() => import('./pages/course/Grades'));
const CourseStudents = lazy(() => import('./pages/teacher/Students'));
const CourseCertificates = lazy(() => import('./pages/teacher/CourseCertificates'));
const Certificates = lazy(() => import('./pages/student/Certificates'));
const CertificateView = lazy(() => import('./pages/shared/CertificateView'));

const AdminOverview = lazy(() => import('./pages/admin/Overview'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminUserDetail = lazy(() => import('./pages/admin/UserDetail'));
const AdminCourses = lazy(() => import('./pages/admin/Courses'));
const AdminCourseDetail = lazy(() => import('./pages/admin/CourseDetail'));
const AdminStructure = lazy(() => import('./pages/admin/Structure'));
const AdminAnnouncements = lazy(() => import('./pages/admin/Announcements'));
const AdminAudit = lazy(() => import('./pages/admin/Audit'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));
const NotFound = lazy(() => import('./pages/shared/NotFound'));

function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="content"><Loading label="Checking your session" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // UI-level guard only; the API enforces every permission independently.
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

const learnerOrTeacher: Role[] = ['student', 'teacher'];

export default function App() {
  return (
    <Suspense fallback={<div className="content"><Loading /></div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/verify/:serial" element={<Verify />} />

        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Home />} />
          <Route path="dashboard" element={<RequireAuth roles={learnerOrTeacher}><Dashboard /></RequireAuth>} />
          <Route path="courses" element={<RequireAuth roles={learnerOrTeacher}><MyCourses /></RequireAuth>} />
          <Route path="catalogue" element={<RequireAuth roles={['student']}><Catalogue /></RequireAuth>} />
          <Route path="grades" element={<RequireAuth roles={['student']}><StudentGrades /></RequireAuth>} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="notifications" element={<Navigate to="/" replace />} />
          <Route path="announcements" element={<Navigate to="/dashboard" replace />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="certificates" element={<RequireAuth roles={['student']}><Certificates /></RequireAuth>} />
          <Route path="certificates/:certificateId" element={<CertificateView />} />
          <Route path="attempts/:attemptId" element={<RequireAuth roles={['student']}><QuizAttempt /></RequireAuth>} />

          <Route path="courses/:courseId" element={<CourseLayout />}>
            <Route index element={<CourseOverview />} />
            <Route path="modules" element={<CourseModules />} />
            <Route path="items/:itemId" element={<ItemView />} />
            <Route path="assignments" element={<AssignmentList />} />
            <Route path="assignments/:assignmentId" element={<AssignmentDetail />} />
            <Route path="assignments/:assignmentId/grading" element={<Grading />} />
            <Route path="quizzes" element={<QuizList />} />
            <Route path="quizzes/:quizId" element={<QuizDetail />} />
            <Route path="announcements" element={<CourseAnnouncements />} />
            <Route path="grades" element={<CourseGrades />} />
            <Route path="students" element={<CourseStudents />} />
            <Route path="certificates" element={<CourseCertificates />} />
          </Route>

          <Route path="admin" element={<RequireAuth roles={['admin']}><AdminOverview /></RequireAuth>} />
          <Route path="admin/users" element={<RequireAuth roles={['admin']}><AdminUsers /></RequireAuth>} />
          <Route path="admin/users/:userId" element={<RequireAuth roles={['admin']}><AdminUserDetail /></RequireAuth>} />
          <Route path="admin/courses" element={<RequireAuth roles={['admin']}><AdminCourses /></RequireAuth>} />
          <Route path="admin/courses/:courseId" element={<RequireAuth roles={['admin']}><AdminCourseDetail /></RequireAuth>} />
          <Route path="admin/structure" element={<RequireAuth roles={['admin']}><AdminStructure /></RequireAuth>} />
          <Route path="admin/announcements" element={<RequireAuth roles={['admin']}><AdminAnnouncements /></RequireAuth>} />
          <Route path="admin/audit" element={<RequireAuth roles={['admin']}><AdminAudit /></RequireAuth>} />
          <Route path="admin/settings" element={<RequireAuth roles={['admin']}><AdminSettings /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
