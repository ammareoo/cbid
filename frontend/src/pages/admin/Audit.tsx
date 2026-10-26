import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import type { AuditEntry, Paged } from '../../api/types';
import { EmptyState, PageHeader, Pagination, QueryView, SelectField } from '../../components/ui';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime } from '../../utils/format';
import { actionLabel } from './Overview';

const FILTERS: [string, string][] = [
  ['', 'All actions'], ['auth.', 'Sign-ins and passwords'], ['auth.login_failed', 'Failed sign-ins'], ['user.', 'People'],
  ['course.', 'Courses'], ['enrollment.', 'Enrolments'], ['grade.', 'Grades'], ['submission.', 'Submissions'],
  ['quiz.', 'Quizzes'], ['settings.', 'Settings'], ['file.', 'Files'],
];

function details(d: Record<string, unknown>) {
  const entries = Object.entries(d);
  if (!entries.length) return null;
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
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
    <Page wide>
      <PageHeader eyebrow="Administration" title="Audit log" lede="An append-only record of privileged and security-relevant actions. Entries cannot be edited or deleted from the application and are kept for two years." />
      <div style={{ maxWidth: 320, marginBottom: 'var(--s-5)' }}>
        <SelectField label="Show" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
      </div>
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title="No entries for this filter" /> : (
          <>
            <div className="table-wrap"><table className="table">
              <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Who</th><th scope="col">Target</th><th scope="col">Details</th><th scope="col">IP</th></tr></thead>
              <tbody>{d.items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{formatDateTime(e.createdAt)}</td>
                  <td><strong>{actionLabel(e.action)}</strong><br /><code className="meta">{e.action}</code></td>
                  <td>{e.actorName ?? <span className="muted">Anonymous or system</span>}{e.actorEmail && <><br /><span className="meta">{e.actorEmail}</span></>}</td>
                  <td>{e.entityType ? <>{e.entityType}<br /><code className="meta">{e.entityId?.slice(0, 8)}</code></> : '—'}</td>
                  <td className="meta" style={{ maxWidth: 320, wordBreak: 'break-word' }}>{details(e.details) ?? '—'}</td>
                  <td className="mono meta">{e.ip ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} noun="entries" />
          </>
        )}
      </QueryView>
    </Page>
  );
}
