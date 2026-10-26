import type { Tx } from '../../db/pool.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import type { AuthContext } from '../../types.js';
import { requireStaff, requireVisible } from '../courses/courses.service.js';

export interface QuestionInput {
  kind: 'single' | 'multiple' | 'short';
  prompt: string;
  points: number;
  options?: { label: string; correct: boolean }[];
  acceptedAnswers?: string[];
}
export interface QuizInput {
  title: string;
  description?: string;
  timeLimitMinutes?: number | null;
  maxAttempts?: number;
  opensAt: string;
  closesAt: string;
  status?: 'draft' | 'published';
  questions?: QuestionInput[];
}

/** Structural validation of a question set. Returns the first problem found, or null. */
export function questionProblem(questions: QuestionInput[]): string | null {
  for (const [i, q] of questions.entries()) {
    const n = i + 1;
    if (q.kind === 'short') {
      if (!q.acceptedAnswers?.some((a) => a.trim())) return `Question ${n}: add at least one accepted answer`;
      continue;
    }
    const opts = q.options ?? [];
    if (opts.length < 2) return `Question ${n}: add at least two options`;
    if (opts.length > 8) return `Question ${n}: use eight options or fewer`;
    const correct = opts.filter((o) => o.correct).length;
    if (q.kind === 'single' && correct !== 1) return `Question ${n}: mark exactly one correct option`;
    if (q.kind === 'multiple' && correct < 1) return `Question ${n}: mark at least one correct option`;
  }
  return null;
}

/** Pure scoring rule, mirrored by app._score_attempt in the database (which is authoritative). */
export function scoreAnswer(
  q: { kind: QuestionInput['kind']; points: number },
  key: { correctOptionIds: string[]; acceptedAnswers: string[] },
  answer: { selectedOptionIds: string[]; textAnswer?: string | null },
): number {
  if (q.kind === 'short') {
    const given = (answer.textAnswer ?? '').trim().toLowerCase();
    return given && key.acceptedAnswers.some((a) => a.trim().toLowerCase() === given) ? q.points : 0;
  }
  const a = [...new Set(answer.selectedOptionIds)].sort();
  const k = [...key.correctOptionIds].sort();
  return a.length > 0 && a.length === k.length && a.every((v, i) => v === k[i]) ? q.points : 0;
}

const quizCols = `q.id, q.course_id AS "courseId", q.title, q.description, q.time_limit_minutes AS "timeLimitMinutes",
  q.max_attempts AS "maxAttempts", q.opens_at AS "opensAt", q.closes_at AS "closesAt", q.status`;

async function quizCourse(tx: Tx, quizId: string) {
  const r = await tx.maybeOne<{ course_id: string; title: string; status: string }>(
    'SELECT course_id, title, status FROM quizzes WHERE id = $1', [quizId]);
  if (!r) throw notFound('Quiz');
  return r;
}

export async function listQuizzes(tx: Tx, courseId: string, auth: AuthContext) {
  const access = await requireVisible(tx, courseId);
  if (access.isStaff) {
    const items = await tx.query(
      `SELECT ${quizCols},
              (SELECT count(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id)::int AS "questionCount",
              (SELECT count(*) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.status = 'submitted')::int AS "submittedCount"
         FROM quizzes q WHERE q.course_id = $1 ORDER BY q.opens_at, q.title`, [courseId]);
    return { items, isStaff: true, writable: access.writable };
  }
  const items = await tx.query(
    `SELECT ${quizCols},
            (SELECT count(*) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.student_id = $2)::int AS "attemptsUsed",
            (SELECT max(a.score) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.student_id = $2 AND a.status = 'submitted') AS "bestScore",
            (SELECT max(a.max_score) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.student_id = $2) AS "maxScore",
            (SELECT a.id FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.student_id = $2 AND a.status = 'in_progress'
               AND a.deadline_at > now()) AS "openAttemptId"
       FROM quizzes q WHERE q.course_id = $1 AND q.status = 'published' ORDER BY q.opens_at, q.title`, [courseId, auth.userId]);
  return { items, isStaff: false, writable: false };
}

