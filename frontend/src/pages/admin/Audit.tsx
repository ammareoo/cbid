import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { AuditEntry, Paged } from '../../api/types';
import { EmptyState, PageHeader, Pagination, QueryView } from '../../components/ui';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime, initials, relative } from '../../utils/format';
import { actionLabel } from './Overview';

const FILTERS: [string, string][] = [
  ['', 'All'],
  ['auth.', 'Sign-in'],
  ['auth.login_failed', 'Failed'],
  ['user.', 'People'],
  ['course.', 'Courses'],
  ['enrollment.', 'Enrolments'],
  ['grade.', 'Grades'],
  ['submission.', 'Work'],
  ['quiz.', 'Quizzes'],
  ['settings.', 'Settings'],
  ['file.', 'Files'],
];

function details(d: Record<string, unknown>) {
  const entries = Object.entries(d);
  if (!entries.length) return null;
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
}

function toneFor(action: string) {
  if (action.includes('failed') || action.includes('revoke') || action.includes('deactivat')) return 'danger';
  if (action.startsWith('auth.')) return 'auth';
  if (action.startsWith('course.') || action.startsWith('enrollment.')) return 'course';
  if (action.startsWith('grade.') || action.startsWith('submission.') || action.startsWith('quiz.')) return 'grade';
  return 'default';
}

function AuditCard({ entry: e }: { entry: AuditEntry }) {
  const tone = toneFor(e.action);
  const detail = details(e.details);
  const who = e.actorName ?? 'System';
  return (
    <article className={`audit-card audit-card--${tone}`}>
      <div className="audit-card__rail" aria-hidden="true" />
      <time className="audit-card__when" dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>
        <span className="audit-card__relative">{relative(e.createdAt)}</span>
        <span className="audit-card__absolute">{formatDateTime(e.createdAt)}</span>
      </time>
      <div className="audit-card__main">
        <div className="audit-card__title-row">
          <span className={`audit-card__pill audit-card__pill--${tone}`}>{actionLabel(e.action)}</span>
          <code className="audit-card__code">{e.action}</code>
        </div>
        {detail && <p className="audit-card__details">{detail}</p>}
        <div className="audit-card__meta">
          <span className="audit-card__who">
            <span className="audit-card__avatar" aria-hidden="true">{initials(who)}</span>
            <span className="audit-card__who-text">
              <span className="audit-card__name">{who}</span>
              {e.actorEmail && <span className="audit-card__email">{e.actorEmail}</span>}
            </span>
          </span>
          <span className="audit-card__facts">
            {e.entityType ? (
              <span className="audit-card__fact">
                <span className="audit-card__fact-label">Target</span>
                <span className="audit-card__fact-value">
                  {e.entityType}
                  {e.entityId && <code>{e.entityId.slice(0, 8)}</code>}
                </span>
              </span>
            ) : null}
            <span className="audit-card__fact">
              <span className="audit-card__fact-label">IP</span>
              <span className="audit-card__fact-value mono">{e.ip ?? '—'}</span>
            </span>
          </span>
        </div>
      </div>
    </article>
  );
}

export default function AdminAudit() {
  useDocumentTitle('Audit log');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['admin', 'audit', action, page],
    queryFn: () => api.get<Paged<AuditEntry>>(`/admin/audit${qs({ action, page, pageSize: 25 })}`),
    placeholderData: (p) => p,
  });
  return (
    <Page>
      <div className="audit-page">
        <PageHeader
          title="Audit log"
          lede="Signed actions across the platform."
        />
        <div className="audit-filters" role="toolbar" aria-label="Filter by area">
          {FILTERS.map(([v, l]) => (
            <button
              key={v || 'all'}
              type="button"
              className={`audit-filter${action === v ? ' is-active' : ''}`}
              aria-pressed={action === v}
              onClick={() => { setAction(v); setPage(1); }}
            >
              {l}
            </button>
          ))}
        </div>
        <QueryView q={q}>
          {(d) => d.items.length === 0 ? (
            <EmptyState title="No entries for this filter" icon={<ScrollText aria-hidden="true" />}>
              Try another area, or choose All to see everything.
            </EmptyState>
          ) : (
            <>
              <ul className="audit-feed" aria-label="Audit entries">
                {d.items.map((e) => (
                  <li key={e.id}><AuditCard entry={e} /></li>
                ))}
              </ul>
              <Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} noun="entries" />
            </>
          )}
        </QueryView>
      </div>
    </Page>
  );
}
