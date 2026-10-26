import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MapPin, Search, UserRound, Users } from 'lucide-react';
import { api, qs } from '../../api/client';
import { DELIVERY_LABEL, type CatalogueCourse, type DeliveryMode, type Paged } from '../../api/types';
import { Badge, ConfirmDialog, EmptyState, PageHeader, Pagination, QueryView } from '../../components/ui';
import { CourseCover, TeacherAvatar } from '../../components/CourseMedia';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDebounced, useDocumentTitle } from '../../hooks/misc';

/** "Employers, HR teams" → "employers, HR teams" (keeps acronyms such as OPD). */
const lowerFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0]!.toLowerCase() + t.slice(1) : t);

export default function Catalogue() {
  useDocumentTitle('Course catalogue');
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<DeliveryMode | ''>('');
  const [page, setPage] = useState(1);
  const term = useDebounced(search.trim(), 300);
  const [confirm, setConfirm] = useState<CatalogueCourse | null>(null);
  const q = useQuery({
    queryKey: ['catalogue', term, mode, page],
    queryFn: () => api.get<Paged<CatalogueCourse>>(`/courses${qs({ scope: 'catalogue', search: term, mode: mode || undefined, page, pageSize: 12 })}`),
    placeholderData: (prev) => prev,
  });
  const enrol = useMutation({
    mutationFn: (c: CatalogueCourse) => api.post(`/courses/${c.id}/enroll`),
    onSuccess: (_r, c) => {
      toast(`You are enrolled in ${c.code}`);
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ['catalogue'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => { toast(e.message, 'error'); setConfirm(null); },
  });

  return (
    <Page>
      <PageHeader title="Course catalogue" lede="CBID Institute training programmes open this term. Courses marked open let you enrol yourself; others are arranged with your organisation by the CBID Institute team." />
      <div className="filters" style={{ marginBottom: 'var(--s-5)' }}>
        <div className="field" style={{ flex: '1 1 320px', maxWidth: 520 }}>
          <label htmlFor="cat-search">Search courses</label>
          <div style={{ position: 'relative' }}>
            <Search aria-hidden="true" width={18} height={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input id="cat-search" className="input" style={{ paddingLeft: 40 }} type="search" value={search} placeholder="Title, code, topic or audience"
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="field" style={{ flex: '0 1 260px' }}>
          <label htmlFor="cat-mode">How it is delivered</label>
          <select id="cat-mode" className="input" value={mode} onChange={(e) => { setMode(e.target.value as DeliveryMode | ''); setPage(1); }}>
            <option value="">All formats</option>
            {(Object.keys(DELIVERY_LABEL) as DeliveryMode[]).map((m) => <option key={m} value={m}>{DELIVERY_LABEL[m]}</option>)}
          </select>
        </div>
      </div>
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title="No courses match your search">Try a broader term, choose all formats, or clear the search.</EmptyState> : (
          <>
            <p className="sr-only" aria-live="polite">{d.total} courses found</p>
            <ul className="course-grid">
              {d.items.map((c) => {
                const full = c.capacity != null && c.enrolledCount >= c.capacity;
                return (
                  <li key={c.id}>
                    <article className="course-card" aria-labelledby={`c-${c.id}`}>
                      <CourseCover courseKey={c.code || c.id} />
                      <div className="course-card__body">
                        <div className="course-card__top">
                          <span className="code-tag">{c.code}</span>
                          {c.isEnrolled ? <Badge tone="ok" icon={<CheckCircle2 aria-hidden="true" />}>Enrolled</Badge>
                            : c.enrollmentOpen ? (full ? <Badge tone="danger">Full</Badge> : <Badge tone="brand">Open for enrolment</Badge>)
                            : <Badge tone="outline">By arrangement</Badge>}
                        </div>
                        <h3 id={`c-${c.id}`}>{c.title}</h3>
                        <p className="muted">{c.summary}</p>
                        {c.audience && <p className="meta row" style={{ gap: 6, alignItems: 'flex-start', flexWrap: 'nowrap' }}><UserRound aria-hidden="true" width={15} height={15} style={{ flex: 'none', marginTop: 3 }} /><span><span className="sr-only">Audience: </span>For {lowerFirst(c.audience)}</span></p>}
                        <p className="meta row" style={{ gap: 6 }}><MapPin aria-hidden="true" width={15} height={15} /><span><span className="sr-only">Delivery: </span>{DELIVERY_LABEL[c.deliveryMode]}</span></p>
                        <div className="course-card__foot">
                          {c.teachers && <p className="teacher-line meta"><TeacherAvatar />{c.teachers}</p>}
                          <p className="meta">{[c.departmentName, c.termName].filter(Boolean).join(' · ')}</p>
                          <p className="meta row" style={{ gap: 6 }}><Users aria-hidden="true" width={15} height={15} />
                            {c.capacity ? `${c.enrolledCount} of ${c.capacity} places taken` : `${c.enrolledCount} enrolled`}</p>
                          <div className="row">
                            {c.isEnrolled ? <Link className="btn btn--secondary btn--sm" to={`/courses/${c.id}`}>Go to course</Link>
                              : c.enrollmentOpen && !full ? (
                                <button type="button" className="btn btn--primary btn--sm" onClick={() => setConfirm(c)}>Enrol<span className="sr-only"> in {c.title}</span></button>
                              ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
            <Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} noun="courses" />
          </>
        )}
      </QueryView>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title={`Enrol in ${confirm?.code ?? ''}?`}
        confirmLabel="Enrol now" busy={enrol.isPending} onConfirm={() => confirm && enrol.mutate(confirm)}
        body={<p>You will join <strong>{confirm?.title}</strong> for {confirm?.termName}. {confirm && confirm.deliveryMode !== 'online' ? 'This course includes sessions or an assessment at CBID Institute in Karachi; tell your trainer about any adjustments you need. ' : ''}You can withdraw later from the course page.</p>} />
    </Page>
  );
}
