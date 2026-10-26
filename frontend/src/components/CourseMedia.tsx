import d1 from '../assets/course-d1.jpg';
import d2 from '../assets/course-d2.jpg';
import d3 from '../assets/course-d3.jpg';
import d4 from '../assets/course-d4.jpg';
import d5 from '../assets/course-d5.jpg';
import d6 from '../assets/d6-login.jpg';
import d7 from '../assets/course-d7.webp';
import teacherPhoto from '../assets/dummy_teacher.jpg';

const coursePhotos = [d1, d2, d3, d4, d5, d6, d7];
const featuredPhotos: Record<string, string> = {
  DET101: d1, IBT201: d2, IET201: d3, DET090: d4,
  CBW101: d5, ILT101: d6, CT301: d7,
};

/** Keep each course's image consistent across the catalogue, dashboard and detail view. */
export function coursePhoto(key: string) {
  if (featuredPhotos[key]) return featuredPhotos[key];
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return coursePhotos[hash % coursePhotos.length]!;
}

export function CourseCover({ courseKey, className = '' }: { courseKey: string; className?: string }) {
  return <img className={`course-cover ${className}`} src={coursePhoto(courseKey)} alt="" loading="lazy" />;
}

export function TeacherAvatar({ className = '' }: { className?: string }) {
  return <img className={`teacher-avatar ${className}`} src={teacherPhoto} alt="" loading="lazy" />;
}
