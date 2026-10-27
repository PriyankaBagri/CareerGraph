import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apiOrigin, buildCsp, injectCsp } from '../scripts/csp';

describe('production Content-Security-Policy', () => {
  it('blocks inline and third-party scripts and plugins, and allows only this site (plus the configured API origin) for requests', () => {
    const csp = buildCsp('https://api.example.com/api');
    assert.match(csp, /script-src 'self'(;|$)/); assert.ok(!/script-src[^;]*unsafe/.test(csp)); assert.match(csp, /object-src 'none'/); assert.match(csp, /connect-src 'self' https:\/\/api\.example\.com(;|$)/);
    assert.match(csp, /default-src 'self'/); assert.match(csp, /form-action 'self'/);
  });
  it('without an API URL only the site itself is allowed; a bad or non-http URL adds nothing', () => {
    assert.match(buildCsp(), /connect-src 'self'(;|$)/);
    for (const bad of ['', 'not a url', 'javascript:alert(1)', 'ftp://x.test']) assert.equal(apiOrigin(bad), null, bad);
    assert.equal(apiOrigin('http://localhost:4000/api'), 'http://localhost:4000');
  });
  it('the policy cannot be broken out of by a hostile API URL', () => {
    const csp = buildCsp('https://a.test"; script-src *; x="');
    assert.ok(!csp.includes('script-src *')); assert.ok(!csp.includes('"'));
  });
  it('injects once into index.html, and leaves a page that already has one alone', () => {
    const html = '<!doctype html><html><head><title>x</title></head></html>';
    const out = injectCsp(html); assert.match(out, /<head><meta http-equiv="Content-Security-Policy"/); assert.equal(injectCsp(out), out);
  });
});
