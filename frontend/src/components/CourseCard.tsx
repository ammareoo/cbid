import { Link } from 'react-router-dom';
import { ChevronRight, Users } from 'lucide-react';
import type { MyCourse } from '../api/types';
import { Badge, ProgressBar } from './ui';
import { coursePhoto, coursePhotoFocus, CourseCover, TeacherAvatar } from './CourseMedia';
import { formatDateTime } from '../utils/format';

function CourseMeta({ course: c }: { course: MyCourse }) {
  if (c.status === 'archived') return <Badge tone="outline">Archived</Badge>;
  if (c.status === 'draft') return <Badge tone="warn">Draft</Badge>;
  return <span className="meta">{c.termName}</span>;
}

/** Compact list row — not a card/grid tile. */
export function CourseListItem({ course: c, teacher }: { course: MyCourse; teacher?: boolean }) {
  return (
    <Link className="course-row" to={`/courses/${c.id}`}>
      <img
        className="course-row__cover"
        src={coursePhoto(c.code || c.id)}
        alt=""
        width={56}
        height={42}
        loading="lazy"
        style={{ objectPosition: coursePhotoFocus(c.code || c.id) }}
      />
      <span className="course-row__main">
        <span className="course-row__meta">
          <span className="code-tag">{c.code}</span>
          <CourseMeta course={c} />
        </span>
        <span className="course-row__title">{c.title}</span>
        {!teacher && c.teachers && (
          <span className="teacher-line meta course-row__teachers"><TeacherAvatar />{c.teachers}</span>
        )}
      </span>
      <span className={`course-row__stats${teacher ? ' course-row__stats--teacher' : ''}`}>
        {teacher ? (
          <>
            <span className="course-row__stat">
              <Users aria-hidden="true" width={15} height={15} />
              {c.studentCount ?? 0} learners
            </span>
            {(c.needsGrading ?? 0) > 0
              ? <Badge tone="warn">{c.needsGrading} to grade</Badge>
              : <Badge tone="ok">Up to date</Badge>}
          </>
        ) : (
          <>
            <span className="course-row__progress">
              <ProgressBar value={c.progress} label="Course progress" compact />
            </span>
            <span className="meta course-row__due">
              {c.nextDueAt ? <>Due {formatDateTime(c.nextDueAt)}</> : 'No deadlines'}
            </span>
          </>
        )}
      </span>
      <ChevronRight className="course-row__chevron" aria-hidden="true" width={18} height={18} />
    </Link>
  );
}

export function CourseCard({ course: c, teacher }: { course: MyCourse; teacher?: boolean }) {
  return (
    <article className="course-card">
      <CourseCover courseKey={c.code || c.id} />
      <div className="course-card__body">
        <div className="course-card__top">
          <span className="code-tag">{c.code}</span>
          <CourseMeta course={c} />
        </div>
        <h3><Link to={`/courses/${c.id}`}>{c.title}</Link></h3>
        {!teacher && c.teachers && <p className="teacher-line meta"><TeacherAvatar />{c.teachers}</p>}
        <div className="course-card__foot">
          {teacher ? (
            <div className="course-card__stats">
              <span className="course-card__stat">
                <Users aria-hidden="true" width={15} height={15} />
                <span>{c.studentCount ?? 0} learners</span>
              </span>
              {(c.needsGrading ?? 0) > 0
                ? <Badge tone="warn">{c.needsGrading} to grade</Badge>
                : <Badge tone="ok">Grading up to date</Badge>}
            </div>
          ) : (
            <>
              <ProgressBar value={c.progress} label="Course progress" />
              <p className="meta">{c.nextDueAt ? <>Next deadline {formatDateTime(c.nextDueAt)}</> : 'No upcoming deadlines'}</p>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
