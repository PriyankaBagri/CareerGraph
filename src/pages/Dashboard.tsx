import { Link } from 'react-router-dom';
import GapList from '../components/dashboard/GapList';
import PlainSummary from '../components/dashboard/PlainSummary';
import NextMove from '../components/dashboard/NextMove';
import CareerGraph from '../components/graph/CareerGraph';
import Disclosure from '../components/ui/Disclosure';
import ReadinessBreakdown from '../components/readiness/ReadinessBreakdown';
import ReadinessCard from '../components/readiness/ReadinessCard';
import Skeleton from '../components/ui/Skeleton';
import { useCareerAnalysis } from '../hooks/useCareerAnalysis';
import { useProfile } from '../hooks/useProfile';
import { profileProgress } from '../utils/profileStatus';
import { readinessLabel } from '../utils/readiness';

export default function Dashboard() {
  const me = useProfile();
  const { view, actions, roadmap, error, retry, refreshing } = useCareerAnalysis(me?.profile.targetCareerId ?? '');
  return (
    <div className="animate-rise space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Career intelligence</p>
          <h1 className="text-3xl font-semibold leading-tight">{me ? `Welcome back, ${me.user.name.split(' ')[0]}` : 'Welcome back'}</h1>
          <p className="text-mute">{me && view ? `Profile ${profileProgress(me.profile, view.skills, view.evidence.length).percent}% complete` : ' '}</p>
        </div>
        <div className="rounded-xl border border-line bg-panel px-4 py-3">
          <p className="eyebrow">Your target career</p>
          <p className="text-lg font-semibold">{view?.career.name ?? '…'}</p>
          {view && <p className="max-w-xs text-xs text-mute">{view.career.description}</p>}
          <Link to="/profile" className="text-sm text-ember underline">Change</Link>
        </div>
      </header>
      {error && <div className="card-dark" role="alert"><p className="font-semibold">We couldn't load your CareerGraph right now.</p><button className="btn mt-3" onClick={retry}>Try again</button></div>}
      {!view && !error && <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>}
      {view && actions && roadmap && (
        <>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <ReadinessCard readiness={view.readiness} skills={view.skills} />
            <NextMove actions={actions} roadmap={roadmap} />
          </div>
          <PlainSummary view={view} actions={actions} compact />
          <GapList gaps={view.gaps} actions={actions} unassessed={view.skills.filter((s) => s.status === 'not_assessed').length} />
          <Disclosure title="How each skill adds to the score" hint="the numbers behind the percentage"><ReadinessBreakdown readiness={view.readiness} skills={view.skills} /></Disclosure>
          <Disclosure title="Career action graph" hint="a visual map of the same skills, evidence and actions">
            <CareerGraph key={view.career.id} career={view.career} evidence={view.evidence} overall={view.readiness.overall} readinessText={readinessLabel(view.readiness)} skills={view.skills} actions={actions} guidance={view.guidance} rules={view.readiness.backend?.evaluation?.rules} refreshing={refreshing} />
          </Disclosure>
          <p className="text-sm text-mute">Want an explanation of any of this? <Link to="/assistant" className="text-ember underline">Ask the career assistant</Link>.</p>
        </>
      )}
    </div>
  );
}
