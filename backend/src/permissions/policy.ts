/**
 * Coarse, role-level capabilities. These gate which routes a role may call at all.
 * Resource-level checks (does this trainer teach THIS course? is this learner enrolled?)
 * happen in services and are enforced again by PostgreSQL RLS policies.
 *
 * Adding a role: insert it into the `roles` table (with a rank) and add an entry here.
 * Deny-by-default: a role/permission pair not listed here is refused.
 */
export const ROLES = ['student', 'teacher', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'courses.browse',
  'courses.self_enroll',
  'courses.teach',
  'content.manage',
  'assignments.submit',
  'assignments.manage',
  'grades.view_own',
  'grades.manage',
  'quizzes.take',
  'quizzes.manage',
  'announcements.course',
  'announcements.global',
  'roster.view',
  'admin.dashboard',
  'admin.users',
  'admin.courses',
  'admin.enrollments',
  'admin.structure',
  'admin.audit',
  'admin.settings',
  'files.upload_submission',
  'files.upload_material',
  'certificates.view_own',
  'certificates.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  student: [
    'courses.browse', 'courses.self_enroll', 'assignments.submit', 'grades.view_own', 'quizzes.take',
    'files.upload_submission', 'certificates.view_own',
  ],
  teacher: [
    'courses.browse', 'courses.teach', 'content.manage', 'assignments.manage', 'grades.manage',
    'quizzes.manage', 'announcements.course', 'roster.view', 'files.upload_material', 'certificates.manage',
  ],
  admin: [
    'courses.browse', 'courses.teach', 'content.manage', 'assignments.manage', 'grades.manage',
    'quizzes.manage', 'announcements.course', 'announcements.global', 'roster.view',
    'admin.dashboard', 'admin.users', 'admin.courses', 'admin.enrollments', 'admin.structure',
    'admin.audit', 'admin.settings', 'files.upload_material', 'certificates.manage',
  ],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(role: string | null | undefined, permission: Permission): boolean {
  if (!role || !isRole(role)) return false;
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}

/** Roles an administrator may assign through the API. Administrator accounts are CLI-provisioned. */
export const ASSIGNABLE_ROLES: readonly Role[] = ['student', 'teacher'];
