-- 0001: core relational schema for the CBID University LMS.
-- Conventions:
--   * UUID primary keys (gen_random_uuid), timestamptz everywhere (stored in UTC).
--   * People and graded work are never hard-deleted: users are deactivated, courses archived.
--     Foreign keys from submissions/grades/attempts use ON DELETE RESTRICT to protect records.
--   * Derived values (late flags, scores) are written by triggers/functions, never trusted from clients.

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------- roles & academic structure
CREATE TABLE roles (
  key   text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,32}$'),
  name  text NOT NULL,
  rank  smallint NOT NULL UNIQUE CHECK (rank > 0)
);
INSERT INTO roles (key, name, rank) VALUES
  ('student', 'Student', 10),
  ('teacher', 'Teacher', 20),
  ('admin',   'Administrator', 30);

CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,10}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on > starts_on)
);

-- ---------------------------------------------------------------- people & authentication
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE
                        CHECK (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash       text NOT NULL,
  full_name           text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
  preferred_name      text CHECK (preferred_name IS NULL OR length(btrim(preferred_name)) BETWEEN 1 AND 60),
  role                text NOT NULL REFERENCES roles(key),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  department_id       uuid REFERENCES departments(id) ON DELETE SET NULL,
  timezone            text NOT NULL DEFAULT 'Asia/Karachi' CHECK (length(timezone) BETWEEN 1 AND 64),
  failed_login_count  integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until        timestamptz,
  last_login_at       timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_role_status_idx ON users (role, status);
CREATE INDEX users_name_trgm_idx ON users USING gin (full_name gin_trgm_ops);
CREATE INDEX users_email_trgm_idx ON users USING gin ((email::text) gin_trgm_ops);

-- Opaque session tokens; only a SHA-256 hash is stored. Expired rows are pruned by the worker.
CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash       bytea NOT NULL UNIQUE,
  csrf_token       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  idle_expires_at  timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  ip               inet,
  user_agent       text CHECK (user_agent IS NULL OR length(user_agent) <= 300)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);
CREATE INDEX password_reset_expiry_idx ON password_reset_tokens (expires_at);

-- ---------------------------------------------------------------- courses & membership
CREATE TABLE courses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL CHECK (code ~ '^[A-Z]{2,6}[0-9]{2,4}[A-Z]?$'),
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
  summary          text NOT NULL DEFAULT '' CHECK (length(summary) <= 500),
  description      text NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  department_id    uuid REFERENCES departments(id) ON DELETE RESTRICT,
  term_id          uuid NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  enrollment_open  boolean NOT NULL DEFAULT false,
  capacity         integer CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 5000),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  UNIQUE (code, term_id),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX courses_status_idx ON courses (status);
CREATE INDEX courses_term_idx ON courses (term_id);
CREATE INDEX courses_title_trgm_idx ON courses USING gin (title gin_trgm_ops);

CREATE TABLE course_teachers (
  course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_lead      boolean NOT NULL DEFAULT false,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id)
);
CREATE INDEX course_teachers_user_idx ON course_teachers (user_id);

CREATE TABLE enrollments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dropped', 'completed')),
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);
CREATE INDEX enrollments_user_idx ON enrollments (user_id, status);
CREATE INDEX enrollments_course_idx ON enrollments (course_id, status);

-- ---------------------------------------------------------------- files
CREATE TABLE files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  purpose        text NOT NULL CHECK (purpose IN ('material', 'submission')),
  storage_key    text NOT NULL UNIQUE CHECK (storage_key ~ '^[a-f0-9]{2}/[a-f0-9-]{36}$'),
  original_name  text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  mime_type      text NOT NULL CHECK (length(mime_type) <= 100),
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  sha256         text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_owner_idx ON files (owner_id);
CREATE INDEX files_course_idx ON files (course_id);

-- ---------------------------------------------------------------- content
CREATE TABLE modules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 160),
  description  text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  position     integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  published    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX modules_course_idx ON modules (course_id, position);

