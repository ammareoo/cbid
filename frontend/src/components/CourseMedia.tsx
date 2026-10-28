import h1 from '../assets/course-h1.jpg';
import h2 from '../assets/course-h2.jpg';
import h3 from '../assets/course-h3.jpg';
import h4 from '../assets/course-h4.jpg';
import h5 from '../assets/course-h5.jpg';
import h6 from '../assets/course-h6.jpg';
import h7 from '../assets/course-h7.jpg';
import h8 from '../assets/course-h8.jpg';
import teacherPhoto from '../assets/dummy_teacher.jpg';

/** Prefer face-forward / landscape shots for wide course heroes. */
const coursePhotos = [
  { src: h3, focus: 'center 32%' }, // desk meeting — faces clear
  { src: h4, focus: 'center 38%' }, // brick office — faces clear
  { src: h8, focus: 'center 40%' }, // pier group — faces clear
  { src: h7, focus: 'center 35%' }, // yellow boardroom
  { src: h6, focus: 'center 35%' }, // yellow boardroom (alt)
  { src: h2, focus: 'center 22%' }, // sticky-notes team (portrait — keep heads)
  { src: h5, focus: 'center 18%' }, // table + wheelchair (portrait — keep heads)
  { src: h1, focus: 'center 28%' }, // over-shoulder (faces limited)
];

const featuredByCode: Record<string, (typeof coursePhotos)[number]> = {
  DET101: coursePhotos[0]!, // h3
  IBT201: coursePhotos[1]!, // h4
  IET201: coursePhotos[2]!, // h8
  DET090: coursePhotos[3]!, // h7
  CBW101: coursePhotos[5]!, // h2
  ILT101: coursePhotos[4]!, // h6
  CT301: coursePhotos[6]!,  // h5
};

function photoFor(key: string) {
  if (featuredByCode[key]) return featuredByCode[key];
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return coursePhotos[hash % coursePhotos.length]!;
}

/** Keep each course's image consistent across the catalogue, dashboard and detail view. */
export function coursePhoto(key: string) {
  return photoFor(key).src;
}

/** CSS background-position so faces stay in the wide hero crop. */
export function coursePhotoFocus(key: string) {
  return photoFor(key).focus;
}

export function CourseCover({ courseKey, className = '' }: { courseKey: string; className?: string }) {
  const { src, focus } = photoFor(courseKey);
  return (
    <img
      className={`course-cover ${className}`}
      src={src}
      alt=""
      loading="lazy"
      style={{ objectPosition: focus }}
    />
  );
}

export function TeacherAvatar({ className = '' }: { className?: string }) {
  return <img className={`teacher-avatar ${className}`} src={teacherPhoto} alt="" loading="lazy" />;
}
