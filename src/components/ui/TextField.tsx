import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props extends InputHTMLAttributes<HTMLInputElement> { label: string; error?: string }

export default function TextField({ label, error, id, name, type, ...rest }: Props) {
  const [show, setShow] = useState(false);
  const fid = id ?? name ?? label;
  const isPw = type === 'password';
  return (
    <div>
      <label htmlFor={fid} className="mb-1 block text-sm font-medium">{label}</label>
      <div className="relative">
        <input id={fid} name={name} type={isPw && show ? 'text' : type} aria-invalid={!!error} aria-describedby={error ? `${fid}-err` : undefined}
          className={`w-full rounded-lg border bg-white px-3 py-2 text-bark placeholder:text-bark2/60 ${error ? 'border-bad' : 'border-sand'} ${isPw ? 'pr-11' : ''}`} {...rest} />
        {isPw && (
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-bark2">
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {error && <p id={`${fid}-err`} role="alert" className="mt-1 text-sm text-bad">⚠ {error}</p>}
    </div>
  );
}
