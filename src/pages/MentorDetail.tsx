import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DemoBadge, DemoNotice } from '../components/mentorship/Badges';
import Skeleton from '../components/ui/Skeleton';
import { useLoad } from '../hooks/useLoad';
import { careerService } from '../services/career';
import { formatPrice, friendlyPaymentError, mentorTitle, mentorshipApi } from '../services/mentorship';

export default function MentorDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const careerId = useSearchParams()[0].get('career') || undefined; // the career this student came from; the server re-checks it
  const enabled = mentorshipApi.enabled();
  const { data, error, retry } = useLoad(() => mentorshipApi.getMentor(id), [id], enabled);
  const careerName = useLoad(() => careerService.list().then((l) => l.find((c) => c.id === careerId)?.name ?? null), [careerId], !!careerId).data;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { document.title = `${data?.mentor.displayName ?? 'Mentor'} · CareerGraph`; }, [data]);

  // Only the session id is sent. The server looks up the price and currency itself.
  async function book(sessionId: string) {
    setBusy(sessionId); setProblem(null);
    try { await mentorshipApi.createBooking(sessionId, careerId); navigate('/bookings'); }
    catch (e) { setProblem(friendlyPaymentError(e)); setBusy(null); }
  }

  return (
    <div className="animate-rise space-y-6">
      <Link to="/mentors" className="text-sm text-mute underline">← Back to mentors</Link>
      {!enabled && <p className="card-dark" role="status">Mentor booking needs the CareerGraph server, which is not connected in this mode.</p>}
      {error != null && <div className="card-dark" role="alert"><p className="font-semibold">{friendlyPaymentError(error)}</p><button className="btn mt-3" onClick={retry}>Try again</button></div>}
      {enabled && !error && !data && <Skeleton className="h-72" />}
      {data && (
        <>
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-semibold">{mentorTitle(data.mentor)}</h1>{data.mentor.isDemo && <DemoBadge />}</div>
            <p className="text-mute">{data.mentor.expertise.join(' · ')}</p>
            {careerName && <p className="text-sm">Booking for: <strong>{careerName}</strong></p>}
            {!data.mentor.isDemo && <p className="max-w-2xl">{data.mentor.bio}</p>}
          </header>
          {data.mentor.isDemo && <DemoNotice />}
          <section aria-label="Sessions" className="space-y-3">
            <h2 className="text-xl font-semibold">Sessions</h2>
            {problem && <p role="alert" className="text-sm text-bad">{problem} <Link to="/bookings" className="underline">See bookings</Link></p>}
            {data.sessions.length === 0 && <p className="card-dark">No sessions available right now.</p>}
            <ul className="grid gap-3 md:grid-cols-2">
              {data.sessions.map((s) => (
                <li key={s.id} className="card-dark flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2"><h3 className="font-semibold">{s.title}</h3><span className="font-semibold text-ember">{formatPrice(s.price, s.currency)}</span></div>
                  <p className="text-sm text-mute">{s.description}</p>
                  <p className="text-xs text-mute">{s.durationMinutes} minutes</p>
                  <button className="btn mt-auto self-start" disabled={busy !== null} onClick={() => void book(s.id)}>{busy === s.id ? 'Booking…' : 'Book session'}</button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
