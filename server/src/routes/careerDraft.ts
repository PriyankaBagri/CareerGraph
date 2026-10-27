import * as c from '../controllers/careerDraft';
import type { Route } from '../http/types';

export const careerDraftRoutes: Route[] = [{ method: 'POST', path: '/api/careers/draft', auth: true, handler: c.draftCareer }];
