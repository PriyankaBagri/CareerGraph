import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookingStatusBadge } from '../components/mentorship/Badges';
import Skeleton from '../components/ui/Skeleton';
import { useLoad } from '../hooks/useLoad';
import { startCheckout } from '../services/checkout';
import { formatPrice, friendlyPaymentError, mentorTitle, mentorshipApi } from '../services/mentorship';

export default function Bookings() {
  const enabled = mentorshipApi.enabled();
  const { data, error, retry } = useLoad(() => mentorshipApi.listBookings(), [], enabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { document.title = 'Bookings · CareerGraph'; }, []);
  // Coming back with the browser's Back button can restore this page as it was while redirecting; make the Pay buttons usable again.
  useEffect(() => { const reset = (e: PageTransitionEvent) => { if (e.persisted) setBusy(null); }; window.addEventListener('pageshow', reset); return () => window.removeEventListener('pageshow', reset); }, []);

  // The server creates the PayPal order from the stored booking price and returns PayPal's own approval link. We only follow it.
  async function pay(bookingId: string) {
    setBusy(bookingId); setProblem(null);
    try { window.location.assign(await startCheckout(bookingId)); }
    catch (e) { setProblem(friendlyPaymentError(e)); setBusy(null); }
  }

  return (
    <div className="animate-rise space-y-6">
      <header><p className="eyebrow">Mentorship</p><h1 className="text-3xl font-semibold">Your bookings</h1><p className="mt-1 max-w-2xl text-mute">Choose a session → Pay → Confirmed. A booking is confirmed only after PayPal payment is verified (Sandbox uses test money).</p></header>
      {!enabled && <p className="card-dark" role="status">Bookings need the CareerGraph server, which isn't connected.</p>}
      {error != null && <div className="card-dark" role="alert"><p className="font-semibold">{friendlyPaymentError(error)}</p><button className="btn mt-3" onClick={retry}>Try again</button></div>}
      {problem && <p role="alert" className="text-sm text-bad">{problem}</p>}
      {enabled && !error && !data && <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
      {data && data.length === 0 && <div className="card-dark"><p>No bookings yet.</p><Link to="/mentors" className="btn mt-3">Find a mentor</Link></div>}
      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((b) => (
            <li key={b.id} className="card-dark flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{b.session.title}</h2><BookingStatusBadge status={b.status} /></div>
                <p className="text-sm text-mute">{mentorTitle(b.mentor)}{b.mentor.isDemo ? ' (sample)' : ''}{b.career ? ` · For ${b.career.name}` : ''} · {b.session.durationMinutes} min · {formatPrice(b.amount, b.currency)} · Booked {new Date(b.createdAt).toLocaleDateString()}</p>
              </div>
              {b.status === 'pending_payment' && <button className="btn" disabled={busy !== null} onClick={() => void pay(b.id)}>{busy === b.id ? 'Opening PayPal…' : 'Pay with PayPal'}</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
