import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Award } from 'lucide-react';
import { api } from '../../api/client';
import type { Certificate } from '../../api/types';
import { Badge, EmptyState, PageHeader, QueryView } from '../../components/ui';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate } from '../../utils/format';

export default function Certificates() {
  useDocumentTitle('Certificates');
  const q = useQuery({ queryKey: ['certificates', 'mine'], queryFn: () => api.get<{ items: Certificate[] }>('/certificates') });
  return (
    <Page>
      <PageHeader title="Certificates" lede="Certificates from CBID Institute courses you have completed. Each one has a serial number that employers and others can check online." />
      <QueryView q={q}>
        {(d) => d.items.length === 0 ? (
          <EmptyState title="No certificates yet" icon={<Award aria-hidden="true" />}>
            Your trainer issues a certificate when you complete a course and its assessment.
          </EmptyState>
        ) : (
          <ul className="course-grid">
            {d.items.map((c) => (
              <li key={c.id}>
                <article className="course-card" aria-labelledby={`cert-${c.id}`}>
                  <div className="course-card__top">
                    <span className="code-tag">{c.courseCode}</span>
                    {c.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone="ok" icon={<Award aria-hidden="true" />}>Valid</Badge>}
                  </div>
                  <h2 id={`cert-${c.id}`} className="course-card__title">{c.courseTitle}</h2>
                  <p className="meta">Issued {formatDate(c.issuedAt)}</p>
                  <p className="meta">Serial <span className="serial">{c.serial}</span></p>
                  <div className="course-card__foot">
                    <Link className="btn btn--secondary btn--sm" to={`/certificates/${c.id}`}>View and print<span className="sr-only"> certificate for {c.courseTitle}</span></Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Page>
  );
}
