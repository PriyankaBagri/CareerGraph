import * as c from '../controllers/core';
import type { Route } from '../http/types';

// All Stage 3 routes require a verified Bearer token.
export const coreRoutes: Route[] = [
  { method: 'GET', path: '/api/careers', auth: true, handler: c.listCareers },
  { method: 'POST', path: '/api/careers', auth: true, handler: c.createCareer },
  { method: 'GET', path: '/api/careers/:careerId', auth: true, handler: c.getCareer },
  { method: 'PUT', path: '/api/careers/:careerId', auth: true, handler: c.putCareer },
  { method: 'DELETE', path: '/api/careers/:careerId', auth: true, handler: c.deleteCareer },
  { method: 'GET', path: '/api/careers/:careerId/skills', auth: true, handler: c.getCareerSkills },
  { method: 'GET', path: '/api/me/skills', auth: true, handler: c.listMySkills },
  { method: 'GET', path: '/api/me/skills/:skillId', auth: true, handler: c.getMySkill },
  { method: 'PUT', path: '/api/me/skills/:skillId', auth: true, handler: c.putMySkill },
  { method: 'DELETE', path: '/api/me/skills/:skillId', auth: true, handler: c.deleteMySkill },
  { method: 'GET', path: '/api/evidence', auth: true, handler: c.listEvidence },
  { method: 'POST', path: '/api/evidence', auth: true, handler: c.createEvidence },
  { method: 'GET', path: '/api/evidence/:evidenceId', auth: true, handler: c.getEvidence },
  { method: 'PUT', path: '/api/evidence/:evidenceId', auth: true, handler: c.putEvidence },
  { method: 'DELETE', path: '/api/evidence/:evidenceId', auth: true, handler: c.deleteEvidence },
  { method: 'POST', path: '/api/evidence/:evidenceId/skills/:skillId', auth: true, handler: c.linkEvidenceSkill },
  { method: 'DELETE', path: '/api/evidence/:evidenceId/skills/:skillId', auth: true, handler: c.unlinkEvidenceSkill },
];
