import { createHmac, timingSafeEqual } from 'node:crypto';
import { unauthorized } from '../errors';

// Minimal HS256 JWT. The algorithm is fixed (no "alg" negotiation, so "none"/key-confusion attacks are impossible), the signature
// is compared in constant time, expiry and token type are enforced. Replaceable by `jsonwebtoken` behind this class.
// Claims are minimal: sub (user id), typ ("access"), iat, exp. Tokens are stateless and cannot be revoked before they expire.
const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
const HEADER = b64({ alg: 'HS256', typ: 'JWT' });

export class TokenService {
  constructor(private readonly secret: string, readonly ttlSeconds: number, private readonly now: () => number = () => Date.now()) {
    if (secret.length < 32) throw new Error('Token secret must be at least 32 characters.');
  }
  private mac(data: string) { return createHmac('sha256', this.secret).update(data).digest(); }
  sign(sub: string): string {
    const iat = Math.floor(this.now() / 1000);
    const body = `${HEADER}.${b64({ sub, typ: 'access', iat, exp: iat + this.ttlSeconds })}`;
    return `${body}.${this.mac(body).toString('base64url')}`;
  }
  verify(token: string): { sub: string } {
    const invalid = () => unauthorized('Invalid token.', 'invalid_token');
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== HEADER) throw invalid();
    const given = Buffer.from(parts[2], 'base64url'), want = this.mac(`${parts[0]}.${parts[1]}`);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw invalid();
    let c: { sub?: unknown; typ?: unknown; exp?: unknown };
    try { c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as typeof c; } catch { throw invalid(); }
    if (typeof c.sub !== 'string' || c.typ !== 'access' || typeof c.exp !== 'number') throw invalid();
    if (c.exp * 1000 <= this.now()) throw unauthorized('Your session has expired. Please log in again.', 'token_expired');
    return { sub: c.sub };
  }
}
