import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import { authService, expireSession } from '../services/auth';
import { dataService } from '../services/data';
import { profileService } from '../services/profile';
import { settingsService } from '../services/settings';
import type { OnboardingInput, Profile, User } from '../types';

interface AuthValue {
  user: User | null; profile: Profile | null; isAuthenticated: boolean; isLoading: boolean;
  profileError: boolean; // signed in, but the profile/ratings could not be loaded (server down): guards show a retry screen, never onboarding
  retryProfile: () => void; // clears the error and loads the profile again
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeOnboarding: (input: OnboardingInput) => Promise<Profile>;
  updateSkillLevel: (skillId: string, level: number) => Promise<void>;
  setTargetCareer: (careerId: string) => Promise<void>;
  saveProfile: (patch: Partial<Profile>) => Promise<void>;
  resetAccountData: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}
const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => authService.getCurrentUser());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setLoading] = useState(() => authService.getCurrentUser() !== null);
  const [profileError, setProfileError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryProfile = useCallback(() => { setProfileError(false); setLoading(true); setAttempt((a) => a + 1); }, []);

  useEffect(() => {
    if (!user) { setProfileError(false); setLoading(false); return; }
    let live = true;
    profileService.getProfile(user.id).then((p) => { if (live) { setProfile(p); setProfileError(false); setLoading(false); } }).catch(() => { if (live) { setProfileError(true); setLoading(false); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // An expired/invalid token seen by any API call ends the session here too, so route guards redirect to /login instead of showing a broken page.
  useEffect(() => {
    api.setUnauthorizedHandler(() => { expireSession(); setUser(null); setProfile(null); setProfileError(false); setLoading(false); });
    return () => api.setUnauthorizedHandler(expireSession);
  }, []);

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    const u = await authService.login(email, password, remember);
    try { setProfile(await profileService.getProfile(u.id)); setProfileError(false); } catch { setProfile(null); setProfileError(true); } // signed in, profile load failed: retry screen
    setUser(u);
  }, []);
  const signup = useCallback(async (name: string, email: string, password: string) => {
    const u = await authService.signUp(name, email, password);
    setProfile(null); setProfileError(false); setUser(u);
  }, []);
  const logout = useCallback(async () => { await authService.logout(); settingsService.clearCache(); setUser(null); setProfile(null); setProfileError(false); }, []);
  const completeOnboarding = useCallback(async (input: OnboardingInput) => {
    if (!user) throw new Error('Not signed in');
    const p = await profileService.completeOnboarding(user.id, input);
    setProfile(p);
    return p;
  }, [user]);

  const updateSkillLevel = useCallback(async (skillId: string, level: number) => {
    if (!user) throw new Error('Not signed in');
    setProfile(await profileService.setSkillLevel(user.id, skillId, level));
  }, [user]);
  const targetId = profile?.targetCareerId;
  const setTargetCareer = useCallback(async (careerId: string) => {
    if (!user) return;
    const prev = targetId;
    setProfile((p) => (p ? { ...p, targetCareerId: careerId } : p));
    try { await profileService.updateProfile(user.id, { targetCareerId: careerId }); } catch { setProfile((p) => (p && prev ? { ...p, targetCareerId: prev } : p)); throw new Error('Could not save target career'); }
  }, [user, targetId]);

  const saveProfile = useCallback(async (patch: Partial<Profile>) => {
    if (!user) throw new Error('Not signed in');
    setProfile(await profileService.updateProfile(user.id, patch));
  }, [user]);
  // Removes this user's saved data (profile, evidence, action progress, custom careers, settings). Non-demo users return to onboarding.
  const resetAccountData = useCallback(async () => {
    if (!user) throw new Error('Not signed in');
    await dataService.resetAll();
    setProfile(await profileService.getProfile(user.id));
  }, [user]);

  const refreshProfile = useCallback(async () => { if (user) setProfile(await profileService.getProfile(user.id)); }, [user]);

  const value = useMemo(() => ({ user, profile, isAuthenticated: !!user, isLoading, profileError, retryProfile, login, signup, logout, completeOnboarding, updateSkillLevel, setTargetCareer, saveProfile, resetAccountData, refreshProfile }), [user, profile, isLoading, profileError, retryProfile, login, signup, logout, completeOnboarding, updateSkillLevel, setTargetCareer, saveProfile, resetAccountData, refreshProfile]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
