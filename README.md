# CareerGraph

CareerGraph is a career-readiness prototype. Instead of a résumé builder or a quiz, it models what a career requires and what you can *show*:

**Career → Capabilities → Skills → Evidence → Readiness → Gaps → Next actions → Progress**

## What it does
- **Careers:** a few seeded example careers, plus custom careers. A custom career can be typed in by hand, drafted from a template, or drafted by an optional AI provider. An AI draft is always reviewed and edited by you, and is labelled as unverified.
- **Skills:** rate each skill 0–5 against the level the career expects. A skill you have not rated is "Not assessed", which is different from a rating of 0.
- **Evidence:** add your own evidence (projects, write-ups, results) and link it to skills. Evidence you add yourself is shown as unverified.
- **Readiness, gaps, next actions:** a deterministic, rule-based calculation (no AI). It is a progress indicator, not a prediction of getting a job.
- **Roadmap:** prioritised actions with an expandable "How to do this" guide (steps, effort *estimate*, definition of done, evidence to add). Guidance is template-based and not expert-verified. Marking an action complete does not change your ratings.
- **Also:** Dashboard, Career Explorer / Compare, an action graph, Profile, Settings (preferences and data controls), and an optional AI career assistant.

## Architecture
- **Frontend (repo root):** React 18, TypeScript, Vite 5, Tailwind CSS 3, React Router 6, lucide-react.
- **Backend (`server/`):** Node.js (>= 20.11), Express 4, `pg`, TypeScript run with `tsx`. Handlers are framework-agnostic; Express is only the transport. Passwords use scrypt; tokens are HS256 JWTs.
- **Database:** PostgreSQL, with SQL migrations in `server/migrations/` (001–004).
- **Modes:** with `VITE_API_URL` set the app uses the backend. With it empty and `VITE_DEMO_MODE=true` it runs on browser-only demo data. With neither it shows setup instructions; it never silently falls back to demo data.
- **AI (optional):** server-side only. The API key lives in `server/.env` and is never exposed to the browser.

## Prerequisites
Node.js >= 20.11, npm, and a running PostgreSQL with an empty database you have created for this app.

## Windows quick start (PowerShell, after extracting the ZIP)
The ZIP deliberately contains **no** real environment files (`.env`, `.env.local`, `server/.env`), no `node_modules` and no build output, so you must create the two environment files yourself. Copying an example file does not by itself make the database connect: you must put in your own PostgreSQL details.

```powershell
cd CareerGraph

# 1. Frontend dependencies
npm install

# 2. Frontend config: create .env.local in this folder with ONE line:
#      VITE_API_URL=http://localhost:4000/api
#    (Copy-Item .env.example .env.local   also works; delete the comment lines if you like.)
Copy-Item .env.example .env.local

# 3. Backend dependencies
cd server
npm install

# 4. Backend config: this file MUST exist before any server command, otherwise Node stops with "node: .env: not found"
Copy-Item .env.example .env
notepad .env
```
In `server\.env`, edit these yourself and never share or commit the file:
- `DATABASE_URL`: your PostgreSQL URL, in double quotes, with special characters in the password percent-encoded. Replace `CHANGE_ME` and use the name of **your own** database.
- `JWT_SECRET`: 32+ random characters. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` and paste the output.
- `CLIENT_ORIGIN` must include `http://localhost:5173`. Leave `AI_PROVIDER` empty unless you configure an AI provider.

Then, still in `CareerGraph\server`:
```powershell
npm run db:check        # read-only diagnostic; no changes, no secrets printed
```
Only on a **new, empty** database, and only if `db:check` says migrations are missing: `npm run db:migrate`. Never reset or recreate a database that already has your data.

Start the app in **two separate PowerShell windows**:
```powershell
# Window 1 (backend)
cd CareerGraph\server
npm run dev

# Window 2 (frontend)
cd CareerGraph
npm run dev
```
Open `http://localhost:5173`. Check the API in a third window or the browser: `Invoke-RestMethod http://localhost:4000/api/health` should show `status: ok` and `database: up`. (Alternatively `npm run dev:all` from the root starts both in one window.)

Common errors: `node: .env: not found` means `server\.env` was not created in the `server` folder (check it is not named `.env.txt`). A health response with `database: down` means `DATABASE_URL` or PostgreSQL is wrong: run `npm run db:check` to see which step fails. Changes to `.env.local` need a restart of `npm run dev`.

## Install (any OS)
```bash
npm install
npm --prefix server install
```
No lockfiles ship with this package (see Known limitations), so versions resolve from the ranges in `package.json`.

## Configuration
Copy the example files and fill in your own values. Never commit the real files.

| File | Variable | Purpose |
|---|---|---|
| `.env.local` (root) | `VITE_API_URL` | Backend URL ending in `/api`, e.g. `http://localhost:4000/api` |
| `.env.local` (root) | `VITE_DEMO_MODE` | Optional; `true` for browser-only demo mode when `VITE_API_URL` is empty |
| `server/.env` | `PORT`, `DATABASE_URL`, `DATABASE_SSL`, `CLIENT_ORIGIN`, `NODE_ENV` | Server and database |
| `server/.env` | `JWT_SECRET`, `JWT_EXPIRES_IN_SECONDS` | Auth; the secret must be 32+ random characters |
| `server/.env` | `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_RATE_LIMIT_PER_MINUTE` | Optional AI; leave `AI_PROVIDER` empty to run without it |

`.env.example` and `server/.env.example` document each variable.

