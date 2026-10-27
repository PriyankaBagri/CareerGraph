export interface Config {
  nodeEnv: string; production: boolean; port: number;
  databaseUrl: string; databaseSsl: boolean;
  clientOrigins: string[];
  jwtSecret: string | null; tokenTtlSeconds: number;
  ai: AiConfig;
}
// Server-only AI settings. The key never leaves this process: it is not sent to the browser, not logged, and not part of any API response.
export interface AiConfig { provider: 'anthropic' | 'openai-compatible' | null; apiKey: string | null; model: string | null; baseUrl: string | null; timeoutMs: number; maxOutputTokens: number; ratePerMinute: number; problem: string | null }
export const NO_AI: AiConfig = { provider: null, apiKey: null, model: null, baseUrl: null, timeoutMs: 20000, maxOutputTokens: 700, ratePerMinute: 10, problem: null };

const intIn = (env: Record<string, string | undefined>, name: string, def: number, min: number, max: number): number => {
  const raw = env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
};
// Missing or incomplete AI settings are NOT fatal: the assistant simply reports itself unavailable (with a reason that never contains a secret).
export function loadAiConfig(env: Record<string, string | undefined>): AiConfig {
  const timeoutMs = intIn(env, 'AI_TIMEOUT_MS', NO_AI.timeoutMs, 1000, 120000);
  const maxOutputTokens = intIn(env, 'AI_MAX_OUTPUT_TOKENS', NO_AI.maxOutputTokens, 50, 4000);
  const ratePerMinute = intIn(env, 'AI_RATE_LIMIT_PER_MINUTE', NO_AI.ratePerMinute, 1, 120);
  const base = { timeoutMs, maxOutputTokens, ratePerMinute };
  const raw = env.AI_PROVIDER?.trim().toLowerCase() ?? '';
  if (!raw || raw === 'none') return { ...NO_AI, ...base };
  if (raw !== 'anthropic' && raw !== 'openai-compatible') return { ...NO_AI, ...base, problem: 'AI_PROVIDER must be "anthropic", "openai-compatible" or empty.' };
  const apiKey = env.AI_API_KEY?.trim() ?? '', model = env.AI_MODEL?.trim() ?? '';
  const baseUrl = (env.AI_BASE_URL?.trim() ?? '').replace(/\/+$/, '');
  if (baseUrl && !/^https?:\/\/[^\s]+$/.test(baseUrl)) return { ...NO_AI, ...base, problem: 'AI_BASE_URL must be an http(s) URL.' };
  if (raw === 'openai-compatible' && !baseUrl) return { ...NO_AI, ...base, problem: 'AI_BASE_URL is required for the openai-compatible provider.' };
  if (!apiKey) return { ...NO_AI, ...base, problem: 'AI_API_KEY is not set.' };
  if (!model) return { ...NO_AI, ...base, problem: 'AI_MODEL is not set.' };
  return { provider: raw, apiKey, model, baseUrl: baseUrl || null, ...base, problem: null };
}

// Reads and validates configuration once at start-up. Fails fast with a clear message; never logs secret values.
export function loadConfig(env: Record<string, string | undefined>): Config {
  const databaseUrl = env.DATABASE_URL?.trim() ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL must be set.');
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error('DATABASE_URL must start with postgres:// or postgresql://.');
  try { new URL(databaseUrl); } catch { throw new Error('DATABASE_URL cannot be parsed. Percent-encode special characters in the password (@ becomes %40, # becomes %23), and wrap the value in double quotes in .env because an unquoted # cuts it off. Run "npm run db:check" for details.'); }
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a whole number between 1 and 65535.');
  const origins = (env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origins.length) throw new Error('CLIENT_ORIGIN must list at least one origin.');
  for (const o of origins) if (o === '*' || !/^https?:\/\/[^/\s]+$/.test(o)) throw new Error(`CLIENT_ORIGIN entries must be exact origins like http://localhost:5173 (got "${o}").`);
  const nodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';
  // A weak or missing secret is never used. In production the server refuses to start; elsewhere auth endpoints answer 503.
  const secret = env.JWT_SECRET?.trim() ?? '';
  if (production && secret.length < 32) throw new Error('JWT_SECRET must be set to at least 32 random characters in production.');
  const ttl = Number(env.JWT_EXPIRES_IN_SECONDS ?? 86400);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 30 * 86400) throw new Error('JWT_EXPIRES_IN_SECONDS must be a whole number between 60 and 2592000.');
  return { nodeEnv, production, port, databaseUrl, databaseSsl: env.DATABASE_SSL === 'true', clientOrigins: origins, jwtSecret: secret.length >= 32 ? secret : null, tokenTtlSeconds: ttl, ai: loadAiConfig(env) };
}
