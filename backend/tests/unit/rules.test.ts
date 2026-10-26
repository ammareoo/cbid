import { describe, expect, it } from 'vitest';
import { can, permissionsFor, isRole } from '../../src/permissions/policy.js';
import { submissionWindow } from '../../src/modules/assignments/assignments.service.js';
import { questionProblem, scoreAnswer } from '../../src/modules/quizzes/quizzes.service.js';
import { contentDisposition, passwordProblem, safeEqual } from '../../src/lib/security.js';
import { sanitizeFilename } from '../../src/lib/storage.js';
import { fromDbError, toPublicError, AppError } from '../../src/lib/errors.js';
import { likePattern, pageQuery } from '../../src/lib/http.js';
import { z } from 'zod';

describe('permission policy', () => {
  it('denies by default for unknown roles and permissions', () => {
    expect(can('superuser', 'admin.users')).toBe(false);
    expect(can(null, 'courses.browse')).toBe(false);
    expect(isRole('owner')).toBe(false);
  });
  it('keeps student, teacher and admin capabilities separate', () => {
    expect(can('student', 'assignments.submit')).toBe(true);
    expect(can('student', 'grades.manage')).toBe(false);
    expect(can('teacher', 'grades.manage')).toBe(true);
    expect(can('teacher', 'admin.users')).toBe(false);
    expect(can('teacher', 'announcements.global')).toBe(false);
    expect(can('admin', 'admin.audit')).toBe(true);
    expect(can('admin', 'assignments.submit')).toBe(false);
  });
  it('lists permissions per role', () => {
    expect(permissionsFor('student')).toContain('quizzes.take');
    expect(permissionsFor('admin')).not.toContain('quizzes.take');
  });
});

describe('submission window', () => {
  const due = new Date('2026-03-10T17:00:00Z');
  it('is open and on time before the due date', () => {
    expect(submissionWindow({ dueAt: due }, new Date('2026-03-10T16:59:59Z'))).toEqual({ open: true, late: false });
  });
  it('is open but late until the late cut-off', () => {
    expect(submissionWindow({ dueAt: due, lateUntil: '2026-03-12T17:00:00Z' }, new Date('2026-03-11T09:00:00Z'))).toEqual({ open: true, late: true });
  });
  it('is closed after the due date when no late window exists', () => {
    expect(submissionWindow({ dueAt: due }, new Date('2026-03-10T17:00:01Z')).open).toBe(false);
  });
});

describe('quiz validation and scoring', () => {
  it('requires exactly one correct option for single choice', () => {
    expect(questionProblem([{ kind: 'single', prompt: 'x', points: 1, options: [{ label: 'a', correct: true }, { label: 'b', correct: true }] }]))
      .toMatch(/exactly one/);
    expect(questionProblem([{ kind: 'single', prompt: 'x', points: 1, options: [{ label: 'a', correct: true }, { label: 'b', correct: false }] }]))
      .toBeNull();
  });
  it('requires an accepted answer for short questions', () => {
    expect(questionProblem([{ kind: 'short', prompt: 'x', points: 1, acceptedAnswers: ['  '] }])).toMatch(/accepted answer/);
  });
  it('scores multiple choice as all-or-nothing, order independent', () => {
    const q = { kind: 'multiple' as const, points: 2 };
    const key = { correctOptionIds: ['a', 'c'], acceptedAnswers: [] };
    expect(scoreAnswer(q, key, { selectedOptionIds: ['c', 'a'] })).toBe(2);
    expect(scoreAnswer(q, key, { selectedOptionIds: ['a'] })).toBe(0);
    expect(scoreAnswer(q, key, { selectedOptionIds: ['a', 'b', 'c'] })).toBe(0);
    expect(scoreAnswer(q, key, { selectedOptionIds: [] })).toBe(0);
  });
  it('matches short answers case-insensitively after trimming', () => {
    const q = { kind: 'short' as const, points: 1 };
    expect(scoreAnswer(q, { correctOptionIds: [], acceptedAnswers: ['CRPD'] }, { selectedOptionIds: [], textAnswer: '  crpd ' })).toBe(1);
    expect(scoreAnswer(q, { correctOptionIds: [], acceptedAnswers: ['CRPD'] }, { selectedOptionIds: [], textAnswer: '' })).toBe(0);
  });
});

describe('security helpers', () => {
  it('enforces password rules', () => {
    expect(passwordProblem('short')).toMatch(/at least 10/);
    expect(passwordProblem('password123')).toMatch(/too common/);
    expect(passwordProblem('aaaaaaaaaaaa')).toMatch(/repeating/);
    expect(passwordProblem('amina.khan-secret', 'amina.khan@x.org')).toMatch(/email/);
    expect(passwordProblem('Lahore-Monsoon-42')).toBeNull();
  });
  it('compares tokens safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('sanitises filenames and content disposition', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\x\\report.pdf')).toBe('report.pdf');
    expect(sanitizeFilename('a<b>:c.pdf')).toBe('a_b__c.pdf');
    const cd = contentDisposition('résumé "final".pdf');
    expect(cd).toMatch(/^attachment; filename="r_sum_ _final_.pdf"; filename\*=UTF-8''/);
    expect(cd).not.toMatch(/\r|\n/);
  });
  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
  it('bounds pagination', () => {
    expect(() => pageQuery.parse({ pageSize: '1000' })).toThrow();
    expect(pageQuery.parse({})).toEqual({ page: 1, pageSize: 20 });
  });
});

describe('error mapping', () => {
  const pgErr = (code: string, message = 'x') => Object.assign(new Error(message), { code, severity: 'ERROR' });
  it('shows authored database rule messages', () => {
    expect(fromDbError(pgErr('CB422', 'The submission deadline has passed'))).toMatchObject({ statusCode: 422, message: 'The submission deadline has passed' });
    expect(fromDbError(pgErr('CB403'))?.statusCode).toBe(403);
  });
  it('hides internal messages for constraint and RLS failures', () => {
    const rls = fromDbError(pgErr('42501', 'new row violates row-level security policy for table "grades"'));
    expect(rls?.statusCode).toBe(403);
    expect(rls?.message).not.toMatch(/grades/);
    expect(fromDbError(pgErr('23514', 'violates check constraint "users_email_check"'))?.message).not.toMatch(/users_email/);
  });
  it('turns unknown errors into a generic 500', () => {
    const e = toPublicError(new Error('connection string postgres://secret'));
    expect(e.statusCode).toBe(500);
    expect(e.message).not.toMatch(/secret/);
  });
  it('formats validation errors with field paths', () => {
    let caught: unknown;
    try { z.object({ title: z.string().min(3) }).parse({ title: 'x' }); } catch (err) { caught = err; }
    const e = toPublicError(caught);
    expect(e).toBeInstanceOf(AppError);
    expect(e.statusCode).toBe(400);
    expect(e.details).toEqual([expect.objectContaining({ path: 'title' })]);
  });
});
