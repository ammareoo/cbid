import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, List, Search } from 'lucide-react';
import { api } from '../../api/client';
import type { MyCourse } from '../../api/types';
import { useUser } from '../../auth/AuthProvider';
import { CourseCard, CourseListItem } from '../../components/CourseCard';
import { EmptyState, PageHeader, QueryView, Select } from '../../components/ui';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';

type CoursesTab = 'current' | 'archived';
type CoursesView = 'grid' | 'list';
type CoursesSort = 'title-asc' | 'title-desc' | 'code' | 'term' | 'needs-grade' | 'progress';
type CoursesFilter = 'all' | 'needs-grade' | 'draft' | 'published' | 'has-deadline' | 'in-progress';

const VIEW_KEY = 'cbid-courses-view';

function readView(): CoursesView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function matchesSearch(c: MyCourse, q: string) {
  if (!q) return true;
  const hay = `${c.code} ${c.title} ${c.termName} ${c.summary}`.toLowerCase();
  return hay.includes(q);
}

function matchesFilter(c: MyCourse, filter: CoursesFilter, teacher: boolean) {
  switch (filter) {
    case 'all':
      return true;
    case 'needs-grade':
      return (c.needsGrading ?? 0) > 0;
    case 'draft':
      return c.status === 'draft';
    case 'published':
      return c.status === 'published';
    case 'has-deadline':
      return !teacher && Boolean(c.nextDueAt);
    case 'in-progress':
      return !teacher && (c.progress ?? 0) > 0 && (c.progress ?? 0) < 100;
    default:
      return true;
  }
}

function sortCourses(items: MyCourse[], sort: CoursesSort, teacher: boolean) {
  const next = [...items];
  const byTitle = (a: MyCourse, b: MyCourse) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  switch (sort) {
    case 'title-desc':
      next.sort((a, b) => -byTitle(a, b));
      break;
    case 'code':
      next.sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: 'base' }));
      break;
    case 'term':
      next.sort((a, b) => a.termName.localeCompare(b.termName, undefined, { sensitivity: 'base' }) || byTitle(a, b));
      break;
    case 'needs-grade':
      if (teacher) {
        next.sort((a, b) => (b.needsGrading ?? 0) - (a.needsGrading ?? 0) || byTitle(a, b));
      } else {
        next.sort(byTitle);
      }
      break;
    case 'progress':
      if (!teacher) {
        next.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0) || byTitle(a, b));
      } else {
        next.sort(byTitle);
      }
      break;
    default:
      next.sort(byTitle);
  }
  return next;
}

function visibleCourses(baseList: MyCourse[], searchQ: string, filter: CoursesFilter, sort: CoursesSort, teacher: boolean) {
  const filtered = baseList.filter((c) => matchesSearch(c, searchQ) && matchesFilter(c, filter, teacher));
  return sortCourses(filtered, sort, teacher);
}

