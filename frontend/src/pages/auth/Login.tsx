import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { homeFor, useAuth } from '../../auth/AuthProvider';
import { ErrorSummary, TextField } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/misc';
import { AuthLayout } from './AuthLayout';

export default function Login() {
  useDocumentTitle('Sign in');
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<{ email?: string; password?: string }>({});

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const from = (location.state as { from?: string } | null)?.from;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const m = { email: email.trim() ? undefined : 'Enter your email address', password: password ? undefined : 'Enter your password' };
    setMissing(m);
    if (m.email || m.password) return;
    setBusy(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      navigate(from && from.startsWith('/') && !from.startsWith('//') ? from : homeFor(u.role), { replace: true });
    } catch (err) {
      setError(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="auth__panel">
        <header className="auth__panel-head">
          <h1>Sign in</h1>
          <p className="auth__panel-lede">Use the email for your CBID Institute account.</p>
        </header>
        <form className="auth__panel-form" onSubmit={submit} noValidate>
          <ErrorSummary error={error} />
          <TextField
            label="Email address"
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={missing.email}
            autoFocus
          />
          <TextField
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={missing.password}
          />
          <div className="auth__panel-actions">
            <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="auth__panel-forgot">
              <Link to="/forgot-password">Forgot your password?</Link>
            </p>
          </div>
        </form>
      </div>
    </AuthLayout>
  );
}
