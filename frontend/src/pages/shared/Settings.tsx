import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from '../../api/client';
import { roleLabel, useAuth } from '../../auth/AuthProvider';
import { Checkbox, ErrorSummary, PageHeader, QueryView, SelectField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { formatDateTime } from '../../utils/format';
import { TeacherAvatar } from '../../components/CourseMedia';

interface Profile { id: string; email: string; fullName: string; preferredName: string | null; role: 'student' | 'teacher' | 'admin'; timezone: string; lastLoginAt: string | null; departmentName: string | null }
interface Prefs { emailAnnouncements: boolean; emailGrades: boolean; emailDeadlines: boolean }

const ZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'America/Toronto', 'Asia/Kolkata', 'UTC'];

function ProfileForm({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();
  const [fullName, setFullName] = useState(p.fullName);
  const [preferredName, setPreferredName] = useState(p.preferredName ?? '');
  const [timezone, setTimezone] = useState(p.timezone);
  const m = useMutation({
    mutationFn: () => api.patch('/me/profile', { fullName, preferredName: preferredName.trim() || null, timezone }),
    onSuccess: () => { toast('Profile saved'); qc.invalidateQueries({ queryKey: ['me'] }); refresh(); },
  });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} noValidate>
      {p.role === 'teacher' && <div className="person-line"><TeacherAvatar className="teacher-avatar--large" /><strong>{p.fullName}</strong></div>}
      <ErrorSummary error={m.error} />
      <div className="form-grid">
        <TextField label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required maxLength={120} />
        <TextField label="Preferred name (optional)" hint="Used in greetings and by your trainers." value={preferredName} onChange={(e) => setPreferredName(e.target.value)} maxLength={60} />
        <TextField label="Email address" value={p.email} readOnly hint="Contact an administrator to change your email." />
        <SelectField label="Time zone" hint="Deadlines are shown in this time zone." value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {[...new Set([p.timezone, ...ZONES])].map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
        </SelectField>
      </div>
      <p className="meta">{roleLabel[p.role]}{p.departmentName ? ` · ${p.departmentName}` : ''} · last sign-in {formatDateTime(p.lastLoginAt)}</p>
      <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Save profile'}</button></div>
    </form>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [local, setLocal] = useState<string>();
  const m = useMutation({
    mutationFn: () => api.post<{ csrfToken: string }>('/auth/password/change', { currentPassword: current, newPassword: next }),
    onSuccess: (r) => {
      setCsrfToken(r.csrfToken);
      setCurrent(''); setNext(''); setConfirm('');
      toast('Password changed. Other devices have been signed out.');
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) { setLocal('The new passwords do not match'); return; }
    setLocal(undefined);
    m.mutate();
  }
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <ErrorSummary error={m.error} />
      <div className="form-grid">
        <div className="span-2"><TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <TextField label="New password" type="password" autoComplete="new-password" hint="At least 10 characters." value={next} onChange={(e) => setNext(e.target.value)} />
        <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={local} />
      </div>
      <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={m.isPending || !current || !next}>{m.isPending ? 'Changing…' : 'Change password'}</button></div>
    </form>
  );
}

function NotificationPrefs() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['me', 'prefs'], queryFn: () => api.get<Prefs>('/me/notification-preferences') });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  useEffect(() => { if (q.data) setPrefs(q.data); }, [q.data]);
  const m = useMutation({ mutationFn: (p: Prefs) => api.put('/me/notification-preferences', p), onSuccess: () => toast('Email preferences saved') });
  return (
    <QueryView q={q}>
      {() => prefs && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); m.mutate(prefs); }}>
          <ErrorSummary error={m.error} />
          <fieldset className="field">
            <legend>Email me about</legend>
            <Checkbox label="Course and institute announcements" checked={prefs.emailAnnouncements} onChange={(e) => setPrefs({ ...prefs, emailAnnouncements: e.target.checked })} />
            <Checkbox label="Released grades and feedback" checked={prefs.emailGrades} onChange={(e) => setPrefs({ ...prefs, emailGrades: e.target.checked })} />
            <Checkbox label="New assignments and quizzes" checked={prefs.emailDeadlines} onChange={(e) => setPrefs({ ...prefs, emailDeadlines: e.target.checked })} />
          </fieldset>
          <p className="hint">In-app notifications are always on. Password and account emails are always sent.</p>
          <div className="form-actions"><button className="btn btn--primary" type="submit" disabled={m.isPending}>Save email preferences</button></div>
        </form>
      )}
    </QueryView>
  );
}

export default function SettingsPage() {
  useDocumentTitle('Profile and settings');
  const q = useQuery({ queryKey: ['me', 'profile'], queryFn: () => api.get<Profile>('/me/profile') });
  return (
    <Page>
      <PageHeader title="Profile and settings" lede="Your details, password and how we contact you. Display options (text size, theme) are in the toolbar." />
      <div className="stack-lg" style={{ maxWidth: 820 }}>
        <section className="panel" aria-labelledby="p-h"><div className="panel__head"><h2 id="p-h">Profile</h2></div>
          <div className="panel__body"><QueryView q={q}>{(p) => <ProfileForm p={p} />}</QueryView></div></section>
        <section className="panel" aria-labelledby="pw-h"><div className="panel__head"><h2 id="pw-h">Password</h2></div>
          <div className="panel__body"><PasswordForm /></div></section>
        <section className="panel" aria-labelledby="n-h"><div className="panel__head"><h2 id="n-h">Email notifications</h2></div>
          <div className="panel__body"><NotificationPrefs /></div></section>
      </div>
    </Page>
  );
}
