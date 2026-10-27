import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideGuest, decideOnboardingRoute, decideProtected, type AccessState } from '../src/routes/guardDecision';
import type { Profile, User } from '../src/types';

const user = { id: 'u', email: 'a@b.co', name: 'A', initials: 'A' } as User;
const done = { onboardingComplete: true } as Profile, fresh = { onboardingComplete: false } as Profile;
const st = (o: Partial<AccessState>): AccessState => ({ user, profile: done, isLoading: false, profileError: false, ...o });

describe('route guard decisions', () => {
  it('server down while signed in: retry screen, never onboarding, never login', () => {
    const down = st({ profile: null, profileError: true });
    assert.equal(decideProtected(down), 'problem'); assert.equal(decideOnboardingRoute(down), 'problem'); assert.equal(decideGuest(down), 'problem');
    assert.notEqual(decideProtected({ ...down, profileError: false }), 'problem'); // without the error flag a missing profile means onboarding
    assert.equal(decideProtected({ ...down, profileError: false }), 'onboarding');
  });
  it('after Try again succeeds the user reaches the app; while retrying a loader shows', () => {
    assert.equal(decideProtected(st({ profile: null, profileError: true, isLoading: true })), 'loading');
    assert.equal(decideProtected(st({})), 'app');
  });
  it('signed out always goes to login (or stays on guest pages), even if a stale error flag exists', () => {
    assert.equal(decideProtected(st({ user: null, profile: null, profileError: true })), 'login');
    assert.equal(decideGuest(st({ user: null, profile: null })), 'stay');
  });
  it('normal routing is unchanged', () => {
    assert.equal(decideProtected(st({ profile: fresh })), 'onboarding'); assert.equal(decideOnboardingRoute(st({ profile: fresh })), 'onboarding');
    assert.equal(decideOnboardingRoute(st({})), 'app'); assert.equal(decideGuest(st({})), 'app'); assert.equal(decideGuest(st({ profile: fresh })), 'onboarding');
  });
});

import ProfileProblem from '../src/components/ui/ProfileProblem';
import { readFileSync } from 'node:fs';
type El = { props?: { children?: unknown; onClick?: () => void } };
const walk = (n: unknown, out: El[] = []): El[] => { if (Array.isArray(n)) n.forEach((c) => walk(c, out)); else if (n && typeof n === 'object') { out.push(n as El); walk((n as El).props?.children, out); } return out; };
describe('retry screen wiring', () => {
  it('the rendered "Try again" button calls onRetry and "Log out" calls onLogout', () => {
    let retried = 0, out = 0;
    const tree = walk(ProfileProblem({ onRetry: () => { retried++; }, onLogout: () => { out++; } }));
    const buttons = tree.filter((e) => typeof e.props?.onClick === 'function');
    assert.equal(buttons.length, 2);
    buttons[0].props!.onClick!(); assert.equal(retried, 1); assert.equal(out, 0);
    buttons[1].props!.onClick!(); assert.equal(out, 1);
  });
  it('guards connect that screen to the context\'s retryProfile and logout (static check of the container)', () => {
    const src = readFileSync(new URL('../src/routes/guards.tsx', import.meta.url), 'utf8');
    assert.match(src, /const \{ retryProfile, logout \} = useAuth\(\);\s*return <ProfileProblem onRetry=\{retryProfile\} onLogout=\{\(\) => void logout\(\)\} \/>/);
    assert.equal((src.match(/<ProfileProblemScreen \/>/g) ?? []).length, 3);
  });
});
