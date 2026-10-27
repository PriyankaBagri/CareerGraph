// Database connectivity diagnostics. Everything returned here is safe to print: it never contains the URL, user name, password,
// host name of a credential, or raw driver error text. Only enumerated categories and booleans are exposed.
export type DbReason = 'timeout' | 'connection_refused' | 'host_not_found' | 'auth_failed' | 'database_missing' | 'tls_error' | 'invalid_url' | 'unknown';

const BY_CODE: Record<string, DbReason> = {
  ECONNREFUSED: 'connection_refused', ETIMEDOUT: 'timeout', ENOTFOUND: 'host_not_found', EAI_AGAIN: 'host_not_found',
  '28P01': 'auth_failed', '28000': 'auth_failed', '3D000': 'database_missing',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'tls_error', SELF_SIGNED_CERT_IN_CHAIN: 'tls_error', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls_error', ERR_TLS_CERT_ALTNAME_INVALID: 'tls_error',
};
export function classifyDbError(err: unknown): DbReason {
  const e = err as { code?: unknown; message?: unknown; errors?: unknown[] } | null;
  if (e && typeof e.code === 'string' && BY_CODE[e.code]) return BY_CODE[e.code];
  // Node 20+ may wrap several attempts (IPv6 + IPv4) in an AggregateError whose own code is empty.
  if (e && Array.isArray(e.errors)) for (const inner of e.errors) { const r = classifyDbError(inner); if (r !== 'unknown') return r; }
  const msg = typeof e?.message === 'string' ? e.message : '';
  if (/timeout/i.test(msg)) return 'timeout';
  if (/password authentication failed|SASL|client password must be a string/i.test(msg)) return 'auth_failed';
  if (/does not exist/i.test(msg)) return 'database_missing';
  if (/Invalid URL|invalid connection string/i.test(msg)) return 'invalid_url';
  if (/self.signed|certificate|SSL|TLS/i.test(msg)) return 'tls_error';
  return 'unknown';
}
export const REASON_HINT: Record<DbReason, string> = {
  timeout: 'The database did not answer in time. Is the PostgreSQL service running and not overloaded? Check the host and port.',
  connection_refused: 'Nothing is accepting connections on that host and port. Start the PostgreSQL service, and check the port in DATABASE_URL (default 5432).',
  host_not_found: 'The host name in DATABASE_URL could not be resolved. Try 127.0.0.1 instead of the name.',
  auth_failed: 'PostgreSQL rejected the user name or password. If the password contains @ # / ? : % or spaces, it must be percent-encoded in the URL (for example @ becomes %40).',
  database_missing: 'The database named in DATABASE_URL does not exist on that server.',
  tls_error: 'TLS failed. For a local PostgreSQL set DATABASE_SSL=false; for a managed one use a certificate your machine trusts.',
  invalid_url: 'DATABASE_URL cannot be parsed. A password with special characters must be percent-encoded.',
  unknown: 'The connection failed for an unrecognised reason. Run the diagnostic (npm run db:check) for per-stage detail.',
};

