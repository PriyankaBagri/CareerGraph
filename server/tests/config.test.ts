import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config';

const ok = { DATABASE_URL: 'postgres://u:p@localhost:5432/cg' };
describe('config', () => {
  it('applies safe defaults', () => {
    const c = loadConfig(ok);
    assert.equal(c.port, 4000); assert.deepEqual(c.clientOrigins, ['http://localhost:5173']); assert.equal(c.production, false); assert.equal(c.databaseSsl, false);
  });
  it('parses explicit values, multiple origins and production', () => {
    const c = loadConfig({ ...ok, JWT_SECRET: 'p'.repeat(40), PORT: '8080', NODE_ENV: 'production', DATABASE_SSL: 'true', CLIENT_ORIGIN: 'https://a.example.com, http://localhost:5173' });
    assert.equal(c.port, 8080); assert.equal(c.production, true); assert.equal(c.databaseSsl, true);
    assert.deepEqual(c.clientOrigins, ['https://a.example.com', 'http://localhost:5173']);
  });
  it('fails fast with clear messages', () => {
    assert.throws(() => loadConfig({}), /DATABASE_URL must be set/);
    assert.throws(() => loadConfig({ DATABASE_URL: 'mysql://x' }), /postgres/);
    assert.throws(() => loadConfig({ ...ok, PORT: 'abc' }), /PORT/);
    assert.throws(() => loadConfig({ ...ok, PORT: '70000' }), /PORT/);
    assert.throws(() => loadConfig({ ...ok, CLIENT_ORIGIN: '*' }), /exact origins/);
    assert.throws(() => loadConfig({ ...ok, CLIENT_ORIGIN: 'http://x.com/path' }), /exact origins/);
  });
  it('does not put the database URL in error messages', () => {
    try { loadConfig({ DATABASE_URL: 'mysql://user:TOPSECRET@h/db' }); assert.fail('should throw'); }
    catch (e) { assert.ok(!(e as Error).message.includes('TOPSECRET')); }
  });
  it('JWT: weak or missing secrets are never used; production refuses to start without one', () => {
    assert.equal(loadConfig(ok).jwtSecret, null);
    assert.equal(loadConfig({ ...ok, JWT_SECRET: 'short' }).jwtSecret, null);
    assert.equal(loadConfig({ ...ok, JWT_SECRET: 'x'.repeat(32) }).jwtSecret, 'x'.repeat(32));
    assert.throws(() => loadConfig({ ...ok, NODE_ENV: 'production' }), /JWT_SECRET/);
    assert.throws(() => loadConfig({ ...ok, NODE_ENV: 'production', JWT_SECRET: 'short' }), /JWT_SECRET/);
  });
  it('JWT: token lifetime defaults to 24h and is bounded', () => {
    assert.equal(loadConfig(ok).tokenTtlSeconds, 86400);
    assert.equal(loadConfig({ ...ok, JWT_EXPIRES_IN_SECONDS: '3600' }).tokenTtlSeconds, 3600);
    for (const bad of ['10', 'abc', '99999999']) assert.throws(() => loadConfig({ ...ok, JWT_EXPIRES_IN_SECONDS: bad }), /JWT_EXPIRES_IN_SECONDS/);
  });
  it('never leaks the JWT secret in error messages', () => {
    try { loadConfig({ ...ok, NODE_ENV: 'production', JWT_SECRET: 'TOPSECRET' }); assert.fail('should throw'); } catch (e) { assert.ok(!(e as Error).message.includes('TOPSECRET')); }
  });
});

describe('production start does not depend on a local .env file or on devDependencies', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> };
  it('start:prod reads variables from the environment only', () => {
    assert.match(pkg.scripts['start:prod'], /src\/index\.ts/); assert.ok(!/--env-file/.test(pkg.scripts['start:prod']));
  });
  it('the runtime launcher (tsx) is a production dependency, not a dev one', () => {
    assert.ok(pkg.dependencies.tsx); assert.ok(!pkg.devDependencies.tsx);
  });
  it('the local scripts that load server/.env are unchanged', () => {
    assert.match(pkg.scripts.start, /--env-file=\.env/); assert.match(pkg.scripts['db:migrate'], /--env-file=\.env/);
  });
  it('db:check:prod and db:migrate:prod reuse the same scripts without loading a .env file', () => {
    assert.match(pkg.scripts['db:check:prod'], /src\/db\/check\.ts/); assert.match(pkg.scripts['db:migrate:prod'], /src\/db\/migrate\.ts/);
    assert.ok(!/--env-file/.test(pkg.scripts['db:check:prod'] + pkg.scripts['db:migrate:prod']));
    assert.match(pkg.scripts['db:check'], /--env-file=\.env/); // the local commands keep loading server/.env
  });
  it('the server never migrates on startup', () => {
    assert.ok(!/migrat/i.test(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')));
  });
});
