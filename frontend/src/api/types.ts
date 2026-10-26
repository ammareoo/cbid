export type Role = 'student' | 'teacher' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  preferredName: string | null;
  role: Role;
  timezone: string;
  permissions: string[];
}
export interface SessionPayload { user: SessionUser; csrfToken: string; expiresAt: string }

export interface Paged<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }

export interface MyCourse {
  id: string; code: string; title: string; summary: string; status: 'draft' | 'published' | 'archived'; termName: string;
  enrollmentStatus?: string; progress?: number | null; nextDueAt?: string | null; teachers?: string | null;
  isLead?: boolean; studentCount?: number; needsGrading?: number;
}
export interface CatalogueCourse {
  id: string; code: string; title: string; summary: string; enrollmentOpen: boolean; capacity: number | null;
  enrolledCount: number; departmentName: string | null; termName: string; isEnrolled: boolean; teachers: string | null;
  audience: string; deliveryMode: DeliveryMode;
}
export interface CourseDetail {
  id: string; code: string; title: string; summary: string; description: string; status: string;
  enrollmentOpen: boolean; capacity: number | null; enrolledCount: number; departmentName: string | null;
  termName: string; termStartsOn: string; termEndsOn: string; enrollmentStatus: string | null;
  teachers: { id: string; fullName: string; isLead: boolean }[];
  relationship: 'staff' | 'learner' | 'visitor'; writable: boolean; progress: number | null;
  audience: string; deliveryMode: DeliveryMode;
  certificate: { id: string; serial: string; issuedAt: string } | null;
}
export interface ModuleItem {
  id: string; moduleId: string; kind: 'page' | 'link' | 'file'; title: string; url: string | null; fileId: string | null;
  position: number; published: boolean; estimatedMinutes: number | null; fileName: string | null; fileSize: number | null;
  fileType: string | null; completed: boolean;
}
export interface CourseModule { id: string; title: string; description: string; position: number; published: boolean; items: ModuleItem[] }
export interface ItemDetail extends ModuleItem {
  body: string | null; moduleTitle: string; courseId: string; courseTitle: string; courseCode: string;
  previous: { id: string; title: string } | null; next: { id: string; title: string } | null;
}

export interface Assignment {
  id: string; courseId: string; title: string; instructions: string; dueAt: string; lateUntil: string | null;
  pointsPossible: number; submissionType: 'text' | 'file' | 'text_or_file'; maxAttempts: number;
  status: 'draft' | 'published'; publishedAt: string | null;
  attemptsUsed?: number; lastSubmittedAt?: string | null; score?: number | null; gradeReleasedAt?: string | null;
  submittedCount?: number; gradedCount?: number; studentCount?: number;
  courseTitle?: string; courseCode?: string;
}
export interface Submission {
  id: string; attempt: number; body: string | null; submittedAt: string; isLate: boolean;
  fileId: string | null; fileName: string | null; fileSize: number | null;
}
export interface Grade { score: number; feedback: string; releasedAt: string | null; gradedAt: string; version?: number; gradedBy?: string }
export interface AssignmentView {
  assignment: Assignment; relationship: 'staff' | 'learner'; writable?: boolean;
  stats?: { studentCount: number; submittedCount: number; gradedCount: number; unreleasedCount: number };
  submissions?: Submission[]; grade?: Grade | null; canSubmit?: boolean; willBeLate?: boolean; attemptsLeft?: number;
}
export interface QueueRow {
  studentId: string; fullName: string; enrollmentStatus: string; attempt: number | null; submittedAt: string | null;
  isLate: boolean | null; attempts: number; score: number | null; releasedAt: string | null; gradedAt: string | null;
  version: number | null; needsGrading: boolean;
}

