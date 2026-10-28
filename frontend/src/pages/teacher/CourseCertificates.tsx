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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
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
    <div className="course-certificates">
      <SectionTitle
        title="Certificates"
        lede="Issue completion certificates when learners meet course requirements. Serial numbers can be checked on the public verification page."
      />
      {draft && <Notice tone="warn"><p>Certificates can be issued once the course is published.</p></Notice>}
      <p className="cert-legend">
        <span className="cert-legend__item"><Badge tone="ok" icon={<Award aria-hidden="true" />}>Issued</Badge> active certificate</span>
        <span className="cert-legend__item"><Badge tone="outline">Not issued</Badge> eligible to issue when requirements are met</span>
      </p>
      <QueryView q={q}>
        {(d) => {
          const active = new Map(d.certificates.filter((c) => !c.revokedAt).map((c) => [c.userId, c]));
          const revoked = d.certificates.filter((c) => c.revokedAt);
          const eligible = d.learners.filter((l) => l.enrollmentStatus === 'active' || l.enrollmentStatus === 'completed');
          return (
            <>
              {eligible.length === 0 ? (
                <EmptyState title="No learners enrolled yet" />
              ) : (
                <ul className="roster-list cert-list" aria-label={`Certificate status for learners in ${course.title}`}>
                  {eligible.map((l) => {
                    const cert = active.get(l.id);
                    return (
                      <li key={l.id} className="roster-row cert-row">
                        <div className="roster-row__person">
                          <span className="roster-row__avatar" aria-hidden="true">{initials(l.fullName)}</span>
                          <div className="roster-row__identity">
                            <p className="roster-row__name">{l.fullName}</p>
                            <p className="roster-row__email">{l.email}</p>
                          </div>
                        </div>
                        <dl className="roster-row__metrics cert-row__metrics">
                          <div>
                            <dt>Content</dt>
                            <dd className="tabular">{l.progress == null ? '—' : `${l.progress}%`}</dd>
                          </div>
                          <div>
                            <dt>Submitted</dt>
                            <dd className="tabular">{l.submitted}/{l.assignmentCount}</dd>
                          </div>
                          <div>
                            <dt>Grade</dt>
                            <dd className="tabular">{l.gradePercent == null ? '—' : `${l.gradePercent}%`}</dd>
                          </div>
                        </dl>
                        <div className="cert-row__status">
                          {cert ? (
                            <>
                              <Badge tone="ok" icon={<Award aria-hidden="true" />}>Issued {formatDate(cert.issuedAt)}</Badge>
                              <span className="cert-row__serial serial">{cert.serial}</span>
                            </>
                          ) : (
                            <Badge tone="outline">Not issued</Badge>
                          )}
                        </div>
                        <div className="cert-row__actions">
                          {cert ? (
                            <>
                              <Link className="btn btn--secondary btn--sm" to={`/certificates/${cert.id}`}>
                                View<span className="sr-only"> certificate for {l.fullName}</span>
                              </Link>
                              {course.writable && (
                                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRevoking(cert)}>
                                  Revoke<span className="sr-only"> certificate for {l.fullName}</span>
                                </button>
                              )}
                            </>
                          ) : (
                            <button type="button" className="btn btn--primary btn--sm" disabled={draft} onClick={() => setIssuing(l)}>
                              Issue<span className="sr-only"> certificate to {l.fullName}</span>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {revoked.length > 0 && (
                <section className="cert-revoked" aria-labelledby="revoked-h">
                  <h3 id="revoked-h" className="cert-revoked__title">Revoked certificates</h3>
                  <ul className="cert-revoked-list">
                    {revoked.map((c) => (
                      <li key={c.id} className="cert-revoked-row">
                        <div className="cert-revoked-row__main">
                          <strong>{c.recipientName}</strong>
                          <span className="serial cert-revoked-row__serial">{c.serial}</span>
                        </div>
                        <p className="cert-revoked-row__meta">
                          Revoked {formatDate(c.revokedAt!)}
                          {c.revokeReason ? ` · ${c.revokeReason}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
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
    </div>
  );
}
