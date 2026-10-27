import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout, { FormError } from '../components/layout/AuthLayout';
import TextField from '../components/ui/TextField';
import { authService, toFieldErrors, type FieldErrors } from '../services/auth';
import { isEmail } from '../utils/validation';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isEmail(email)) { setErrors({ email: 'Enter a valid email address.' }); return; }
    setErrors({}); setBusy(true);
    try { await authService.requestPasswordReset(email); setSent(true); } catch (err) { setErrors(toFieldErrors(err)); } finally { setBusy(false); }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your account email." footer={<Link to="/login" className="text-ember underline">Back to log in</Link>}>
      {sent ? (
        <div role="status" className="rounded-lg border border-ok bg-ok/10 p-4 text-sm">
          <p className="font-semibold text-ok">✓ Password reset request submitted.</p>
          <p className="mt-1 text-bark2">This demo build has no backend, so no email is sent.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormError msg={errors.form} />
          <TextField label="Email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
          <button className="btn w-full" disabled={busy}>{busy ? 'Submitting…' : 'Request reset'}</button>
        </form>
      )}
    </AuthLayout>
  );
}
