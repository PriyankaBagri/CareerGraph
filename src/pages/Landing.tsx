import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Landing() {
  const { isAuthenticated } = useAuth();
  return (
    <main className="mx-auto grid min-h-screen max-w-2xl place-items-center px-6 py-12 text-center">
      <div className="animate-rise">
        <p className="text-xl font-semibold">Career<span className="text-ember">Graph</span></p>
        <h1 className="mt-8 text-4xl font-semibold leading-tight sm:text-5xl">Turn your experience into a career intelligence graph.</h1>
        <p className="mx-auto mt-4 max-w-lg text-mute">Connect your skills, experience and evidence to see where you stand, what you're missing, and what to do next.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {isAuthenticated ? <Link to="/dashboard" className="btn">Open dashboard</Link> : <>
            <Link to="/signup" className="btn">Get Started</Link>
            <Link to="/login" className="inline-flex items-center rounded-lg border border-line px-4 py-2 font-semibold hover:bg-white/5">Log in</Link>
          </>}
        </div>
        <section className="mt-12 text-left" aria-labelledby="how-h">
          <h2 id="how-h" className="text-center text-sm font-semibold uppercase tracking-widest text-mute">How it works</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {[['Choose or define a career', 'Pick one from the catalog, start from a template, or build your own with capabilities and skills.'], ['Rate your skills honestly', 'Skills you have not rated stay “not assessed”. They are unknown, never counted as zero.'], ['Add evidence', 'Link projects, courses and work to skills. Evidence you enter is labelled self-reported, never verified.'], ['See readiness, gaps and next actions', 'Every number comes with the reasons behind it and the rules used. No fake scores.']].map(([t, d], i) => (
              <li key={t} className="rounded-xl border border-line bg-panel p-4"><p className="text-xs font-semibold text-ember">Step {i + 1}</p><p className="mt-1 font-semibold">{t}</p><p className="mt-1 text-sm text-mute">{d}</p></li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
