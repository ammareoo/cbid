import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Award, ChevronRight } from 'lucide-react';
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
          <ul className="my-certs" aria-label="Your certificates">
            {d.items.map((c) => (
              <li key={c.id} className="my-certs__row">
                <div className="my-certs__glyph" aria-hidden="true">
                  <Award />
                </div>
                <div className="my-certs__main">
                  <div className="my-certs__top">
                    <span className="code-tag">{c.courseCode}</span>
                    {c.revokedAt
                      ? <Badge tone="danger">Revoked</Badge>
                      : <Badge tone="ok" icon={<Award aria-hidden="true" />}>Valid</Badge>}
                  </div>
                  <p className="my-certs__title">{c.courseTitle}</p>
                  <p className="my-certs__meta">
                    <span>Issued {formatDate(c.issuedAt)}</span>
                    <span className="my-certs__serial">Serial <span className="serial">{c.serial}</span></span>
                  </p>
                </div>
                <div className="my-certs__actions">
                  <Link className="btn btn--secondary btn--sm" to={`/certificates/${c.id}`}>
                    View and print
                    <span className="sr-only"> certificate for {c.courseTitle}</span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Page>
  );
}
