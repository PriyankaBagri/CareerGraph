import { LEVEL_NAMES, type NextAction } from './readiness';

// Student-facing guidance for a ranked action. It is DERIVED from data that already exists (the action itself, the skill's own description and
// evidence note, the career's evidence expectations). It adds no score, changes no ranking and never touches ratings. It invents no
// resources, certifications, prerequisites or job requirements: `resources` holds search hints, not links.
export const EVIDENCE_LABEL = 'Evidence to show:';
export type GuidanceKind = 'foundation' | 'practice' | 'portfolio' | 'assess' | 'evidence';
export const KIND_LABEL: Record<GuidanceKind, string> = { foundation: 'Learning the basics', practice: 'Practice exercise', portfolio: 'Portfolio project', assess: 'Quick self-check', evidence: 'Add proof' };

export interface SkillNotes { description: string; evidenceNote: string }
export interface ActionGuidance {
  kind: GuidanceKind; kindLabel: string; title: string; whyItMatters: string; whyNow: string; outcome: string;
  steps: string[]; prerequisites: string[];
  effort: { text: string; isEstimate: true; basis: string };
  resources: { note: string; searchTerms: string[] };
  definitionOfDone: string[]; evidenceToSubmit: string; ratingNote: string;
}

// A skill's stored description may end with "Evidence to show: ..." (how the career-draft flow stores per-skill evidence notes).
export function splitSkillText(raw: string): SkillNotes {
  const i = raw.indexOf(EVIDENCE_LABEL);
  if (i < 0) return { description: raw.trim(), evidenceNote: '' };
  return { description: raw.slice(0, i).trim(), evidenceNote: raw.slice(i + EVIDENCE_LABEL.length).trim() };
}
const lvl = (n: number) => `${LEVEL_NAMES[Math.min(5, Math.max(0, Math.round(n)))]} (${n})`;
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

// The level the student is working towards next, not the final target, decides how big the task is. This keeps an advanced project from being
// suggested to someone who has not yet reached the basics.
export function kindFor(a: Pick<NextAction, 'type' | 'currentLevel' | 'targetLevel'>): GuidanceKind {
  if (a.type === 'assess_skill') return 'assess';
  if (a.type === 'add_evidence') return 'evidence';
  const next = Math.min(5, (a.currentLevel ?? 0) + 1);
  return next <= 2 ? 'foundation' : next === 3 ? 'practice' : 'portfolio';
}

