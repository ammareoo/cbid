import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import type { MyCourse } from '../api/types';
import { Badge, ProgressBar } from './ui';
import { CourseCover, TeacherAvatar } from './CourseMedia';
import { formatDateTime } from '../utils/format';

export function CourseCard({ course: c, teacher }: { course: MyCourse; teacher?: boolean }) {
  return (
    <article className="course-card">
      <CourseCover courseKey={c.code || c.id} />
      <div className="course-card__body">
        <div className="course-card__top">
          <span className="code-tag">{c.code}</span>
          {c.status === 'archived' ? <Badge tone="outline">Archived</Badge> : c.status === 'draft' ? <Badge tone="warn">Draft</Badge> : <span className="meta">{c.termName}</span>}
        </div>
        <h3><Link to={`/courses/${c.id}`}>{c.title}</Link></h3>
        {!teacher && c.teachers && <p className="teacher-line meta"><TeacherAvatar />{c.teachers}</p>}
        <div className="course-card__foot">
          {teacher ? (
            <div className="row meta">
              <span className="row" style={{ gap: 6 }}><Users aria-hidden="true" width={16} height={16} />{c.studentCount ?? 0} learners</span>
              {(c.needsGrading ?? 0) > 0 ? <Badge tone="warn">{c.needsGrading} to grade</Badge> : <Badge tone="ok">Grading up to date</Badge>}
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
