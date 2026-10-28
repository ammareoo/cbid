import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Eye, KeyRound, UserRound } from 'lucide-react';
import { api, setCsrfToken } from '../../api/client';
import { roleLabel, useAuth } from '../../auth/AuthProvider';
import { ErrorSummary, QueryView, SelectField, TextField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { Page } from '../../layouts/AppShell';
import { useDocumentTitle } from '../../hooks/misc';
import { initials } from '../../utils/format';
import { TeacherAvatar } from '../../components/CourseMedia';
import { usePreferences, type DisplayPrefs } from '../../hooks/usePreferences';

interface Profile {
  id: string; email: string; fullName: string; preferredName: string | null;
  role: 'student' | 'teacher' | 'admin'; timezone: string; lastLoginAt: string | null; departmentName: string | null;
}
interface Prefs { emailAnnouncements: boolean; emailGrades: boolean; emailDeadlines: boolean }

type Section = 'profile' | 'display' | 'password' | 'email';

const ZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'America/Toronto', 'Asia/Kolkata', 'UTC'];

const NAV: { id: Section; label: string; icon: typeof UserRound }[] = [
  { id: 'profile', label: 'Edit profile', icon: UserRound },
  { id: 'display', label: 'Display', icon: Eye },
  { id: 'password', label: 'Password', icon: KeyRound },
  { id: 'email', label: 'Email', icon: Bell },
];

function ProfileHero({ p }: { p: Profile }) {
  const name = p.preferredName || p.fullName;
  return (
    <div className="settings-hero">
      {p.role === 'teacher'
        ? <TeacherAvatar className="teacher-avatar--large settings-hero__avatar" />
        : <span className="avatar settings-hero__avatar" aria-hidden="true">{initials(p.fullName)}</span>}
      <div className="settings-hero__meta">
        <h1 tabIndex={-1} data-page-heading className="settings-hero__name">{name}</h1>
        <p className="settings-hero__sub">{p.email} · {roleLabel[p.role]}</p>
      </div>
    </div>
  );
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
    <form className="settings-form" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} noValidate>
      <ErrorSummary error={m.error} />
      <SettingsRow label="Name">
        <TextField label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required maxLength={120} />
      </SettingsRow>
      <SettingsRow label="Preferred name" hint="Used in greetings and by your trainers.">
        <TextField label="Preferred name" value={preferredName} onChange={(e) => setPreferredName(e.target.value)} maxLength={60} />
      </SettingsRow>
      <SettingsRow label="Email" hint="Contact an administrator to change your email.">
        <TextField label="Email address" value={p.email} readOnly />
      </SettingsRow>
      <SettingsRow label="Time zone" hint="Deadlines are shown in this time zone.">
        <SelectField label="Time zone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {[...new Set([p.timezone, ...ZONES])].map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
        </SelectField>
      </SettingsRow>
      <div className="settings-form__actions">
        <button className="btn btn--primary" type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Submit'}</button>
      </div>
    </form>
  );
}

function DisplaySection() {
  const { prefs, update } = usePreferences();
  const sizes: [DisplayPrefs['textSize'], string][] = [[100, 'Standard'], [112, 'Large'], [125, 'Larger']];
  const themes: [DisplayPrefs['theme'], string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
  return (
    <div className="settings-form">
      <SettingsRow label="Text size">
        <div className="settings-chips" role="radiogroup" aria-label="Text size">
          {sizes.map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={prefs.textSize === v}
              className={`settings-chip${prefs.textSize === v ? ' is-active' : ''}`}
              onClick={() => update({ textSize: v })}>{l}</button>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow label="Colour theme">
        <div className="settings-chips" role="radiogroup" aria-label="Colour theme">
          {themes.map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={prefs.theme === v}
              className={`settings-chip${prefs.theme === v ? ' is-active' : ''}`}
              onClick={() => update({ theme: v })}>{l}</button>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow label="Spacing">
        <label className="check"><input type="checkbox" checked={prefs.spacious} onChange={(e) => update({ spacious: e.target.checked })} />Wider letter and line spacing</label>
      </SettingsRow>
      <p className="settings-note">Saved on this device only.</p>
    </div>
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
    <form className="settings-form" onSubmit={submit} noValidate>
      <ErrorSummary error={m.error} />
      <SettingsRow label="Current">
        <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </SettingsRow>
      <SettingsRow label="New" hint="At least 10 characters.">
        <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </SettingsRow>
      <SettingsRow label="Confirm">
        <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={local} />
      </SettingsRow>
      <div className="settings-form__actions">
        <button className="btn btn--primary" type="submit" disabled={m.isPending || !current || !next}>
          {m.isPending ? 'Changing…' : 'Change password'}
        </button>
      </div>
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
        <form className="settings-form" onSubmit={(e) => { e.preventDefault(); m.mutate(prefs); }}>
          <ErrorSummary error={m.error} />
          <SettingsRow label="Announcements">
            <label className="check"><input type="checkbox" checked={prefs.emailAnnouncements} onChange={(e) => setPrefs({ ...prefs, emailAnnouncements: e.target.checked })} />Course and institute announcements</label>
          </SettingsRow>
          <SettingsRow label="Grades">
            <label className="check"><input type="checkbox" checked={prefs.emailGrades} onChange={(e) => setPrefs({ ...prefs, emailGrades: e.target.checked })} />Released grades and feedback</label>
          </SettingsRow>
          <SettingsRow label="Deadlines">
            <label className="check"><input type="checkbox" checked={prefs.emailDeadlines} onChange={(e) => setPrefs({ ...prefs, emailDeadlines: e.target.checked })} />New assignments and quizzes</label>
          </SettingsRow>
          <p className="settings-note">In-app notifications stay on. Password and account emails are always sent.</p>
          <div className="settings-form__actions">
            <button className="btn btn--primary" type="submit" disabled={m.isPending}>Save</button>
          </div>
        </form>
      )}
    </QueryView>
  );
}

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const [section, setSection] = useState<Section>('profile');
  const q = useQuery({ queryKey: ['me', 'profile'], queryFn: () => api.get<Profile>('/me/profile') });
  const active = NAV.find((n) => n.id === section)!;

  return (
    <Page>
      <QueryView q={q}>
        {(p) => (
          <div className="settings">
            <ProfileHero p={p} />
            <aside className="settings-nav" aria-label="Settings sections">
              <p className="settings-nav__title">Settings</p>
              {NAV.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav__item${section === item.id ? ' is-active' : ''}`}
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <item.icon aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </aside>

            <div className="settings-main">
              <section className="settings-card" aria-labelledby="settings-section-h">
                <header className="settings-card__head">
                  <h2 id="settings-section-h">{active.label}</h2>
                </header>
                {section === 'profile' && <ProfileForm p={p} />}
                {section === 'display' && <DisplaySection />}
                {section === 'password' && <PasswordForm />}
                {section === 'email' && <NotificationPrefs />}
              </section>
            </div>
          </div>
        )}
      </QueryView>
    </Page>
  );
}
