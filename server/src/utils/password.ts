import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

// Passwords are hashed with scrypt (Node built-in: memory-hard, random per-password salt, no extra dependency).
// Only the hash is stored. Format: scrypt$N$r$p$salt$hash (base64). Swappable for bcrypt/argon2 behind these two functions.
const N = 16384, R = 8, P = 1, LEN = 64, MAXMEM = 64 * 1024 * 1024;
const derive = (pw: string, salt: Buffer, len: number, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, { N: n, r, p, maxmem: MAXMEM }, (e, key) => (e ? reject(e) : resolve(key))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(pw, salt, LEN, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(pw, Buffer.from(salt, 'base64'), expected.length, Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
