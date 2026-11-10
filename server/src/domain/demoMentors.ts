// DEMO / SANDBOX DATA ONLY. These are invented sample profiles used to exercise mentor discovery and booking in development.
// They are NOT real people and NOT verified professionals; prices are illustrative sandbox values. Loaded by `npm run db:seed` and by the in-memory test repositories.
export interface DemoSession { id: string; title: string; description: string; durationMinutes: number; price: string; currency: string }
export interface DemoMentor { id: string; displayName: string; fields: string[]; headline: string; bio: string; expertise: string[]; sessions: DemoSession[] }

const NOTE = ' This is a demo profile for sandbox testing, not a real or verified professional.';
export const DEMO_MENTORS: DemoMentor[] = [
  { id: '00000000-0000-4000-8000-00000000d001', displayName: 'Demo Mentor: UX Design', fields: ['design'], headline: 'Sample profile: portfolio and research feedback', bio: `Illustrative mentor who reviews design portfolios and talks through user-research basics.${NOTE}`, expertise: ['UX design', 'Portfolio review', 'User research'], sessions: [
    { id: '00000000-0000-4000-8000-00000000e001', title: 'Portfolio review', description: 'Written and live feedback on one case study.', durationMinutes: 30, price: '25.00', currency: 'USD' },
    { id: '00000000-0000-4000-8000-00000000e002', title: 'Career path chat', description: 'Talk through how to move from learning to a first design role.', durationMinutes: 60, price: '45.00', currency: 'USD' }] },
  { id: '00000000-0000-4000-8000-00000000d002', displayName: 'Demo Mentor: Software Engineering', fields: ['technology'], headline: 'Sample profile: projects, code review and interviews', bio: `Illustrative mentor who reviews student projects and practises interview questions.${NOTE}`, expertise: ['Software engineering', 'Code review', 'Interview practice'], sessions: [
    { id: '00000000-0000-4000-8000-00000000e003', title: 'Project code review', description: 'Feedback on one small project repository.', durationMinutes: 45, price: '35.00', currency: 'USD' },
    { id: '00000000-0000-4000-8000-00000000e004', title: 'Mock technical interview', description: 'A practice interview with written feedback.', durationMinutes: 60, price: '50.00', currency: 'USD' }] },
  { id: '00000000-0000-4000-8000-00000000d003', displayName: 'Demo Mentor: Finance', fields: ['finance'], headline: 'Sample profile: first finance roles and CV feedback', bio: `Illustrative mentor who gives feedback on CVs and explains common entry routes into finance.${NOTE}`, expertise: ['Financial analysis', 'CV feedback', 'Entry routes'], sessions: [
    { id: '00000000-0000-4000-8000-00000000e005', title: 'CV and cover letter review', description: 'Written feedback on a CV and one cover letter.', durationMinutes: 30, price: '20.00', currency: 'USD' }] },
  { id: '00000000-0000-4000-8000-00000000d004', displayName: 'Demo Mentor: Law', fields: ['law', 'legal'], headline: 'Sample profile: law applications and legal career paths', bio: `Illustrative mentor who talks through routes into legal careers and reviews law-school or traineeship applications.${NOTE}`, expertise: ['Legal career paths', 'Applications', 'Interview practice'], sessions: [
    { id: '00000000-0000-4000-8000-00000000e006', title: 'Legal career Q&A', description: 'Ask questions about studying law and entry routes.', durationMinutes: 30, price: '20.00', currency: 'USD' },
    { id: '00000000-0000-4000-8000-00000000e007', title: 'Application and CV review', description: 'Written feedback on a law application or CV.', durationMinutes: 45, price: '30.00', currency: 'USD' }] },
];
