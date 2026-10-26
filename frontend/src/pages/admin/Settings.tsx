import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Checkbox, ErrorSummary, PageHeader, QueryView, TextField } from '../../components/ui';
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

const Ok = ({ ok, label }: { ok: boolean; label: string }) =>
  ok ? <Badge tone="ok" icon={<CheckCircle2 aria-hidden="true" />}>{label}</Badge> : <Badge tone="danger" icon={<XCircle aria-hidden="true" />}>{label}</Badge>;

export default function AdminSettings() {
  useDocumentTitle('Settings and status');
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
      <PageHeader eyebrow="Administration" title="Settings and status" lede="Institute-wide options and the health of the platform. Secrets and connection details are never shown here." />
      <div className="columns">
        <section className="panel" aria-labelledby="set-h">
          <div className="panel__head"><h2 id="set-h">Institute settings</h2></div>
          <div className="panel__body">
            <QueryView q={s}>
              {() => f && (
                <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate>
                  <ErrorSummary error={save.error} />
                  <TextField label="Institute name" hint="Shown in the header, emails and on certificates." value={f.institute_name} onChange={(e) => setF({ ...f, institute_name: e.target.value })} maxLength={120} />
                  <TextField label="Parent organisation" value={f.organisation_name} onChange={(e) => setF({ ...f, organisation_name: e.target.value })} maxLength={120} />
                  <TextField label="Support email" type="email" hint="Public: shown on the sign-in page and in every email." value={f.support_email} onChange={(e) => setF({ ...f, support_email: e.target.value })} />
                  <TextField label="Contact phone" type="tel" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} maxLength={60} />
                  <TextField label="Address" value={f.contact_address} onChange={(e) => setF({ ...f, contact_address: e.target.value })} maxLength={200} />
                  <TextField label="Website" type="url" hint="Must start with https://" value={f.website_url} onChange={(e) => setF({ ...f, website_url: e.target.value })} maxLength={200} />
                  <TextField label="Notice banner (optional)" hint="Shown at the top of every page, e.g. planned maintenance. Leave empty to hide." value={f.maintenance_banner} onChange={(e) => setF({ ...f, maintenance_banner: e.target.value })} maxLength={300} />
                  <Checkbox label="Allow self-enrolment" hint="When off, only administrators can enrol learners, even in courses marked open." checked={f.self_enrollment_enabled} onChange={(e) => setF({ ...f, self_enrollment_enabled: e.target.checked })} />
                  <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={save.isPending}>Save settings</button></div>
                </form>
              )}
            </QueryView>
          </div>
        </section>
        <section className="panel" aria-labelledby="stat-h">
          <div className="panel__head"><h2 id="stat-h">System status</h2><span className="meta">Refreshes every 30 s</span></div>
          <div className="panel__body">
            <QueryView q={st}>
              {(x) => (
                <div className="stack-sm">
                <dl className="stack-sm" style={{ margin: 0 }}>
                  <div className="row-between"><dt>Database</dt><dd style={{ margin: 0 }}><Ok ok={x.database.status === 'ok'} label={`${x.database.status} · ${x.database.latencyMs} ms`} /></dd></div>
                  <div className="row-between"><dt>Cache and rate limiting</dt><dd style={{ margin: 0 }}>{x.redis === 'not_configured' ? <Badge tone="outline">In-memory</Badge> : <Ok ok={x.redis === 'ok'} label={`Redis ${x.redis}`} />}</dd></div>
                  <div className="row-between"><dt>Background worker</dt><dd style={{ margin: 0 }}>{x.workers.length === 0 ? <Badge tone="danger">Not running</Badge>
                    : x.workers.map((w) => <Ok key={w.worker} ok={Date.now() - new Date(w.lastBeat).getTime() < 120_000} label={`seen ${relative(w.lastBeat)}`} />)}</dd></div>
                  <div className="row-between"><dt>Emails waiting</dt><dd style={{ margin: 0 }} className="tabular">{x.emailPending}{x.emailFailed > 0 && <> · <Badge tone="danger">{x.emailFailed} failed</Badge></>}</dd></div>
                  <div className="row-between"><dt>Signed-in sessions</dt><dd style={{ margin: 0 }} className="tabular">{x.activeSessions}</dd></div>
                  <div className="row-between"><dt>Quiz attempts in progress</dt><dd style={{ margin: 0 }} className="tabular">{x.openQuizAttempts}</dd></div>
                  <div className="row-between"><dt>Database size</dt><dd style={{ margin: 0 }}>{formatBytes(x.databaseSizeBytes)}</dd></div>
                  <div className="row-between"><dt>API uptime</dt><dd style={{ margin: 0 }}>{Math.round(x.uptimeSeconds / 60)} min · {x.environment} · Node {x.nodeVersion}</dd></div>
                </dl>
                <p className="meta">Checked {formatDateTime(new Date())}</p>
                </div>
              )}
            </QueryView>
          </div>
        </section>
      </div>
    </Page>
  );
}