async function writeQuestions(tx: Tx, quizId: string, questions: QuestionInput[]) {
  await tx.query('DELETE FROM quiz_questions WHERE quiz_id = $1', [quizId]);
  for (const [qi, q] of questions.entries()) {
    const { id: questionId } = await tx.one<{ id: string }>(
      'INSERT INTO quiz_questions (quiz_id, position, kind, prompt, points) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [quizId, qi, q.kind, q.prompt, q.points]);
    const correct: string[] = [];
    if (q.kind !== 'short') {
      for (const [oi, o] of (q.options ?? []).entries()) {
        const { id } = await tx.one<{ id: string }>(
          'INSERT INTO quiz_options (question_id, label, position) VALUES ($1, $2, $3) RETURNING id', [questionId, o.label, oi]);
        if (o.correct) correct.push(id);
      }
    }
    await tx.query('INSERT INTO quiz_answer_keys (question_id, correct_option_ids, accepted_answers) VALUES ($1, $2, $3)', [
      questionId, correct, q.kind === 'short' ? (q.acceptedAnswers ?? []).map((a) => a.trim()).filter(Boolean) : []]);
  }
}

function checkWindow(input: { opensAt?: string; closesAt?: string }) {
  if (input.opensAt && input.closesAt && new Date(input.closesAt) <= new Date(input.opensAt)) {
    throw unprocessable('The closing time must be after the opening time');
  }
}

export async function createQuiz(tx: Tx, courseId: string, input: QuizInput) {
  await requireStaff(tx, courseId, { write: true });
  checkWindow(input);
  const questions = input.questions ?? [];
  const problem = questionProblem(questions);
  if (problem) throw unprocessable(problem);
  if (input.status === 'published' && questions.length === 0) throw unprocessable('Add at least one question before publishing');
  const quiz = await tx.one<{ id: string }>(
    `INSERT INTO quizzes (course_id, title, description, time_limit_minutes, max_attempts, opens_at, closes_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [courseId, input.title, input.description ?? '', input.timeLimitMinutes ?? null, input.maxAttempts ?? 1,
     input.opensAt, input.closesAt, input.status ?? 'draft']);
  await writeQuestions(tx, quiz.id, questions);
  if (input.status === 'published') await notifyPublished(tx, courseId, quiz.id, input.title, input.closesAt);
  return quiz;
}

async function notifyPublished(tx: Tx, courseId: string, quizId: string, title: string, closesAt: string) {
  await tx.query('SELECT app.notify_course($1, $2, $3, $4, $5)', [
    courseId, 'quiz', `New quiz: ${title}`.slice(0, 200), `Closes ${new Date(closesAt).toUTCString()}`,
    `/courses/${courseId}/quizzes/${quizId}`]);
}

export async function updateQuiz(tx: Tx, quizId: string, input: Partial<QuizInput>) {
  const cur = await quizCourse(tx, quizId);
  await requireStaff(tx, cur.course_id, { write: true });
  const existing = await tx.one<{ opensAt: string; closesAt: string; attempts: number; questions: number }>(
    `SELECT opens_at AS "opensAt", closes_at AS "closesAt",
            (SELECT count(*) FROM quiz_attempts WHERE quiz_id = $1)::int AS attempts,
            (SELECT count(*) FROM quiz_questions WHERE quiz_id = $1)::int AS questions
       FROM quizzes WHERE id = $1`, [quizId]);
  checkWindow({ opensAt: input.opensAt ?? existing.opensAt, closesAt: input.closesAt ?? existing.closesAt });
  if (input.questions) {
    if (existing.attempts > 0) throw conflict('Questions cannot change after learners have started this quiz');
    const problem = questionProblem(input.questions);
    if (problem) throw unprocessable(problem);
  }
  const questionCount = input.questions ? input.questions.length : existing.questions;
  if ((input.status ?? cur.status) === 'published' && questionCount === 0) throw unprocessable('Add at least one question before publishing');
  if (cur.status === 'published' && input.status === 'draft' && existing.attempts > 0) {
    throw conflict('A quiz that learners have started cannot return to draft');
  }
  const q = await tx.one<{ title: string; status: string; closesAt: string }>(
    `UPDATE quizzes SET title = coalesce($2, title), description = coalesce($3, description),
       time_limit_minutes = CASE WHEN $4::boolean THEN $5::smallint ELSE time_limit_minutes END,
       max_attempts = coalesce($6, max_attempts), opens_at = coalesce($7, opens_at), closes_at = coalesce($8, closes_at),
       status = coalesce($9, status)
     WHERE id = $1 RETURNING title, status, closes_at AS "closesAt"`,
    [quizId, input.title ?? null, input.description ?? null, input.timeLimitMinutes !== undefined, input.timeLimitMinutes ?? null,
     input.maxAttempts ?? null, input.opensAt ?? null, input.closesAt ?? null, input.status ?? null]);
  if (input.questions) await writeQuestions(tx, quizId, input.questions);
  if (cur.status !== 'published' && q.status === 'published') await notifyPublished(tx, cur.course_id, quizId, q.title, q.closesAt);
  return { id: quizId };
}

export async function deleteQuiz(tx: Tx, quizId: string) {
  const cur = await quizCourse(tx, quizId);
  await requireStaff(tx, cur.course_id, { write: true });
  const used = await tx.one<{ n: number }>('SELECT count(*)::int AS n FROM quiz_attempts WHERE quiz_id = $1', [quizId]);
  if (used.n > 0) throw conflict('This quiz has attempts and cannot be deleted');
  await tx.query('DELETE FROM quizzes WHERE id = $1', [quizId]);
  return cur.course_id;
}

export async function getQuiz(tx: Tx, quizId: string, auth: AuthContext) {
  const quiz = await tx.maybeOne<Record<string, unknown> & { courseId: string }>(
    `SELECT ${quizCols}, c.title AS "courseTitle", c.code AS "courseCode" FROM quizzes q JOIN courses c ON c.id = q.course_id WHERE q.id = $1`, [quizId]);
  if (!quiz) throw notFound('Quiz');
  const access = await requireVisible(tx, quiz.courseId);
  // Totals come from a definer function: learners cannot read questions before they start.
  const points = await tx.maybeOne<{ total: number; count: number }>(
    'SELECT total_points AS total, question_count AS count FROM app.quiz_summary($1)', [quizId]);
  if (access.isStaff) {
    const questions = await tx.query<{ id: string; options?: unknown[] }>(
      `SELECT qq.id, qq.kind, qq.prompt, qq.points, qq.position, k.correct_option_ids AS "correctOptionIds",
              k.accepted_answers AS "acceptedAnswers"
         FROM quiz_questions qq LEFT JOIN quiz_answer_keys k ON k.question_id = qq.id
        WHERE qq.quiz_id = $1 ORDER BY qq.position`, [quizId]);
    const options = await tx.query<{ questionId: string }>(
      `SELECT o.id, o.question_id AS "questionId", o.label, o.position FROM quiz_options o
         JOIN quiz_questions qq ON qq.id = o.question_id WHERE qq.quiz_id = $1 ORDER BY o.position`, [quizId]);
    for (const q of questions) q.options = options.filter((o) => o.questionId === q.id);
    const attempts = await tx.one<{ n: number }>('SELECT count(*)::int AS n FROM quiz_attempts WHERE quiz_id = $1', [quizId]);
    return { quiz, relationship: 'staff', writable: access.writable, questions, totalPoints: points?.total ?? 0, attemptCount: attempts.n };
  }
  const attempts = await tx.query(
    `SELECT id, attempt_no AS "attemptNo", status, started_at AS "startedAt", deadline_at AS "deadlineAt",
            submitted_at AS "submittedAt", score, max_score AS "maxScore"
       FROM quiz_attempts WHERE quiz_id = $1 AND student_id = $2 ORDER BY attempt_no DESC`, [quizId, auth.userId]);
  return { quiz, relationship: 'learner', attempts, questionCount: points?.count ?? 0, totalPoints: points?.total ?? 0 };
}

export async function startAttempt(tx: Tx, quizId: string) {
  // Eligibility, window, attempt limits and the deadline are enforced in app.start_quiz_attempt.
  const r = await tx.one<{ id: string }>('SELECT app.start_quiz_attempt($1) AS id', [quizId]);
  return r.id;
}

export async function getAttempt(tx: Tx, attemptId: string, auth: AuthContext) {
  const attempt = await tx.maybeOne<{ quizId: string; status: string; studentId: string; courseId: string }>(
    `SELECT a.id, a.quiz_id AS "quizId", a.student_id AS "studentId", a.attempt_no AS "attemptNo", a.status,
            a.started_at AS "startedAt", a.deadline_at AS "deadlineAt", a.submitted_at AS "submittedAt",
            a.score, a.max_score AS "maxScore", q.title AS "quizTitle", q.course_id AS "courseId", q.description,
            now() AS "serverNow"
       FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.id = $1`, [attemptId]);
  if (!attempt) throw notFound('Attempt');
  const questions = await tx.query<{ id: string; options?: unknown[]; answer?: unknown }>(
    `SELECT id, kind, prompt, points, position FROM quiz_questions WHERE quiz_id = $1 ORDER BY position`, [attempt.quizId]);
  const options = await tx.query<{ questionId: string }>(
    `SELECT o.id, o.question_id AS "questionId", o.label FROM quiz_options o
       JOIN quiz_questions qq ON qq.id = o.question_id WHERE qq.quiz_id = $1 ORDER BY o.position`, [attempt.quizId]);
  const answers = await tx.query<{ questionId: string }>(
    `SELECT question_id AS "questionId", selected_option_ids AS "selectedOptionIds", text_answer AS "textAnswer",
            is_correct AS "isCorrect", points_awarded AS "pointsAwarded"
       FROM quiz_answers WHERE attempt_id = $1`, [attemptId]);
  for (const q of questions) {
    q.options = options.filter((o) => o.questionId === q.id);
    q.answer = answers.find((a) => a.questionId === q.id) ?? null;
  }
  return { attempt, questions, isOwner: attempt.studentId === auth.userId };
}

export async function saveAnswer(tx: Tx, attemptId: string, questionId: string, input: { selectedOptionIds?: string[]; textAnswer?: string | null }) {
  await tx.query(
    `INSERT INTO quiz_answers (attempt_id, question_id, selected_option_ids, text_answer)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (attempt_id, question_id) DO UPDATE SET selected_option_ids = EXCLUDED.selected_option_ids, text_answer = EXCLUDED.text_answer`,
    [attemptId, questionId, input.selectedOptionIds ?? [], input.textAnswer ?? null]);
  return { saved: true };
}

export async function submitAttempt(tx: Tx, attemptId: string) {
  return tx.one<{ score: number; max_score: number }>('SELECT * FROM app.submit_quiz_attempt($1)', [attemptId]);
}

export async function quizResults(tx: Tx, quizId: string) {
  const cur = await quizCourse(tx, quizId);
  await requireStaff(tx, cur.course_id);
  return tx.query(
    `SELECT a.id, u.full_name AS "fullName", a.student_id AS "studentId", a.attempt_no AS "attemptNo", a.status,
            a.started_at AS "startedAt", a.submitted_at AS "submittedAt", a.score, a.max_score AS "maxScore"
       FROM quiz_attempts a JOIN users u ON u.id = a.student_id
      WHERE a.quiz_id = $1 ORDER BY u.full_name, a.attempt_no`, [quizId]);
}
