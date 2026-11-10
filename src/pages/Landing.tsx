import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Landing() {
  const { isAuthenticated } = useAuth();
  return (
    <main className="mx-auto grid min-h-screen max-w-2xl place-items-center px-6 py-12 text-center">
      <div className="animate-rise">
        <p className="text-xl font-semibold">Career<span className="text-ember">Graph</span></p>
        <h1 className="mt-8 text-4xl font-semibold leading-tight sm:text-5xl">Choose a career. See what you're missing. Know what to do next.</h1>
        <p className="mx-auto mt-4 max-w-lg text-mute">CareerGraph shows the skills a career needs, what you already have, and your next step.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {isAuthenticated ? <Link to="/dashboard" className="btn">Open dashboard</Link> : <>
            <Link to="/signup" className="btn">Get Started</Link>
            <Link to="/login" className="inline-flex items-center rounded-lg border border-line px-4 py-2 font-semibold hover:bg-white/5">Log in</Link>
          </>}
        </div>
        <section className="mt-12 text-left" aria-labelledby="how-h">
          <h2 id="how-h" className="text-center text-sm font-semibold uppercase tracking-widest text-mute">How it works</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {[['Choose a career', 'Pick one, or build your own.'], ['Rate your skills', 'Be honest. Skills you skip are not counted as zero.'], ['Add evidence', 'Link projects, courses and work to your skills.'], ['See what to do next', 'Get your readiness, your gaps and clear next steps.']].map(([t, d], i) => (
              <li key={t} className="rounded-xl border border-line bg-panel p-4"><p className="text-xs font-semibold text-ember">Step {i + 1}</p><p className="mt-1 font-semibold">{t}</p><p className="mt-1 text-sm text-mute">{d}</p></li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
