// Shown instead of redirecting to onboarding when a signed-in user's data could not be loaded (server down). Pure props, so it is testable.
interface Props { onRetry: () => void; onLogout: () => void }
export default function ProfileProblem({ onRetry, onLogout }: Props) {
  return (
    <div className="grid min-h-screen place-items-center p-6"><div className="card-dark max-w-md" role="alert">
      <p className="font-semibold">We couldn't load your account data.</p>
      <p className="mt-1 text-sm">The server did not respond, so nothing has been changed. Check that the backend is running, then try again.</p>
      <div className="mt-4 flex gap-3"><button className="btn" onClick={onRetry}>Try again</button><button className="rounded-lg border border-sand px-4 py-2" onClick={onLogout}>Log out</button></div>
    </div></div>
  );
}
