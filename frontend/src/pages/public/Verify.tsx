import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ShieldX } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { CertificateVerification } from '../../api/types';
import { ErrorSummary, Loading, Notice, TextField } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate } from '../../utils/format';
import { AuthLayout } from '../auth/AuthLayout';

const SERIAL = /^CBID-\d{4}-[A-HJ-NP-Z2-9]{8}$/;

export default function Verify() {
  useDocumentTitle('Verify a certificate');
  const { serial: fromUrl = '' } = useParams();
  const navigate = useNavigate();
  const [serial, setSerial] = useState(fromUrl);
  const [problem, setProblem] = useState<string>();
  const wanted = fromUrl.trim().toUpperCase();
  const q = useQuery({
    queryKey: ['verify', wanted],
    queryFn: () => api.get<CertificateVerification>(`/verify/${encodeURIComponent(wanted)}`),
    enabled: SERIAL.test(wanted),
    retry: false,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const s = serial.trim().toUpperCase();
    if (!SERIAL.test(s)) { setProblem('Enter the serial exactly as printed, for example CBID-2026-ABCD2345'); return; }
    setProblem(undefined);
    navigate(`/verify/${s}`);
  }

  const notFound = q.error instanceof ApiError && q.error.status === 404;
  return (
    <AuthLayout>
      <div className="stack-sm">
        <p className="eyebrow">Certificate verification</p>
        <h1>Verify a certificate</h1>
        <p className="muted">Check that a CBID Institute certificate is genuine and still valid. Enter the serial number printed on it.</p>
      </div>
      <form className="stack" onSubmit={submit} noValidate>
        <TextField label="Serial number" name="serial" autoComplete="off" spellCheck={false} placeholder="CBID-2026-ABCD2345"
          value={serial} onChange={(e) => setSerial(e.target.value)} error={problem} />
        <button className="btn btn--primary btn--block" type="submit">Check certificate</button>
      </form>
      <div aria-live="polite">
        {q.isFetching && <Loading label="Checking" />}
        {q.data && (q.data.valid ? (
          <div className="notice notice--ok stack-sm">
            <p className="row" style={{ gap: 8, fontWeight: 700 }}><BadgeCheck aria-hidden="true" />Valid certificate</p>
            <dl className="stack-sm" style={{ margin: 0 }}>
              <div><dt className="meta">Awarded to</dt><dd style={{ margin: 0, fontWeight: 700 }}>{q.data.recipientName}</dd></div>
              <div><dt className="meta">Course</dt><dd style={{ margin: 0 }}>{q.data.courseCode} · {q.data.courseTitle}</dd></div>
              <div><dt className="meta">Issued</dt><dd style={{ margin: 0 }}>{formatDate(q.data.issuedAt)} by {q.data.issuer}, {q.data.organisation}</dd></div>
              <div><dt className="meta">Serial</dt><dd style={{ margin: 0 }} className="serial">{q.data.serial}</dd></div>
            </dl>
          </div>
        ) : (
          <div className="notice notice--danger stack-sm">
            <p className="row" style={{ gap: 8, fontWeight: 700 }}><ShieldX aria-hidden="true" />Not valid: this certificate was revoked</p>
            <p>Serial {q.data.serial}, issued to {q.data.recipientName} for {q.data.courseTitle}, was revoked on {formatDate(q.data.revokedAt!)}.</p>
          </div>
        ))}
        {notFound && <Notice tone="warn"><p>No certificate has the serial <span className="serial">{wanted}</span>. Check each character; serials never use the letters I or O or the digits 0 or 1.</p></Notice>}
        {q.error && !notFound && <ErrorSummary error={q.error} />}
      </div>
      <p className="meta"><Link to="/login">Back to sign in</Link></p>
    </AuthLayout>
  );
}