CREATE TABLE module_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id          uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('page', 'link', 'file')),
  title              text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  body               text CHECK (body IS NULL OR length(body) <= 50000),
  url                text CHECK (url IS NULL OR (url ~ '^https://[^\s<>"]+$' AND length(url) <= 2000)),
  file_id            uuid REFERENCES files(id) ON DELETE RESTRICT,
  position           integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  published          boolean NOT NULL DEFAULT false,
  estimated_minutes  integer CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 600),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'page' AND body IS NOT NULL) OR
    (kind = 'link' AND url IS NOT NULL) OR
    (kind = 'file' AND file_id IS NOT NULL)
  )
);
CREATE INDEX module_items_module_idx ON module_items (module_id, position);

CREATE TABLE item_completions (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES module_items(id) ON DELETE CASCADE,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX item_completions_item_idx ON item_completions (item_id);

-- ---------------------------------------------------------------- assignments, submissions, grades
CREATE TABLE assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  instructions     text NOT NULL DEFAULT '' CHECK (length(instructions) <= 20000),
  due_at           timestamptz NOT NULL,
  late_until       timestamptz,
  points_possible  numeric(6,2) NOT NULL CHECK (points_possible > 0 AND points_possible <= 1000),
  submission_type  text NOT NULL DEFAULT 'text_or_file'
                     CHECK (submission_type IN ('text', 'file', 'text_or_file')),
  max_attempts     smallint NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at     timestamptz,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (late_until IS NULL OR late_until > due_at)
);
CREATE INDEX assignments_course_due_idx ON assignments (course_id, due_at);
CREATE INDEX assignments_due_idx ON assignments (due_at) WHERE status = 'published';

CREATE TABLE submissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  student_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt        smallint NOT NULL CHECK (attempt >= 1),
  body           text CHECK (body IS NULL OR length(body) <= 100000),
  file_id        uuid REFERENCES files(id) ON DELETE RESTRICT,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  is_late        boolean NOT NULL DEFAULT false,
  client_token   uuid,               -- idempotency key supplied by the client per submit action
  UNIQUE (assignment_id, student_id, attempt),
  UNIQUE (assignment_id, student_id, client_token),
  CHECK (body IS NOT NULL OR file_id IS NOT NULL)
);
CREATE INDEX submissions_student_idx ON submissions (student_id, submitted_at DESC);

CREATE TABLE grades (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  uuid NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  student_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  score          numeric(6,2) NOT NULL CHECK (score >= 0),
  feedback       text NOT NULL DEFAULT '' CHECK (length(feedback) <= 20000),
  graded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  graded_at      timestamptz NOT NULL DEFAULT now(),
  released_at    timestamptz,
  version        integer NOT NULL DEFAULT 1,
  UNIQUE (assignment_id, student_id)
);
CREATE INDEX grades_student_idx ON grades (student_id);

-- ---------------------------------------------------------------- quizzes
CREATE TABLE quizzes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id           uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title               text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  description         text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  time_limit_minutes  smallint CHECK (time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 600),
  max_attempts        smallint NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10),
  opens_at            timestamptz NOT NULL,
  closes_at           timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at        timestamptz,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at)
);
CREATE INDEX quizzes_course_idx ON quizzes (course_id, closes_at);

CREATE TABLE quiz_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id     uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  kind        text NOT NULL CHECK (kind IN ('single', 'multiple', 'short')),
  prompt      text NOT NULL CHECK (length(btrim(prompt)) BETWEEN 1 AND 5000),
  points      numeric(5,2) NOT NULL DEFAULT 1 CHECK (points > 0 AND points <= 100),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quiz_questions_quiz_idx ON quiz_questions (quiz_id, position);

CREATE TABLE quiz_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  label        text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 1000),
  position     integer NOT NULL DEFAULT 0 CHECK (position >= 0)
);
CREATE INDEX quiz_options_question_idx ON quiz_options (question_id, position);

