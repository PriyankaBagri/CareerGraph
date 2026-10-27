import { DEMO_PASSWORD, DEMO_USER } from '../data/profile';
import type { User } from '../types';
import { ApiError, TOKEN_KEY, api, appMode, mockDelay } from './api';
import { isEmail } from '../utils/validation';

// Two modes, chosen by VITE_API_URL (see api.useBackend('auth')):
//  - REAL: talks to the Express API (JWT). The token and a cached copy of the user live in browser storage.
//  - MOCK (default, no VITE_API_URL): accounts and session live in browser storage. Never store passwords like this in production.
const USERS = 'careergraph:users';
const SESSION = 'careergraph:session';
interface Account { user: User; password: string }
export type FieldErrors = Partial<Record<'name' | 'email' | 'password' | 'confirm' | 'form', string>>;

export class AuthError extends Error {
  constructor(message: string, public field: 'email' | 'password' | 'form' = 'form') { super(message); }
}
export const toFieldErrors = (err: unknown): FieldErrors =>
  err instanceof AuthError ? ({ [err.field]: err.message } as FieldErrors) : { form: 'Something went wrong. Please try again.' };

const read = <T>(s: Storage, k: string, fallback: T): T => { try { const v = s.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const accounts = (): Account[] => [{ user: DEMO_USER, password: DEMO_PASSWORD }, ...read<Account[]>(localStorage, USERS, [])];
const norm = (e: string) => e.trim().toLowerCase();
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
function startSession(userId: string, remember: boolean) {
  localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION);
  (remember ? localStorage : sessionStorage).setItem(SESSION, JSON.stringify({ userId }));
}

const AUTH_USER = 'careergraph:auth-user';
interface ApiAuth { token: string; user: { id: string; email: string; name: string } }
const toUser = (u: ApiAuth['user']): User => ({ id: u.id, email: u.email, name: u.name, initials: initials(u.name) });
function tokenExpired(token: string): boolean {
  try { const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }; return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now(); } catch { return true; }
}
function clearRestSession() { api.setToken(null); localStorage.removeItem(AUTH_USER); sessionStorage.removeItem(AUTH_USER); }
api.setUnauthorizedHandler(clearRestSession); // an expired/invalid token seen by any API call ends the local session
function startRestSession(r: ApiAuth, remember: boolean): User {
  api.setToken(r.token, remember);
  localStorage.removeItem(AUTH_USER); sessionStorage.removeItem(AUTH_USER);
  const user = toUser(r.user);
  (remember ? localStorage : sessionStorage).setItem(AUTH_USER, JSON.stringify(user));
  return user;
}
// Synchronous on purpose (the UI reads it on first render). It trusts the cached user only while the token has not expired;
// the server re-verifies the token on every API call.
function restUser(): User | null {
  for (const s of [localStorage, sessionStorage]) {
    const token = s.getItem(TOKEN_KEY);
    if (!token) continue;
    if (tokenExpired(token)) { clearRestSession(); return null; }
    return read<User | null>(s, AUTH_USER, null);
  }
  return null;
}
function toAuthError(e: unknown): AuthError {
  if (e instanceof ApiError) {
    if (e.code === 'validation_failed' && e.fields) {
      if (e.fields.email) return new AuthError(e.fields.email, 'email');
      if (e.fields.password) return new AuthError(e.fields.password, 'password');
      return new AuthError(Object.values(e.fields)[0] ?? e.message, 'form');
    }
    return new AuthError(e.message, e.status === 409 ? 'email' : 'form');
  }
  return new AuthError('Could not reach the server. Please try again.', 'form');
}

// Called when the server rejects the token (expired/invalid): drops the local session so the UI can send the user to the login screen.
export const expireSession = clearRestSession;

export const authService = {
  getCurrentUser(): User | null {
    if (api.useBackend('auth')) return restUser();
    if (appMode() === 'unconfigured') return null; // a leftover demo session must not sign anyone in when no server and no demo mode are configured
    const s = read<{ userId: string } | null>(localStorage, SESSION, null) ?? read<{ userId: string } | null>(sessionStorage, SESSION, null);
    return s ? accounts().find((a) => a.user.id === s.userId)?.user ?? null : null;
  },
  isAuthenticated(): boolean { return authService.getCurrentUser() !== null; },
  async signUp(name: string, email: string, password: string): Promise<User> {
    if (appMode() === 'unconfigured') throw new AuthError('This app is not connected to a server. See the setup message on this page.', 'form');
    if (api.useBackend('auth')) { try { return startRestSession(await api.post<ApiAuth>('/auth/register', { name, email, password }), false); } catch (e) { throw toAuthError(e); } }
    await mockDelay(null, 500);
    if (!isEmail(email)) throw new AuthError('Enter a valid email address.', 'email');
    if (accounts().some((a) => norm(a.user.email) === norm(email))) throw new AuthError('An account with this email already exists.', 'email');
    const user: User = { id: `u${accounts().length + 1}`, name: name.trim(), email: norm(email), initials: initials(name) };
    localStorage.setItem(USERS, JSON.stringify([...read<Account[]>(localStorage, USERS, []), { user, password }]));
    startSession(user.id, true);
    return user;
  },
  async login(email: string, password: string, remember = true): Promise<User> {
    if (appMode() === 'unconfigured') throw new AuthError('This app is not connected to a server. See the setup message on this page.', 'form');
    if (api.useBackend('auth')) { try { return startRestSession(await api.post<ApiAuth>('/auth/login', { email, password }), remember); } catch (e) { throw toAuthError(e); } }
    await mockDelay(null, 500);
    const acc = accounts().find((a) => norm(a.user.email) === norm(email));
    if (!acc || acc.password !== password) throw new AuthError('Incorrect email or password.', 'form');
    startSession(acc.user.id, remember);
    return acc.user;
  },
  async logout(): Promise<void> {
    if (api.useBackend('auth')) { try { await api.post('/auth/logout'); } catch { /* the token is discarded locally regardless */ } clearRestSession(); return; }
    localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); await mockDelay(null, 100); },
  async requestPasswordReset(email: string): Promise<void> {
    // The Stage 4 API has no password-reset endpoint, so in backend mode say so instead of pretending a request was made.
    if (api.useBackend('auth')) throw new AuthError('Password reset is not available yet for accounts on the server. Contact the administrator.', 'form');
    await mockDelay(null, 500);
    if (!isEmail(email)) throw new AuthError('Enter a valid email address.', 'email');
  },
};
