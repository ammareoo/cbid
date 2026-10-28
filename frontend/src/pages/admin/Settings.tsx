import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Building2, Globe2, Mail, Shield } from 'lucide-react';
import { api } from '../../api/client';
import { Checkbox, ErrorSummary, PageHeader, QueryView, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatBytes, formatDateTime, relative } from '../../utils/format';

interface Settings {
  institute_name: string; organisation_name: string; support_email: string; contact_phone: string; contact_address: string;
  website_url: string; self_enrollment_enabled: boolean; maintenance_banner: string;
}
interface Status {
  database: { status: string; latencyMs: number }; redis: string; activeSessions: number; emailPending: number; emailFailed: number;
  openQuizAttempts: number; workers: { worker: string; lastBeat: string }[]; databaseSizeBytes: number; uptimeSeconds: number;
  nodeVersion: string; environment: string;
}

function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <span>{label}</span>
        {hint && <span className="settings-row__hint">{hint}</span>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function StatusLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`status-line${ok ? ' status-line--ok' : ' status-line--bad'}`}>
      <span className="status-line__dot" aria-hidden="true" />
      <span className="sr-only">{ok ? 'OK: ' : 'Issue: '}</span>
      {label}
    </span>
  );
}

function SectionLabel({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="admin-settings__section">
      <span className="admin-settings__section-icon" aria-hidden="true">{icon}</span>
      <span>{title}</span>
    </div>
  );
}

