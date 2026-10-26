-- 0007: CBID Institute identity, course audience and delivery mode, and certificates.
--
-- * The platform is the learning system of CBID Institute (CBID Network PK Sindh, https://cbidnetwork.org).
--   Settings are renamed and contact details added; a SECURITY DEFINER function exposes only the
--   public branding keys so the sign-in page and emails can use them without a session.
-- * Roles keep their keys ('student', 'teacher', 'admin') and are shown as Learner, Trainer and Administrator.
-- * Courses gain an audience line and a delivery mode (online, blended, onsite). Both are administrator-only.
-- * Certificates: issued by the course's trainers or an administrator to enrolled learners, revocable,
--   and verifiable by anyone who has the serial number. Rows are written only by trusted functions.

-- =====================================================================================
-- Settings and branding
-- =====================================================================================
UPDATE system_settings SET key = 'institute_name' WHERE key = 'university_name';
UPDATE system_settings SET value = '"CBID Institute"' WHERE key = 'institute_name' AND value = '"CBID University"';
UPDATE system_settings SET value = '"info@cbidnetwork.org"' WHERE key = 'support_email' AND value = '"support@example.org"';
INSERT INTO system_settings (key, value) VALUES
  ('institute_name', '"CBID Institute"'),
  ('organisation_name', '"CBID Network PK Sindh"'),
  ('contact_phone', '"+92 21 34155705"'),
  ('contact_address', '"B-52/1, Block 13-D/1, Jamali Road, Gulshan-e-Iqbal, Karachi"'),
  ('website_url', '"https://cbidnetwork.org"')
ON CONFLICT (key) DO NOTHING;

-- Public branding (no session needed): whitelisted keys only.
CREATE FUNCTION app.public_settings() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM system_settings
   WHERE key IN ('institute_name', 'organisation_name', 'support_email', 'contact_phone', 'contact_address', 'website_url')
$$;

UPDATE roles SET name = 'Learner' WHERE key = 'student';
UPDATE roles SET name = 'Trainer' WHERE key = 'teacher';

-- =====================================================================================
-- Courses: audience and delivery mode (administrator-only, like code, term and status)
-- =====================================================================================
ALTER TABLE courses
  ADD COLUMN audience text NOT NULL DEFAULT '' CHECK (length(audience) <= 200),
  ADD COLUMN delivery_mode text NOT NULL DEFAULT 'online' CHECK (delivery_mode IN ('online', 'blended', 'onsite'));

CREATE OR REPLACE FUNCTION app.tg_courses_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'archived' AND OLD.status <> 'archived' THEN NEW.archived_at := now(); END IF;
    IF NEW.status <> 'archived' THEN NEW.archived_at := NULL; END IF;
  ELSE
    NEW.archived_at := CASE WHEN NEW.status = 'archived' THEN now() END;
  END IF;

  IF app.is_system() THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT app.is_admin() THEN
      RAISE EXCEPTION 'Only administrators can create courses' USING ERRCODE = 'CB403';
    END IF;
    NEW.created_by := app.uid();
    RETURN NEW;
  END IF;

  IF NOT app.is_admin() THEN
    IF OLD.status = 'archived' THEN
      RAISE EXCEPTION 'Archived courses are read-only' USING ERRCODE = 'CB403';
    END IF;
    IF (NEW.code, NEW.term_id, NEW.department_id, NEW.status, NEW.enrollment_open, NEW.capacity, NEW.created_by,
        NEW.audience, NEW.delivery_mode)
       IS DISTINCT FROM (OLD.code, OLD.term_id, OLD.department_id, OLD.status, OLD.enrollment_open, OLD.capacity, OLD.created_by,
        OLD.audience, OLD.delivery_mode) THEN
      RAISE EXCEPTION 'Only administrators can change a course''s code, term, status, audience, delivery mode or enrolment settings' USING ERRCODE = 'CB403';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- =====================================================================================
-- Certificates
-- =====================================================================================
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'notifications'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%';
  EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('announcement', 'grade', 'assignment', 'quiz', 'enrollment', 'system', 'certificate'));

