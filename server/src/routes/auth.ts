import { login, logout, me, register } from '../controllers/auth';
import type { Route } from '../http/types';

export const authRoutes: Route[] = [
  { method: 'POST', path: '/api/auth/register', handler: register },
  { method: 'POST', path: '/api/auth/login', handler: login },
  { method: 'GET', path: '/api/auth/me', auth: true, handler: me },
  { method: 'POST', path: '/api/auth/logout', handler: logout },
];
