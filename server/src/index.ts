import { createApp } from './app';
import { loadConfig } from './config';
import { createPgDb } from './db/pool';
import { HEALTH_TIMEOUT_MS } from './db/timeouts';
import { createPgRepos } from './repositories/pg';
import { createPgCoreRepos } from './repositories/pg-core';
import { createPgProgressRepos } from './repositories/pg-progress';
import { createServices } from './services';
import { checkDatabase } from './routes/health';
import { REASON_HINT } from './db/diagnose';
import { routes } from './routes';
import { consoleLogger as logger } from './logger';
import { describeListenError } from './utils/listenError';

const config = loadConfig(process.env);
const db = createPgDb({ url: config.databaseUrl, ssl: config.databaseSsl, logger });
const services = createServices({ repos: { ...createPgRepos(db), ...createPgCoreRepos(db), ...createPgProgressRepos(db) }, config, logger });
if (config.ai.problem) logger.warn(`AI assistant disabled: ${config.ai.problem}`);
else if (config.ai.provider) logger.info('AI assistant enabled', { provider: config.ai.provider, model: config.ai.model });
else logger.info('AI assistant not configured (AI_PROVIDER is empty); the app works without it.');
if (!config.jwtSecret) logger.warn('JWT_SECRET is not set (or shorter than 32 characters): authentication endpoints will answer 503 until it is configured.');
const app = createApp(routes, { config, db, logger, services, now: () => new Date(), version: process.env.npm_package_version ?? '0.1.0', healthTimeoutMs: HEALTH_TIMEOUT_MS });

const server = app.listen(config.port, async () => {
  logger.info('CareerGraph API listening', { port: config.port, env: config.nodeEnv });
  const first = await checkDatabase(db, HEALTH_TIMEOUT_MS);
  if (!first.up) logger.warn(`Database is not reachable (${first.reason}). ${REASON_HINT[first.reason!]} Run "npm run db:check" for details.`);
});
server.on('error', (err: NodeJS.ErrnoException) => { logger.error(describeListenError(err, config.port)); process.exit(1); });
const shutdown = (signal: string) => { logger.info('Shutting down', { signal }); server.close(async () => { await db.close(); process.exit(0); }); };
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
