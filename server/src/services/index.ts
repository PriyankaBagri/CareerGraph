import type { Config } from '../config';
import type { AllRepos } from '../repositories/types';
import { TokenService } from '../utils/token';
import { AuthService } from './auth';
import { CoreService } from './core';
import { ReadinessService } from './readiness';
import { ProfileService } from './profile';
import { ProgressService } from './progress';
import { AssistantService } from './assistant';
import { CareerDraftService } from './careerDraft';
import { createAiProvider, type AiProvider } from '../ai/provider';
import { silentLogger, type Logger } from '../logger';

export interface Services { auth: AuthService; profile: ProfileService; core: CoreService; readiness: ReadinessService; progress: ProgressService; assistant: AssistantService; careerDraft: CareerDraftService }
export function createServices(deps: { repos: AllRepos; config: Config; now?: () => Date; aiProvider?: AiProvider | null; logger?: Logger }): Services {
  const { repos, config } = deps;
  const clock = deps.now ?? (() => new Date());
  const tokens = config.jwtSecret ? new TokenService(config.jwtSecret, config.tokenTtlSeconds, () => clock().getTime()) : null;
  const readiness = new ReadinessService(repos);
  const provider = deps.aiProvider !== undefined ? deps.aiProvider : createAiProvider(config.ai);
  const assistant = new AssistantService({ provider, ai: config.ai, readiness, repos, logger: deps.logger ?? silentLogger, now: clock });
  const careerDraft = new CareerDraftService({ provider, ai: config.ai, logger: deps.logger ?? silentLogger, now: clock });
  return { auth: new AuthService(repos, tokens, () => clock().getTime()), profile: new ProfileService(repos), progress: new ProgressService(repos), core: new CoreService(repos), readiness, assistant, careerDraft };
}