-- Answer keys live in their own table so RLS can hide them from students entirely.
CREATE TABLE quiz_answer_keys (
  question_id         uuid PRIMARY KEY REFERENCES quiz_questions(id) ON DELETE CASCADE,
  correct_option_ids  uuid[] NOT NULL DEFAULT '{}',
  accepted_answers    text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE quiz_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       uuid NOT NULL REFERENCES quizzes(id) ON DELETE RESTRICT,
  student_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt_no    smallint NOT NULL CHECK (attempt_no >= 1),
  started_at    timestamptz NOT NULL DEFAULT now(),
  deadline_at   timestamptz NOT NULL,
  submitted_at  timestamptz,
  status        text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  score         numeric(7,2),
  max_score     numeric(7,2),
  UNIQUE (quiz_id, student_id, attempt_no),
  CHECK ((status = 'submitted') = (submitted_at IS NOT NULL))
);
CREATE UNIQUE INDEX quiz_attempts_one_open_idx ON quiz_attempts (quiz_id, student_id) WHERE status = 'in_progress';
CREATE INDEX quiz_attempts_student_idx ON quiz_attempts (student_id);
CREATE INDEX quiz_attempts_open_deadline_idx ON quiz_attempts (deadline_at) WHERE status = 'in_progress';

CREATE TABLE quiz_answers (
  attempt_id           uuid NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id          uuid NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  selected_option_ids  uuid[] NOT NULL DEFAULT '{}',
  text_answer          text CHECK (text_answer IS NULL OR length(text_answer) <= 2000),
  is_correct           boolean,
  points_awarded       numeric(5,2),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);

-- ---------------------------------------------------------------- communication
CREATE TABLE announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid REFERENCES courses(id) ON DELETE CASCADE,   -- NULL = university-wide
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_course_idx ON announcements (course_id, created_at DESC);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('announcement', 'grade', 'assignment', 'quiz', 'enrollment', 'system')),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body        text NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  link        text CHECK (link IS NULL OR (link ~ '^/[A-Za-z0-9/_?=&.-]*$' AND length(link) <= 300)),
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_created_idx ON notifications (created_at);

CREATE TABLE notification_preferences (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_announcements  boolean NOT NULL DEFAULT true,
  email_grades         boolean NOT NULL DEFAULT true,
  email_deadlines      boolean NOT NULL DEFAULT true,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid REFERENCES courses(id) ON DELETE CASCADE,  -- NULL = academic calendar
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  description  text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  location     text CHECK (location IS NULL OR length(location) <= 200),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX calendar_events_start_idx ON calendar_events (starts_at);
CREATE INDEX calendar_events_course_idx ON calendar_events (course_id, starts_at);

-- ---------------------------------------------------------------- operations
CREATE TABLE audit_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL CHECK (action ~ '^[a-z_.]{3,64}$'),
  entity_type  text CHECK (entity_type IS NULL OR length(entity_type) <= 40),
  entity_id    text CHECK (entity_id IS NULL OR length(entity_id) <= 64),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

CREATE TABLE system_settings (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,64}$'),
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO system_settings (key, value) VALUES
  ('university_name', '"CBID University"'),
  ('support_email', '"support@example.org"'),
  ('self_enrollment_enabled', 'true'),
  ('maintenance_banner', '""');

-- Outbound email queue processed by the worker (retry with backoff; sent rows pruned after 30 days).
CREATE TABLE email_outbox (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_address       citext NOT NULL,
  subject          text NOT NULL CHECK (length(subject) <= 200),
  body_text        text NOT NULL CHECK (length(body_text) <= 20000),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts         smallint NOT NULL DEFAULT 0,
  last_error       text,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);
CREATE INDEX email_outbox_pending_idx ON email_outbox (next_attempt_at) WHERE status = 'pending';
