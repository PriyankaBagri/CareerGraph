import { CAREER_DATASETS } from '../../data/careers';
import type { Career, CareerGenerationInput, CareerValidationResult } from '../../types';
import type { CareerIntelligenceProvider } from './provider';

// TEMPORARY local provider. It is NOT AI and does not "know" careers: it matches the text against a few
// broad domain templates, then personalises names. Replace with a backend/AI provider via the same interface.
type Skills = [name: string, required: number][];
interface Pattern { test: RegExp; category: string; summary: string; caps: [string, Skills][]; evidence: string[] }
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const PATTERNS: Pattern[] = [
  { test: /\b(law|legal|lawyer|advocate|attorney|barrister|judge)\b/, category: 'Law', summary: 'practising law through rigorous research, drafting and advocacy',
    caps: [['Legal Foundations', [['Legal research', 4], ['Statute and case-law analysis', 4]]], ['Drafting & Advocacy', [['Legal writing and drafting', 4], ['Negotiation and advocacy', 3]]], ['Professional Practice', [['Client communication', 3], ['Professional ethics and procedure', 3]]]],
    evidence: ['Legal research memo', 'Drafted agreement or pleading', 'Moot court, internship or case analysis'] },
  { test: /(upsc|civil serv|\bias\b|\bips\b|government|public admin|public service)/, category: 'Public Service', summary: 'competitive-exam preparation and public administration',
    caps: [['Exam Knowledge', [['General studies coverage', 4], ['Current affairs and policy awareness', 4]]], ['Analytical Writing', [['Answer writing and essays', 4], ['Optional subject mastery', 4]]], ['Governance & Ethics', [['Public administration concepts', 3], ['Ethics and integrity case analysis', 3]]], ['Exam Readiness', [['Mock tests and revision discipline', 4], ['Time management', 3]]]],
    evidence: ['Mock test scores', 'Answer-writing practice samples', 'Revision tracker or notes'] },
  { test: /(research|scientist|professor|academic|phd|lecturer)/, category: 'Research & Academia', summary: 'producing and communicating rigorous knowledge',
    caps: [['Research Methods', [['Study design', 4], ['Statistical analysis', 3]]], ['Scholarly Output', [['Literature review', 4], ['Academic writing and publication', 3]]], ['Domain Practice', [['Data collection and analysis tools', 3], ['Research ethics and compliance', 3]]]],
    evidence: ['Research project or thesis', 'Publication or conference paper', 'Analysis report'] },
  { test: /(doctor|physician|dentist|pharmac|nurs|medic|surgeon|clinic|health)/, category: 'Healthcare', summary: 'safe, evidence-based patient care',
    caps: [['Clinical Knowledge', [['Foundational medical science', 4], ['Diagnosis and clinical reasoning', 4]]], ['Patient Care', [['Patient communication', 4], ['Clinical procedures and safety', 3]]], ['Professional Practice', [['Medical ethics and regulation', 3], ['Evidence-based practice', 3]]]],
    evidence: ['Clinical rotation or internship', 'Case write-up', 'Certification or licensing exam'] },
  { test: /(teach|educat|tutor|instructor)/, category: 'Education', summary: 'designing and delivering effective learning',
    caps: [['Pedagogy', [['Instructional design', 4], ['Lesson planning', 4]]], ['Classroom Practice', [['Classroom management', 3], ['Assessment and feedback', 3]]], ['Learner Support', [['Communication with learners and families', 3], ['Inclusive teaching', 3]]]],
    evidence: ['Lesson plans', 'Teaching practicum', 'Student assessment samples'] },
  { test: /(financ|account|invest|bank|audit|chartered|\bca\b|actuar)/, category: 'Finance & Accounting', summary: 'sound financial analysis, reporting and judgement',
    caps: [['Financial Foundations', [['Accounting principles', 4], ['Financial statement analysis', 4]]], ['Analysis & Reporting', [['Financial modelling', 3], ['Reporting and presentation', 3]]], ['Compliance & Judgement', [['Regulation and compliance', 3], ['Risk assessment', 3]]]],
    evidence: ['Financial model or analysis', 'Certification progress', 'Internship or audit exposure'] },
  { test: /(manager|product|marketing|entrepreneur|founder|\bhr\b|human resource|consult|business|operations)/, category: 'Business & Management', summary: 'making decisions and leading outcomes',
    caps: [['Strategy & Analysis', [['Market and customer analysis', 4], ['Business problem-solving', 4]]], ['Execution', [['Planning and prioritisation', 3], ['Data-informed decision making', 3]]], ['People & Influence', [['Leadership and collaboration', 4], ['Stakeholder communication', 3]]]],
    evidence: ['Project or initiative led', 'Business case or plan', 'Team or internship experience'] },
  { test: /(engineer|developer|software|data|cyber|security|programmer|technician|network)/, category: 'Engineering & Technology', summary: 'building and maintaining reliable technical systems',
    caps: [['Technical Foundations', [['Core technical fundamentals', 4], ['Problem solving', 4]]], ['Building & Delivery', [['Applied project work', 4], ['Tools and methods', 3]]], ['Collaboration', [['Technical communication', 3], ['Quality and safety practice', 3]]]],
    evidence: ['Project or prototype', 'Technical report or repository', 'Internship or certification'] },
  { test: /(design|fashion|architect|artist|creative|illustrat|photograph)/, category: 'Design & Creative', summary: 'turning ideas into crafted, professional work',
    caps: [['Creative Craft', [['Design fundamentals', 4], ['Concept development', 4]]], ['Production', [['Tools and technique', 4], ['Prototyping and making', 3]]], ['Professional Practice', [['Portfolio and presentation', 4], ['Client and trend awareness', 3]]]],
    evidence: ['Portfolio piece', 'Case study', 'Collaboration or internship'] },
  { test: /(journal|writer|content|creator|editor|media|broadcast)/, category: 'Media & Communication', summary: 'researching, creating and distributing credible content',
    caps: [['Storytelling', [['Research and fact-checking', 4], ['Writing and editing', 4]]], ['Audience', [['Audience understanding', 3], ['Distribution and platforms', 3]]], ['Professional Practice', [['Ethics and credibility', 3], ['Interviewing and sourcing', 3]]]],
    evidence: ['Published pieces', 'Portfolio of work', 'Editorial or internship experience'] },
];
const GENERIC: Pattern = { test: /./, category: 'General Professional', summary: 'building the knowledge, practice and communication the role expects',
  caps: [['Foundational Knowledge', [['Industry and regulatory awareness', 3]]], ['Applied Practice', [['Practical application', 4], ['Problem solving', 3]]], ['Professional Communication', [['Written communication', 3], ['Stakeholder communication', 3]]], ['Professional Development', [['Networking and mentorship', 3], ['Continuous learning', 3]]]],
  evidence: ['Project or practical work', 'Course or certification', 'Work, volunteer or internship experience'] };