export interface UrlInspection { ok: boolean; host: string | null; port: number | null; database: string | null; hasUser: boolean; hasPassword: boolean; issues: string[] }
// Describes the shape of a connection string without returning any of its secret parts.
export function inspectDatabaseUrl(raw: string | undefined): UrlInspection {
  const r: UrlInspection = { ok: false, host: null, port: null, database: null, hasUser: false, hasPassword: false, issues: [] };
  const url = (raw ?? '').trim();
  if (!url) { r.issues.push('DATABASE_URL is empty or not loaded. Check that server\\.env exists next to server\\package.json.'); return r; }
  if (!/^postgres(ql)?:\/\//.test(url)) { r.issues.push('DATABASE_URL must start with postgres:// or postgresql://.'); return r; }
  if (/\s/.test(url)) r.issues.push('DATABASE_URL contains whitespace; percent-encode or remove it.');
  if (/^["'].*["']$/.test(url)) r.issues.push('DATABASE_URL still has surrounding quotes after loading.');
  let u: URL;
  try { u = new URL(url); } catch { r.issues.push('DATABASE_URL cannot be parsed. Two common causes: (1) a password containing @ # / ? : % must be percent-encoded (# becomes %23); (2) an unquoted # in server\\.env cuts the value off at that point, so wrap the whole URL in double quotes.'); return r; }
  r.host = u.hostname || null; r.port = u.port ? Number(u.port) : 5432; r.database = decodeURIComponent(u.pathname.replace(/^\//, '')) || null;
  r.hasUser = u.username !== ''; r.hasPassword = u.password !== '';
  if (!r.host) r.issues.push('DATABASE_URL has no host.');
  if (!r.database) r.issues.push('DATABASE_URL has no database name after the host and port.');
  if (!r.hasUser) r.issues.push('DATABASE_URL has no user name.');
  if (u.hash) r.issues.push('DATABASE_URL contains "#": it ends the URL early. Percent-encode it as %23 (a # in a .env file may also start a comment).');
  if ((url.match(/@/g) ?? []).length > 1) r.issues.push('DATABASE_URL contains more than one "@": an @ inside the password must be written %40.');
  if (/%(?![0-9a-fA-F]{2})/.test(url)) r.issues.push('DATABASE_URL contains a "%" that is not part of a valid percent-encoding; write a literal % as %25.');
  r.ok = r.issues.length === 0;
  return r;
}

export interface Stage { stage: string; ok: boolean; detail: string }
export interface DiagnoseDeps {
  tcp(host: string, port: number): Promise<void>;                 // rejects if nothing accepts connections
  query(sql: string): Promise<Record<string, unknown>[]>;         // read-only queries on the real connection (rejects on failure)
}
// Runs the stages in order and stops at the first failure. Read-only: only SELECT statements are ever sent.
export async function diagnoseDatabase(env: Record<string, string | undefined>, deps: DiagnoseDeps): Promise<Stage[]> {
  const out: Stage[] = [];
  const add = (stage: string, ok: boolean, detail: string) => { out.push({ stage, ok, detail }); return ok; };
  const insp = inspectDatabaseUrl(env.DATABASE_URL);
  if (!add('1. DATABASE_URL loaded and well-formed', insp.ok, insp.ok ? `host=${insp.host} port=${insp.port} database=${insp.database} user=${insp.hasUser ? 'set' : 'MISSING'} password=${insp.hasPassword ? 'set' : 'not set'}` : insp.issues.join(' '))) return out;
  const ssl = env.DATABASE_SSL === 'true';
  add('2. TLS setting', true, ssl ? 'DATABASE_SSL=true (TLS with certificate verification)' : 'DATABASE_SSL is not "true": plain connection (right for local PostgreSQL)');
  try { await deps.tcp(insp.host!, insp.port!); add('3. TCP reachable', true, `${insp.host}:${insp.port} accepts connections`); }
  catch (e) { const r = classifyDbError(e); add('3. TCP reachable', false, `${r}: ${REASON_HINT[r]}`); return out; }
  try { const rows = await deps.query('SELECT current_database() AS db, version() AS v, current_setting(\'server_version_num\') AS num'); const v = String(rows[0]?.v ?? '').match(/PostgreSQL [\d.]+/)?.[0] ?? 'PostgreSQL (version unknown)'; add('4. Login and SELECT', true, `connected to database "${String(rows[0]?.db)}" (${v})`); }
  catch (e) { const r = classifyDbError(e); add('4. Login and SELECT', false, `${r}: ${REASON_HINT[r]}`); return out; }
  try {
    const m = await deps.query('SELECT name FROM schema_migrations ORDER BY name');
    add('5. Applied migrations (read-only)', true, m.length ? m.map((x) => String(x.name)).join(', ') : 'schema_migrations is empty');
  } catch (e) { add('5. Applied migrations (read-only)', false, `could not read schema_migrations (${classifyDbError(e)}). This is informational; run migrations only after reading the README.`); }
  try {
    const t = await deps.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
    const names = t.map((x) => String(x.table_name));
    const used = ['users', 'profiles', 'careers', 'career_capabilities', 'skills', 'career_skills', 'custom_careers', 'skill_assessments', 'evidence', 'evidence_skills'];
    const missing = used.filter((x) => !names.includes(x)); const other = names.filter((x) => !used.includes(x) && x !== 'schema_migrations' && !['readiness_snapshots', 'gaps', 'actions', 'roadmap_items', 'user_settings'].includes(x));
    add('6. Tables the API uses', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'all present');
    if (names.includes('custom_careers') && names.includes('careers')) { try { const o = await deps.query("SELECT count(*)::int AS n FROM careers c WHERE c.source <> 'seed' AND NOT EXISTS (SELECT 1 FROM custom_careers cc WHERE cc.career_id = c.id)"); add('6b. Custom careers without an owner (hidden from everyone)', true, `${Number(o[0]?.n ?? 0)} found`); } catch { /* informational */ } }
    add('7. Other tables in schema public (not used by the API, never touched)', true, other.length ? other.join(', ') : 'none');
  } catch (e) { add('6. Tables the API uses', false, `could not list tables (${classifyDbError(e)})`); }
  return out;
}
