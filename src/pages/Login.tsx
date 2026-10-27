import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import SetupNotice from '../components/layout/SetupNotice';
import AuthLayout, { FormError } from '../components/layout/AuthLayout';
import TextField from '../components/ui/TextField';
import { useAuth } from '../context/AuthContext';
import { appMode } from '../services/api';
import { toFieldErrors, type FieldErrors } from '../services/auth';
import { isEmail } from '../utils/validation';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const er: FieldErrors = {};
    if (!email.trim()) er.email = 'Enter your email address.'; else if (!isEmail(email)) er.email = 'Enter a valid email address.';
    if (!password) er.password = 'Enter your password.';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try { await login(email, password, remember); } catch (err) { setErrors(toFieldErrors(err)); setBusy(false); }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to see your career readiness." footer={<>New to CareerGraph? <Link to="/signup" className="text-ember underline">Create an account</Link></>}>
      {appMode() === 'unconfigured' ? <SetupNotice /> : <form onSubmit={submit} noValidate className="space-y-4">
        <FormError msg={errors.form} />
        <TextField label="Email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-ember" /> Keep me signed in on this device</label>
          <Link to="/forgot-password" className="text-bark2 underline">Forgot password?</Link>
        </div>
        <button className="btn w-full" disabled={busy}>{busy ? 'Logging in…' : errors.form?.startsWith('Could not reach') ? 'Try again' : 'Log in'}</button>
        {appMode() === 'demo' && <p className="text-xs text-bark2" data-testid="demo-credentials">Demo mode (browser-only data, no server). Demo account: alex@example.com / Password1</p>}
      </form>}
    </AuthLayout>
  );
}