function CourseResults({ items, teacher, view }: { items: MyCourse[]; teacher: boolean; view: CoursesView }) {
  if (view === 'list') {
    return (
      <ul className="course-list" data-view="list">
        {items.map((c) => (
          <li key={c.id}><CourseListItem course={c} teacher={teacher} /></li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="course-grid" data-view="grid">
      {items.map((c) => (
        <li key={c.id}><CourseCard course={c} teacher={teacher} /></li>
      ))}
    </ul>
  );
}

export default function MyCourses() {
  useDocumentTitle('My courses');
  const user = useUser();
  const [tab, setTab] = useState<CoursesTab>('current');
  const [view, setView] = useState<CoursesView>(readView);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CoursesSort>('title-asc');
  const [filter, setFilter] = useState<CoursesFilter>('all');
  const q = useQuery({ queryKey: ['courses', 'mine'], queryFn: () => api.get<{ items: MyCourse[] }>('/courses?scope=mine') });
  const isTeacher = user.role === 'teacher';
  const items = q.data?.items ?? [];
  const current = items.filter((c) => c.status !== 'archived');
  const past = items.filter((c) => c.status === 'archived');
  const hasAny = items.length > 0;
  const searchQ = search.trim().toLowerCase();

  function setViewMode(next: CoursesView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const teacherSortOptions: { value: CoursesSort; label: string }[] = [
    { value: 'title-asc', label: 'Title (A–Z)' },
    { value: 'title-desc', label: 'Title (Z–A)' },
    { value: 'code', label: 'Course code' },
    { value: 'term', label: 'Term' },
    { value: 'needs-grade', label: 'Needs grading first' },
  ];
  const learnerSortOptions: { value: CoursesSort; label: string }[] = [
    { value: 'title-asc', label: 'Title (A–Z)' },
    { value: 'title-desc', label: 'Title (Z–A)' },
    { value: 'code', label: 'Course code' },
    { value: 'term', label: 'Term' },
    { value: 'progress', label: 'Progress (high to low)' },
  ];
  const teacherFilters: { value: CoursesFilter; label: string }[] = [
    { value: 'all', label: 'All courses' },
    { value: 'needs-grade', label: 'Needs grading' },
    { value: 'draft', label: 'Draft' },
    { value: 'published', label: 'Published' },
  ];
  const learnerFilters: { value: CoursesFilter; label: string }[] = [
    { value: 'all', label: 'All courses' },
    { value: 'in-progress', label: 'In progress' },
    { value: 'has-deadline', label: 'Has upcoming deadline' },
  ];

  return (
    <Page>
      <div className="courses-page">
        <PageHeader
          title="My courses"
          actions={(
            <div className="courses-header-actions">
              {hasAny && (
                <div className="courses-tabs" role="tablist" aria-label="Course list">
                  <button
                    type="button"
                    role="tab"
                    id="courses-tab-current"
                    aria-selected={tab === 'current'}
                    aria-controls="courses-panel-current"
                    className={`courses-tabs__tab${tab === 'current' ? ' is-active' : ''}`}
                    onClick={() => setTab('current')}
                  >
                    Current
                    <span className="courses-tabs__count">{current.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="courses-tab-archived"
                    aria-selected={tab === 'archived'}
                    aria-controls="courses-panel-archived"
                    className={`courses-tabs__tab${tab === 'archived' ? ' is-active' : ''}`}
                    onClick={() => setTab('archived')}
                  >
                    Archived
                    <span className="courses-tabs__count">{past.length}</span>
                  </button>
                </div>
              )}
              {!isTeacher && <Link className="btn btn--secondary btn--sm" to="/catalogue">Browse catalogue</Link>}
            </div>
          )}
        />

        <QueryView q={q} loadingLabel="Loading your courses">
          {(d) => {
            const cur = d.items.filter((c) => c.status !== 'archived');
            const arc = d.items.filter((c) => c.status === 'archived');
            if (d.items.length === 0) {
              return (
                <EmptyState
                  title={isTeacher ? 'No courses assigned to you yet' : 'You have not joined any courses yet'}
                  action={!isTeacher ? <Link className="btn btn--primary" to="/catalogue">Find a course</Link> : undefined}
                >
                  {isTeacher ? 'An administrator assigns trainers to courses.' : 'Open courses in the catalogue let you enrol yourself.'}
                </EmptyState>
              );
            }

            const panelId = tab === 'current' ? 'courses-panel-current' : 'courses-panel-archived';
            const baseList = tab === 'current' ? cur : arc;
            const list = visibleCourses(baseList, searchQ, filter, sort, isTeacher);

            return (
              <>
                <div className="courses-controls">
                  <div className="courses-controls__search">
                    <Search className="courses-controls__icon" aria-hidden="true" width={18} height={18} />
                    <label className="sr-only" htmlFor="courses-search">Search courses</label>
                    <input
                      id="courses-search"
                      className="courses-controls__input"
                      type="search"
                      value={search}
                      placeholder="Search courses"
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="courses-controls__group">
                    <label className="sr-only" htmlFor="courses-filter">Filter</label>
                    <Select
                      id="courses-filter"
                      tone="sm"
                      aria-label="Filter courses"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value as CoursesFilter)}
                    >
                      {(isTeacher ? teacherFilters : learnerFilters).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="courses-controls__group">
                    <label className="sr-only" htmlFor="courses-sort">Sort</label>
                    <Select
                      id="courses-sort"
                      tone="sm"
                      aria-label="Sort courses"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as CoursesSort)}
                    >
                      {(isTeacher ? teacherSortOptions : learnerSortOptions).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="courses-controls__view" role="group" aria-label="Layout">
                    <button
                      type="button"
                      className={view === 'grid' ? 'is-active' : undefined}
                      aria-pressed={view === 'grid'}
                      onClick={() => setViewMode('grid')}
                    >
                      <LayoutGrid aria-hidden="true" width={17} height={17} />
                      <span className="sr-only">Grid</span>
                    </button>
                    <button
                      type="button"
                      className={view === 'list' ? 'is-active' : undefined}
                      aria-pressed={view === 'list'}
                      onClick={() => setViewMode('list')}
                    >
                      <List aria-hidden="true" width={17} height={17} />
                      <span className="sr-only">List</span>
                    </button>
                  </div>
                </div>

                <div
                  role="tabpanel"
                  id={panelId}
                  aria-labelledby={tab === 'current' ? 'courses-tab-current' : 'courses-tab-archived'}
                  className="courses-panel"
                >
                  {tab === 'archived' && (
                    <p className="courses-section__note">Archived courses are read-only. Your grades and feedback remain available.</p>
                  )}
                  {baseList.length === 0 ? (
                    <p className="muted courses-section__empty">
                      {tab === 'current' ? 'No current courses.' : 'No archived courses.'}
                    </p>
                  ) : list.length === 0 ? (
                    <p className="muted courses-section__empty">No courses match your search or filters.</p>
                  ) : (
                    <>
                      {(searchQ || filter !== 'all') && (
                        <p className="courses-results-meta meta">
                          Showing {list.length} of {baseList.length} {tab === 'current' ? 'current' : 'archived'} courses
                        </p>
                      )}
                      <CourseResults items={list} teacher={isTeacher} view={view} />
                    </>
                  )}
                </div>
              </>
            );
          }}
        </QueryView>
      </div>
    </Page>
  );
}
