// `npm run dev:all`: starts the API (server/) and the Vite frontend together. It never runs migrations or seeds and never touches the database.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiPort, checkServerEnv, isPortFree, parseEnv, resolveApiUrl, summarizeHealth, WEB_ORIGIN } from './devLib';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => (existsSync(p) ? parseEnv(readFileSync(p, 'utf8')) : null);
const fail = (msg: string): never => { console.error(`\n[dev:all] ${msg}\n`); process.exit(1); };
const isWin = process.platform === 'win32';

async function main() {
  console.log('[dev:all] Checking setup (no database changes are made)...');
  if (!existsSync(resolve(root, 'node_modules'))) fail('Frontend dependencies are missing. Run: npm install   (in the project root)');
  if (!existsSync(resolve(root, 'server', 'node_modules'))) fail('Backend dependencies are missing. Run: npm install   (inside the server folder)');
  const serverEnv = read(resolve(root, 'server', '.env'));
  if (!serverEnv) fail('server\\.env was not found. Copy server\\.env.example to server\\.env and fill in DATABASE_URL and JWT_SECRET yourself.');
  const issues = checkServerEnv(serverEnv!);
  for (const i of issues) console[i.level === 'error' ? 'error' : 'warn'](`[dev:all] ${i.level === 'error' ? 'ERROR' : 'WARNING'}: ${i.message}`);
  if (issues.some((i) => i.level === 'error')) fail('Fix server\\.env, then run the command again.');

  const port = apiPort(serverEnv!);
  const api = resolveApiUrl(read(resolve(root, '.env')) ?? {}, process.env, port);
  if (api.source === 'default') console.log(`[dev:all] No VITE_API_URL in .env: using ${api.url} for this run.`);
  if (!(await isPortFree(port))) fail(`Port ${port} (API) is already in use. Close the other program (maybe a previous backend), or change PORT in server\\.env.`);
  if (!(await isPortFree(5173))) fail('Port 5173 (frontend) is already in use. Close the other Vite window (or another app) and try again.');

  const children: ChildProcess[] = [];
  let stopping = false;
  const stop = (code: number) => {
    if (stopping) return; stopping = true;
    for (const c of children) if (c.pid && c.exitCode === null) { if (isWin) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); else c.kill('SIGTERM'); }
    setTimeout(() => process.exit(code), 300);
  };
  const run = (name: string, cmdArgs: string, env: NodeJS.ProcessEnv) => {
    const child = spawn(cmdArgs, { cwd: root, shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const tag = (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
    child.stdout?.on('data', tag); child.stderr?.on('data', tag);
    child.on('exit', (code) => { if (!stopping) { console.error(`\n[dev:all] The ${name} process stopped (exit code ${code}). Stopping the other one too.\n`); stop(code ?? 1); } });
    children.push(child);
  };
  run('api', 'npm --prefix server run dev', process.env);
  run('web', 'npx vite --strictPort --port 5173', { ...process.env, VITE_API_URL: api.url });

  // Informational only. The database may need a few seconds after start-up, so keep polling; never treat the first 503 as final.
  const healthUrl = `http://localhost:${port}/api/health`;
  let last = '';
  for (let i = 0; i < 30 && !stopping; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(healthUrl); const body = await res.json().catch(() => null) as { databaseReason?: string } | null; last = `HTTP ${res.status}, ${summarizeHealth(body)}${body?.databaseReason ? `, reason=${body.databaseReason}` : ''}`;
      if (res.ok) { console.log(`\n[dev:all] API health: ${last}`); last = 'ok'; break; }
    } catch { last = 'no answer yet'; }
  }
  if (last !== 'ok' && !stopping) console.warn(`\n[dev:all] API health after 30 s: ${last}. The app is running, but the database is not reachable.\n[dev:all] Run in a second window:  npm run db:check   (read-only, prints which step fails, no secrets)`);
  console.log(`[dev:all] Open ${WEB_ORIGIN}  (Ctrl+C stops both)`);
}
process.on('SIGINT', () => process.exit(0));
main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
