import type { Career, Evidence } from '../types';

// Layout rules for the career graph, kept pure so they can be tested. Nodes in a column are spaced at least ROW px apart (one text line plus padding),
// so labels cannot overlap vertically however many skills or evidence items there are. When there are too many for a graph to be comfortable,
// the list view is offered first.
export const ROW = 28, TOP = 40, MIN_H = 440, CROWDED_SKILLS = 14, CROWDED_EVIDENCE = 14;
export const graphHeight = (columnSizes: number[]): number => Math.max(MIN_H, TOP * 2 + ROW * (Math.max(1, ...columnSizes) - 1));
export const columnY = (height: number, n: number, i: number): number => (n === 1 ? height / 2 : TOP + ((height - TOP * 2) * i) / (n - 1));
export function isCrowded(career: Career, evidence: Evidence[]): boolean {
  const skills = career.capabilities.reduce((n, c) => n + c.skills.length, 0);
  return skills > CROWDED_SKILLS || evidence.length > CROWDED_EVIDENCE;
}
export const minRowGap = (height: number, n: number): number => (n <= 1 ? Infinity : (height - TOP * 2) / (n - 1));
