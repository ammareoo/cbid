import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Ban } from 'lucide-react';
import { api } from '../../api/client';
import type { Certificate } from '../../api/types';
import { Badge, ConfirmDialog, Dialog, EmptyState, ErrorSummary, Notice, QueryView, SectionTitle, TextAreaField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useCourse } from '../course/CourseLayout';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDate } from '../../utils/format';

interface Learner {
  id: string; fullName: string; email: string; enrollmentStatus: string; progress: number | null;
  submitted: number; assignmentCount: number; gradePercent: number | null; certificateSerial: string | null;
}

export default function CourseCertificates() {
  const { course, isStaff } = useCourse();
  useDocumentTitle(`Certificates · ${course.code}`);
  const qc = useQueryClient();
  const toast = useToast();
  const [issuing, setIssuing] = useState<Learner | null>(null);
  const [revoking, setRevoking] = useState<Certificate | null>(null);
  const [reason, setReason] = useState('');
  const q = useQuery({
    queryKey: ['certificates', 'course', course.id],
    queryFn: () => api.get<{ learners: Learner[]; certificates: Certificate[] }>(`/courses/${course.id}/certificates`),
    enabled: isStaff,
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['certificates'] }); qc.invalidateQueries({ queryKey: ['roster', course.id] }); };
  const issue = useMutation({
    mutationFn: (l: Learner) => api.post<{ id: string; serial: string }>(`/courses/${course.id}/certificates`, { userId: l.id }),
    onSuccess: (r, l) => { toast(`Certificate ${r.serial} issued to ${l.fullName}`); setIssuing(null); refresh(); },
    onError: (e: Error) => { toast(e.message, 'error'); setIssuing(null); },
  });
  const revoke = useMutation({
    mutationFn: (c: Certificate) => api.post(`/certificates/${c.id}/revoke`, { reason }),
    onSuccess: (_r, c) => { toast(`Certificate ${c.serial} revoked`); setRevoking(null); setReason(''); refresh(); },
  });

  if (!isStaff) return <EmptyState title="Only the training team can manage certificates" />;
  const draft = course.status === 'draft';

  return (
    <>
      <SectionTitle title="Certificates"
        lede="Issue a CBID Institute certificate when a learner has completed the course and passed the assessment. Each certificate has a serial number that anyone can check on the public verification page." />
      {draft && <Notice tone="warn"><p>Certificates can be issued once the course is published.</p></Notice>}
      <QueryView q={q}>
        {(d) => {
          const active = new Map(d.certificates.filter((c) => !c.revokedAt).map((c) => [c.userId, c]));
          const revoked = d.certificates.filter((c) => c.revokedAt);
          const eligible = d.learners.filter((l) => l.enrollmentStatus === 'active' || l.enrollmentStatus === 'completed');
          return (
            <div className="stack-lg">
              {eligible.length === 0 ? <EmptyState title="No learners enrolled yet" /> : (
                <div className="table-wrap">
                  <table className="table">
                    <caption className="sr-only">Learners in {course.title} and their certificate status</caption>
                    <thead><tr>
                      <th scope="col">Learner</th>
                      <th scope="col" className="num">Content progress</th>
                      <th scope="col" className="num">Assignments submitted</th>
                      <th scope="col" className="num">Grade</th>
                      <th scope="col">Certificate</th>
                      <th scope="col"><span className="sr-only">Action</span></th>
                    </tr></thead>
                    <tbody>
                      {eligible.map((l) => {
                        const cert = active.get(l.id);
                        return (
                          <tr key={l.id}>
                            <th scope="row">{l.fullName}<span className="meta" style={{ display: 'block', fontWeight: 400 }}>{l.email}</span></th>
                            <td className="num tabular">{l.progress == null ? '–' : `${l.progress}%`}</td>
                            <td className="num tabular">{l.submitted} of {l.assignmentCount}</td>
                            <td className="num tabular">{l.gradePercent == null ? '–' : `${l.gradePercent}%`}</td>
                            <td>{cert
                              ? <span className="stack-sm"><Badge tone="ok" icon={<Award aria-hidden="true" />}>Issued {formatDate(cert.issuedAt)}</Badge><span className="serial meta">{cert.serial}</span></span>
                              : <Badge tone="outline">Not issued</Badge>}</td>
                            <td>{cert ? (
                              <div className="row" style={{ gap: 6 }}>
                                <Link className="btn btn--secondary btn--sm" to={`/certificates/${cert.id}`}>View<span className="sr-only"> certificate for {l.fullName}</span></Link>
                                {course.writable && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRevoking(cert)}>Revoke<span className="sr-only"> certificate for {l.fullName}</span></button>}
                              </div>
                            ) : (
                              <button type="button" className="btn btn--primary btn--sm" disabled={draft} onClick={() => setIssuing(l)}>
                                Issue<span className="sr-only"> certificate to {l.fullName}</span>
                              </button>
                            )}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {revoked.length > 0 && (
                <section className="panel" aria-labelledby="revoked-h">
                  <div className="panel__head"><h3 id="revoked-h">Revoked certificates</h3></div>
                  <ul className="list">
                    {revoked.map((c) => (
                      <li key={c.id} className="row-between" style={{ padding: 'var(--s-3) var(--s-4)' }}>
                        <span><strong>{c.recipientName}</strong> · <span className="serial">{c.serial}</span></span>
                        <span className="meta">Revoked {formatDate(c.revokedAt!)}{c.revokeReason ? `: ${c.revokeReason}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          );
        }}
      </QueryView>
      <ConfirmDialog open={!!issuing} onClose={() => setIssuing(null)} title={`Issue a certificate to ${issuing?.fullName ?? ''}?`}
        confirmLabel="Issue certificate" busy={issue.isPending} onConfirm={() => issuing && issue.mutate(issuing)}
        body={<p>The certificate will show <strong>{issuing?.fullName}</strong> and <strong>{course.code} {course.title}</strong>. The learner is notified and can print it. If it is issued in error you can revoke it, and verification will then show it as not valid.</p>} />
      <Dialog open={!!revoking} onClose={() => { setRevoking(null); setReason(''); }} title={`Revoke certificate ${revoking?.serial ?? ''}?`}
        description="Verification will show this certificate as revoked. The reason is kept for staff and is not shown publicly.">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (revoking) revoke.mutate(revoking); }} noValidate>
          <ErrorSummary error={revoke.error} />
          <TextAreaField label="Reason" hint="At least 3 characters, for example: issued in error." value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
          <div className="form-actions">
            <button className="btn btn--danger" type="submit" disabled={revoke.isPending}><Ban aria-hidden="true" />Revoke certificate</button>
            <button type="button" className="btn btn--secondary" onClick={() => { setRevoking(null); setReason(''); }}>Cancel</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
