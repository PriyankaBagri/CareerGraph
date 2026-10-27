import { authNotConfigured, tooManyRequests, unauthorized } from '../errors';
import { RateLimiter } from '../utils/rateLimit';
import type { ProfileRecord, Repos, UserRecord } from '../repositories/types';
import { hashPassword, verifyPassword } from '../utils/password';
import type { TokenService } from '../utils/token';
import { profileView, type ProfileView } from './profile';

export interface PublicUser { id: string; email: string; name: string }
export interface AuthSession { token: string; tokenType: 'Bearer'; expiresIn: number; user: PublicUser; profile: ProfileView }
export const publicUser = (u: UserRecord): PublicUser => ({ id: u.id, email: u.email, name: u.name }); // the ONLY user shape that leaves the server

export const LOGIN_FAILURES = 8, LOGIN_WINDOW_MS = 15 * 60_000;
export class AuthService {
  private dummyHash: Promise<string> | null = null;
  // Failed sign-ins per email (whether or not the account exists, so the limiter reveals nothing). In memory, per process.
  private readonly failures: RateLimiter;
  constructor(private readonly repos: Repos, private readonly tokens: TokenService | null, now: () => number = Date.now) { this.failures = new RateLimiter(LOGIN_FAILURES, LOGIN_WINDOW_MS, now); }
  private requireTokens(): TokenService { if (!this.tokens) throw authNotConfigured(); return this.tokens; }
  private session(user: UserRecord, profile: ProfileRecord): AuthSession {
    const t = this.requireTokens();
    return { token: t.sign(user.id), tokenType: 'Bearer', expiresIn: t.ttlSeconds, user: publicUser(user), profile: profileView(user, profile) };
  }

  async register(input: { name: string; email: string; password: string }): Promise<AuthSession> {
    this.requireTokens(); // never create an account we cannot issue a session for
    const { user, profile } = await this.repos.createUserWithProfile({ email: input.email, name: input.name, passwordHash: await hashPassword(input.password) });
    return this.session(user, profile);
  }

  async login(email: string, password: string): Promise<AuthSession> {
    this.requireTokens();
    const key = email.trim().toLowerCase(), wait = this.failures.wait(key);
    if (wait > 0) throw tooManyRequests(wait); // checked BEFORE any password work, so a locked-out guesser costs us nothing
    const user = await this.repos.findUserByEmail(email);
    // Same work and same answer whether the email exists or not: no account enumeration through messages or timing.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await (this.dummyHash ??= hashPassword('dummy-password-for-timing'))));
    if (!user || !ok) { this.failures.record(key); throw unauthorized('Incorrect email or password.', 'invalid_credentials'); }
    const profile = await this.repos.getProfile(user.id);
    if (!profile) throw unauthorized('Incorrect email or password.', 'invalid_credentials');
    this.failures.clear(key);
    return this.session(user, profile);
  }

  // Verifies the token AND that the account still exists. Returns the user id; this is the only source of identity for handlers.
  async authenticate(token: string): Promise<string> {
    const { sub } = this.requireTokens().verify(token);
    if (!(await this.repos.findUserById(sub))) throw unauthorized('Invalid token.', 'invalid_token');
    return sub;
  }

  async me(userId: string): Promise<{ user: PublicUser; profile: ProfileView }> {
    const user = await this.repos.findUserById(userId), profile = await this.repos.getProfile(userId);
    if (!user || !profile) throw unauthorized('Invalid token.', 'invalid_token');
    return { user: publicUser(user), profile: profileView(user, profile) };
  }
}
