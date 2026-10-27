import type { Profile, User } from '../types';
export const DEMO_USER: User = { id: 'u1', name: 'Alex Morgan', email: 'alex@example.com', initials: 'AM' };
export const DEMO_PASSWORD = 'Password1'; // mock only
export const DEMO_PROFILE: Profile = {
  userId: 'u1', stage: 'Final-year student', education: 'BA, Interaction Design', experienceSummary: 'One internship, three projects.',
  targetCareerId: 'ux', experienceLevel: 'early', isDemo: true, onboardingComplete: true, skillAssessments: [], completeness: 82, lastAnalysis: '2025-09-01',
  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-09-01T00:00:00.000Z',
};
