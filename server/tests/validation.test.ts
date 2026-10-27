import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError, Validator, parseUuid } from '../src/validation';

const collect = (body: unknown, fn: (v: Validator) => void): Record<string, string> => {
  try { const v = new Validator(body); fn(v); v.done(); return {}; } catch (e) { assert.ok(e instanceof ValidationError); return e.fields; }
};
describe('validation', () => {
  it('returns typed, trimmed values when valid', () => {
    const v = new Validator({ name: '  Ada  ', level: 3, on: true, kind: 'a', tags: ['x', 'x', ' y '] });
    assert.equal(v.string('name', { max: 10 }), 'Ada'); assert.equal(v.int('level', { min: 0, max: 5 }), 3);
    assert.equal(v.bool('on'), true); assert.equal(v.enum('kind', ['a', 'b'] as const), 'a'); assert.deepEqual(v.stringArray('tags'), ['x', 'y']);
    v.done();
  });
  it('reports every invalid field at once', () => {
    const f = collect({ name: '', level: 9, on: 'yes', kind: 'z', id: 'nope' }, (v) => { v.string('name'); v.int('level', { min: 0, max: 5 }); v.bool('on'); v.enum('kind', ['a', 'b'] as const); v.uuid('id'); v.string('missing'); });
    assert.deepEqual(Object.keys(f).sort(), ['id', 'kind', 'level', 'missing', 'name', 'on']);
  });
  it('handles optional fields, wrong types, bounds and patterns', () => {
    assert.deepEqual(collect({}, (v) => { v.string('a', { optional: true }); v.int('b', { optional: true }); }), {});
    assert.ok(collect({ n: 1.5 }, (v) => v.int('n')).n);
    assert.ok(collect({ n: '3' }, (v) => v.int('n')).n);
    assert.ok(collect({ s: 'x'.repeat(11) }, (v) => v.string('s', { max: 10 })).s);
    assert.ok(collect({ s: 'ab' }, (v) => v.string('s', { min: 3 })).s);
    assert.ok(collect({ e: 'nope' }, (v) => v.string('e', { pattern: /@/, patternMessage: 'Enter an email.' })).e);
    assert.ok(collect({ t: [1] }, (v) => v.stringArray('t')).t);
  });
  it('rejects non-object bodies', () => {
    for (const body of [null, undefined, 'x', 5, [1]]) assert.throws(() => new Validator(body), ValidationError);
  });
  it('validates uuids', () => {
    assert.equal(parseUuid('3F2504E0-4F89-41D3-9A0C-0305E82C3301'), '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    assert.equal(parseUuid("1' OR '1'='1"), null); assert.equal(parseUuid(5), null);
  });
});