## Database setup
Use a **new, empty** database for a first install:
```bash
npm --prefix server run db:check     # read-only connectivity check; prints no secrets
npm --prefix server run db:migrate   # applies pending migrations (changes the schema)
npm --prefix server run db:seed      # optional: upserts the example careers
```
**If you already have a CareerGraph database, do not reset, drop or recreate it.** Run `db:check` first; `db:migrate` only applies migrations that are not yet recorded.

## Run
```bash
npm run dev:all      # API + frontend together (never runs migrations or seeds)
# or, in two terminals:
npm run dev:api      # http://localhost:4000
npm run dev          # http://localhost:5173
```
Health checks: `GET /api/live` says the API process is running (no database involved; use this as a host's liveness check). `GET /api/health` also checks the database and returns 503 if it is down.

## Hosted deployment (free-tier demo: Cloudflare Pages + Render + Neon)
Free tiers can sleep, change or end, so treat this as a demo setup, not a guaranteed service. **Node:** use 22 (`.node-version`; the code needs 20.11 or newer). Set `NODE_VERSION=22` on Render if it does not pick the file up.
- **Migrate the hosted database from your own computer, separately from the server.** The server never migrates on startup. In PowerShell, using placeholders (never paste the real value into chat or a file):
  ```powershell
  $env:DATABASE_URL = "<your-hosted-connection-string>"
  $env:DATABASE_SSL = "true"
  npm run db:check:prod     # read-only
  npm run db:migrate:prod   # applies only migrations not yet recorded; safe to repeat
  Remove-Item Env:DATABASE_URL, Env:DATABASE_SSL
  ```
  Do not set `NODE_ENV=production` for these two commands. They read variables from the process (no `.env` file), so run them with the hosted values only. The local `db:check` and `db:migrate` still read `server/.env`.
- **API (Render):** build command `npm --prefix server install`, start command `npm run start:api`, repository root as the root directory, liveness path `/api/live`. Variables: `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_SSL=true`, `JWT_SECRET` (32+ random characters), `CLIENT_ORIGIN` (the exact frontend origin, no wildcard). Leave the `AI_*` variables unset.
- **Frontend (Cloudflare Pages):** build command `npm install && npm run build`, output `dist`, build variable `VITE_API_URL=https://<render-app>.onrender.com/api` (it is baked into the build and its security policy, so changing it needs a rebuild). `public/_redirects` makes page refreshes and deep links work; `public/_headers` adds security headers.
- **Cold starts:** the app opens by pinging `/api/live`, shows a notice when a request takes over 5 seconds, allows 70 seconds per request, and retries a failed or timed-out GET once. It never retries a sign-up, sign-in, save or delete.

## AI assistant: what it does and how to test it with a real provider
- **With a configured provider** (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` in `server/.env`) every question goes to the model, with your selected career's data attached as context. General questions (any career, concepts, comparisons, study plans) are answered from the model's general knowledge. Questions about your own skills, evidence, readiness and roadmap are answered from your saved data. The model is told to keep these apart, to say when career-specific expectations are estimates, and never to invent salaries, standards, links or your qualifications. Earlier messages in the conversation are sent as context. Replies are labelled "AI-generated".
- **Without a provider** the page says so. It uses a rule-based explainer that only answers questions about your saved data, and replies that a live AI model is needed for general questions. It never shows an unrelated summary and never calls itself AI.
- Automated tests use a fake provider, so they prove the request, context, errors and isolation, **not** the quality of live answers.

Manual test with your real provider (about 10 minutes; start the backend, sign in, open **Assistant**):
1. The status line names your provider and model.
2. Ask `How do I become a corporate lawyer?` (unrelated to your career): you get a direct answer, not a readiness report.
3. Ask `Explain recursion using a simple example.`: a worked example.
4. Ask a follow-up such as `Can you make it simpler?`: it refers to the previous answer.
5. Ask `What is my biggest gap?`: it names skills from your own data and does not invent ratings, scores or evidence.
6. Open a skill and click **Ask the assistant about this skill**, then ask `Explain this skill`: it knows which skill you mean.
7. Check that nothing states a salary, an industry standard or a link as fact.
8. Stop the backend, or blank `AI_PROVIDER` and restart: the page shows the rule-based notice and general questions get the "needs an AI model" reply.

## Tests and build
```bash
npm test                            # frontend logic tests
npm --prefix server run typecheck
npm --prefix server test            # backend tests (in-memory repositories; no PostgreSQL needed)
npm run build                       # tsc --noEmit && vite build
```
`npm --prefix server run test:pg` is opt-in: it needs `TEST_DATABASE_URL` pointing at a database whose name ends in `_test`, and it never touches `DATABASE_URL`.

## Verification status
In the packaging sandbox (no npm registry, PostgreSQL or real browser) the frontend tests (288) and backend tests (294) passed, and the pages rendered in headless Chromium with stand-in router, icon and stylesheet packages. **Not verified there:** `npm run build`, the real PostgreSQL path, a live AI provider, a real browser session, deployment. Run those yourself before submission.

## Known limitations
- No lockfiles are included, so installs are not reproducible until you generate and commit them.
- No login rate limiting or lockout; tokens cannot be revoked before expiry; no refresh tokens, password reset or email verification. The token is kept in browser storage.
- The seeded careers are examples, and guidance and effort figures are templates and estimates, not expert-verified standards.
- No readiness history, rating transfer between careers, or evidence verification.
- Not hardened or tested for public deployment.

More detail from earlier development stages is kept in `docs/project-notes-detailed.md` and `docs/server-notes-detailed.md`; those notes may lag the code.
