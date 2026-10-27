import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Hourglass } from 'lucide-react';

interface Props { title: string; description?: string; standalone?: boolean }

// Honest placeholder for sections that are not built yet. Never redirects.
export default function ComingNext({ title, description = 'This section is in development.', standalone = false }: Props) {
  useEffect(() => { document.title = `${title} · CareerGraph`; }, [title]);
  return (
    <div className={`animate-rise ${standalone ? 'mx-auto grid min-h-screen max-w-xl place-items-center p-6' : ''}`}>
      <header className="mb-6"><p className="eyebrow">CareerGraph</p><h1 className="text-3xl font-semibold">{title}</h1></header>
      <section className="card-dark max-w-xl" aria-label={`${title} status`}>
        <Hourglass className="mb-3 text-ember" aria-hidden />
        <p className="inline-block rounded-full border border-line px-2 py-0.5 text-xs text-mute">In development · coming soon</p>
        <p className="mt-3 text-mute">{description}</p>
        <Link to="/dashboard" className="mt-5 inline-block text-sm text-ember underline">← Back to dashboard</Link>
      </section>
    </div>
  );
}
