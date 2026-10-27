import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { columnY, graphHeight, isCrowded, minRowGap, ROW } from '../src/utils/graphLayout';
import { ev, seed } from './helpers';

describe('graph layout never lets labels overlap', () => {
  it('rows are always at least ROW px apart, for any column size', () => {
    for (const n of [1, 2, 5, 14, 30, 60, 120]) { const h = graphHeight([n]); assert.ok(minRowGap(h, n) >= ROW - 1e-9, `n=${n}`); const ys = Array.from({ length: n }, (_, i) => columnY(h, n, i)); for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= ROW - 1e-9); }
  });
  it('the height follows the biggest column and never shrinks below the minimum', () => {
    assert.equal(graphHeight([1, 2]), 440); assert.ok(graphHeight([3, 60]) > 440); assert.equal(columnY(440, 1, 0), 220);
  });
  it('crowded careers default to the list view', () => {
    const swe = seed('swe').career; assert.equal(isCrowded(swe, []), swe.capabilities.reduce((n, c) => n + c.skills.length, 0) > 14);
    const small = { ...swe, capabilities: swe.capabilities.slice(0, 1).map((c) => ({ ...c, skills: c.skills.slice(0, 3) })) };
    assert.equal(isCrowded(small, []), false); assert.equal(isCrowded(small, Array.from({ length: 15 }, (_, i) => ev(`e${i}`, []))), true);
  });
});
