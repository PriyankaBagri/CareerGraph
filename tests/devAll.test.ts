import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, it } from 'node:test';
import { apiPort, checkServerEnv, isPortFree, parseEnv, resolveApiUrl, summarizeHealth } from '../scripts/devLib';

const good = { DATABASE_URL: 'postgres://u:SuperSecretPw@localhost:5432/db', JWT_SECRET: 'x'.repeat(40), CLIENT_ORIGIN: 'http://localhost:5173', PORT: '4000' };
describe('dev:all configuration checks', () => {
  it('parses .env text (BOM, CRLF, comments, quotes) without evaluating anything', () => {
    assert.deepEqual(parseEnv('﻿# c\r\nA=1\r\nB="two words"\r\nC=\'x\'\r\n\r\nbad line\r\nD=a=b'), { A: '1', B: 'two words', C: 'x', D: 'a=b' });
  });
  it('a complete server env has no issues', () => assert.deepEqual(checkServerEnv(good), []));
  it('reports missing DATABASE_URL, short JWT_SECRET, wrong CLIENT_ORIGIN and bad PORT, and never echoes a value', () => {
    const issues = checkServerEnv({ JWT_SECRET: 'short-secret-value', CLIENT_ORIGIN: 'http://example.com', PORT: 'abc' });
    assert.deepEqual(issues.map((i) => i.level).sort(), ['error', 'error', 'error', 'warn']);
    const text = issues.map((i) => i.message).join(' ');
    assert.doesNotMatch(text, /short-secret-value|SuperSecretPw/); assert.match(text, /DATABASE_URL/);
    assert.equal(checkServerEnv({ ...good, CLIENT_ORIGIN: 'http://localhost:3000, http://localhost:5173' }).length, 0);
  });
  it('port and API URL resolution: process env beats .env beats the local default', () => {
    assert.equal(apiPort({}), 4000); assert.equal(apiPort({ PORT: '4100' }), 4100);
    assert.deepEqual(resolveApiUrl({}, {}, 4100), { url: 'http://localhost:4100/api', source: 'default' });
    assert.equal(resolveApiUrl({ VITE_API_URL: 'http://a/api' }, {}, 4000).source, '.env');
    assert.equal(resolveApiUrl({ VITE_API_URL: 'http://a/api' }, { VITE_API_URL: 'http://b/api' }, 4000).url, 'http://b/api');
  });
  it('health summary shows only status and database', () => {
    assert.equal(summarizeHealth({ status: 'ok', database: 'up', secret: 'x' }), 'status=ok, database=up'); assert.equal(summarizeHealth(null), 'status=?, database=?');
  });
  it('isPortFree detects a port that is really in use', async () => {
    const s = net.createServer(); await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const port = (s.address() as net.AddressInfo).port;
    assert.equal(await isPortFree(port), false); await new Promise<void>((r) => s.close(() => r()));
    assert.equal(await isPortFree(port), true);
  });
});

describe('dev:all and the database URL (regression)', () => {
  it('parseEnv ends an unquoted value at # exactly like Node, and checkServerEnv explains it without echoing the value', () => {
    const env = parseEnv('DATABASE_URL=postgres://app:pa#ss@localhost:5432/db\nJWT_SECRET=' + 'x'.repeat(40) + '\n');
    assert.equal(env.DATABASE_URL, 'postgres://app:pa');
    const text = checkServerEnv(env).map((i) => i.message).join(' ');
    assert.match(text, /DATABASE_URL/); assert.doesNotMatch(text, /pa#ss|app:pa/);
    assert.equal(parseEnv('DATABASE_URL="postgres://app:pa#ss@localhost:5432/db"').DATABASE_URL, 'postgres://app:pa#ss@localhost:5432/db');
  });
});
