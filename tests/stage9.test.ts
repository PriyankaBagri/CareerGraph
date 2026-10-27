import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../src/services/api';
import { friendlyAiError } from '../src/services/assistant/aiClient';
import type { AssistantContext } from '../src/types';
import { suggestedPrompts } from '../src/utils/assistant';

const ctx = (over: Partial<AssistantContext> = {}): AssistantContext => ({ careerId: 'c', careerName: 'Fashion Designer', careerDescription: '', readiness: { overall: 0, assessment: { state: 'not_assessed' } } as never, skills: [], gaps: [], actions: [], roadmapProgress: 0, evidence: [], profile: { stage: '', education: '', note: '' }, ...over });

describe('Stage 9 UI honesty', () => {
  it('suggestions do not mention a gap or evidence the data does not have', () => {
    const none = suggestedPrompts(ctx());
    assert.ok(!none.some((p) => /gap|evidence helps/i.test(p)), none.join(' | '));
    assert.match(none[0], /not assessed/);
  });
  it('suggestions mention a gap and evidence once they exist', () => {
    const p = suggestedPrompts(ctx({ gaps: [{} as never], evidence: [{} as never] }));
    assert.ok(p.includes('What is my biggest gap?') && p.includes('Which evidence helps me most?'));
  });
  it('a failure to load the user\'s data gets its own plain message, not a generic one', () => {
    const m = friendlyAiError(new ApiError(503, 'context_unavailable', 'x'));
    assert.match(m, /couldn't load your CareerGraph data/); assert.notEqual(m, friendlyAiError(new ApiError(502, 'ai_unavailable', 'x')));
  });
});
