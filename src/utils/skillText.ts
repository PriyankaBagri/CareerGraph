// A skill's stored description may end with "Evidence to show: ..." (how the career-draft flow stores a per-skill evidence note).
export const EVIDENCE_LABEL = 'Evidence to show:';
export function splitSkillText(raw: string | undefined): { description: string; evidenceNote: string } {
  const text = raw ?? '', i = text.indexOf(EVIDENCE_LABEL);
  return i < 0 ? { description: text.trim(), evidenceNote: '' } : { description: text.slice(0, i).trim(), evidenceNote: text.slice(i + EVIDENCE_LABEL.length).trim() };
}
// CareerGraph's own 0-5 scale in plain words. It is a self-rating guide, not an industry standard or a certification level.
export const LEVEL_MEANING = [
  'You have not started, or cannot do this yet.',
  'You know the basic ideas but need help to apply them.',
  'You can do simple tasks, with some guidance.',
  'You can do typical tasks on your own.',
  'You can handle harder, less familiar problems and help others.',
  'You can lead, design new approaches and teach this.',
] as const;