export class MockCareerIntelligenceProvider implements CareerIntelligenceProvider {
  readonly id = 'local-demo-provider';

  async generateCareerModel(input: CareerGenerationInput): Promise<Career> {
    await wait(700);
    const name = input.name.trim().replace(/\s+/g, ' ');
    const p = PATTERNS.find((x) => x.test.test(`${name} ${input.field ?? ''}`.toLowerCase())) ?? GENERIC;
    const id = `custom-${slug(name)}`;
    const ctx = input.description?.trim();
    const capabilities = p.caps.map(([cn, skills], ci) => ({
      id: `${id}:cap-${slug(cn)}`, name: cn,
      skills: (ci === 0 ? [[`${name}: core domain knowledge`, 4] as [string, number], ...skills] : skills).map(([sn, req]) => ({ id: `${id}:${slug(sn)}`, name: sn, currentLevel: 0, requiredLevel: req, evidenceIds: [] as string[] })),
    }));
    return {
      id, name, category: input.field?.trim() || p.category,
      description: `A starting model for ${name}, focused on ${p.summary}.${ctx ? ` Your goal: ${ctx}` : ''}`,
      capabilities, evidenceExpectations: p.evidence,
      origin: { source: 'custom', createdAt: new Date().toISOString(), generatedFrom: this.id },
    };
  }

  async searchCareers(query: string): Promise<Career[]> {
    const q = query.trim().toLowerCase();
    return CAREER_DATASETS.map((d) => d.career).filter((c) => !q || `${c.name} ${c.category}`.toLowerCase().includes(q));
  }

  async validateCareerModel(career: Career): Promise<CareerValidationResult> {
    const errors: string[] = [];
    if (!career.name.trim()) errors.push('Career has no name.');
    const skills = career.capabilities.flatMap((c) => c.skills);
    if (!career.capabilities.length) errors.push('Career has no capabilities.');
    if (career.capabilities.some((c) => c.skills.length === 0)) errors.push('A capability has no skills.');
    if (!skills.length) errors.push('Career has no skills.');
    if (skills.some((s) => !Number.isInteger(s.requiredLevel) || s.requiredLevel < 1 || s.requiredLevel > 5)) errors.push('A skill has an invalid required level.');
    if (new Set(skills.map((s) => s.id)).size !== skills.length) errors.push('Skill ids are not unique.');
    return { valid: errors.length === 0, errors };
  }
}
