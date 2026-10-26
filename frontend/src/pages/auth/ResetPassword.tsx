import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { ErrorSummary, Notice, TextField } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/misc';
import { AuthLayout } from './AuthLayout';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const invite = params.get('invite') === '1';
  useDocumentTitle(invite ? 'Set up your account' : 'Choose a new password');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (password.length < 10) next.password = 'Use at least 10 characters';
    if (confirm !== password) next.confirm = 'The two passwords do not match';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="stack-sm">
        <h1>{invite ? 'Set up your account' : 'Choose a new password'}</h1>
        <p className="muted">Use at least 10 characters. A short phrase of unrelated words is easy to remember and hard to guess.</p>
      </div>
      {!token ? (
        <Notice tone="warn"><p>This page needs the link from your email. <Link to="/forgot-password">Request a new link</Link>.</p></Notice>
      ) : done ? (
        <div className="stack">
          <Notice tone="ok"><p>Your password is set. For your security, you have been signed out everywhere else.</p></Notice>
          <Link className="btn btn--primary" to="/login">Sign in</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <ErrorSummary error={error} />
          <TextField label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoFocus />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
          <p><Link to="/forgot-password">Link expired? Request a new one</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}
