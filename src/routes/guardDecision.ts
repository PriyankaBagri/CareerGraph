import type { Profile, User } from '../types';

// Pure routing decisions for the guards, so the important rule is testable without a DOM:
// a signed-in user whose profile could not be LOADED (server down) gets a retry screen, never onboarding or a login redirect.
export interface AccessState { user: User | null; profile: Profile | null; isLoading: boolean; profileError: boolean }
export type Access = 'loading' | 'login' | 'problem' | 'onboarding' | 'app';

export function decideProtected(s: AccessState): Access {
  if (s.isLoading) return 'loading';
  if (!s.user) return 'login';
  if (s.profileError) return 'problem';
  return s.profile?.onboardingComplete ? 'app' : 'onboarding';
}
// Onboarding route: allowed only for a signed-in user who has not finished onboarding.
export function decideOnboardingRoute(s: AccessState): Access {
  if (s.isLoading) return 'loading';
  if (!s.user) return 'login';
  if (s.profileError) return 'problem';
  return s.profile?.onboardingComplete ? 'app' : 'onboarding';
}
// Login/signup routes: signed-in users are sent on, unless their data failed to load.
export function decideGuest(s: AccessState): 'loading' | 'problem' | 'stay' | 'onboarding' | 'app' {
  if (s.isLoading) return 'loading';
  if (!s.user) return 'stay';
  if (s.profileError) return 'problem';
  return s.profile?.onboardingComplete ? 'app' : 'onboarding';
}
