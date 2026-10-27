import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import FullScreenLoader from '../components/ui/FullScreenLoader';
import ProfileProblem from '../components/ui/ProfileProblem';
import { decideGuest, decideOnboardingRoute, decideProtected } from './guardDecision';

function ProfileProblemScreen() {
  const { retryProfile, logout } = useAuth();
  return <ProfileProblem onRetry={retryProfile} onLogout={() => void logout()} />;
}

export function RequireAuth() {
  const loc = useLocation();
  const a = useAuth();
  switch (decideProtected(a)) {
    case 'loading': return <FullScreenLoader />;
    case 'login': return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
    case 'problem': return <ProfileProblemScreen />;
    case 'onboarding': return <Navigate to="/onboarding" replace />;
    default: return <Outlet />;
  }
}
export function RequireUser() {
  switch (decideOnboardingRoute(useAuth())) {
    case 'loading': return <FullScreenLoader />;
    case 'login': return <Navigate to="/login" replace />;
    case 'problem': return <ProfileProblemScreen />;
    case 'app': return <Navigate to="/dashboard" replace />;
    default: return <Outlet />;
  }
}
export function GuestOnly() {
  const loc = useLocation();
  const a = useAuth();
  switch (decideGuest(a)) {
    case 'loading': return <FullScreenLoader />;
    case 'problem': return <ProfileProblemScreen />;
    case 'onboarding': return <Navigate to="/onboarding" replace />;
    case 'app': return <Navigate to={(loc.state as { from?: string } | null)?.from ?? '/dashboard'} replace />;
    default: return <Outlet />;
  }
}
