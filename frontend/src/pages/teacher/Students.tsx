import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, EmptyState, QueryView, SectionTitle, Select } from '../../components/ui';
import { useCourse } from '../course/CourseLayout';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate } from '../../utils/format';

interface RosterRow {
  id: string; fullName: string; email: string; enrollmentStatus: string; enrolledAt: string; progress: number | null;
  submitted: number; assignmentCount: number; gradePercent: number | null; lastSubmissionAt: string | null;
}

type SortKey = 'fullName' | 'progress' | 'gradePercent' | 'submitted';

const SORT_VALUE: Record<string, { key: SortKey; dir: 1 | -1 }> = {
  'fullName:1': { key: 'fullName', dir: 1 },
  'fullName:-1': { key: 'fullName', dir: -1 },
  'progress:-1': { key: 'progress', dir: -1 },
  'progress:1': { key: 'progress', dir: 1 },
  'submitted:-1': { key: 'submitted', dir: -1 },
  'gradePercent:-1': { key: 'gradePercent', dir: -1 },
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function EnrolBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge tone="ok">Active</Badge>;
  if (status === 'completed') return <Badge tone="info">Completed</Badge>;
  return <Badge tone="outline">Withdrawn</Badge>;
}

export default function Students() {
  const { course, isStaff } = useCourse();
  useDocumentTitle(`Learners · ${course.code}`);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fullName', dir: 1 });
  const [filter, setFilter] = useState('');
  const q = useQuery({ queryKey: ['roster', course.id], queryFn: () => api.get<{ items: RosterRow[] }>(`/courses/${course.id}/students`), enabled: isStaff });

  const rows = useMemo(() => {
    const items = (q.data?.items ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase()));
    return [...items].sort((a, b) => {
      const av = a[sort.key] ?? -1;
      const bv = b[sort.key] ?? -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [q.data, sort, filter]);

  const sortSelect = `${sort.key}:${sort.dir}`;

  if (!isStaff) return <EmptyState title="Only the training team can see the class list" />;

  return (
    <div className="course-roster">
      <SectionTitle title="Learners" lede="Enrolment, progress and assignment activity for this course." />

      <div className="courses-controls roster-toolbar">
        <div className="courses-controls__search">
          <Search className="courses-controls__icon" aria-hidden="true" width={18} height={18} />
          <label className="sr-only" htmlFor="roster-filter">Search learners</label>
          <input
            id="roster-filter"
            className="courses-controls__input"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by name…"
            autoComplete="off"
          />
        </div>
        <div className="courses-controls__group">
          <label className="sr-only" htmlFor="roster-sort">Sort learners</label>
          <Select
            id="roster-sort"
            tone="sm"
            aria-label="Sort learners"
            value={sortSelect}
            onChange={(e) => {
              const next = SORT_VALUE[e.target.value];
              if (next) setSort(next);
            }}
          >
            <option value="fullName:1">Name (A–Z)</option>
            <option value="fullName:-1">Name (Z–A)</option>
            <option value="progress:-1">Progress (high first)</option>
            <option value="progress:1">Progress (low first)</option>
            <option value="submitted:-1">Most submissions</option>
            <option value="gradePercent:-1">Grade (high first)</option>
          </Select>
        </div>
      </div>

      <QueryView q={q}>
        {() => rows.length === 0 ? (
          <EmptyState title={filter ? 'No learners match that name' : 'No learners enrolled yet'} />
        ) : (
          <ul className="roster-list" aria-label={`Learners in ${course.title}`}>
            {rows.map((r) => (
              <li key={r.id} className="roster-row">
                <div className="roster-row__person">
                  <span className="roster-row__avatar" aria-hidden="true">{initials(r.fullName)}</span>
                  <div className="roster-row__identity">
                    <p className="roster-row__name">{r.fullName}</p>
                    <p className="roster-row__email">{r.email}</p>
                  </div>
                </div>
                <div className="roster-row__enrol">
                  <EnrolBadge status={r.enrollmentStatus} />
                  <span className="roster-row__since">Since {formatDate(r.enrolledAt)}</span>
                </div>
                <dl className="roster-row__metrics">
                  <div>
                    <dt>Content</dt>
                    <dd className="tabular">{r.progress == null ? '—' : `${r.progress}%`}</dd>
                  </div>
                  <div>
                    <dt>Submitted</dt>
                    <dd className="tabular">{r.submitted}/{r.assignmentCount}</dd>
                  </div>
                  <div>
                    <dt>Grade</dt>
                    <dd className="tabular">{r.gradePercent == null ? '—' : `${r.gradePercent}%`}</dd>
                  </div>
                  <div>
                    <dt>Last work</dt>
                    <dd>{r.lastSubmissionAt ? formatDate(r.lastSubmissionAt) : <span className="muted">None</span>}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </div>
  );
}
