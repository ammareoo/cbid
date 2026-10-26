-- 0002: identity context, guard triggers, trusted functions, grants and Row-Level Security.
--
-- Trust model (see docs/SECURITY.md):
--   * The API connects as cbid_app (NOBYPASSRLS, not an owner). For every request it opens a
--     transaction and runs set_config('app.user_id', <id from a validated session>, true).
--     The id never comes from the client.
--   * Every helper below derives the caller's role from the users table, never from a claim.
--   * SECURITY DEFINER functions (owned by cbid_owner) are the only way to touch sessions,
--     reset tokens, quiz answer keys and attempt scoring. Each checks app.uid() itself.
--   * Guard triggers enforce business rules (deadlines, attempt limits, score bounds,
--     privilege escalation) even if application code has a bug.
--   * Custom SQLSTATEs: CB403 forbidden, CB404 not found, CB409 conflict, CB422 rule violation.
--     The API maps these to HTTP status codes and shows the message to the user.

-- =====================================================================================
-- Identity helpers
-- =====================================================================================
CREATE FUNCTION app.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- True for maintenance connections (migrations, seed, worker) — anything that is not the API role.
CREATE FUNCTION app.is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT session_user::text <> 'cbid_app'
$$;

CREATE FUNCTION app.my_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT role FROM users WHERE id = app.uid() AND status = 'active'
$$;

CREATE FUNCTION app.role_rank(p_role text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT rank FROM roles WHERE key = p_role
$$;

CREATE FUNCTION app.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app.my_role() = 'admin', false)
$$;

CREATE FUNCTION app.teaches(p_course uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM course_teachers ct JOIN users u ON u.id = ct.user_id
    WHERE ct.course_id = p_course AND ct.user_id = app.uid()
      AND u.status = 'active' AND u.role = 'teacher')
$$;

