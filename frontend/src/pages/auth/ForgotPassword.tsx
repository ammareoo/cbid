import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { api } from '../../api/client';
import { ErrorSummary, Notice, TextField } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/misc';
import { AuthLayout } from './AuthLayout';

export default function ForgotPassword() {
  useDocumentTitle('Reset your password');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setFieldError('Enter an email address like name@example.org'); return; }
    setFieldError(undefined);
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/forgot', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="stack-sm">
        <h1>Reset your password</h1>
        <p className="muted">We will email you a link to choose a new password. The link works once and expires after 30 minutes.</p>
      </div>
      {sent ? (
        <div className="stack">
          <Notice tone="ok"><p><MailCheck aria-hidden="true" width={16} height={16} /> If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your inbox and spam folder.</p></Notice>
          <p><Link to="/login">Back to sign in</Link></p>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <ErrorSummary error={error} />
          <TextField label="Email address" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError} autoFocus />
          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <p><Link to="/login">Back to sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}
