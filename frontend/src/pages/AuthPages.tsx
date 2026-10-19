import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Alert, Button, Card, Field, Input } from '../components/ui';
import { ApiError, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';

function useAuthForm(submit: () => Promise<void>) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await submit();
      navigate('/host');
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setFields(err.fields);
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, fields, onSubmit };
}

export function LoginPage() {
  const { token, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const form = useAuthForm(() => login(email, password));

  if (token) {
    return <Navigate to="/host" replace />;
  }
  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <h1 className="text-2xl font-bold">Sign in to host</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Guests do not need an account, only hosts do.</p>
        <form onSubmit={form.onSubmit} className="mt-6 space-y-4" noValidate>
          <Field label="Email" error={form.fields['email']}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-testid="email" />
          </Field>
          <Field label="Password" error={form.fields['password']}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              data-testid="password"
            />
          </Field>
          {form.error && <Alert tone="error">{form.error}</Alert>}
          <Button type="submit" className="w-full" busy={form.busy} data-testid="login-submit">
            Sign in
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
          New here?{' '}
          <Link to="/register" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Create an account
          </Link>
        </p>
      </Card>
    </div>
  );
}

export function RegisterPage() {
  const { token, register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const form = useAuthForm(() => register(name, email, password));

  if (token) {
    return <Navigate to="/host" replace />;
  }
  return (
    <div className="mx-auto max-w-md py-8">
      <Card>
        <h1 className="text-2xl font-bold">Create your host account</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Free. It takes ten seconds.</p>
        <form onSubmit={form.onSubmit} className="mt-6 space-y-4" noValidate>
          <Field label="Your name" error={form.fields['name']} hint="Shown to participants as the host">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="name" />
          </Field>
          <Field label="Email" error={form.fields['email']}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-testid="email" />
          </Field>
          <Field label="Password" error={form.fields['password']} hint="At least 8 characters">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              data-testid="password"
            />
          </Field>
          {form.error && <Alert tone="error">{form.error}</Alert>}
          <Button type="submit" className="w-full" busy={form.busy} data-testid="register-submit">
            Create account
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
