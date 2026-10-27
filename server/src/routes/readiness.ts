import { getActions, getGaps, getGraph, getReadiness } from '../controllers/readiness';
import type { Route } from '../http/types';

export const readinessRoutes: Route[] = [
  { method: 'GET', path: '/api/careers/:careerId/readiness', auth: true, handler: getReadiness },
  { method: 'GET', path: '/api/careers/:careerId/gaps', auth: true, handler: getGaps },
  { method: 'GET', path: '/api/careers/:careerId/actions', auth: true, handler: getActions },
  { method: 'GET', path: '/api/careers/:careerId/graph', auth: true, handler: getGraph },
];