CREATE FUNCTION app.course_staff(p_course uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR app.teaches(p_course)
$$;

CREATE FUNCTION app.course_status(p_course uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT status FROM courses WHERE id = p_course
$$;

-- Staff may change course content unless the course is archived (administrators may always).
CREATE FUNCTION app.course_writable(p_course uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR (app.teaches(p_course) AND app.course_status(p_course) <> 'archived')
$$;

CREATE FUNCTION app.enrolled(p_course uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM enrollments e JOIN users u ON u.id = e.user_id
    WHERE e.course_id = p_course AND e.user_id = app.uid()
      AND e.status IN ('active', 'completed') AND u.status = 'active')
$$;

CREATE FUNCTION app.learner_can_view(p_course uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.enrolled(p_course) AND coalesce(app.course_status(p_course) IN ('published', 'archived'), false)
$$;

CREATE FUNCTION app.course_visible(p_course uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.course_staff(p_course) OR app.learner_can_view(p_course)
$$;

CREATE FUNCTION app.module_course(p_module uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT course_id FROM modules WHERE id = p_module
$$;

CREATE FUNCTION app.module_visible(p_module uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM modules m WHERE m.id = p_module
      AND (app.course_staff(m.course_id) OR (m.published AND app.learner_can_view(m.course_id))))
$$;

CREATE FUNCTION app.item_course(p_item uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.course_id FROM module_items i JOIN modules m ON m.id = i.module_id WHERE i.id = p_item
$$;

CREATE FUNCTION app.item_visible(p_item uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM module_items i JOIN modules m ON m.id = i.module_id
    WHERE i.id = p_item
      AND (app.course_staff(m.course_id)
           OR (i.published AND m.published AND app.learner_can_view(m.course_id))))
$$;

CREATE FUNCTION app.assignment_course(p_assignment uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT course_id FROM assignments WHERE id = p_assignment
$$;

CREATE FUNCTION app.quiz_course(p_quiz uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT course_id FROM quizzes WHERE id = p_quiz
$$;

CREATE FUNCTION app.quiz_visible(p_quiz uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM quizzes q WHERE q.id = p_quiz
      AND (app.course_staff(q.course_id) OR (q.status = 'published' AND app.learner_can_view(q.course_id))))
$$;

CREATE FUNCTION app.question_quiz(p_question uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT quiz_id FROM quiz_questions WHERE id = p_question
$$;

CREATE FUNCTION app.has_quiz_attempt(p_quiz uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM quiz_attempts WHERE quiz_id = p_quiz AND student_id = app.uid())
$$;

CREATE FUNCTION app.attempt_owner(p_attempt uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT student_id FROM quiz_attempts WHERE id = p_attempt
$$;

CREATE FUNCTION app.attempt_course(p_attempt uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT q.course_id FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.id = p_attempt
$$;

-- Can the current user see this person's profile? Self, administrators, and people who
-- share a course in a teacher/learner relationship (students never see other students).
CREATE FUNCTION app.can_view_user(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_user = app.uid() OR app.is_admin() OR EXISTS (
    SELECT 1 FROM course_teachers ct
    JOIN enrollments e ON e.course_id = ct.course_id
    WHERE (ct.user_id = app.uid() AND e.user_id = p_user)
       OR (e.user_id = app.uid() AND e.status IN ('active', 'completed') AND ct.user_id = p_user)
  ) OR EXISTS (
    SELECT 1 FROM course_teachers a JOIN course_teachers b ON a.course_id = b.course_id
    WHERE a.user_id = app.uid() AND b.user_id = p_user
  ) OR EXISTS (
    -- teacher names are public on published catalogue entries
    SELECT 1 FROM course_teachers ct JOIN courses c ON c.id = ct.course_id
    WHERE ct.user_id = p_user AND c.status = 'published' AND app.uid() IS NOT NULL
  )
$$;

CREATE FUNCTION app.can_read_file(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM files f WHERE f.id = p_file AND (
      f.owner_id = app.uid()
      OR app.course_staff(f.course_id)
      OR (f.purpose = 'material' AND EXISTS (
            SELECT 1 FROM module_items i WHERE i.file_id = f.id AND app.item_visible(i.id)))))
$$;

CREATE FUNCTION app.can_self_enroll(p_course uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.my_role() = 'student'
     AND EXISTS (SELECT 1 FROM courses WHERE id = p_course AND status = 'published' AND enrollment_open)
     AND coalesce((SELECT value = 'true'::jsonb FROM system_settings WHERE key = 'self_enrollment_enabled'), false)
$$;

-- =====================================================================================
-- Generic triggers
-- =====================================================================================
CREATE FUNCTION app.tg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','courses','enrollments','modules','module_items','assignments',
                           'quizzes','announcements','notification_preferences']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.tg_set_updated_at()',
                   t || '_updated_at', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- users: privilege escalation guard
CREATE FUNCTION app.tg_users_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE admin_rank integer := app.role_rank('admin');
BEGIN
  IF app.is_system() THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT app.is_admin() THEN
      RAISE EXCEPTION 'Only administrators can create accounts' USING ERRCODE = 'CB403';
    END IF;
    IF app.role_rank(NEW.role) >= admin_rank THEN
      RAISE EXCEPTION 'Administrator accounts can only be created by the system owner' USING ERRCODE = 'CB403';
    END IF;
    NEW.failed_login_count := 0;
    NEW.locked_until := NULL;
    NEW.last_login_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Immutable fields cannot change' USING ERRCODE = 'CB403';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.email IS DISTINCT FROM OLD.email OR NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    IF NOT app.is_admin() THEN
      RAISE EXCEPTION 'Only administrators can change role, status, email or department' USING ERRCODE = 'CB403';
    END IF;
    IF NEW.id = app.uid() THEN
      RAISE EXCEPTION 'You cannot change your own role, status or email' USING ERRCODE = 'CB403';
    END IF;
    IF app.role_rank(OLD.role) >= admin_rank OR app.role_rank(NEW.role) >= admin_rank THEN
      RAISE EXCEPTION 'Administrator accounts are managed by the system owner' USING ERRCODE = 'CB403';
    END IF;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF OLD.role = 'teacher' AND EXISTS (
         SELECT 1 FROM course_teachers ct JOIN courses c ON c.id = ct.course_id
         WHERE ct.user_id = OLD.id AND c.status <> 'archived') THEN
      RAISE EXCEPTION 'Remove this teacher from their courses before changing their role' USING ERRCODE = 'CB409';
    END IF;
    IF OLD.role = 'student' AND EXISTS (
         SELECT 1 FROM enrollments WHERE user_id = OLD.id AND status = 'active') THEN
      RAISE EXCEPTION 'Drop this student''s active enrolments before changing their role' USING ERRCODE = 'CB409';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_guard BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.tg_users_guard();

-- ---------------------------------------------------------------- courses: publication & structure are admin-only
CREATE FUNCTION app.tg_courses_guard() RETURNS trigger
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
    IF (NEW.code, NEW.term_id, NEW.department_id, NEW.status, NEW.enrollment_open, NEW.capacity, NEW.created_by)
       IS DISTINCT FROM (OLD.code, OLD.term_id, OLD.department_id, OLD.status, OLD.enrollment_open, OLD.capacity, OLD.created_by) THEN
      RAISE EXCEPTION 'Only administrators can change a course''s code, term, status or enrolment settings' USING ERRCODE = 'CB403';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER courses_guard BEFORE INSERT OR UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION app.tg_courses_guard();

CREATE FUNCTION app.tg_course_teachers_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'teacher' AND status = 'active') THEN
    RAISE EXCEPTION 'Only active teacher accounts can be assigned to teach a course' USING ERRCODE = 'CB422';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER course_teachers_guard BEFORE INSERT OR UPDATE ON course_teachers
  FOR EACH ROW EXECUTE FUNCTION app.tg_course_teachers_guard();

-- ---------------------------------------------------------------- enrolments: roles, self-enrolment, capacity
CREATE FUNCTION app.tg_enrollments_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_capacity integer; v_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.course_id <> OLD.course_id OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'An enrolment cannot be moved to another course or person' USING ERRCODE = 'CB422';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'student' AND status = 'active') THEN
    RAISE EXCEPTION 'Only active student accounts can be enrolled' USING ERRCODE = 'CB422';
  END IF;

  IF NOT app.is_system() AND NOT app.is_admin() THEN
    IF NEW.user_id IS DISTINCT FROM app.uid() THEN
      RAISE EXCEPTION 'You can only change your own enrolment' USING ERRCODE = 'CB403';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NOT app.can_self_enroll(NEW.course_id) THEN
        RAISE EXCEPTION 'This course is not open for enrolment' USING ERRCODE = 'CB422';
      END IF;
      NEW.status := 'active';
    ELSIF NOT (OLD.status = 'active' AND NEW.status = 'dropped') THEN
      RAISE EXCEPTION 'You can only withdraw from an active enrolment' USING ERRCODE = 'CB403';
    END IF;
  END IF;

  -- Capacity applies to self-enrolment; administrators may knowingly over-enrol.
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') AND NOT app.is_admin() AND NOT app.is_system() THEN
    SELECT capacity INTO v_capacity FROM courses WHERE id = NEW.course_id FOR UPDATE;
    IF v_capacity IS NOT NULL THEN
      SELECT count(*) INTO v_count FROM enrollments WHERE course_id = NEW.course_id AND status = 'active';
      IF v_count >= v_capacity THEN
        RAISE EXCEPTION 'This course is full' USING ERRCODE = 'CB409';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrollments_guard BEFORE INSERT OR UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION app.tg_enrollments_guard();

-- ---------------------------------------------------------------- content integrity
CREATE FUNCTION app.tg_module_items_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.file_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM files f JOIN modules m ON m.course_id = f.course_id
       WHERE f.id = NEW.file_id AND m.id = NEW.module_id AND f.purpose = 'material') THEN
    RAISE EXCEPTION 'The attached file does not belong to this course' USING ERRCODE = 'CB422';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.module_id <> OLD.module_id
     AND app.module_course(NEW.module_id) <> app.module_course(OLD.module_id) THEN
    RAISE EXCEPTION 'Items cannot be moved between courses' USING ERRCODE = 'CB422';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER module_items_guard BEFORE INSERT OR UPDATE ON module_items
  FOR EACH ROW EXECUTE FUNCTION app.tg_module_items_guard();

CREATE FUNCTION app.tg_publishable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT app.is_system() THEN NEW.created_by := app.uid(); END IF;
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status <> 'published') THEN
    NEW.published_at := coalesce(NEW.published_at, now());
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.course_id <> OLD.course_id THEN
    RAISE EXCEPTION 'Work cannot be moved to another course' USING ERRCODE = 'CB422';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignments_publishable BEFORE INSERT OR UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION app.tg_publishable();
CREATE TRIGGER quizzes_publishable BEFORE INSERT OR UPDATE ON quizzes
  FOR EACH ROW EXECUTE FUNCTION app.tg_publishable();

CREATE FUNCTION app.tg_assignment_points_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.points_possible < OLD.points_possible
     AND EXISTS (SELECT 1 FROM grades WHERE assignment_id = NEW.id AND score > NEW.points_possible) THEN
    RAISE EXCEPTION 'Some existing grades are higher than the new points total' USING ERRCODE = 'CB409';
  END IF;
  IF OLD.status = 'published' AND NEW.status = 'draft'
     AND EXISTS (SELECT 1 FROM submissions WHERE assignment_id = NEW.id) THEN
    RAISE EXCEPTION 'An assignment with submissions cannot return to draft' USING ERRCODE = 'CB409';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignments_points_guard BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION app.tg_assignment_points_guard();

-- Questions, options and keys are frozen once any student has started the quiz.
CREATE FUNCTION app.tg_quiz_structure_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quiz uuid; v_row record;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_TABLE_NAME = 'quiz_questions' THEN
    v_quiz := v_row.quiz_id;
  ELSE
    v_quiz := app.question_quiz(v_row.question_id);
  END IF;
  IF NOT app.is_system() AND EXISTS (SELECT 1 FROM quiz_attempts WHERE quiz_id = v_quiz) THEN
    RAISE EXCEPTION 'Questions cannot change after students have started this quiz' USING ERRCODE = 'CB409';
  END IF;
  RETURN v_row;
END $$;
CREATE TRIGGER quiz_questions_guard BEFORE INSERT OR UPDATE OR DELETE ON quiz_questions
  FOR EACH ROW EXECUTE FUNCTION app.tg_quiz_structure_guard();
CREATE TRIGGER quiz_options_guard BEFORE INSERT OR UPDATE OR DELETE ON quiz_options
  FOR EACH ROW EXECUTE FUNCTION app.tg_quiz_structure_guard();
CREATE TRIGGER quiz_answer_keys_guard BEFORE INSERT OR UPDATE OR DELETE ON quiz_answer_keys
  FOR EACH ROW EXECUTE FUNCTION app.tg_quiz_structure_guard();

-- ---------------------------------------------------------------- submissions: deadlines, attempts, ownership
CREATE FUNCTION app.tg_submissions_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a assignments%ROWTYPE; v_next integer;
BEGIN
  SELECT * INTO a FROM assignments WHERE id = NEW.assignment_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found' USING ERRCODE = 'CB404';
  END IF;

  IF NOT app.is_system() THEN
    IF NEW.student_id IS DISTINCT FROM app.uid() THEN
      RAISE EXCEPTION 'You can only submit your own work' USING ERRCODE = 'CB403';
    END IF;
    NEW.submitted_at := now();
  END IF;

  IF a.status <> 'published' OR app.course_status(a.course_id) <> 'published' THEN
    RAISE EXCEPTION 'This assignment is not accepting submissions' USING ERRCODE = 'CB422';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM enrollments WHERE course_id = a.course_id AND user_id = NEW.student_id AND status = 'active') THEN
    RAISE EXCEPTION 'You are not enrolled in this course' USING ERRCODE = 'CB403';
  END IF;
  IF NEW.submitted_at > coalesce(a.late_until, a.due_at) THEN
    RAISE EXCEPTION 'The submission deadline has passed' USING ERRCODE = 'CB422';
  END IF;
  NEW.is_late := NEW.submitted_at > a.due_at;

  IF NEW.body IS NOT NULL AND length(btrim(NEW.body)) = 0 THEN NEW.body := NULL; END IF;
  IF a.submission_type = 'text' AND (NEW.body IS NULL OR NEW.file_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This assignment accepts a written response only' USING ERRCODE = 'CB422';
  END IF;
  IF a.submission_type = 'file' AND NEW.file_id IS NULL THEN
    RAISE EXCEPTION 'This assignment requires a file upload' USING ERRCODE = 'CB422';
  END IF;
  IF NEW.body IS NULL AND NEW.file_id IS NULL THEN
    RAISE EXCEPTION 'Add a written response or a file before submitting' USING ERRCODE = 'CB422';
  END IF;
  IF NEW.file_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM files WHERE id = NEW.file_id AND owner_id = NEW.student_id
         AND purpose = 'submission' AND course_id = a.course_id) THEN
    RAISE EXCEPTION 'The attached file is not valid for this submission' USING ERRCODE = 'CB422';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('sub:' || NEW.assignment_id::text || NEW.student_id::text, 0));
  SELECT coalesce(max(attempt), 0) + 1 INTO v_next FROM submissions
   WHERE assignment_id = NEW.assignment_id AND student_id = NEW.student_id;
  IF v_next > a.max_attempts THEN
    RAISE EXCEPTION 'You have used all % submission attempts', a.max_attempts USING ERRCODE = 'CB422';
  END IF;
  NEW.attempt := v_next;
  RETURN NEW;
END $$;
CREATE TRIGGER submissions_guard BEFORE INSERT ON submissions
  FOR EACH ROW EXECUTE FUNCTION app.tg_submissions_guard();

-- ---------------------------------------------------------------- grades: bounds, grader identity, versioning
CREATE FUNCTION app.tg_grades_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a assignments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM assignments WHERE id = NEW.assignment_id;
  IF TG_OP = 'UPDATE' AND (NEW.assignment_id <> OLD.assignment_id OR NEW.student_id <> OLD.student_id) THEN
    RAISE EXCEPTION 'A grade cannot be moved to another assignment or student' USING ERRCODE = 'CB422';
  END IF;
  IF NEW.score > a.points_possible THEN
    RAISE EXCEPTION 'Score cannot be higher than the % points available', a.points_possible USING ERRCODE = 'CB422';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM enrollments WHERE course_id = a.course_id AND user_id = NEW.student_id) THEN
    RAISE EXCEPTION 'This student is not enrolled in the course' USING ERRCODE = 'CB422';
  END IF;
  IF NOT app.is_system() THEN
    NEW.graded_by := app.uid();
    IF TG_OP = 'INSERT' OR NEW.score IS DISTINCT FROM OLD.score OR NEW.feedback IS DISTINCT FROM OLD.feedback THEN
      NEW.graded_at := now();
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER grades_guard BEFORE INSERT OR UPDATE ON grades
  FOR EACH ROW EXECUTE FUNCTION app.tg_grades_guard();

-- ---------------------------------------------------------------- quiz answers: only while the attempt is open
CREATE FUNCTION app.tg_quiz_answers_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE att quiz_attempts%ROWTYPE; v_kind text; v_bad integer;
BEGIN
  SELECT * INTO att FROM quiz_attempts WHERE id = NEW.attempt_id;
  IF NOT app.is_system() THEN
    IF att.student_id IS DISTINCT FROM app.uid() THEN
      RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'CB404';
    END IF;
    IF att.status <> 'in_progress' OR now() > att.deadline_at THEN
      RAISE EXCEPTION 'This attempt is closed' USING ERRCODE = 'CB422';
    END IF;
    NEW.is_correct := NULL;
    NEW.points_awarded := NULL;
  END IF;

  SELECT kind INTO v_kind FROM quiz_questions WHERE id = NEW.question_id AND quiz_id = att.quiz_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question does not belong to this quiz' USING ERRCODE = 'CB422';
  END IF;
  NEW.selected_option_ids := ARRAY(SELECT DISTINCT unnest(NEW.selected_option_ids));
  SELECT count(*) INTO v_bad FROM unnest(NEW.selected_option_ids) s(id)
   WHERE NOT EXISTS (SELECT 1 FROM quiz_options o WHERE o.id = s.id AND o.question_id = NEW.question_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Invalid answer option' USING ERRCODE = 'CB422';
  END IF;
  IF v_kind = 'single' AND cardinality(NEW.selected_option_ids) > 1 THEN
    RAISE EXCEPTION 'Choose only one answer' USING ERRCODE = 'CB422';
  END IF;
  IF v_kind = 'short' THEN
    NEW.selected_option_ids := '{}';
  ELSE
    NEW.text_answer := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER quiz_answers_guard BEFORE INSERT OR UPDATE ON quiz_answers
  FOR EACH ROW EXECUTE FUNCTION app.tg_quiz_answers_guard();

-- =====================================================================================
-- Trusted operations (SECURITY DEFINER)
-- =====================================================================================

-- ---------------------------------------------------------------- authentication
CREATE FUNCTION app.auth_lookup_user(p_email citext)
RETURNS TABLE (id uuid, password_hash text, status text, role text, locked_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, password_hash, status, role, locked_until FROM users WHERE email = p_email
$$;

CREATE FUNCTION app.auth_login_failed(p_user uuid, p_max_attempts integer, p_lock interval)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_locked timestamptz;
BEGIN
  UPDATE users SET
    failed_login_count = CASE WHEN failed_login_count + 1 >= p_max_attempts THEN 0 ELSE failed_login_count + 1 END,
    locked_until = CASE WHEN failed_login_count + 1 >= p_max_attempts THEN now() + p_lock ELSE locked_until END
  WHERE id = p_user
  RETURNING locked_until INTO v_locked;
  RETURN v_locked;
END $$;

CREATE FUNCTION app.auth_create_session(p_user uuid, p_token_hash bytea, p_csrf text,
                                        p_absolute interval, p_idle interval, p_ip inet, p_user_agent text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user AND status = 'active') THEN
    RAISE EXCEPTION 'Account is not active' USING ERRCODE = 'CB403';
  END IF;
  UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = p_user;
  INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at, idle_expires_at, ip, user_agent)
  VALUES (p_user, p_token_hash, p_csrf, now() + p_absolute, now() + p_idle, p_ip, left(p_user_agent, 300))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Validates a session token, enforces idle + absolute expiry and slides the idle window.
CREATE FUNCTION app.auth_resolve_session(p_token_hash bytea, p_idle interval)
RETURNS TABLE (session_id uuid, user_id uuid, role text, csrf_token text, email text,
               full_name text, preferred_name text, timezone text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM sessions WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN; END IF;
  IF s.expires_at <= now() OR s.idle_expires_at <= now() THEN
    DELETE FROM sessions WHERE id = s.id;
    RETURN;
  END IF;
  IF s.last_seen_at < now() - interval '60 seconds' THEN
    UPDATE sessions SET last_seen_at = now(), idle_expires_at = least(now() + p_idle, sessions.expires_at)
     WHERE id = s.id;
  END IF;
  RETURN QUERY
    SELECT s.id, u.id, u.role, s.csrf_token, u.email::text, u.full_name, u.preferred_name, u.timezone, s.expires_at
      FROM users u WHERE u.id = s.user_id AND u.status = 'active';
END $$;

CREATE FUNCTION app.auth_revoke_session(p_token_hash bytea) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM sessions WHERE token_hash = p_token_hash
$$;

-- Revoke every session for a user (after deactivation or password change). Self or administrator only.
CREATE FUNCTION app.auth_revoke_user_sessions(p_user uuid, p_keep_session uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_user IS DISTINCT FROM app.uid() AND NOT app.is_admin() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = 'CB403';
  END IF;
  DELETE FROM sessions WHERE user_id = p_user AND (p_keep_session IS NULL OR id <> p_keep_session);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE FUNCTION app.auth_create_reset(p_email citext, p_token_hash bytea, p_ttl interval)
RETURNS TABLE (user_id uuid, full_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM users WHERE email = p_email AND status = 'active';
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM password_reset_tokens WHERE password_reset_tokens.user_id = v_user.id AND used_at IS NULL;
  INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
  VALUES (v_user.id, p_token_hash, now() + p_ttl);
  RETURN QUERY SELECT v_user.id, v_user.full_name;
END $$;

CREATE FUNCTION app.auth_consume_reset(p_token_hash bytea, p_new_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t password_reset_tokens%ROWTYPE;
BEGIN
  SELECT * INTO t FROM password_reset_tokens WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR t.used_at IS NOT NULL OR t.expires_at <= now() THEN
    RETURN NULL;
  END IF;
  UPDATE password_reset_tokens SET used_at = now() WHERE id = t.id;
  UPDATE users SET password_hash = p_new_hash, password_changed_at = now(),
                   failed_login_count = 0, locked_until = NULL
   WHERE id = t.user_id AND status = 'active';
  IF NOT FOUND THEN RETURN NULL; END IF;
  DELETE FROM sessions WHERE user_id = t.user_id;
  RETURN t.user_id;
END $$;

CREATE FUNCTION app.get_own_password_hash() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT password_hash FROM users WHERE id = app.uid() AND status = 'active'
$$;

CREATE FUNCTION app.set_own_password(p_new_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'CB403'; END IF;
  UPDATE users SET password_hash = p_new_hash, password_changed_at = now() WHERE id = app.uid();
END $$;

-- ---------------------------------------------------------------- audit (append-only for the API)
CREATE FUNCTION app.audit(p_action text, p_entity_type text, p_entity_id text,
                          p_details jsonb DEFAULT '{}'::jsonb, p_ip inet DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip)
  VALUES (app.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb), p_ip)
$$;

-- ---------------------------------------------------------------- email queue
CREATE FUNCTION app.enqueue_email(p_to citext, p_subject text, p_body text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO email_outbox (to_address, subject, body_text) VALUES (p_to, left(p_subject, 200), left(p_body, 20000))
$$;

-- ---------------------------------------------------------------- notifications (fan-out with authorization)
CREATE FUNCTION app.notify_course(p_course uuid, p_kind text, p_title text, p_body text, p_link text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer; v_pref text;
BEGIN
  IF NOT app.course_staff(p_course) THEN
    RAISE EXCEPTION 'Not allowed to notify this course' USING ERRCODE = 'CB403';
  END IF;
  INSERT INTO notifications (user_id, kind, title, body, link)
  SELECT e.user_id, p_kind, left(p_title, 200), left(p_body, 1000), p_link
    FROM enrollments e JOIN users u ON u.id = e.user_id
   WHERE e.course_id = p_course AND e.status = 'active' AND u.status = 'active';
  GET DIAGNOSTICS n = ROW_COUNT;

  v_pref := CASE p_kind WHEN 'announcement' THEN 'email_announcements'
                        WHEN 'assignment' THEN 'email_deadlines'
                        WHEN 'quiz' THEN 'email_deadlines' END;
  IF v_pref IS NOT NULL THEN
    INSERT INTO email_outbox (to_address, subject, body_text)
    SELECT u.email, left(p_title, 200), left(p_body, 20000)
      FROM enrollments e JOIN users u ON u.id = e.user_id
      LEFT JOIN notification_preferences np ON np.user_id = u.id
     WHERE e.course_id = p_course AND e.status = 'active' AND u.status = 'active'
       AND coalesce(CASE v_pref WHEN 'email_announcements' THEN np.email_announcements
                                ELSE np.email_deadlines END, true);
  END IF;
  RETURN n;
END $$;

CREATE FUNCTION app.notify_student(p_course uuid, p_student uuid, p_kind text, p_title text, p_body text, p_link text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app.course_staff(p_course) THEN
    RAISE EXCEPTION 'Not allowed to notify this student' USING ERRCODE = 'CB403';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM enrollments WHERE course_id = p_course AND user_id = p_student) THEN
    RAISE EXCEPTION 'Student is not enrolled in this course' USING ERRCODE = 'CB422';
  END IF;
  INSERT INTO notifications (user_id, kind, title, body, link)
  VALUES (p_student, p_kind, left(p_title, 200), left(p_body, 1000), p_link);
  IF p_kind = 'grade' THEN
    INSERT INTO email_outbox (to_address, subject, body_text)
    SELECT u.email, left(p_title, 200), left(p_body, 20000)
      FROM users u LEFT JOIN notification_preferences np ON np.user_id = u.id
     WHERE u.id = p_student AND u.status = 'active' AND coalesce(np.email_grades, true);
  END IF;
END $$;

CREATE FUNCTION app.notify_all(p_kind text, p_title text, p_body text, p_link text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF NOT app.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can notify everyone' USING ERRCODE = 'CB403';
  END IF;
  INSERT INTO notifications (user_id, kind, title, body, link)
  SELECT id, p_kind, left(p_title, 200), left(p_body, 1000), p_link FROM users WHERE status = 'active';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------- quizzes: start, score, submit
CREATE FUNCTION app.start_quiz_attempt(p_quiz uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE q quizzes%ROWTYPE; v_uid uuid := app.uid(); v_open quiz_attempts%ROWTYPE; v_count integer; v_id uuid;
BEGIN
  SELECT * INTO q FROM quizzes WHERE id = p_quiz;
  IF NOT FOUND OR v_uid IS NULL OR NOT app.quiz_visible(p_quiz) THEN
    RAISE EXCEPTION 'Quiz not found' USING ERRCODE = 'CB404';
  END IF;
  IF app.my_role() <> 'student' OR NOT EXISTS (
       SELECT 1 FROM enrollments WHERE course_id = q.course_id AND user_id = v_uid AND status = 'active') THEN
    RAISE EXCEPTION 'Only enrolled students can take this quiz' USING ERRCODE = 'CB403';
  END IF;
  IF q.status <> 'published' OR app.course_status(q.course_id) <> 'published' THEN
    RAISE EXCEPTION 'This quiz is not available' USING ERRCODE = 'CB422';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('quiz:' || p_quiz::text || v_uid::text, 0));

  SELECT * INTO v_open FROM quiz_attempts WHERE quiz_id = p_quiz AND student_id = v_uid AND status = 'in_progress';
  IF FOUND THEN
    IF now() <= v_open.deadline_at THEN RETURN v_open.id; END IF;
    PERFORM app._score_attempt(v_open.id);
  END IF;

  IF now() < q.opens_at THEN
    RAISE EXCEPTION 'This quiz opens on %', to_char(q.opens_at AT TIME ZONE 'UTC', 'DD Mon YYYY HH24:MI "UTC"') USING ERRCODE = 'CB422';
  END IF;
  IF now() >= q.closes_at THEN
    RAISE EXCEPTION 'This quiz has closed' USING ERRCODE = 'CB422';
  END IF;
  SELECT count(*) INTO v_count FROM quiz_attempts WHERE quiz_id = p_quiz AND student_id = v_uid;
  IF v_count >= q.max_attempts THEN
    RAISE EXCEPTION 'You have used all your attempts for this quiz' USING ERRCODE = 'CB422';
  END IF;

  INSERT INTO quiz_attempts (quiz_id, student_id, attempt_no, deadline_at)
  VALUES (p_quiz, v_uid, v_count + 1,
          least(q.closes_at, now() + make_interval(mins => coalesce(q.time_limit_minutes, 0)::integer)
                              + CASE WHEN q.time_limit_minutes IS NULL THEN interval '100 years' ELSE interval '0' END))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Internal: scores saved answers against the hidden keys and closes the attempt.
CREATE FUNCTION app._score_attempt(p_attempt uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quiz uuid;
BEGIN
  SELECT quiz_id INTO v_quiz FROM quiz_attempts WHERE id = p_attempt FOR UPDATE;

  UPDATE quiz_answers qa SET
    is_correct = r.correct,
    points_awarded = CASE WHEN r.correct THEN r.points ELSE 0 END
  FROM (
    SELECT a.question_id, q.points,
      CASE q.kind
        WHEN 'short' THEN EXISTS (
          SELECT 1 FROM unnest(coalesce(k.accepted_answers, '{}')) acc
          WHERE lower(btrim(acc)) = lower(btrim(coalesce(a.text_answer, ''))) AND btrim(coalesce(a.text_answer, '')) <> '')
        ELSE cardinality(a.selected_option_ids) > 0 AND
             ARRAY(SELECT x FROM unnest(a.selected_option_ids) x ORDER BY x) =
             ARRAY(SELECT x FROM unnest(coalesce(k.correct_option_ids, '{}')) x ORDER BY x)
      END AS correct
    FROM quiz_answers a
    JOIN quiz_questions q ON q.id = a.question_id
    LEFT JOIN quiz_answer_keys k ON k.question_id = q.id
    WHERE a.attempt_id = p_attempt
  ) r
  WHERE qa.attempt_id = p_attempt AND qa.question_id = r.question_id;

  UPDATE quiz_attempts SET
    status = 'submitted',
    submitted_at = now(),
    score = coalesce((SELECT sum(points_awarded) FROM quiz_answers WHERE attempt_id = p_attempt), 0),
    max_score = coalesce((SELECT sum(points) FROM quiz_questions WHERE quiz_id = v_quiz), 0)
  WHERE id = p_attempt AND status = 'in_progress';
END $$;

CREATE FUNCTION app.submit_quiz_attempt(p_attempt uuid)
RETURNS TABLE (score numeric, max_score numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE att quiz_attempts%ROWTYPE;
BEGIN
  SELECT * INTO att FROM quiz_attempts WHERE id = p_attempt FOR UPDATE;
  IF NOT FOUND OR att.student_id IS DISTINCT FROM app.uid() THEN
    RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'CB404';
  END IF;
  IF att.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This attempt has already been submitted' USING ERRCODE = 'CB409';
  END IF;
  PERFORM app._score_attempt(p_attempt);
  RETURN QUERY SELECT a.score, a.max_score FROM quiz_attempts a WHERE a.id = p_attempt;
END $$;

-- Worker only: closes attempts whose deadline passed (answers saved before the deadline count).
CREATE FUNCTION app.finalize_expired_attempts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM quiz_attempts WHERE status = 'in_progress' AND deadline_at < now() - interval '1 minute'
  LOOP
    PERFORM app._score_attempt(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Worker only: retention policy for expiring operational data.
CREATE FUNCTION app.purge_expired(p_notification_days integer, p_audit_days integer, p_email_days integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s integer; t integer; n integer; a integer; e integer;
BEGIN
  DELETE FROM sessions WHERE expires_at <= now() OR idle_expires_at <= now();
  GET DIAGNOSTICS s = ROW_COUNT;
  DELETE FROM password_reset_tokens WHERE expires_at <= now() - interval '1 day' OR used_at <= now() - interval '1 day';
  GET DIAGNOSTICS t = ROW_COUNT;
  DELETE FROM notifications WHERE created_at < now() - make_interval(days => p_notification_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM audit_logs WHERE created_at < now() - make_interval(days => p_audit_days);
  GET DIAGNOSTICS a = ROW_COUNT;
  DELETE FROM email_outbox WHERE status IN ('sent', 'failed') AND created_at < now() - make_interval(days => p_email_days);
  GET DIAGNOSTICS e = ROW_COUNT;
  RETURN jsonb_build_object('sessions', s, 'reset_tokens', t, 'notifications', n, 'audit_logs', a, 'emails', e);
END $$;

-- =====================================================================================
-- Privileges
-- =====================================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO cbid_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO cbid_app;
REVOKE EXECUTE ON FUNCTION app._score_attempt(uuid), app.finalize_expired_attempts(),
                         app.purge_expired(integer, integer, integer) FROM cbid_app;

GRANT SELECT ON roles, departments, terms, system_settings TO cbid_app;
GRANT INSERT, UPDATE, DELETE ON departments, terms TO cbid_app;
GRANT UPDATE (value, updated_by) ON system_settings TO cbid_app;

GRANT SELECT (id, email, full_name, preferred_name, role, status, department_id, timezone,
              last_login_at, created_at, updated_at) ON users TO cbid_app;
GRANT INSERT (email, password_hash, full_name, preferred_name, role, status, department_id, timezone) ON users TO cbid_app;
GRANT UPDATE (email, full_name, preferred_name, role, status, department_id, timezone) ON users TO cbid_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON courses, course_teachers, enrollments, modules, module_items,
  assignments, quizzes, quiz_questions, quiz_options, quiz_answer_keys, announcements, calendar_events TO cbid_app;
GRANT SELECT, INSERT, DELETE ON files, item_completions TO cbid_app;
GRANT SELECT, INSERT ON submissions TO cbid_app;
GRANT SELECT, INSERT, UPDATE ON grades TO cbid_app;
GRANT SELECT ON quiz_attempts TO cbid_app;
GRANT SELECT, INSERT ON quiz_answers TO cbid_app;
GRANT UPDATE (selected_option_ids, text_answer) ON quiz_answers TO cbid_app;
GRANT SELECT, DELETE ON notifications TO cbid_app;
GRANT UPDATE (read_at) ON notifications TO cbid_app;
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO cbid_app;
GRANT SELECT ON audit_logs TO cbid_app;
-- sessions, password_reset_tokens, email_outbox: no direct grants; trusted functions only.

-- =====================================================================================
-- Row-Level Security (default deny once enabled)
-- =====================================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles','departments','terms','users','sessions','password_reset_tokens','courses',
    'course_teachers','enrollments','files','modules','module_items','item_completions','assignments',
    'submissions','grades','quizzes','quiz_questions','quiz_options','quiz_answer_keys','quiz_attempts',
    'quiz_answers','announcements','notifications','notification_preferences','calendar_events',
    'audit_logs','system_settings','email_outbox']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- reference data: any signed-in user reads; administrators write
CREATE POLICY roles_read ON roles FOR SELECT TO cbid_app USING (app.uid() IS NOT NULL);
CREATE POLICY departments_read ON departments FOR SELECT TO cbid_app USING (app.uid() IS NOT NULL);
CREATE POLICY departments_admin ON departments FOR ALL TO cbid_app USING (app.is_admin()) WITH CHECK (app.is_admin());
CREATE POLICY terms_read ON terms FOR SELECT TO cbid_app USING (app.uid() IS NOT NULL);
CREATE POLICY terms_admin ON terms FOR ALL TO cbid_app USING (app.is_admin()) WITH CHECK (app.is_admin());
CREATE POLICY settings_read ON system_settings FOR SELECT TO cbid_app USING (app.uid() IS NOT NULL);
CREATE POLICY settings_admin ON system_settings FOR UPDATE TO cbid_app USING (app.is_admin()) WITH CHECK (app.is_admin());

-- users
CREATE POLICY users_read ON users FOR SELECT TO cbid_app USING (app.can_view_user(id));
CREATE POLICY users_insert ON users FOR INSERT TO cbid_app WITH CHECK (app.is_admin());
CREATE POLICY users_update ON users FOR UPDATE TO cbid_app
  USING (id = app.uid() OR app.is_admin()) WITH CHECK (id = app.uid() OR app.is_admin());

-- courses
CREATE POLICY courses_read ON courses FOR SELECT TO cbid_app
  USING ((status = 'published' AND app.uid() IS NOT NULL) OR app.course_visible(id));
CREATE POLICY courses_insert ON courses FOR INSERT TO cbid_app WITH CHECK (app.is_admin());
CREATE POLICY courses_update ON courses FOR UPDATE TO cbid_app
  USING (app.course_staff(id)) WITH CHECK (app.course_staff(id));
CREATE POLICY courses_delete ON courses FOR DELETE TO cbid_app USING (app.is_admin() AND status = 'draft');

CREATE POLICY course_teachers_read ON course_teachers FOR SELECT TO cbid_app
  USING (app.course_visible(course_id) OR (app.uid() IS NOT NULL AND app.course_status(course_id) = 'published'));
CREATE POLICY course_teachers_admin ON course_teachers FOR ALL TO cbid_app
  USING (app.is_admin()) WITH CHECK (app.is_admin());

CREATE POLICY enrollments_read ON enrollments FOR SELECT TO cbid_app
  USING (user_id = app.uid() OR app.course_staff(course_id));
CREATE POLICY enrollments_insert ON enrollments FOR INSERT TO cbid_app
  WITH CHECK (app.is_admin() OR (user_id = app.uid() AND app.can_self_enroll(course_id)));
CREATE POLICY enrollments_update ON enrollments FOR UPDATE TO cbid_app
  USING (app.is_admin() OR user_id = app.uid()) WITH CHECK (app.is_admin() OR user_id = app.uid());
CREATE POLICY enrollments_delete ON enrollments FOR DELETE TO cbid_app USING (app.is_admin());

-- files
CREATE POLICY files_read ON files FOR SELECT TO cbid_app USING (app.can_read_file(id));
CREATE POLICY files_insert ON files FOR INSERT TO cbid_app WITH CHECK (
  owner_id = app.uid() AND (
    (purpose = 'submission' AND app.enrolled(course_id) AND app.my_role() = 'student')
    OR (purpose = 'material' AND app.course_writable(course_id))));
CREATE POLICY files_delete ON files FOR DELETE TO cbid_app USING (owner_id = app.uid() OR app.is_admin());

-- content
CREATE POLICY modules_read ON modules FOR SELECT TO cbid_app USING (app.module_visible(id));
CREATE POLICY modules_write ON modules FOR ALL TO cbid_app
  USING (app.course_writable(course_id)) WITH CHECK (app.course_writable(course_id));

CREATE POLICY module_items_read ON module_items FOR SELECT TO cbid_app USING (app.item_visible(id));
CREATE POLICY module_items_write ON module_items FOR ALL TO cbid_app
  USING (app.course_writable(app.module_course(module_id))) WITH CHECK (app.course_writable(app.module_course(module_id)));

CREATE POLICY completions_read ON item_completions FOR SELECT TO cbid_app
  USING (user_id = app.uid() OR app.course_staff(app.item_course(item_id)));
CREATE POLICY completions_insert ON item_completions FOR INSERT TO cbid_app
  WITH CHECK (user_id = app.uid() AND app.item_visible(item_id) AND app.enrolled(app.item_course(item_id)));
CREATE POLICY completions_delete ON item_completions FOR DELETE TO cbid_app USING (user_id = app.uid());

-- assignments, submissions, grades
CREATE POLICY assignments_read ON assignments FOR SELECT TO cbid_app
  USING (app.course_staff(course_id) OR (status = 'published' AND app.learner_can_view(course_id)));
CREATE POLICY assignments_write ON assignments FOR ALL TO cbid_app
  USING (app.course_writable(course_id)) WITH CHECK (app.course_writable(course_id));

CREATE POLICY submissions_read ON submissions FOR SELECT TO cbid_app
  USING (student_id = app.uid() OR app.course_staff(app.assignment_course(assignment_id)));
CREATE POLICY submissions_insert ON submissions FOR INSERT TO cbid_app WITH CHECK (student_id = app.uid());

CREATE POLICY grades_read ON grades FOR SELECT TO cbid_app
  USING ((student_id = app.uid() AND released_at IS NOT NULL) OR app.course_staff(app.assignment_course(assignment_id)));
CREATE POLICY grades_write ON grades FOR INSERT TO cbid_app
  WITH CHECK (app.course_writable(app.assignment_course(assignment_id)));
CREATE POLICY grades_update ON grades FOR UPDATE TO cbid_app
  USING (app.course_writable(app.assignment_course(assignment_id)))
  WITH CHECK (app.course_writable(app.assignment_course(assignment_id)));

-- quizzes
CREATE POLICY quizzes_read ON quizzes FOR SELECT TO cbid_app USING (app.quiz_visible(id));
CREATE POLICY quizzes_write ON quizzes FOR ALL TO cbid_app
  USING (app.course_writable(course_id)) WITH CHECK (app.course_writable(course_id));

-- Students see questions/options only once they have started an attempt.
CREATE POLICY quiz_questions_read ON quiz_questions FOR SELECT TO cbid_app
  USING (app.course_staff(app.quiz_course(quiz_id)) OR (app.quiz_visible(quiz_id) AND app.has_quiz_attempt(quiz_id)));
CREATE POLICY quiz_questions_write ON quiz_questions FOR ALL TO cbid_app
  USING (app.course_writable(app.quiz_course(quiz_id))) WITH CHECK (app.course_writable(app.quiz_course(quiz_id)));

CREATE POLICY quiz_options_read ON quiz_options FOR SELECT TO cbid_app
  USING (app.course_staff(app.quiz_course(app.question_quiz(question_id)))
         OR (app.quiz_visible(app.question_quiz(question_id)) AND app.has_quiz_attempt(app.question_quiz(question_id))));
CREATE POLICY quiz_options_write ON quiz_options FOR ALL TO cbid_app
  USING (app.course_writable(app.quiz_course(app.question_quiz(question_id))))
  WITH CHECK (app.course_writable(app.quiz_course(app.question_quiz(question_id))));

CREATE POLICY quiz_keys_staff ON quiz_answer_keys FOR ALL TO cbid_app
  USING (app.course_staff(app.quiz_course(app.question_quiz(question_id))))
  WITH CHECK (app.course_writable(app.quiz_course(app.question_quiz(question_id))));

CREATE POLICY quiz_attempts_read ON quiz_attempts FOR SELECT TO cbid_app
  USING (student_id = app.uid() OR app.course_staff(app.quiz_course(quiz_id)));

CREATE POLICY quiz_answers_read ON quiz_answers FOR SELECT TO cbid_app
  USING (app.attempt_owner(attempt_id) = app.uid() OR app.course_staff(app.attempt_course(attempt_id)));
CREATE POLICY quiz_answers_insert ON quiz_answers FOR INSERT TO cbid_app
  WITH CHECK (app.attempt_owner(attempt_id) = app.uid());
CREATE POLICY quiz_answers_update ON quiz_answers FOR UPDATE TO cbid_app
  USING (app.attempt_owner(attempt_id) = app.uid()) WITH CHECK (app.attempt_owner(attempt_id) = app.uid());

-- announcements & calendar
CREATE POLICY announcements_read ON announcements FOR SELECT TO cbid_app
  USING ((course_id IS NULL AND app.uid() IS NOT NULL) OR (course_id IS NOT NULL AND app.course_visible(course_id)));
CREATE POLICY announcements_insert ON announcements FOR INSERT TO cbid_app WITH CHECK (
  author_id = app.uid() AND ((course_id IS NULL AND app.is_admin()) OR (course_id IS NOT NULL AND app.course_writable(course_id))));
CREATE POLICY announcements_modify ON announcements FOR UPDATE TO cbid_app
  USING ((course_id IS NULL AND app.is_admin()) OR (course_id IS NOT NULL AND app.course_writable(course_id)))
  WITH CHECK ((course_id IS NULL AND app.is_admin()) OR (course_id IS NOT NULL AND app.course_writable(course_id)));
CREATE POLICY announcements_delete ON announcements FOR DELETE TO cbid_app
  USING ((course_id IS NULL AND app.is_admin()) OR (course_id IS NOT NULL AND app.course_writable(course_id)));

CREATE POLICY events_read ON calendar_events FOR SELECT TO cbid_app
  USING ((course_id IS NULL AND app.uid() IS NOT NULL) OR (course_id IS NOT NULL AND app.course_visible(course_id)));
CREATE POLICY events_write ON calendar_events FOR ALL TO cbid_app
  USING ((course_id IS NULL AND app.is_admin()) OR (course_id IS NOT NULL AND app.course_writable(course_id)))
  WITH CHECK ((course_id IS NULL AND app.is_admin()) OR (course_id IS NOT NULL AND app.course_writable(course_id)));

-- personal data
CREATE POLICY notifications_own ON notifications FOR SELECT TO cbid_app USING (user_id = app.uid());
CREATE POLICY notifications_update ON notifications FOR UPDATE TO cbid_app USING (user_id = app.uid()) WITH CHECK (user_id = app.uid());
CREATE POLICY notifications_delete ON notifications FOR DELETE TO cbid_app USING (user_id = app.uid());
CREATE POLICY prefs_own ON notification_preferences FOR ALL TO cbid_app
  USING (user_id = app.uid()) WITH CHECK (user_id = app.uid());

-- audit log: administrators read; writes only through app.audit()
CREATE POLICY audit_admin_read ON audit_logs FOR SELECT TO cbid_app USING (app.is_admin());