export interface Quiz {
  id: string; courseId: string; title: string; description: string; timeLimitMinutes: number | null; maxAttempts: number;
  opensAt: string; closesAt: string; status: 'draft' | 'published';
  attemptsUsed?: number; bestScore?: number | null; maxScore?: number | null; openAttemptId?: string | null;
  questionCount?: number; submittedCount?: number; courseTitle?: string; courseCode?: string;
}
export interface QuizOption { id: string; label: string; questionId?: string; position?: number }
export interface QuizQuestion {
  id: string; kind: 'single' | 'multiple' | 'short'; prompt: string; points: number; position: number;
  options: QuizOption[]; correctOptionIds?: string[]; acceptedAnswers?: string[];
  answer?: { selectedOptionIds: string[]; textAnswer: string | null; isCorrect: boolean | null; pointsAwarded: number | null } | null;
}
export interface AttemptSummary {
  id: string; attemptNo: number; status: 'in_progress' | 'submitted'; startedAt: string; deadlineAt: string;
  submittedAt: string | null; score: number | null; maxScore: number | null;
}
export interface QuizView {
  quiz: Quiz; relationship: 'staff' | 'learner'; writable?: boolean; questions?: QuizQuestion[]; totalPoints: number;
  attemptCount?: number; attempts?: AttemptSummary[]; questionCount?: number;
}
export interface AttemptView {
  attempt: AttemptSummary & { quizId: string; quizTitle: string; courseId: string; description: string; serverNow: string };
  questions: QuizQuestion[]; isOwner: boolean;
}

export interface Announcement {
  id: string; courseId: string | null; courseCode: string | null; courseTitle: string | null; title: string; body: string;
  createdAt: string; authorName: string | null;
}
export interface Notification { id: string; kind: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }
export interface CalendarEntry {
  type: 'event' | 'assignment' | 'quiz'; id: string; title: string; description: string; location: string | null;
  startsAt: string; endsAt: string; courseId: string | null; courseCode: string | null; link: string | null;
}

export interface UpcomingItem { type: 'assignment' | 'quiz'; id: string; title: string; dueAt: string; courseId: string; courseCode: string; done: boolean }
export interface StudentDashboard {
  role: 'student'; courses: MyCourse[]; upcoming: UpcomingItem[];
  feedback: { assignmentId: string; title: string; courseId: string; courseCode: string; score: number; pointsPossible: number; releasedAt: string }[];
}
export interface TeacherDashboard {
  role: 'teacher'; courses: MyCourse[];
  toGrade: { assignmentId: string; title: string; courseId: string; courseCode: string; studentId: string; studentName: string; submittedAt: string; isLate: boolean }[];
  upcoming: { id: string; title: string; dueAt: string; courseId: string; courseCode: string; status: string; submittedCount: number; studentCount: number }[];
}

export interface AdminUser {
  id: string; email: string; fullName: string; role: Role; status: 'active' | 'deactivated'; lastLoginAt: string | null;
  createdAt: string; departmentName: string | null; departmentId: string | null;
}
export interface AdminCourse {
  id: string; code: string; title: string; status: string; enrollmentOpen: boolean; capacity: number | null;
  termName: string; departmentName: string | null; studentCount: number; teachers: string | null;
}
export interface Department { id: string; code: string; name: string; courseCount: number }
export interface Term { id: string; code: string; name: string; startsOn: string; endsOn: string; courseCount: number }
export interface AuditEntry {
  id: number; action: string; entityType: string | null; entityId: string | null; details: Record<string, unknown>;
  ip: string | null; createdAt: string; actorName: string | null; actorEmail: string | null;
}

export type DeliveryMode = 'online' | 'blended' | 'onsite';
export const DELIVERY_LABEL: Record<DeliveryMode, string> = {
  online: 'Online',
  blended: 'Blended: online with onsite sessions',
  onsite: 'Onsite in Karachi',
};

export interface Certificate {
  id: string; serial: string; courseId: string; userId: string; recipientName: string; courseCode: string; courseTitle: string;
  issuedAt: string; revokedAt: string | null; revokeReason?: string | null;
}
export interface CertificateVerification {
  serial: string; recipientName: string; courseCode: string; courseTitle: string; issuedAt: string; valid: boolean;
  revokedAt: string | null; issuer: string; organisation: string;
}
