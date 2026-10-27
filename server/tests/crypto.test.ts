import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { AppError } from '../src/errors';
import { hashPassword, verifyPassword } from '../src/utils/password';
import { TokenService } from '../src/utils/token';

const SECRET = 's'.repeat(40);
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as AppError).code; } return null; };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('password hashing', () => {
  it('hashes with a random salt, verifies, and rejects wrong or malformed input', async () => {
    const a = await hashPassword('Password1'), b = await hashPassword('Password1');
    assert.match(a, /^scrypt\$/); assert.notEqual(a, b); assert.ok(!a.includes('Password1'));
    assert.equal(await verifyPassword('Password1', a), true);
    assert.equal(await verifyPassword('password1', a), false);
    assert.equal(await verifyPassword('Password1', 'not-a-hash'), false);
    assert.equal(await verifyPassword('Password1', 'scrypt$1$1$1$AA$'), false);
  });
});

describe('JWT tokens', () => {
  const clock = { ms: 1_700_000_000_000 };
  const svc = () => new TokenService(SECRET, 60, () => clock.ms);
  it('round-trips the user id and carries only minimal claims', () => {
    const t = svc().sign('user-1');
    assert.equal(svc().verify(t).sub, 'user-1');
    assert.deepEqual(Object.keys(JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString())).sort(), ['exp', 'iat', 'sub', 'typ']);
  });
  it('rejects tampering, other secrets, forged alg=none and malformed tokens', () => {
    const t = svc().sign('user-1'), [h, p, s] = t.split('.');
    assert.equal(code(() => svc().verify(`${h}.${b64({ sub: 'user-2', typ: 'access', iat: 1, exp: 9e9 })}.${s}`)), 'invalid_token');
    assert.equal(code(() => new TokenService('z'.repeat(40), 60, () => clock.ms).verify(t)), 'invalid_token');
    assert.equal(code(() => svc().verify(`${b64({ alg: 'none', typ: 'JWT' })}.${p}.`)), 'invalid_token');
    for (const bad of ['', 'abc', 'a.b', 'a.b.c', `${h}.${p}`]) assert.equal(code(() => svc().verify(bad)), 'invalid_token', bad);
  });
  it('enforces expiry and token type', () => {
    const t = svc().sign('user-1'); clock.ms += 61_000;
    assert.equal(code(() => svc().verify(t)), 'token_expired'); clock.ms -= 61_000;
    const header = b64({ alg: 'HS256', typ: 'JWT' }), body = `${header}.${b64({ sub: 'u', typ: 'refresh', iat: 1, exp: 9e9 })}`;
    const forged = `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
    assert.equal(code(() => svc().verify(forged)), 'invalid_token', 'a correctly signed token of the wrong type is refused');
  });
  it('refuses short secrets', () => { assert.throws(() => new TokenService('short', 60)); });
});