export function buildGuidance(a: NextAction, careerName: string, notes: SkillNotes, careerExpectations: string[]): ActionGuidance {
  const kind = kindFor(a), skill = a.skillName, cur = a.currentLevel;
  const meaning = notes.description ? ` What it means: ${sentence(notes.description)}` : '';
  const evidenceHint = notes.evidenceNote || careerExpectations[0] || '';
  const evidenceToSubmit = notes.evidenceNote ? `${sentence(notes.evidenceNote)} Link it to “${skill}” in your Evidence library.`
    : careerExpectations.length ? `Something you made or did that shows ${skill}, for example: ${careerExpectations.slice(0, 2).join('; ')}. Link it to “${skill}” in your Evidence library.`
    : `Something you made or did that shows ${skill} (a project, a write-up, a course result). Link it to “${skill}” in your Evidence library.`;
  const base = {
    kind, kindLabel: KIND_LABEL[kind], evidenceToSubmit,
    basis: `Template guidance: general steps adapted to this skill's name${notes.description ? ', its description' : ''} and your current rating. It is not verified, career-specific advice and no expert has reviewed it.`,
    whyItMatters: `For ${careerName}, ${skill} (in “${a.capabilityName}”) is expected at ${lvl(a.targetLevel)} and counts ${a.priority === 'high' ? 'for a lot' : 'for a fair amount'} (importance in this career model).${meaning}`,
    ratingNote: 'Marking this done only records that you did the work. It does not change your skill rating or your readiness. After practising, rate the skill yourself on its page.',
    resources: { note: 'No links are included because none have been checked. Search for beginner-friendly material, or ask a teacher, mentor or the course you are taking.', searchTerms: [`${skill} beginner exercises`, `${skill} for ${careerName}`] },
  };
  if (kind === 'assess') {
    return { ...base, title: `Rate your ${skill} level`, whyNow: `CareerGraph does not know your ${skill} level yet, so it cannot tell if this is a gap. This is the quickest way to make your plan more accurate.`,
      outcome: `A saved honest rating for ${skill}.`,
      steps: [`Open the ${skill} page.`, `Read what each level means.`, `Pick the highest level you could show with real work today. Unsure? Choose the lower one.`, `Save the rating.`],
      prerequisites: ['None. A rough honest rating is fine; you can change it later.'],
      effort: { text: '5–10 minutes', isEstimate: true, basis: 'Rough estimate: reading the level descriptions and choosing one.' },
      definitionOfDone: [`${skill} has a saved self-rating.`], evidenceToSubmit: 'No evidence is needed to rate a skill. Evidence can be added later to support the rating.' };
  }
  if (kind === 'evidence') {
    return { ...base, title: `Add proof of your ${skill}`, whyNow: `You rated ${skill} at or above the target, but ${a.reason.replace(/^.*?but /, '')} Evidence shows others how you got there.`,
      outcome: `At least one piece of real work linked to ${skill}.`,
      steps: [`Think of something you made or did that used ${skill}.${evidenceHint ? ` Ideas: ${evidenceHint}` : ''}`, 'Add it in the Evidence library with a short description (what you did and what resulted).', `Link it to ${skill}.`, 'Choose a strength that honestly matches it. A course certificate is usually weaker than something you built.'],
      prerequisites: ['Some work you have actually done. If you have none yet, use a practice task for this skill first.'],
      effort: { text: '30–90 minutes', isEstimate: true, basis: 'Rough estimate: writing up and linking work you already have.' },
      definitionOfDone: [a.completionCriterion, 'The item has a title, description and honest strength.'] };
  }
  const to = Math.min(5, (cur ?? 0) + 1);
  const gap = Math.max(1, a.targetLevel - (cur ?? 0));
  const steps = kind === 'foundation'
    ? [`Find one beginner-friendly explanation of ${skill} you trust (a course unit, book chapter or tutorial).`, 'Write the 3 most important ideas in your own words.', `Do 3 to 5 small exercises on ${skill} and check your answers.`, 'Write a short note: what is clear, and what is still confusing.', `Re-rate ${skill} on its page if you now feel more confident.`]
    : kind === 'practice'
      ? [`Pick one small, realistic task where ${careerName} work uses ${skill}.${meaning}`, 'Write down what a good result looks like before you start.', 'Do the task. Keep notes on anything you got stuck on.', 'Compare your result with your “good result” notes and fix the biggest gap.', 'Save what you made (file, notes or link) for your Evidence library.']
      : [`Choose a small but complete project that needs ${skill} at ${lvl(to)} level.${meaning}`, 'Write the goal and what “finished” means in 3 sentences.', 'Build it in stages and keep a short log of decisions.', evidenceHint ? `Check the result against: ${evidenceHint}` : 'Ask someone more experienced to review it, or compare it with a good public example.', 'Publish or save it (for example a repository or document) with a short explanation.', 'Add it to your Evidence library and link it to this skill.'];
  const hours = kind === 'foundation' ? [3, 8] : kind === 'practice' ? [4, 10] : [10, 25];
  return { ...base,
    title: kind === 'foundation' ? `Learn the basics of ${skill}` : kind === 'practice' ? `Practise ${skill} on a small task` : `Show ${skill} in a real project`,
    whyNow: `You are at ${lvl(cur ?? 0)} and this career expects ${lvl(a.targetLevel)}, a gap of ${gap}. ${a.priority === 'high' ? 'It is ranked high because the gap is large or the skill is very important.' : 'It is next on your list by rule-based ranking.'} The next step is to reach ${lvl(to)}.`,
    outcome: kind === 'foundation' ? `You can explain the main ideas of ${skill} and solve simple problems with it.` : kind === 'practice' ? `You complete a realistic task using ${skill} and can show the result.` : `A finished project that demonstrates ${skill}, which you can link as evidence.`,
    steps, prerequisites: cur !== null && cur >= 1 ? [`You rated ${skill} at ${lvl(cur)}, so you already have some basics.`] : [`None required for the basics of ${skill}.`],
    effort: { text: `about ${hours[0]}–${hours[1]} hours`, isEstimate: true, basis: 'Rough estimate for one step up in level. It varies a lot between people and is not measured from your data.' },
    definitionOfDone: [kind === 'portfolio' ? 'The project works and meets the goal you wrote down.' : 'You finished the steps and can explain what you did.', 'You saved something another person could look at.', `You re-rated ${skill} honestly afterwards. The rating may stay the same.`] };
}
