import * as c from '../controllers/assistant';
import type { Route } from '../http/types';

export const assistantRoutes: Route[] = [
  { method: 'GET', path: '/api/assistant/status', auth: true, handler: c.assistantStatus },
  { method: 'POST', path: '/api/assistant/chat', auth: true, handler: c.assistantChat },
];
