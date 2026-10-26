-- 0004: aggregate counts that RLS would otherwise hide from the caller.
-- These return numbers only, never identities, so they are safe for any signed-in user
-- who can already see the course.

CREATE FUNCTION app.active_enrollment_count(p_course uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN app.uid() IS NULL THEN NULL ELSE
    (SELECT count(*)::integer FROM enrollments e
      WHERE e.course_id = p_course AND e.status = 'active'
        AND EXISTS (SELECT 1 FROM courses c WHERE c.id = p_course
                     AND (c.status = 'published' OR app.course_staff(p_course))))
  END
$$;
REVOKE ALL ON FUNCTION app.active_enrollment_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.active_enrollment_count(uuid) TO cbid_app;
