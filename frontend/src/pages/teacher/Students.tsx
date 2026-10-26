import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Badge, EmptyState, QueryView, SectionTitle } from '../../components/ui';
import { useCourse } from '../course/CourseLayout';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate } from '../../utils/format';

interface RosterRow {
  id: string; fullName: string; email: string; enrollmentStatus: string; enrolledAt: string; progress: number | null;
  submitted: number; assignmentCount: number; gradePercent: number | null; lastSubmissionAt: string | null;
}

type SortKey = 'fullName' | 'progress' | 'gradePercent' | 'submitted';

export default function Students() {
  const { course, isStaff } = useCourse();
  useDocumentTitle(`Learners · ${course.code}`);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'fullName', dir: 1 });
  const [filter, setFilter] = useState('');
  const q = useQuery({ queryKey: ['roster', course.id], queryFn: () => api.get<{ items: RosterRow[] }>(`/courses/${course.id}/students`), enabled: isStaff });

  const rows = useMemo(() => {
    const items = (q.data?.items ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase()));
    return [...items].sort((a, b) => {
      const av = a[sort.key] ?? -1; const bv = b[sort.key] ?? -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [q.data, sort, filter]);

  if (!isStaff) return <EmptyState title="Only the training team can see the class list" />;

  const header = (key: SortKey, label: string, numeric = false) => (
    <th scope="col" className={numeric ? 'num' : undefined} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="link-btn" style={{ color: 'inherit', textDecoration: 'none' }}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  return (
    <>
      <SectionTitle title="Learners" lede="Progress counts completed published content. Grades include saved grades whether or not released." />
      <div className="field" style={{ maxWidth: 360, marginBottom: 'var(--s-4)' }}>
        <label htmlFor="roster-filter">Filter by name</label>
        <input id="roster-filter" className="input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <QueryView q={q}>
        {() => rows.length === 0 ? <EmptyState title={filter ? 'No learners match that name' : 'No learners enrolled yet'} /> : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Learners in {course.title}, sortable by column</caption>
              <thead><tr>
                {header('fullName', 'Learner')}
                <th scope="col">Enrolment</th>
                {header('progress', 'Content progress', true)}
                {header('submitted', 'Assignments submitted', true)}
                {header('gradePercent', 'Grade', true)}
                <th scope="col">Last submission</th>
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.fullName}<br /><span className="meta">{r.email}</span></th>
                  <td>{r.enrollmentStatus === 'active' ? <Badge tone="ok">Active</Badge> : r.enrollmentStatus === 'completed' ? <Badge tone="info">Completed</Badge> : <Badge tone="outline">Withdrawn</Badge>}<br /><span className="meta">since {formatDate(r.enrolledAt)}</span></td>
                  <td className="num tabular">{r.progress == null ? '—' : `${r.progress}%`}</td>
                  <td className="num tabular">{r.submitted} / {r.assignmentCount}</td>
                  <td className="num tabular">{r.gradePercent == null ? '—' : `${r.gradePercent}%`}</td>
                  <td>{r.lastSubmissionAt ? formatDate(r.lastSubmissionAt) : <span className="muted">None</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </QueryView>
    </>
  );
}
