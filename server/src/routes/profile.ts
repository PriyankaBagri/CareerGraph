import { getProfile, putProfile } from '../controllers/profile';
import type { Route } from '../http/types';

export const profileRoutes: Route[] = [
  { method: 'GET', path: '/api/profile', auth: true, handler: getProfile },
  { method: 'PUT', path: '/api/profile', auth: true, handler: putProfile },
];
