import type { CareerDataset, EvidenceType } from '../types';
import { STRENGTH_ORDER } from '../utils/constants';

type S = [name: string, current: number, required: number, evidence: string[]];
type C = [name: string, skills: S[]];
type E = [key: string, title: string, type: EvidenceType, strength: number, verified: boolean];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function build(id: string, name: string, category: string, description: string, caps: C[], ev: E[]): CareerDataset {
  return {
    career: {
      id, name, category, description, origin: { source: 'seed' },
      capabilities: caps.map(([cn, skills]) => ({
        id: `${id}:cap-${slug(cn)}`, name: cn,
        skills: skills.map(([sn, cur, req, evs]) => ({ id: `${id}:${slug(sn)}`, name: sn, currentLevel: cur, requiredLevel: req, evidenceIds: evs.map((k) => `${id}:${k}`) })),
      })),
    },
    evidence: ev.map(([k, title, type, strength], i) => ({
      id: `${id}:${k}`, source: 'example' as const, title, type, strength: STRENGTH_ORDER[strength - 1], description: `${type} demonstrating applied skill.`, date: `2025-0${(i % 9) + 1}-15`,
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
      skillIds: caps.flatMap(([, ss]) => ss.filter((s) => s[3].includes(k)).map((s) => `${id}:${slug(s[0])}`)),
    })),
  };
}

// Add a career = add one build() call. No component changes needed.
export const CAREER_DATASETS: CareerDataset[] = [
  build('ux', 'UX Designer', 'Design', 'Designs usable, research-driven digital products.', [
    ['User Research', [['User Interviews', 3, 4, ['a']], ['Data Interpretation', 2, 4, ['b']]]],
    ['Design Craft', [['Interaction Design', 4, 4, ['a', 'c']], ['Prototyping', 4, 3, ['c']]]],
    ['Collaboration', [['Stakeholder Communication', 4, 4, ['d']], ['Design Critique', 3, 3, []]]],
  ], [['a', 'Campus app redesign', 'Project', 4, true], ['b', 'Analytics course', 'Course', 2, true], ['c', 'Portfolio prototype', 'Project', 4, false], ['d', 'Agency internship', 'Internship', 3, true]]),
  build('fin', 'Financial Analyst', 'Finance', 'Models companies and markets to inform investment decisions.', [
    ['Financial Analysis', [['Financial Modeling', 3, 4, ['a']], ['Statistical Analysis', 1, 3, []]]],
    ['Market Knowledge', [['Valuation', 2, 4, ['b']], ['Industry Research', 3, 3, ['b', 'c']]]],
    ['Communication', [['Client Reporting', 4, 3, ['c']], ['Presentation', 4, 4, ['c']]]],
  ], [['a', 'Equity model project', 'Project', 3, false], ['b', 'CFA Level I', 'Certification', 4, true], ['c', 'Investment club', 'Volunteer Work', 3, false]]),
  build('swe', 'Software Engineer', 'Technology', 'Designs, builds and maintains reliable software systems.', [
    ['Problem Solving', [['Algorithms', 4, 4, ['a']], ['System Design', 2, 4, []]]],
    ['Building Software', [['Frontend Development', 4, 4, ['b', 'c']], ['Testing', 2, 3, ['b']]]],
    ['Teamwork', [['Code Review', 3, 3, ['c']], ['Technical Writing', 2, 3, []]]],
  ], [['a', 'Contest ranking', 'Competition', 4, true], ['b', 'Open-source PRs', 'Project', 3, true], ['c', 'Summer internship', 'Internship', 4, true]]),
];
