-- 0006: students may not read quiz questions before starting an attempt (RLS), but they do
-- need to know how many questions and points a quiz has. This exposes the totals only.
CREATE FUNCTION app.quiz_summary(p_quiz uuid)
RETURNS TABLE (question_count integer, total_points numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::integer, coalesce(sum(points), 0)
    FROM quiz_questions
   WHERE quiz_id = p_quiz AND app.quiz_visible(p_quiz)
$$;
REVOKE ALL ON FUNCTION app.quiz_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.quiz_summary(uuid) TO cbid_app;
