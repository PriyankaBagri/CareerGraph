import * as c from '../controllers/progress';
import type { Route } from '../http/types';

export const progressRoutes: Route[] = [
  { method: 'GET', path: '/api/careers/:careerId/action-progress', auth: true, handler: c.listProgress },
  { method: 'PUT', path: '/api/careers/:careerId/action-progress/:actionKey', auth: true, handler: c.putProgress },
  { method: 'DELETE', path: '/api/careers/:careerId/action-progress/:actionKey', auth: true, handler: c.deleteProgress },
  { method: 'GET', path: '/api/settings', auth: true, handler: c.getSettings },
  { method: 'PUT', path: '/api/settings', auth: true, handler: c.putSettings },
];
