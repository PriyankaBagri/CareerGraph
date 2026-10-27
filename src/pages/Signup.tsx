import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { appMode } from '../services/api';
import SetupNotice from '../components/layout/SetupNotice';
import AuthLayout, { FormError } from '../components/layout/AuthLayout';
import TextField from '../components/ui/TextField';
import { useAuth } from '../context/AuthContext';
import { toFieldErrors, type FieldErrors } from '../services/auth';
import { isEmail, PASSWORD_RULES, passwordValid } from '../utils/validation';

export default function Signup() {
  const { signup } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const er: FieldErrors = {};
    if (f.name.trim().length < 2) er.name = 'Enter your name.';
    if (!isEmail(f.email)) er.email = 'Enter a valid email address.';
    if (!passwordValid(f.password)) er.password = 'Password does not meet the requirements below.';
    if (f.confirm !== f.password) er.confirm = 'Passwords do not match.';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try { await signup(f.name, f.email, f.password); } catch (err) { setErrors(toFieldErrors(err)); setBusy(false); }
  }

  return (
    <AuthLayout title="Create your CareerGraph" subtitle="It takes about two minutes to set up." footer={<>Already have an account? <Link to="/login" className="text-ember underline">Log in</Link></>}>
      {appMode() === 'unconfigured' ? <SetupNotice /> : <form onSubmit={submit} noValidate className="space-y-4">
        <FormError msg={errors.form} />
        <TextField label="Name" name="name" autoComplete="name" value={f.name} onChange={set('name')} error={errors.name} />
        <TextField label="Email" name="email" type="email" autoComplete="email" value={f.email} onChange={set('email')} error={errors.email} />
        <TextField label="Password" name="password" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} error={errors.password} />
        <ul className="space-y-1 text-sm" aria-label="Password requirements">
          {PASSWORD_RULES.map((r) => <li key={r.id} className={r.test(f.password) ? 'text-ok' : 'text-bark2'}>{r.test(f.password) ? '✓' : '○'} {r.label}</li>)}
        </ul>
        <TextField label="Confirm password" name="confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} error={errors.confirm} />
        <button className="btn w-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>}
    </AuthLayout>
  );
}
