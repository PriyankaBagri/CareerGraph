import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export default function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md animate-rise">
        <Link to="/" className="mb-6 block text-center text-xl font-semibold">Career<span className="text-ember">Graph</span></Link>
        <div className="card">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-bark2">{subtitle}</p>
          <div className="mt-5">{children}</div>
        </div>
        <p className="mt-5 text-center text-sm text-mute">{footer}</p>
      </div>
    </main>
  );
}
export const FormError = ({ msg }: { msg?: string }) => msg ? <p role="alert" className="mb-4 rounded-lg border border-bad bg-bad/10 p-3 text-sm text-bad">⚠ {msg}</p> : null;