export default function AdminSettings() {
  useDocumentTitle('Settings');
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<{ settings: Settings }>('/admin/settings') });
  const st = useQuery({ queryKey: ['admin', 'status'], queryFn: () => api.get<Status>('/admin/status'), refetchInterval: 30_000 });
  const [f, setF] = useState<Settings | null>(null);
  useEffect(() => { if (s.data) setF(s.data.settings); }, [s.data]);
  const save = useMutation({
    mutationFn: () => api.put('/admin/settings', f),
    onSuccess: () => {
      toast('Settings saved');
      for (const key of [['settings'], ['admin', 'settings'], ['branding']]) qc.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <Page>
      <div className="admin-settings-page">
        <PageHeader
          title="Settings"
          lede="Institute branding, contact details, and platform health."
        />
        <div className="admin-settings">
          <section className="admin-settings__card" aria-labelledby="set-h">
            <header className="admin-settings__card-head">
              <div className="admin-settings__card-icon" aria-hidden="true"><Building2 width={18} height={18} /></div>
              <div>
                <h2 id="set-h">Institute</h2>
                <p>Public identity and learner-facing options.</p>
              </div>
            </header>
            <QueryView q={s}>
              {() => f && (
                <form className="settings-form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate>
                  <ErrorSummary error={save.error} />
                  <SectionLabel icon={<Building2 width={14} height={14} />} title="Identity" />
                  <SettingsRow label="Institute name" hint="Shown in the header, emails and on certificates.">
                    <TextField label="Institute name" value={f.institute_name} onChange={(e) => setF({ ...f, institute_name: e.target.value })} maxLength={120} />
                  </SettingsRow>
                  <SettingsRow label="Parent organisation">
                    <TextField label="Parent organisation" value={f.organisation_name} onChange={(e) => setF({ ...f, organisation_name: e.target.value })} maxLength={120} />
                  </SettingsRow>

                  <SectionLabel icon={<Mail width={14} height={14} />} title="Contact" />
                  <SettingsRow label="Support email" hint="Public: shown on the sign-in page and in every email.">
                    <TextField label="Support email" type="email" value={f.support_email} onChange={(e) => setF({ ...f, support_email: e.target.value })} />
                  </SettingsRow>
                  <SettingsRow label="Contact phone">
                    <TextField label="Contact phone" type="tel" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} maxLength={60} />
                  </SettingsRow>
                  <SettingsRow label="Address">
                    <TextField label="Address" value={f.contact_address} onChange={(e) => setF({ ...f, contact_address: e.target.value })} maxLength={200} />
                  </SettingsRow>
                  <SettingsRow label="Website" hint="Must start with https://">
                    <TextField label="Website" type="url" value={f.website_url} onChange={(e) => setF({ ...f, website_url: e.target.value })} maxLength={200} />
                  </SettingsRow>

                  <SectionLabel icon={<Globe2 width={14} height={14} />} title="Presence" />
                  <SettingsRow label="Notice banner" hint="Shown at the top of every page. Leave empty to hide.">
                    <TextField label="Notice banner (optional)" value={f.maintenance_banner} onChange={(e) => setF({ ...f, maintenance_banner: e.target.value })} maxLength={300} />
                  </SettingsRow>

                  <SectionLabel icon={<Shield width={14} height={14} />} title="Access" />
                  <SettingsRow label="Enrolment" hint="When off, only administrators can enrol learners.">
                    <Checkbox
                      label="Allow self-enrolment from the catalogue"
                      checked={f.self_enrollment_enabled}
                      onChange={(e) => setF({ ...f, self_enrollment_enabled: e.target.checked })}
                    />
                  </SettingsRow>
                  <div className="settings-form__actions">
                    <button className="btn btn--primary" type="submit" disabled={save.isPending}>
                      {save.isPending ? 'Saving…' : 'Save settings'}
                    </button>
                  </div>
                </form>
              )}
            </QueryView>
          </section>

          <aside className="admin-settings__rail" aria-labelledby="stat-h">
            <section className="admin-settings__card admin-settings__status">
              <header className="admin-settings__card-head admin-settings__status-head">
                <div className="admin-settings__card-icon admin-settings__card-icon--teal" aria-hidden="true">
                  <Activity width={18} height={18} />
                </div>
                <div>
                  <h2 id="stat-h">System status</h2>
                  <p>Refreshes every 30 seconds.</p>
                </div>
              </header>
              <div className="admin-settings__status-body">
                <QueryView q={st}>
                  {(x) => {
                    const workerOk = x.workers.length > 0 && x.workers.every((w) => Date.now() - new Date(w.lastBeat).getTime() < 120_000);
                    return (
                      <div className="admin-settings__status-stack">
                        <div className="admin-settings__pulse" aria-label="Key health">
                          <div className="admin-settings__pulse-item">
                            <StatusLine ok={x.database.status === 'ok'} label="Database" />
                            <span className="admin-settings__pulse-sub">{x.database.latencyMs} ms</span>
                          </div>
                          <div className="admin-settings__pulse-item">
                            <StatusLine
                              ok={x.redis === 'ok' || x.redis === 'not_configured'}
                              label={x.redis === 'not_configured' ? 'Cache' : 'Redis'}
                            />
                            <span className="admin-settings__pulse-sub">
                              {x.redis === 'not_configured' ? 'In-memory' : x.redis}
                            </span>
                          </div>
                          <div className="admin-settings__pulse-item">
                            <StatusLine ok={workerOk} label="Worker" />
                            <span className="admin-settings__pulse-sub">
                              {x.workers.length === 0 ? 'Not running' : `Seen ${relative(x.workers[0].lastBeat)}`}
                            </span>
                          </div>
                        </div>
                        <dl className="status-dl">
                          <div className="status-dl__row"><dt>Emails waiting</dt><dd className="tabular">{x.emailPending}{x.emailFailed > 0 ? ` · ${x.emailFailed} failed` : ''}</dd></div>
                          <div className="status-dl__row"><dt>Sessions</dt><dd className="tabular">{x.activeSessions}</dd></div>
                          <div className="status-dl__row"><dt>Open quiz attempts</dt><dd className="tabular">{x.openQuizAttempts}</dd></div>
                          <div className="status-dl__row"><dt>Database size</dt><dd>{formatBytes(x.databaseSizeBytes)}</dd></div>
                          <div className="status-dl__row"><dt>Uptime</dt><dd>{Math.round(x.uptimeSeconds / 60)} min · {x.environment}</dd></div>
                          <div className="status-dl__row"><dt>Node</dt><dd className="tabular">{x.nodeVersion}</dd></div>
                        </dl>
                        <p className="admin-settings__checked meta">Checked {formatDateTime(new Date())}</p>
                      </div>
                    );
                  }}
                </QueryView>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </Page>
  );
}
