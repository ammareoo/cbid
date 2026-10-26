import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { api, qs } from '../../api/client';
import type { Announcement, Paged } from '../../api/types';
import { Badge, EmptyState, PageHeader, Pagination, QueryView } from '../../components/ui';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime } from '../../utils/format';

export function AnnouncementList({ items }: { items: Announcement[] }) {
  return (
    <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((a) => (
        <li key={a.id}>
          <article className="panel" aria-labelledby={`ann-${a.id}`}>
            <div className="panel__body stack-sm">
              <span className="row" style={{ gap: 8 }}>
                {a.courseCode ? <span className="code-tag">{a.courseCode}</span> : <Badge tone="brand">Institute</Badge>}
                <span className="meta">{a.authorName ?? 'CBID Institute'} · <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time></span>
              </span>
              <h2 id={`ann-${a.id}`} style={{ fontSize: 'var(--text-lg)' }}>{a.title}</h2>
              <p style={{ whiteSpace: 'pre-wrap', maxWidth: '70ch' }}>{a.body}</p>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

export default function AnnouncementsFeed() {
  useDocumentTitle('Announcements');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['announcements', 'feed', page], queryFn: () => api.get<Paged<Announcement>>(`/announcements${qs({ page, pageSize: 10 })}`) });
  return (
    <Page>
      <PageHeader title="Announcements" lede="Institute-wide notices and announcements from your courses, newest first." />
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? <EmptyState title="No announcements yet" icon={<Megaphone aria-hidden="true" />} /> : (
          <>
            <AnnouncementList items={d.items} />
            <Pagination page={d.page} totalPages={d.totalPages} total={d.total} onPage={setPage} noun="announcements" />
          </>
        )}
      </QueryView>
    </Page>
  );
}
