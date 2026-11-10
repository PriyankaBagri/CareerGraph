import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DemoBadge, DemoNotice } from '../components/mentorship/Badges';
import Skeleton from '../components/ui/Skeleton';
import { useLoad } from '../hooks/useLoad';
import { useProfile } from '../hooks/useProfile';
import { friendlyPaymentError, mentorTitle, mentorshipApi } from '../services/mentorship';

// Mentors follow the student's selected career: the server filters by that career's field. "All mentors" is an explicit choice (?all=1), never a silent fallback.
export default function Mentors() {
  const enabled = mentorshipApi.enabled();
  const me = useProfile();
  const [params] = useSearchParams();
  const careerId = me?.profile.targetCareerId || '';
  const browseAll = params.get('all') === '1' || !careerId;
  const { data, error, retry } = useLoad(() => mentorshipApi.listMentors(browseAll ? undefined : careerId), [browseAll ? 'all' : careerId], enabled);
  useEffect(() => { document.title = 'Mentors · CareerGraph'; }, []);
  const career = data?.career ?? null, mentors = data?.mentors ?? [];
  const link = (id: string) => (career ? `/mentors/${id}?career=${encodeURIComponent(career.id)}` : `/mentors/${id}`);
  return (
    <div className="animate-rise space-y-6">
      <header className="space-y-3">
        <div>
          <p className="eyebrow">Mentorship</p>
          <h1 className="text-3xl font-semibold">{career ? `Mentors for ${career.name}` : 'Find a mentor'}</h1>
          <p className="mt-1 max-w-2xl text-mute"><Link to="/bookings" className="mr-3 underline">My bookings</Link>{career ? 'Sessions that match your selected career.' : careerId ? 'Showing every sample mentor.' : <>Choose a career in <Link to="/career" className="underline">Explore Careers</Link> to see mentors for it.</>}</p>
        </div>
        <DemoNotice />
      </header>
      {!enabled && <p className="card-dark" role="status">Mentor booking needs the CareerGraph server, which isn't connected.</p>}
      {error != null && <div className="card-dark" role="alert"><p className="font-semibold">{friendlyPaymentError(error)}</p><button className="btn mt-3" onClick={retry}>Try again</button></div>}
      {enabled && !error && !data && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>}
      {data && mentors.length === 0 && (
        <div className="card-dark space-y-3" role="status">
          <p className="font-semibold">{career ? `No mentors for ${career.name} yet.` : 'No mentors yet.'}</p>
          <p className="text-sm text-mute">{career ? "We don't show mentors from other fields here. Mentor sign-up isn't open yet." : 'Please check back soon.'}</p>
          <div className="flex flex-wrap gap-3">
            {career && <Link to="/mentors?all=1" className="btn-quiet">Browse all sample mentors</Link>}
            <Link to="/career" className="btn-quiet">Explore other careers</Link>
          </div>
        </div>
      )}
      {data && mentors.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mentors.map((m) => (
            <li key={m.id} className="card-dark flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{mentorTitle(m)}</h2>{m.isDemo && <DemoBadge />}</div>
              <p className="text-sm text-mute">{m.expertise.join(' · ')}</p>
              <Link to={link(m.id)} className="btn-quiet mt-auto self-start">See sessions</Link>
            </li>
          ))}
        </ul>
      )}
      {data && career && mentors.length > 0 && <p className="text-sm text-mute"><Link to="/mentors?all=1" className="underline">Browse all sample mentors</Link></p>}
      {data && !career && careerId && <p className="text-sm text-mute"><Link to="/mentors" className="underline">Back to mentors for my career</Link></p>}
    </div>
  );
}
