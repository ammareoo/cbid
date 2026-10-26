-- 0005: fixes found by the integration test-suite.
--
-- 1) INSERT ... RETURNING evaluates the SELECT policy against the new row. Policies that look the
--    row up again by id through a STABLE helper cannot see a row created in the same statement,
--    so creators were refused. SELECT policies now test the row's own columns first.
DROP POLICY files_read ON files;
CREATE POLICY files_read ON files FOR SELECT TO cbid_app
  USING (owner_id = app.uid() OR app.course_staff(course_id) OR app.can_read_file(id));

DROP POLICY modules_read ON modules;
CREATE POLICY modules_read ON modules FOR SELECT TO cbid_app
  USING (app.course_staff(course_id) OR (published AND app.learner_can_view(course_id)));

DROP POLICY module_items_read ON module_items;
CREATE POLICY module_items_read ON module_items FOR SELECT TO cbid_app
  USING (app.course_staff(app.module_course(module_id)) OR (published AND app.module_visible(module_id)));

DROP POLICY quizzes_read ON quizzes;
CREATE POLICY quizzes_read ON quizzes FOR SELECT TO cbid_app
  USING (app.course_staff(course_id) OR (status = 'published' AND app.learner_can_view(course_id)));

-- 2) The quiz-answer guard ran as SECURITY DEFINER, so it could not tell a student's own write
--    from the trusted scoring function and wiped the computed score. It now runs as the invoker:
--    current_user is cbid_app for direct API writes and cbid_owner inside trusted functions.
CREATE OR REPLACE FUNCTION app.tg_quiz_answers_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE att quiz_attempts%ROWTYPE; v_kind text; v_bad integer;
BEGIN
  SELECT * INTO att FROM quiz_attempts WHERE id = NEW.attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'CB404';
  END IF;

  IF current_user = 'cbid_app' THEN
    IF att.student_id IS DISTINCT FROM app.uid() THEN
      RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'CB404';
    END IF;
    IF att.status <> 'in_progress' OR now() > att.deadline_at THEN
      RAISE EXCEPTION 'This attempt is closed' USING ERRCODE = 'CB422';
    END IF;
    NEW.is_correct := NULL;
    NEW.points_awarded := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    -- trusted scoring: answer content must not change
    NEW.selected_option_ids := OLD.selected_option_ids;
    NEW.text_answer := OLD.text_answer;
    RETURN NEW;
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
