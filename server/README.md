# CareerGraph API

Node.js (>= 20.11) + Express 4 + `pg` + TypeScript (run with `tsx`). Routing, validation, CORS, errors and health live in framework-agnostic handlers (`src/http/`); Express is only the transport (`src/app.ts`). Persistence is PostgreSQL with in-memory repositories used by the tests.

## Setup
```bash
cd server
npm install
cp .env.example .env     # then edit .env yourself (Windows: copy .env.example .env)
```
`server/.env` is intentionally **not** in the ZIP. Every script here loads it with `--env-file=.env`, so if it is missing Node stops with `node: .env: not found`: create it first. Copying the example does not guarantee a database connection; fill in your own `DATABASE_URL` and `JWT_SECRET`. Never commit `.env` or paste its contents anywhere.

## Environment variables (names only)
`PORT`, `DATABASE_URL`, `DATABASE_SSL`, `CLIENT_ORIGIN`, `NODE_ENV`, `JWT_SECRET`, `JWT_EXPIRES_IN_SECONDS`, and the optional AI settings `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_RATE_LIMIT_PER_MINUTE`. `.env.example` explains each.
- `JWT_SECRET` must be 32+ random characters. Without it, auth endpoints return 503 in development and the server refuses to start in production.
- Wrap `DATABASE_URL` in double quotes and percent-encode special characters in the password.
- AI keys stay server-side. Leave `AI_PROVIDER` empty to run without the assistant or AI drafts.

## Database
> **Warning: never reset, drop, truncate or recreate an existing CareerGraph database.** Use a new empty database for a fresh install. Take a backup before any schema change. Do not edit migrations 001–004 once applied.

| Command | Effect |
|---|---|
| `npm run db:check` | **Read-only** diagnostic: network reachability, login, database, migrations, required tables. Prints no secrets. |
| `npm run db:migrate` | Applies migrations in `migrations/` that are not yet recorded. Changes the schema; skips ones already applied. |
| `npm run db:check:prod` / `db:migrate:prod` | The same two scripts, but they read `DATABASE_URL` and `DATABASE_SSL` from the process environment instead of `server/.env`. For a hosted database: see the root README. Migrations run in one transaction under a lock and are recorded in `schema_migrations`, so repeating the command only applies what is missing. |
| `npm run db:seed` | Upserts the example careers (safe to repeat). Does not touch your users' data. |

Run `db:check` first on any existing database.

## Run
```bash
npm run dev     # watch mode
npm start       # no watch
```
**Hosting (variables come from the host, no `.env` file):** `npm install` in `server`, then `npm run start:prod` (from the repo root: `npm run start:api`). The server imports shared files from the frontend `src/` folder, so deploy the whole repository, not only `server/`. `tsx` is a production dependency for this reason. Set the same variable names as in `.env.example` in the host's dashboard.

Health checks: `GET /api/live` (process only, no database, always 200 while the server runs) and `GET /api/health` (server and database status, 503 if the database is down).

## API (all `/api`, JSON; everything except live, health, register and login needs `Authorization: Bearer <token>`)
`auth/register|login|me|logout`, `profile`, `settings`, `careers` (+ `careers/draft`), `careers/:id/skills|readiness|gaps|actions|graph|action-progress`, `me/skills`, `evidence` (+ skill links), `assistant/status|chat`. The user is always taken from the verified token, never from the request body.

## Tests
```bash
npm run typecheck
npm test            # in-memory repositories; no PostgreSQL needed
npm run test:pg     # opt-in, see below
```
`test:pg` needs `TEST_DATABASE_URL` set to a database whose name **ends in `_test`**; it never uses `DATABASE_URL`. Create that database separately and never point it at your real data.

## Limitations
- No login rate limiting or lockout, no token revocation or refresh tokens, no password reset or email verification.
- The AI integration is written and unit-tested against fake providers; it has not been exercised against a live provider in this package.
- The real PostgreSQL path was not run in the packaging sandbox; use `db:check` and `test:pg` on your machine.
- Not hardened for public deployment.

Earlier stage-by-stage notes: `../docs/server-notes-detailed.md` (may lag the code).