CREATE TABLE certificates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial          text NOT NULL UNIQUE CHECK (serial ~ '^CBID-[0-9]{4}-[A-HJ-NP-Z2-9]{8}$'),
  course_id       uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Snapshots: a certificate states what was true when it was issued.
  recipient_name  text NOT NULL CHECK (length(recipient_name) BETWEEN 1 AND 160),
  course_code     text NOT NULL,
  course_title    text NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  issued_by       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES users(id) ON DELETE RESTRICT,
  revoke_reason   text CHECK (revoke_reason IS NULL OR length(revoke_reason) BETWEEN 3 AND 300),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL))
);
-- One valid certificate per learner per course; a revoked one may be replaced.
CREATE UNIQUE INDEX certificates_active_uq ON certificates (course_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX certificates_user_idx ON certificates (user_id, issued_at DESC);

ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY certificates_read ON certificates FOR SELECT TO cbid_app
  USING (user_id = app.uid() OR app.course_staff(course_id));
GRANT SELECT ON certificates TO cbid_app;
-- No INSERT/UPDATE/DELETE grants: only the trusted functions below write certificates.

CREATE FUNCTION app.issue_certificate(p_course uuid, p_user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_course courses%ROWTYPE;
  v_name text;
  v_serial text;
  v_id uuid;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
BEGIN
  IF NOT app.course_staff(p_course) THEN
    RAISE EXCEPTION 'Only this course''s trainers or an administrator can issue certificates' USING ERRCODE = 'CB403';
  END IF;
  SELECT * INTO v_course FROM courses WHERE id = p_course;
  IF NOT FOUND THEN RAISE EXCEPTION 'Course not found' USING ERRCODE = 'CB404'; END IF;
  IF v_course.status = 'draft' THEN
    RAISE EXCEPTION 'Certificates cannot be issued for a draft course' USING ERRCODE = 'CB422';
  END IF;
  SELECT u.full_name INTO v_name
    FROM enrollments e JOIN users u ON u.id = e.user_id
   WHERE e.course_id = p_course AND e.user_id = p_user AND e.status IN ('active', 'completed') AND u.status = 'active';
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'This learner is not enrolled in the course' USING ERRCODE = 'CB422';
  END IF;
  IF EXISTS (SELECT 1 FROM certificates WHERE course_id = p_course AND user_id = p_user AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'This learner already has a certificate for this course' USING ERRCODE = 'CB409';
  END IF;

  -- 8 characters from a 32-symbol alphabet without look-alikes (no I, O, 0, 1): about 1.1e12 values.
  LOOP
    v_bytes := uuid_send(gen_random_uuid());
    v_serial := 'CBID-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-';
    FOR i IN 0..7 LOOP
      v_serial := v_serial || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM certificates WHERE serial = v_serial);
  END LOOP;

  INSERT INTO certificates (serial, course_id, user_id, recipient_name, course_code, course_title, issued_by)
  VALUES (v_serial, p_course, p_user, v_name, v_course.code, v_course.title, app.uid())
  RETURNING id INTO v_id;

  INSERT INTO notifications (user_id, kind, title, body, link)
  VALUES (p_user, 'certificate', left('Certificate issued: ' || v_course.title, 200),
          'Your certificate is ready to view, print and share. Serial ' || v_serial || '.', '/certificates/' || v_id);
  INSERT INTO email_outbox (to_address, subject, body_text)
  SELECT u.email, left('Certificate issued: ' || v_course.title, 200),
         'Congratulations, ' || u.full_name || '.' || E'\n\n' ||
         b.institute || ' has issued your certificate for ' || v_course.code || ' ' || v_course.title || '.' || E'\n' ||
         'Certificate serial: ' || v_serial || E'\n\n' ||
         'Sign in to view and print it. Anyone can check it on the certificate verification page using the serial.' ||
         E'\n\n--\n' || b.institute || ', ' || b.organisation || E'\n' || b.support
    FROM users u
    LEFT JOIN notification_preferences np ON np.user_id = u.id
    CROSS JOIN LATERAL (
      SELECT coalesce(app.public_settings() ->> 'institute_name', 'CBID Institute') AS institute,
             coalesce(app.public_settings() ->> 'organisation_name', 'CBID Network PK Sindh') AS organisation,
             coalesce(app.public_settings() ->> 'support_email', '') AS support) b
   WHERE u.id = p_user AND coalesce(np.email_grades, true);
  RETURN v_id;
END $$;

CREATE FUNCTION app.revoke_certificate(p_certificate uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_course uuid; v_revoked timestamptz;
BEGIN
  SELECT course_id, revoked_at INTO v_course, v_revoked FROM certificates WHERE id = p_certificate;
  IF NOT FOUND OR NOT app.course_staff(v_course) THEN
    RAISE EXCEPTION 'Certificate not found' USING ERRCODE = 'CB404';
  END IF;
  IF v_revoked IS NOT NULL THEN
    RAISE EXCEPTION 'This certificate is already revoked' USING ERRCODE = 'CB409';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Give a reason for revoking the certificate' USING ERRCODE = 'CB422';
  END IF;
  UPDATE certificates SET revoked_at = now(), revoked_by = app.uid(), revoke_reason = left(btrim(p_reason), 300)
   WHERE id = p_certificate;
END $$;

-- Public verification: anyone with the exact serial sees what the certificate states and whether it is valid.
-- No identifiers, emails or revocation reasons are returned.
CREATE FUNCTION app.verify_certificate(p_serial text)
RETURNS TABLE (serial text, recipient_name text, course_code text, course_title text, issued_at timestamptz,
               valid boolean, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.serial, c.recipient_name, c.course_code, c.course_title, c.issued_at, c.revoked_at IS NULL, c.revoked_at
    FROM certificates c
   WHERE c.serial = upper(btrim(p_serial))
$$;

REVOKE ALL ON FUNCTION app.public_settings(), app.issue_certificate(uuid, uuid),
  app.revoke_certificate(uuid, text), app.verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_settings(), app.issue_certificate(uuid, uuid),
  app.revoke_certificate(uuid, text), app.verify_certificate(text) TO cbid_app;

-- =====================================================================================
-- Wording: Learner and Trainer in messages raised by earlier functions
-- =====================================================================================
DO $$
DECLARE
  r record;
  def text;
  pairs text[][] := ARRAY[
    ['Remove this teacher from their courses', 'Remove this trainer from their courses'],
    ['Drop this student''''s active enrolments', 'Drop this learner''''s active enrolments'],
    ['Only active teacher accounts can be assigned to teach a course', 'Only active trainer accounts can be assigned to a course'],
    ['Only active student accounts can be enrolled', 'Only active learner accounts can be enrolled'],
    ['Questions cannot change after students have started this quiz', 'Questions cannot change after learners have started this quiz'],
    ['A grade cannot be moved to another assignment or student', 'A grade cannot be moved to another assignment or learner'],
    ['This student is not enrolled in the course', 'This learner is not enrolled in the course'],
    ['Not allowed to notify this student', 'Not allowed to notify this learner'],
    ['Student is not enrolled in this course', 'Learner is not enrolled in this course'],
    ['Only enrolled students can take this quiz', 'Only enrolled learners can take this quiz']
  ];
  i int;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND p.prokind = 'f' LOOP
    def := pg_get_functiondef(r.oid);
    IF def ~* '(student|teacher)' AND def LIKE '%RAISE EXCEPTION%' THEN
      FOR i IN 1 .. array_length(pairs, 1) LOOP
        def := replace(def, pairs[i][1], pairs[i][2]);
      END LOOP;
      IF def IS DISTINCT FROM pg_get_functiondef(r.oid) THEN
        EXECUTE def;
      END IF;
    END IF;
  END LOOP;
END $$;
