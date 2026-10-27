import type { Route } from '../http/types';
import { authRoutes } from './auth';
import { coreRoutes } from './core';
import { assistantRoutes } from './assistant';
import { careerDraftRoutes } from './careerDraft';
import { healthRoute, liveRoute } from './health';
import { readinessRoutes } from './readiness';
import { profileRoutes } from './profile';
import { progressRoutes } from './progress';

// Later phases add their routes here. Handlers stay thin: route -> controller -> service -> repository.
export const routes: Route[] = [healthRoute, liveRoute, ...authRoutes, ...profileRoutes, ...coreRoutes, ...readinessRoutes, ...progressRoutes, ...assistantRoutes, ...careerDraftRoutes];
