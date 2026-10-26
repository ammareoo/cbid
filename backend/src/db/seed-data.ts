import { randomInt } from 'node:crypto';
import type { Pool } from './pool.js';
import { hashPassword } from '../lib/security.js';

/**
 * Development/test seed. ALL PEOPLE AND RECORDS ARE FICTIONAL.
 * Emails use the reserved .example domain. Never run against production.
 * Programmes, audiences and contact details follow CBID Institute (CBID Network PK Sindh, https://cbidnetwork.org).
 */

const day = 86_400_000;
const at = (days: number, hour = 12) => {
  const d = new Date(Date.now() + days * day);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const SERIAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const seedSerial = () =>
  `CBID-${new Date(Date.now() - 150 * day).getUTCFullYear()}-${Array.from({ length: 8 }, () => SERIAL_ALPHABET[randomInt(32)]).join('')}`;

export const SEED_EMAILS = {
  admin: 'coordinator@cbid.example',
  teachers: { sana: 'sana.mirza@cbid.example', farhan: 'farhan.qureshi@cbid.example', mehwish: 'mehwish.baig@cbid.example' },
  students: {
    amina: 'amina.khan@cbid.example', bilal: 'bilal.ahmed@cbid.example', hira: 'hira.siddiqui@cbid.example',
    omar: 'omar.farooq@cbid.example', zara: 'zara.malik@cbid.example', danish: 'danish.raza@cbid.example',
    fatima: 'fatima.noor@cbid.example', usman: 'usman.tariq@cbid.example', sadia: 'sadia.iqbal@cbid.example',
    kamran: 'kamran.javed@cbid.example',
  },
} as const;

const TABLES = [
  'certificates', 'quiz_answers', 'quiz_attempts', 'quiz_answer_keys', 'quiz_options', 'quiz_questions', 'quizzes', 'grades', 'submissions',
  'assignments', 'item_completions', 'module_items', 'modules', 'files', 'announcements', 'notifications',
  'notification_preferences', 'calendar_events', 'enrollments', 'course_teachers', 'courses', 'terms', 'departments',
  'password_reset_tokens', 'sessions', 'audit_logs', 'email_outbox', 'worker_heartbeats', 'users',
];

export async function resetData(pool: Pool) {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  // TRUNCATE ... CASCADE also empties system_settings (it references users), so restore defaults.
  await pool.query(`INSERT INTO system_settings (key, value) VALUES
      ('institute_name', '"CBID Institute"'), ('organisation_name', '"CBID Network PK Sindh"'),
      ('support_email', '"info@cbidnetwork.org"'), ('contact_phone', '"+92 21 34155705"'),
      ('contact_address', '"B-52/1, Block 13-D/1, Jamali Road, Gulshan-e-Iqbal, Karachi"'),
      ('website_url', '"https://cbidnetwork.org"'),
      ('self_enrollment_enabled', 'true'), ('maintenance_banner', '""')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = NULL`);
}

export async function seed(pool: Pool, password: string) {
  const client = await pool.connect();
  const q = async <T = { id: string }>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
  const one = async <T = { id: string }>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0] as T;
  const hash = await hashPassword(password);

  try {
    await client.query('BEGIN');

    // Programme areas follow the CBID Institute programmes published at https://cbidnetwork.org/cbid-institute.
    const dept = {
      equality: (await one(`INSERT INTO departments (code, name) VALUES ('DER', 'Disability Equality and Rights') RETURNING id`)).id,
      living: (await one(`INSERT INTO departments (code, name) VALUES ('ILE', 'Independent Living and Empowerment') RETURNING id`)).id,
      systems: (await one(`INSERT INTO departments (code, name) VALUES ('ISY', 'Inclusive Business and Education') RETURNING id`)).id,
      capacity: (await one(`INSERT INTO departments (code, name) VALUES ('CBC', 'Capacity Building and Customized Training') RETURNING id`)).id,
    };
    const year = new Date().getUTCFullYear();
    const autumn = new Date().getUTCMonth() >= 6;
    const names3 = autumn
      ? { past: [`${year}-SPR`, `Spring ${year}`], current: [`${year}-AUT`, `Autumn ${year}`], next: [`${year + 1}-SPR`, `Spring ${year + 1}`] }
      : { past: [`${year - 1}-AUT`, `Autumn ${year - 1}`], current: [`${year}-SPR`, `Spring ${year}`], next: [`${year}-AUT`, `Autumn ${year}`] };
    const termRow = async ([code, name]: string[], start: string, end: string) =>
      (await one(`INSERT INTO terms (code, name, starts_on, ends_on) VALUES ($1, $2, $3, $4) RETURNING id`, [code, name, start, end])).id;
    const term = {
      past: await termRow(names3.past, at(-260).slice(0, 10), at(-140).slice(0, 10)),
      current: await termRow(names3.current, at(-45).slice(0, 10), at(75).slice(0, 10)),
      next: await termRow(names3.next, at(100).slice(0, 10), at(220).slice(0, 10)),
    };

    const user = async (email: string, name: string, role: string, deptId: string | null = null) =>
      (await one(`INSERT INTO users (email, password_hash, full_name, role, department_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [email, hash, name, role, deptId])).id;

    const admin = await user(SEED_EMAILS.admin, 'Nadia Hussain', 'admin');
    // Role keys stay 'teacher' and 'student'; the interface calls them Trainer and Learner.
    const T = {
      sana: await user(SEED_EMAILS.teachers.sana, 'Dr. Sana Mirza', 'teacher', dept.equality),
      farhan: await user(SEED_EMAILS.teachers.farhan, 'Farhan Qureshi', 'teacher', dept.systems),
      mehwish: await user(SEED_EMAILS.teachers.mehwish, 'Dr. Mehwish Baig', 'teacher', dept.living),
    };
    const names: Record<keyof typeof SEED_EMAILS.students, string> = {
      amina: 'Amina Khan', bilal: 'Bilal Ahmed', hira: 'Hira Siddiqui', omar: 'Omar Farooq', zara: 'Zara Malik',
      danish: 'Danish Raza', fatima: 'Fatima Noor', usman: 'Usman Tariq', sadia: 'Sadia Iqbal', kamran: 'Kamran Javed',
    };
    const S = {} as Record<keyof typeof names, string>;
    for (const k of Object.keys(names) as (keyof typeof names)[]) S[k] = await user(SEED_EMAILS.students[k], names[k], 'student');

    const course = async (code: string, title: string, summary: string, description: string, deptId: string, termId: string,
      status: string, enrollmentOpen: boolean, capacity: number | null, audience: string, mode: 'online' | 'blended' | 'onsite') =>
      (await one(`INSERT INTO courses (code, title, summary, description, department_id, term_id, status, enrollment_open, capacity,
                                       audience, delivery_mode, created_by)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [code, title, summary, description, deptId, termId, status, enrollmentOpen, capacity, audience, mode, admin])).id;

    const C = {
      det: await course('DET101', 'Disability Equality Training',
        'Disability as a question of equality and rights: models of disability, the CRPD, everyday barriers and respectful practice.',
        'The shared starting point for every CBID Institute programme, grounded in the principle "Nothing about us without us". Over four weeks you will compare the medical, charity and social models of disability, read the UN CRPD in plain language, practise respectful communication and plan one practical change in your own organisation.\n\n**Assessment and certificate.** Coursework and quizzes are online. The final assessment is held onsite at CBID Institute in Karachi. Learners who complete the course receive a CBID Institute certificate that anyone can verify online.',
        dept.equality, term.current, 'published', true, 40,
        'Staff of organisations, government officials, OPD members, persons with disabilities and families', 'blended'),
      ibt: await course('IBT201', 'Inclusive Business Training',
        'Make hiring, workplaces and customer services inclusive of persons with disabilities.',
        'For employers, HR teams and line managers. You will audit a real job advert, run an accessible interview, handle reasonable accommodation requests from the first conversation to review, and look at your products and services through the eyes of customers with disabilities.',
        dept.systems, term.current, 'published', false, 30, 'Employers, HR teams and line managers', 'blended'),
      iet: await course('IET201', 'Inclusive Education Training',
        'Plan lessons, materials and assessments that include every learner, including children with disabilities.',
        'Hands-on practice with Universal Design for Learning, accessible learning materials, classroom adjustments and working with families. Built for teachers, school leaders and education officers.',
        dept.systems, term.current, 'published', true, 35, 'Teachers, school leaders and education officers', 'online'),
      ilt: await course('ILT101', 'Independent Living Training',
        'Choice, control and self-advocacy: the independent living approach for persons with disabilities.',
        'The independent living philosophy in practice: peer counselling, personal assistance, assistive devices, accessing public services and speaking up for your rights. Taught by and with persons with disabilities.',
        dept.living, term.current, 'published', true, 25, 'Persons with disabilities, families and peer supporters', 'blended'),
      cbw: await course('CBW101', 'Capacity Building Workshop for OPDs',
        'Governance, advocacy and project planning for organisations of persons with disabilities.', '',
        dept.capacity, term.next, 'draft', false, null, 'Organisations of persons with disabilities (OPDs)', 'onsite'),
      custom: await course('CT301', 'Customized Training: Inclusive Public Services',
        'A programme designed with a government department to make its services accessible.', '',
        dept.capacity, term.next, 'draft', false, null, 'Government departments and public service providers', 'onsite'),
      awareness: await course('DET090', 'Disability Equality Awareness Session',
        'A one-day introduction to disability equality for community groups and volunteers.', '',
        dept.equality, term.past, 'published', false, null, 'Community groups and volunteers', 'onsite'),
    };
    await q(`UPDATE courses SET status = 'archived' WHERE id = $1`, [C.awareness]);

    const teach = (c: string, t: string, lead = true) => q('INSERT INTO course_teachers (course_id, user_id, is_lead) VALUES ($1, $2, $3)', [c, t, lead]);
    await teach(C.det, T.sana);
    await teach(C.ibt, T.farhan);
    await teach(C.iet, T.mehwish);
    await teach(C.ilt, T.mehwish);
    await teach(C.ilt, T.sana, false);
    await teach(C.cbw, T.farhan);
    await teach(C.awareness, T.sana);

    const enrol = (c: string, s: string, status = 'active') => q('INSERT INTO enrollments (course_id, user_id, status) VALUES ($1, $2, $3)', [c, s, status]);
    for (const s of [S.amina, S.bilal, S.hira, S.omar, S.zara, S.danish, S.fatima]) await enrol(C.det, s);
    for (const s of [S.amina, S.hira, S.usman, S.sadia]) await enrol(C.ibt, s);
    for (const s of [S.bilal, S.zara, S.kamran]) await enrol(C.iet, s);
    for (const s of [S.hira, S.omar]) await enrol(C.ilt, s);
    await enrol(C.awareness, S.amina, 'completed');

    // A certificate from last term, so the learner and verification views have something to show.
    const awarded = await one<{ id: string; serial: string }>(
      `INSERT INTO certificates (serial, course_id, user_id, recipient_name, course_code, course_title, issued_at, issued_by)
       VALUES ($1, $2, $3, 'Amina Khan', 'DET090', 'Disability Equality Awareness Session', $4, $5) RETURNING id, serial`,
      [seedSerial(), C.awareness, S.amina, at(-150, 9), T.sana]);

    // ---------------------------------------------------------------- DET101 content
    const mod = async (c: string, title: string, description: string, position: number, published = true) =>
      (await one('INSERT INTO modules (course_id, title, description, position, published) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [c, title, description, position, published])).id;
    const page = async (m: string, title: string, body: string, position: number, minutes: number, published = true) =>
      (await one(`INSERT INTO module_items (module_id, kind, title, body, position, published, estimated_minutes)
                  VALUES ($1, 'page', $2, $3, $4, $5, $6) RETURNING id`, [m, title, body, position, published, minutes])).id;
    const link = async (m: string, title: string, url: string, position: number, minutes: number) =>
      (await one(`INSERT INTO module_items (module_id, kind, title, url, position, published, estimated_minutes)
                  VALUES ($1, 'link', $2, $3, $4, true, $5) RETURNING id`, [m, title, url, position, minutes])).id;

    const w1 = await mod(C.det, 'Week 1 · What inclusion means', 'Three ways of thinking about disability, and why the social model matters.', 0);
    const w2 = await mod(C.det, 'Week 2 · Rights and barriers', 'The CRPD in plain language and the barriers people meet every day.', 1);
    const w3 = await mod(C.det, 'Week 3 · Everyday practice', 'Respectful language, etiquette and reasonable accommodation.', 2);
    const w4 = await mod(C.det, 'Week 4 · Measuring progress', 'How to tell whether a change made a difference.', 3, false);

    const items = {
      welcome: await page(w1, 'Welcome and how this course works',
        '## Welcome\n\nThis course runs for four weeks. Each week has short readings, one activity and a quiz.\n\n**Getting help.** Bring questions to the live trainer session or message your trainer. If anything in the course does not work for you, tell us and we will provide an alternative format.\n\n### What you need\n\n- About 3–4 hours a week\n- A notebook for the barrier-spotting activity', 0, 6),
      models: await page(w1, 'Three models of disability',
        '## Medical, charity and social models\n\nThe **medical model** locates the problem in a person\'s body. The **charity model** treats persons with disabilities as recipients of kindness. The **social model** says people are disabled by barriers in the environment, attitudes and systems.\n\n> Barriers can be removed. That is why the social model is useful for organisations.\n\n### Reflect\n\nThink of one place at work where a barrier, not a person, causes the problem.', 1, 20),
      crpd: await link(w2, 'The CRPD in plain language (UN)', 'https://www.un.org/development/desa/disabilities/convention-on-the-rights-of-persons-with-disabilities.html', 0, 25),
      barriers: await page(w2, 'Spot barriers in your own workplace',
        '## Activity\n\nWalk through one space or process you use at work. Note:\n\n1. **Physical** barriers (steps, heavy doors, high counters)\n2. **Communication** barriers (no captions, complex forms)\n3. **Attitudinal** barriers (assumptions about ability)\n4. **Policy** barriers (rigid hours, inaccessible procedures)\n\nAlternative: use the photo set provided by your trainer instead of walking a space.', 1, 30),
      language: await page(w3, 'Respectful language and etiquette',
        '## Language that respects people\n\nSay "persons with disabilities", the language of the CRPD, and write it in full rather than as an abbreviation. Put the person first, use the words people use for themselves, and follow the person\'s lead.\n\n> Nothing about us without us: involve persons with disabilities in every decision that affects them.', 0, 14),
      accommodation: await page(w3, 'Reasonable accommodation basics',
        '## What is reasonable accommodation?\n\nA change to the way things are usually done so that a person with a disability can take part on equal terms: for example, flexible hours, screen-reading software or an accessible workstation.', 1, 20),
      measuring: await page(w4, 'Measuring progress on inclusion', '## Coming soon\n\nThis week opens after the assignment deadline.', 0, 10),
    };
    for (const it of [items.welcome, items.models, items.crpd]) {
      await q('INSERT INTO item_completions (user_id, item_id) VALUES ($1, $2)', [S.amina, it]);
    }
    await q('INSERT INTO item_completions (user_id, item_id) VALUES ($1, $2)', [S.bilal, items.welcome]);

    const h1 = await mod(C.ibt, 'Module 1 · Inclusive employer basics', 'Why inclusive hiring matters and where barriers appear.', 0);
    await page(h1, 'Where hiring excludes people', '## Common barriers in recruitment\n\n- Job adverts that list requirements nobody needs\n- Online forms that do not work with screen readers\n- Interview formats that disadvantage people who communicate differently', 0, 15);
    const h2 = await mod(C.ibt, 'Module 2 · Accessible adverts and applications', 'Rewrite an advert and test an application form.', 1);
    await page(h2, 'Writing an accessible job advert', '## Checklist\n\n1. Separate essential from desirable requirements\n2. Offer adjustments at every stage\n3. Publish in accessible formats', 0, 20);

    const d1 = await mod(C.iet, 'Unit 1 · Inclusive classrooms', 'Universal Design for Learning and accessible learning materials.', 0);
    await page(d1, 'Universal Design for Learning', '## Plan for every learner from the start\n\nOffer more than one way to **take in** information (spoken, written, visual), to **take part** (individual, pair, group) and to **show learning** (written, oral, practical).', 0, 15);
    await page(d1, 'Accessible worksheets', '## Structure before style\n\nUse real headings, clear fonts, good contrast and plain language. Children who use screen readers navigate by headings, so use the built-in Heading styles rather than bold text.', 1, 12);

    const l1 = await mod(C.ilt, 'Module 1 · The independent living approach', 'Choice, control and peer support.', 0);
    await page(l1, 'What independent living means', '## Choice and control\n\nIndependent living does not mean doing everything alone. It means persons with disabilities make the decisions about their own lives, with the support they choose.', 0, 15);

    // ---------------------------------------------------------------- assignments, submissions, grades
    const assignment = async (c: string, title: string, instructions: string, due: string, points: number, type: string, status = 'published', lateUntil: string | null = null) =>
      (await one(`INSERT INTO assignments (course_id, title, instructions, due_at, late_until, points_possible, submission_type, status, created_by)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [c, title, instructions, due, lateUntil, points, type, status, admin])).id;

    const A = {
      reflection: await assignment(C.det, 'Reflection: models of disability',
        'In 300–500 words, describe a situation where the social model changes how you would respond. Submit as text or as a document.',
        at(-6), 20, 'text_or_file'),
      barrierReport: await assignment(C.det, 'Short barrier report',
        'Write an 800-word report on one barrier you found in the Week 2 activity and a practical fix. Include who would need to approve the change.',
        at(8), 50, 'text_or_file', 'published', at(10)),
      advert: await assignment(C.ibt, 'Accessible job advert rewrite',
        'Rewrite the sample advert in the module so it separates essential and desirable criteria and offers adjustments.',
        at(3), 30, 'text_or_file'),
      checklist: await assignment(C.iet, 'Accessible lesson plan',
        'Adapt one of your lesson plans using the Universal Design for Learning checklist and upload the revised plan.', at(12), 40, 'file'),
      draftWork: await assignment(C.det, 'Final reflection (draft)', 'The trainer is still preparing this one.', at(30), 20, 'text', 'draft'),
    };

    const submit = (a: string, s: string, body: string, when: string) =>
      q('INSERT INTO submissions (assignment_id, student_id, attempt, body, submitted_at) VALUES ($1, $2, 1, $3, $4)', [a, s, body, when]);
    await submit(A.reflection, S.amina, 'At my office the reception counter is too high for wheelchair users. Under the medical model I would have offered to help each visitor; under the social model the fix is a lowered counter section so nobody needs special help.', at(-7, 10));
    await submit(A.reflection, S.bilal, 'Our staff training videos have no captions. The social model points to captioning the videos rather than asking colleagues who are Deaf to find workarounds.', at(-6, 9));
    await submit(A.reflection, S.hira, 'Job interviews at my organisation are only held in person on the third floor. A step-free room and a video option would remove the barrier.', at(-8, 9));
    await submit(A.reflection, S.omar, 'Notices are only shared on a printed board. Sharing them by email in an accessible format reaches everyone.', at(-6, 11));
    await submit(A.advert, S.amina, 'Draft: Essential — experience with payroll systems. Desirable — knowledge of Urdu. We welcome requests for adjustments at any stage; contact the HR team by email, phone or text.', at(-1, 11));

    const grade = (a: string, s: string, score: number, feedback: string, by: string, released: boolean) =>
      q(`INSERT INTO grades (assignment_id, student_id, score, feedback, graded_by, released_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [a, s, score, feedback, by, released ? at(-2, 9) : null]);
    await grade(A.reflection, S.amina, 18, 'Clear, practical example. Next time, name who would need to approve the counter change.', T.sana, true);
    await grade(A.reflection, S.hira, 16, 'Good identification of the barrier. Expand on how you would check the change worked.', T.sana, true);
    await grade(A.reflection, S.bilal, 17, 'Strong link between the model and the fix.', T.sana, false);

    // ---------------------------------------------------------------- quizzes
    const quiz = async (c: string, title: string, description: string, opens: string, closes: string, limit: number | null, attempts: number) =>
      (await one(`INSERT INTO quizzes (course_id, title, description, opens_at, closes_at, time_limit_minutes, max_attempts, status, created_by)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8) RETURNING id`, [c, title, description, opens, closes, limit, attempts, admin])).id;
    const question = async (qz: string, pos: number, kind: string, prompt: string, points: number, options: [string, boolean][], accepted: string[] = []) => {
      const qid = (await one('INSERT INTO quiz_questions (quiz_id, position, kind, prompt, points) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [qz, pos, kind, prompt, points])).id;
      const correct: string[] = [];
      for (const [i, [label, ok]] of options.entries()) {
        const oid = (await one('INSERT INTO quiz_options (question_id, label, position) VALUES ($1, $2, $3) RETURNING id', [qid, label, i])).id;
        if (ok) correct.push(oid);
      }
      await q('INSERT INTO quiz_answer_keys (question_id, correct_option_ids, accepted_answers) VALUES ($1, $2, $3)', [qid, correct, accepted]);
      return qid;
    };
    const Q1 = await quiz(C.det, 'Week 1–2 check: key terms',
      'Four questions on the models of disability and the CRPD. You have 20 minutes and two attempts. Your best score counts.',
      at(-3, 4), at(10, 18), 20, 2);
    await question(Q1, 0, 'single', 'Which model of disability locates the problem in barriers in society rather than in a person\'s body?', 1,
      [['Medical model', false], ['Charity model', false], ['Social model', true]]);
    await question(Q1, 1, 'multiple', 'Which of these are examples of communication barriers? Choose all that apply.', 2,
      [['Videos without captions', true], ['A step at the entrance', false], ['Forms that only work with a mouse', true], ['Information only in complex language', true]]);
    await question(Q1, 2, 'short', 'What is the short name of the UN Convention on the Rights of Persons with Disabilities?', 1, [], ['CRPD', 'UNCRPD', 'UN CRPD']);
    await question(Q1, 3, 'single', 'A "reasonable accommodation" is best described as:', 1,
      [['A favour granted at the manager\'s discretion', false], ['A change that lets a person with a disability take part on equal terms', true], ['A separate service only for persons with disabilities', false]]);

    const Q2 = await quiz(C.ibt, 'Inclusive employer basics check', 'Three questions. One attempt, no time limit.', at(-1, 4), at(14, 18), null, 1);
    await question(Q2, 0, 'single', 'When should candidates be told they can request adjustments?', 1,
      [['Only after an offer is made', false], ['At every stage of the process', true], ['Only if they mention a disability', false]]);
    await question(Q2, 1, 'single', 'Requirements that are not needed for the job should be:', 1,
      [['Removed or moved to "desirable"', true], ['Kept to reduce applications', false]]);
    await question(Q2, 2, 'short', 'Name one accessible format for publishing a job advert.', 1, [], ['plain text', 'accessible pdf', 'word', 'html', 'audio', 'easy read', 'large print']);

    // ---------------------------------------------------------------- announcements, events, notifications
    const venue = 'CBID Institute, B-52/1, Block 13-D/1, Jamali Road, Gulshan-e-Iqbal, Karachi';
    await q(`INSERT INTO announcements (course_id, author_id, title, body, created_at) VALUES
      (NULL, $1, 'Onsite assessment dates for this term', 'Final assessments for blended courses will be held at CBID Institute in Karachi. Tell your trainer by the end of next week if you need an adjustment such as extra time, a sign language interpreter, a reader or a ground-floor room.', $2)`,
      [admin, at(-2, 8)]);
    await q(`INSERT INTO announcements (course_id, author_id, title, body, created_at) VALUES
      ($1, $2, 'Week 2 live session moved to Thursday', 'This week''s captioned trainer session is on Thursday at 5 pm Pakistan time. The recording will be posted the same evening.', $3),
      ($1, $2, 'Feedback on reflections is out', 'I have released grades for most reflections. Read the comments before you start the barrier report.', $4)`,
      [C.det, T.sana, at(-4, 9), at(-2, 10)]);
    await q(`INSERT INTO announcements (course_id, author_id, title, body, created_at) VALUES
      ($1, $2, 'Welcome to IBT201', 'Please complete Module 1 before our first workshop.', $3)`, [C.ibt, T.farhan, at(-20, 9)]);

    await q(`INSERT INTO calendar_events (course_id, title, description, location, starts_at, ends_at, created_by) VALUES
      (NULL, 'Adjustment requests close', 'Last day to ask for adjustments for the onsite assessment.', NULL, $1, $1, $3),
      (NULL, 'Onsite assessment day', 'Final assessments for blended courses. Step-free access; interpreters on request.', $4, $2, $2, $3)`,
      [at(14, 4), at(60, 4), admin, venue]);
    await q(`INSERT INTO calendar_events (course_id, title, description, location, starts_at, ends_at, created_by) VALUES
      ($1, 'Live trainer session: barriers at work', 'Captioned; recording posted afterwards.', 'Online', $2, $3, $4)`,
      [C.det, at(2, 12), at(2, 13), T.sana]);

    await q(`INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES
      ($1, 'grade', 'Grade released: Reflection: models of disability', 'Your trainer has released your grade and feedback.', $2, $3),
      ($1, 'announcement', 'DET101: Week 2 live session moved to Thursday', 'This week''s captioned trainer session is on Thursday.', $4, $5)`,
      [S.amina, `/courses/${C.det}/assignments/${A.reflection}`, at(-2, 9), `/courses/${C.det}/announcements`, at(-4, 9)]);

    await client.query('COMMIT');
    return { admin, teachers: T, students: S, courses: C, assignments: A, quizzes: { Q1, Q2 }, items, departments: dept, terms: term, certificates: { awarded } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export type SeedIds = Awaited<ReturnType<typeof seed>>;
