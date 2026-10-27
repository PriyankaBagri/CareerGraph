import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DEMO_PROFILE } from '../src/data/profile';
import { assistantService } from '../src/services/assistant';
import type { AssistantContext, CareerDataset, Evidence } from '../src/types';
import { buildRoadmap } from '../src/utils/actions';
import { answerQuestion, buildAssistantContext, detectIntent, suggestedPrompts } from '../src/utils/assistant';
import { analyze, ev, generate, rateAll, seed } from './helpers';

const ctxFor = (ds: CareerDataset, levels: Record<string, number> = {}, evidence: Evidence[] = []): AssistantContext => {
  const v = analyze(ds, { ...rateAll(ds), ...levels }, evidence);
  return buildAssistantContext(v, v.actions, buildRoadmap(ds.career.id, v.actions), DEMO_PROFILE);
};
const CAREERS = ['ux', 'swe', 'fin'] as const;
const GENERATED = ['Fashion Designer', 'Corporate Lawyer', 'UPSC Civil Services', 'Teacher', 'Architect'];

describe('career assistant (local rule-based provider)', () => {
  it('is labelled as rule-based and not AI, and has no network or key handling', () => {
    assert.equal(assistantService.provider.kind, 'local-rules');
    assert.match(assistantService.provider.label, /not AI/);
    for (const f of ['src/services/assistant/localProvider.ts', 'src/services/assistant.ts', 'src/utils/assistant.ts']) {
      const src = readFileSync(f, 'utf8');
      assert.ok(!/fetch\(|XMLHttpRequest|apiKey|api_key|anthropic|openai|VITE_/i.test(src), f);
    }
  });

  it('explains readiness from the real numbers', async () => {
    const c = ctxFor(seed('ux'), {}, []);
    const a = await assistantService.ask(`Why is my readiness ${c.readiness.overall}%?`, c);
    assert.ok(a.text.includes(`${c.readiness.overall}%`) && a.text.includes(c.careerName));
    assert.ok(c.readiness.metrics.every((m) => a.text.includes(`${m.value}%`)));
    assert.equal(a.references[0].kind, 'readiness');
  });

  it('explains gaps, evidence gaps and next actions from the same engine', () => {
    const sk = 'ux:data-interpretation';
    const c = ctxFor(seed('ux'), { [sk]: 4 });
    const gaps = answerQuestion('What is my biggest gap?', c);
    assert.match(gaps.text, /most important gaps/);
    assert.match((gaps.items ?? []).map((i) => i.detail).join(' '), /evidence gap|skill gap|skill \+ evidence gap/);
    assert.ok((gaps.items ?? []).length > 0 && (gaps.items ?? []).every((i) => i.kind === 'skill' && i.href?.startsWith('/skills/')));
    assert.ok(gaps.references.every((r) => r.kind === 'skill' && r.href?.startsWith('/skills/')));
    const next = answerQuestion('What should I work on next?', c);
    assert.ok((next.items ?? []).some((i) => c.actions.some((a) => a.title === i.title)));
    assert.match((next.items ?? []).map((i) => i.detail).join(' '), /priority because/);
  });

  it('explains why an action is recommended, and how evidence strengthens a skill', () => {
    const sk = 'ux:data-interpretation';
    const c = ctxFor(seed('ux'), { [sk]: 4 }, [ev('Case study', [sk], 'strong')]);
    const top = c.actions[0];
    const why = answerQuestion(`Why is "${top.title}" recommended?`, c);
    assert.equal(detectIntent(`Why is "${top.title}" recommended?`, c), 'action');
    assert.ok(why.text.includes(top.reason)); assert.equal(why.references[0].kind, 'action');
    const how = answerQuestion('How does Case study strengthen Data Interpretation?', c);
    assert.match(how.text, /strong evidence/); assert.match(how.text, /Data Interpretation/); assert.match(how.text, /coverage/);
    const none = answerQuestion('Which evidence helps me most?', ctxFor(seed('ux'), {}, []));
    assert.match(none.text, /no evidence|have supporting evidence/);
  });

  it('maps the profile to the target career without ranking anything', () => {
    const c = ctxFor(seed('fin'));
    const a = answerQuestion('How does my profile map to this career?', c);
    assert.match(a.text, /of \d+ skills are on track/);
    assert.ok(!/best|winner|better career/i.test(a.text));
  });

  it('falls back to help for unknown or empty questions without throwing', () => {
    const c = ctxFor(seed('swe'));
    for (const q of ['', '   ', 'blorp zzz', 'what is the weather']) assert.match(answerQuestion(q, c).text, /I can explain/);
  });

  for (const name of GENERATED) {
    it(`works for generated career: ${name} (no leakage from other careers)`, async () => {
      const c = ctxFor(await generate(name));
      const others = [...CAREERS.map((id) => seed(id).career.name), ...GENERATED.filter((g) => g !== name)];
      for (const q of suggestedPrompts(c)) {
        const a = await assistantService.ask(q, c);
        assert.ok(a.text.length > 20, q);
        for (const o of others) assert.ok(!a.text.includes(o), `"${o}" leaked into answer for ${name}: ${q}`);
      }
      assert.ok(suggestedPrompts(c).some((p) => p.includes(name)));
    });
  }
  for (const id of CAREERS) {
    it(`works for seeded career: ${id}`, async () => {
      const c = ctxFor(seed(id));
      for (const q of suggestedPrompts(c)) assert.ok((await assistantService.ask(q, c)).text.includes(c.careerName) || /priority because|Readiness|evidence/i.test((await assistantService.ask(q, c)).text), q);
    });
  }
  it('answers change when the target career changes (context is the only source)', () => {
    const a = answerQuestion('What is my biggest gap?', ctxFor(seed('ux'))).text;
    const b = answerQuestion('What is my biggest gap?', ctxFor(seed('fin'))).text;
    assert.notEqual(a, b);
  });
});

describe('rule-based explainer: open-ended questions are not forced into an unrelated data report', () => {
  const GENERAL_Q = ['How do I become a corporate lawyer?', 'Explain recursion using a simple example.', 'What skills do I need to become a fashion designer?', 'How can I build a portfolio for architecture?', 'I have limited time and money. What is the most practical way to start learning this skill?', 'Compare a research career with a software engineering career.', 'what is the weather'];
  for (const id of CAREERS) it(`general questions say they need an AI model and never show readiness, gap or evidence output (${id})`, () => {
    const c = ctxFor(seed(id));
    for (const q of GENERAL_Q) {
      assert.equal(detectIntent(q, c), 'general', q);
      const a = answerQuestion(q, c);
      assert.match(a.text, /general question/); assert.match(a.text, /not an AI model/); assert.ok(!a.items?.length, q);
      assert.ok(!/Your readiness for|Your most important gaps|have no evidence for/.test(a.text), q);
    }
  });
  it('questions about the user\'s own data still reach the structured handlers', () => {
    const c = ctxFor(seed('swe'));
    const want: [string, string][] = [['Why is my readiness 40%?', 'readiness'], ['What is my biggest gap?', 'gaps'], ['Which evidence helps me most?', 'evidenceSkill'], ['What should I work on next?', 'next'], ['How does my profile map to this career?', 'profile'], ['What evidence do I have?', 'evidence'], ['Where am I weakest?', 'gaps']];
    for (const [q, intent] of want) assert.equal(detectIntent(q, c), intent, q);
    for (const q of suggestedPrompts(c)) assert.notEqual(detectIntent(q, c), 'general', `suggested prompt must be answerable: ${q}`);
  });
  it('the rule-based answer is never labelled as AI', () => {
    const a = answerQuestion('Explain recursion', ctxFor(seed('swe')));
    assert.ok(!/AI-generated/.test(a.text));
  });
});
