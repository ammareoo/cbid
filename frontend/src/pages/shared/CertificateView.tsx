import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy, Printer } from 'lucide-react';
import { api } from '../../api/client';
import type { Certificate } from '../../api/types';
import { InstituteLogo, Notice, PageHeader, QueryView } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle, type Branding } from '../../hooks/misc';
import { formatDate } from '../../utils/format';

type Detail = Certificate & { issuedByName: string | null; branding: Branding };

export function verifyUrl(serial: string) {
  return `${window.location.origin}/verify/${serial}`;
}

export default function CertificateView() {
  const { certificateId = '' } = useParams();
  const toast = useToast();
  const q = useQuery({ queryKey: ['certificates', certificateId], queryFn: () => api.get<Detail>(`/certificates/${certificateId}`) });
  useDocumentTitle(q.data ? `Certificate · ${q.data.courseTitle}` : 'Certificate');

  async function copyLink(serial: string) {
    try {
      await navigator.clipboard.writeText(verifyUrl(serial));
      toast('Verification link copied');
    } catch {
      toast('Copying is blocked in this browser. Select the link under the certificate instead.', 'error');
    }
  }

  return (
    <Page>
      <QueryView q={q}>
        {(c) => (
          <div className="stack-lg">
            <div className="no-print">
              <PageHeader crumbs={[{ label: 'Certificates', to: '/certificates' }, { label: c.courseCode }]}
                title={`Certificate: ${c.courseTitle}`}
                lede="Print it or save it as a PDF from the print dialog. Share the verification link so others can check it."
                actions={<>
                  <button type="button" className="btn btn--primary" onClick={() => window.print()}><Printer aria-hidden="true" />Print or save as PDF</button>
                  {!c.revokedAt && <button type="button" className="btn btn--secondary" onClick={() => copyLink(c.serial)}><Copy aria-hidden="true" />Copy verification link</button>}
                </>} />
              {c.revokedAt && <Notice tone="danger"><p>This certificate was revoked on {formatDate(c.revokedAt)}. Verification shows it as not valid.</p></Notice>}
            </div>
            <article className="certificate" aria-label={`Certificate of completion for ${c.recipientName}`}>
              <div className="certificate__logos">
                <InstituteLogo height={76} alt={c.branding.institute_name} />
              </div>
              <p className="certificate__kicker">Certificate of completion</p>
              <p className="certificate__body">This is to certify that</p>
              <p className="certificate__name">{c.recipientName}</p>
              <p className="certificate__body">has successfully completed</p>
              <p className="certificate__course">{c.courseCode} · {c.courseTitle}</p>
              <p className="certificate__body">
                at {c.branding.institute_name}, the Centre of Excellence of {c.branding.organisation_name}, Karachi.
              </p>
              <dl className="certificate__meta">
                <div><dt>Date of issue</dt><dd>{formatDate(c.issuedAt)}</dd></div>
                {c.issuedByName && <div><dt>Issued by</dt><dd>{c.issuedByName}</dd></div>}
                <div><dt>Serial number</dt><dd className="serial">{c.serial}</dd></div>
                <div className="certificate__verify"><dt>Verify at</dt><dd>{verifyUrl(c.serial).replace(/^https?:\/\//, '')}</dd></div>
              </dl>
              {c.revokedAt && <div className="certificate__void" aria-hidden="true"><span>REVOKED</span></div>}
            </article>
          </div>
        )}
      </QueryView>
    </Page>
  );
}
