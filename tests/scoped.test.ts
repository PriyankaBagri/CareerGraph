import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoped } from '../src/utils/scoped';

describe('scoped async state (target-career synchronization)', () => {
  it('returns the value only for the id it was loaded for', () => {
    const slot = { id: 'custom-fashion-designer', value: { name: 'Fashion Designer' } };
    assert.deepEqual(scoped(slot, 'custom-fashion-designer'), { name: 'Fashion Designer' });
    assert.equal(scoped(slot, 'ux'), null, 'after the target changes, the previous career is never returned');
    assert.equal(scoped(slot, ''), null);
    assert.equal(scoped(null, 'ux'), null);
  });
  it('follows a sequence of target changes without leaking the previous career', () => {
    let slot: { id: string; value: string } | null = null;
    const seen: (string | null)[] = [];
    for (const target of ['custom-fashion-designer', 'ux', 'custom-corporate-lawyer']) {
      seen.push(scoped(slot, target));       // render right after the target changed, before the new load resolves
      slot = { id: target, value: `data:${target}` }; // load resolves
      seen.push(scoped(slot, target));
    }
    assert.deepEqual(seen, [null, 'data:custom-fashion-designer', null, 'data:ux', null, 'data:custom-corporate-lawyer']);
  });
});
