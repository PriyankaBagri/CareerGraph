# CareerGraph

CareerGraph is a career-readiness prototype. Instead of a résumé builder or a quiz, it models the relationship between what a career requires and what *you can show*:

**Career → Capabilities → Skills → Evidence → Readiness → Gaps → Next action → New evidence → Improved readiness**

It is **career-agnostic**: a career is just data (capabilities → skills → required levels → evidence expectations). Three seeded careers are examples; any career can be analyzed and used.

## Features
- **Auth, onboarding:** local demo accounts; onboarding accepts any typed career (analyze → preview → use).
- **Career intelligence:** `CareerIntelligenceProvider` interface; today a local, deterministic template provider (not AI) generates a career model for any input. Models are saved per user.
- **Career Explorer / Detail / Compare:** search or analyze any career; per-career readiness, gaps and action *previews*; two-career comparison with shared/unique skills. No ranking or "best career". Exploring never changes your target career; changing it needs an explicit confirmation.
- **Skills:** required vs. current level, status (On track, Skill gap, Evidence gap, Skill + evidence gap, **Not assessed**), level editing.
- **Evidence library:** add/edit/delete evidence linked to skills, with a four-level strength model that feeds readiness.
- **Readiness:** one deterministic calculation. States: **Not assessed** (fewer than half the skills rated: no score, unrated skills are not gaps), **Partial**, **Assessed**. The demo profile is treated as assessed.
- **Actions and roadmap:** deterministic, explainable prioritization from gaps; four roadmap phases; status and progress saved per user **and** career. Completing an action never changes skill levels.
- **Career Assistant:** when the server has an AI model configured (see `server/README.md`, "AI assistant"), a real model answers open-ended questions using your own readiness data; every reply is labelled AI-generated. Otherwise the page says so plainly and uses the **local, rule-based explainer (not an AI model)**. Model keys live only on the server.
- **Profile and Settings:** editable background, target-career change, preferences (reduce motion, assistant suggestions), per-user data controls.

## Tech stack
React 18, TypeScript, Vite, Tailwind CSS 3, React Router 6, lucide-react. Tests: Node's built-in runner via `tsx`.

## Run
```bash
npm install
npm run dev        # development
npm run build      # type-check + production build
npm test           # 79 logic tests
```
Demo login (only when you explicitly enable demo mode with `VITE_DEMO_MODE=true`): `alex@example.com` / `Password1`. With `VITE_API_URL` set you use real backend accounts instead.

## Architecture
- `src/types`: shared types. `src/data`: seeded careers. `src/utils`: pure logic (readiness, skills, actions, compare, assistant).
- `src/services`: the only layer that touches storage; `api.ts` switches mock/REST via `VITE_API_URL`. Components never read storage directly.
- `src/hooks/useCareerAnalysis.ts`: the single derivation of career data + profile levels + evidence → analysis → actions → roadmap. Async results are tagged with the career/user they were loaded for (`utils/scoped.ts`) so a stale response can't show another career's data.
- `src/context`: `AuthContext` (user, profile) and `EvidenceContext` (one shared evidence list).
- Persistence: with `VITE_API_URL` set (backend mode) everything for the signed-in user is stored on the server: profile details, target career, onboarding state, skill ratings, evidence, action progress, settings and custom careers. Nothing is silently kept in the browser or mocked in that mode. Without `VITE_API_URL` the app runs on local demo data, scoped by user (`careergraph:user:<id>:…`). Data saved in the browser by earlier versions is only ever copied to your account through the explicit import in Settings.

## Status and honesty
- **Tests:** run `npm test` (frontend, in-memory backend) and `cd server; npm test` (backend, in-memory). Exact counts are in the release notes of the delivery, because they change.
- **Build and browser QA:** not verified in the authoring environment (no package installation or browser available). Run `npm run build` and click through the app locally.
- **PostgreSQL:** the opt-in `npm run test:pg` suite is the check against the real `pg` driver and your PostgreSQL version. It was run during authoring only through a PostgreSQL 16 `psql` adapter, which validates the SQL but not the driver or PostgreSQL 18.
- There are no UI/component tests.

## Known limitations
- Without `VITE_API_URL` everything is stored in the browser and the demo accounts are not real authentication. With it, accounts use the backend (scrypt password hashes, JWT).
- Sessions are bearer JWTs in browser storage (see Security below); logout clears the token in the browser but a stateless JWT cannot be revoked server-side before it expires.
- The career generator is a rule-based template, not AI, and unusual careers get a generic model. The assistant is AI only when the server is configured with a model; otherwise it is rule-based and says so.
- Skill levels and evidence belong to one career's skill ids; they do not transfer between careers.
- Dialogs do not trap focus (Escape closes them and the first control is focused); contrast and responsive layout still need a manual pass in real browsers.
- Evidence cannot be independently verified: there is no verification workflow, so every evidence item is labelled self-reported.
- Prerequisites between skills are not modelled yet; per-career evaluation settings cover the level/evidence split and per-skill minimum evidence only.
- No `package-lock.json` is included; `npm install` will create one.

## Needs a real backend later
Real accounts and authentication, a database, server-side deletion, cross-device sync, and a server-hosted AI provider behind the existing provider interfaces (never put AI keys in the browser).

## Backend
A PostgreSQL/Express API lives in `server/` (config, migrations, seed, health check, error handling, CORS). With `VITE_API_URL` set (for example `http://localhost:4000/api`) the frontend stores everything for the signed-in user on the server: account (scrypt + JWT), profile details, target career (a shared career or one of your own custom careers), skill ratings, evidence, action progress, settings, custom careers, and the readiness/gaps/next-action analysis. Without `VITE_API_URL` the app runs on built-in demo data in the browser. Browser data from older versions is never used silently: Settings has an explicit, reviewable import. See `server/README.md`.

## Local development on Windows (frontend + backend together)

One-time setup (PowerShell, from the project folder):

    npm install
    cd server
    npm install
    cd ..

Create `server\.env` by copying `server\.env.example`, then fill in `DATABASE_URL` and `JWT_SECRET` (32+ random characters) yourself.
Never share that file. The root `.env` should contain one line, `VITE_API_URL=http://localhost:4000/api` (save it as UTF-8 with the exact
name `.env`). If it is missing, `dev:all` uses that same local URL for the run.

Start everything (PostgreSQL must already be running):

    npm run dev:all

This checks your setup, refuses to start with a clear message if a dependency folder, `server\.env` entry or port (4000, 5173) is a
problem, starts the API and Vite, prints the API health result, and stops both on Ctrl+C. It does NOT run migrations or seeds and
never touches your data. Then open http://localhost:5173 and http://localhost:4000/api/health (expect `"status":"ok"`).
The footer should say "Data source: BACKEND".

Other commands: `npm run dev` starts ONLY the frontend (no API, so the app falls back to local mock data); `npm run dev:api`
starts only the backend. Vite reads `.env` only at start, so restart after editing it. Database commands are separate and manual:
`cd server; npm run db:migrate` and `npm run db:seed` (not needed for an already-migrated database).

## Database: connection problems, special characters, backups

`DATABASE_URL` format: `postgresql://USER:PASSWORD@localhost:5432/careergraph`. Rules that avoid the most common "database down" causes:
- Wrap the whole value in **double quotes** in `server\.env`. Node's `--env-file` loader ends an unquoted value at a `#`, silently cutting the URL short.
- Percent-encode special characters in the user name or password: `@` = `%40`, `#` = `%23`, `:` = `%3A`, `/` = `%2F`, `?` = `%3F`, `%` = `%25`, space = `%20`.
  Example: password `p@ss#1` becomes `p%40ss%231`.
- `DATABASE_SSL=false` (or unset) for a local PostgreSQL.

Check the connection (read-only: it only runs SELECT statements and prints no credentials):

    npm run db:check            # from the project root (or inside server/)

It reports, step by step: URL well-formed, TCP reachable, login + SELECT, applied migrations, the tables the API uses, tables it does not use (never touched),
and custom careers without an owner. `GET /api/health` returns HTTP 503 and `"database":"down"` (plus a short `databaseReason` outside production) if the
database cannot be reached; the health check waits 6 s, one second longer than the pool's 5 s connect timeout. The server log shows only that reason, never the URL.

Back up before any database work (this only reads): `pg_dump -U <user> -h localhost -F c -f careergraph-backup.dump careergraph`.
Migrations and seeds are manual (`cd server; npm run db:migrate`, `npm run db:seed`) and are never run by `dev:all`. Your database already records
`001`, `002` and `003`; do not run them again. The new `004_evaluation_rules.sql` is additive and optional until you want custom evaluation settings (see below). Applied migration files must never be edited.

Optional real-PostgreSQL test (uses the real `pg` driver, only ever against a SEPARATE database whose name ends in `_test`):

    psql -U <user> -h localhost -c "CREATE DATABASE careergraph_test"
    cd server
    $env:TEST_DATABASE_URL = "postgresql://<user>:<encoded-password>@localhost:5432/careergraph_test"
    npm run test:pg
    Remove-Item Env:TEST_DATABASE_URL

It applies the existing migrations and seed to that test database, creates throw-away users, and removes only what it created. It refuses to run if the
database name does not end in `_test` or equals `DATABASE_URL`. Run it against your PostgreSQL 18 installation to verify that version.

## Custom careers and the career-agnostic model

Seeded careers (Software Engineer, UX Designer, Financial Analyst) are examples. Any user can create a career for any profession (Explore careers, or onboarding);
it is stored in the signed-in user's account (`POST/PUT/DELETE /api/careers`, owner-only, up to 12 capabilities and 60 skills) and goes through the same
Career -> Capabilities -> Skills -> Evidence -> Readiness -> Gaps -> Actions workflow as the seeded ones. Editing keeps ratings and evidence links for skills that
keep their id/name; removing a skill or career removes the ratings and evidence links for it (the evidence itself is kept). A career created in the generator
is a rule-based starter template, not verified professional standards. The built-in assistant fallback is rule-based, not an AI model.

## What is stored on the server, and how browser data is imported

| Data | Where | Notes |
|---|---|---|
| Account, password hash | `users` | scrypt; never returned by the API |
| Profile details, target career, onboarding state | `profiles` via `GET/PUT /api/profile` | target may be a shared career or **your own** custom career; someone else's is rejected |
| Skill ratings | `skill_assessments` | unrated = no row (never stored as 0) |
| Evidence and its skill links | `evidence`, `evidence_skills` | labelled self-reported; the API ignores any attempt to mark evidence verified |
| Action progress | `actions` + `roadmap_items` via `/api/careers/:id/action-progress` | "not started" = no row; scoped by user and career |
| Settings | `user_settings` via `GET/PUT /api/settings` | |
| Custom careers, evaluation settings | `careers`, `custom_careers`, `career_skills` (+ migration 004 columns) | owner-only |

Readiness, gaps and next actions are computed on the server from the user's own ratings and evidence.

If an earlier version left a profile, progress or settings in this browser, Settings shows **Data saved in this browser**. It compares field by field:
values your account lacks are offered as additions, values that differ are listed with both versions and **default to keeping your account's version**;
you choose per group. The browser copy is never deleted or edited, and running the import twice copies nothing twice.

## Evaluation settings (career-specific rules)

Readiness uses one formula with tunable parameters stored as data. Built-in defaults reproduce the original numbers (75% self-rated level, 25% evidence; evidence points weak 1, moderate 2, strong 3, very strong 4).
A custom career can change the level/evidence split in the editor, and can ask for a minimum number of evidence items per skill (a requirement shown on the skill and in next actions; it does not alter the score).
Every readiness result reports which rules produced it ("default" or "custom"). These settings are the author's own; they are not an official or professional standard.
They need **migration 004** (additive: two nullable columns). Until it is applied the API keeps working with the defaults and refuses to save custom settings with a clear 409.

## Security notes

- Passwords: scrypt hashes. Tokens: HS256 JWT, 24 h by default (`JWT_EXPIRES_IN_SECONDS`). Every protected route takes the user id from the verified token only.
- Browser storage: the token is kept for the **tab session** by default (sign-up, and login without "Keep me signed in on this device"); ticking the box stores it in `localStorage` so it survives restarts. Any script running on the page could read either, so the site must not load third-party scripts. HttpOnly cookie sessions would remove that exposure but need CSRF protection and same-site hosting; they were not built here because they could not be tested without a browser.
- Expired or invalid tokens clear the session (`token_expired` / `invalid_token`); a server outage never logs you out and never switches to mock data.
- API responses carry `no-store`, `nosniff`, `frame-ancestors 'none'` and a restrictive CSP; CORS allows only the origins in `CLIENT_ORIGIN`.
- `npm run build` embeds a Content-Security-Policy `<meta>` in the built `index.html` (scripts only from this site, no plugins, requests only to this site and the `VITE_API_URL` origin). `npm run dev` is unaffected. `npm run csp -- https://your-api.example.com/api` prints the same policy to send as a real header from your static host. Neither has been exercised in a real browser or by a real `vite build` here: try the built site on a staging copy first.

## Verifying (Windows PowerShell)

    npm test                 # frontend tests (in-memory backend, not PostgreSQL, not a browser)
    npm run build            # tsc --noEmit + vite build
    cd server; npm test      # backend tests (in-memory)
    cd server; npm run db:check   # read-only database diagnostic

Applying the new additive migration (004) to YOUR database is a separate, deliberate step: back up first (`pg_dump`), then `cd server; npm run db:migrate`.
It only adds two nullable columns and records itself in `schema_migrations`; running it twice is safe. Nothing in this release runs migrations or seeds for you.

Deployment notes: set VITE_API_URL at BUILD time (a build without it ships local mock mode, and the login page then says so);
set CLIENT_ORIGIN on the server to the exact site origin; JWT_SECRET must be 32+ random characters in production. Tokens live in
browser storage (readable by any script on the page), so keep the site free of third-party scripts.

Note: no `package-lock.json` is included (it could not be generated offline). `npm install` creates one in both `/` and `/server`; keep them.

## Stage 8 Slice 2: evidence, skills, readiness and next actions
In server mode the skill page (`/skills/:id`) now explains **why** a skill is rated as it is, using the server's own per-skill numbers (level credit, evidence points,
skill score, effect on readiness) and the career's evaluation rules; nothing is recomputed with a different formula, and a test checks the explanation against real
engine output. The same page lets you **add, link and unlink evidence**: "Link evidence you already have" and "Unlink from this skill" use the existing ownership-checked
endpoints (`POST/DELETE /api/evidence/:id/skills/:skillId`), show success and error messages, and recalculate readiness. Evidence is always labelled self-reported unless the server
holds a verification record. The Dashboard has a "What is behind your readiness" table (contributing skills, unknown/unrated skills, missing or thin evidence). Roadmap cards show
"Done when" and the rank, and `GET /api/careers/:id/actions` now also returns the ranking rule (`priorityCriteria`) and the career's own `evidenceExpectations`. The AI assistant's
server-side context includes the same numbers so it can explain a user's gaps without inventing figures. **No migration and no schema change.**
Limits: the step-by-step explanation needs server mode (local mode shows the plain status); the graph does not yet show actions as nodes; evidence strength is self-assessed.

## Stage 8 Slice 3: Interactive career action graph

The Dashboard graph (`src/components/graph/CareerGraph.tsx`) now shows Career → Capabilities → Skills → Evidence → Next actions, built from the analysis the app already loads (server readiness, your own evidence links, the server's ranked actions). No new endpoint, no migration.

- Select any node (or list row) to open the side panel: status and why, linked evidence, open actions, and for an action: why it is ranked here (server reason, score arithmetic only when it reproduces the server score, priority band), the skill gap it addresses, what evidence could show progress, and its done-when criterion.
- Keyboard: Tab enters the graph, arrow keys follow real links (up/down within a column), Enter/Space select, Escape clears.
- Graph/List tabs (list is the default on narrow screens or very large careers), "only skills that need attention" filter, empty states, and an "Updating…" status while data refreshes after you link/unlink evidence or change a rating.
- Read-only: changes are made on the Skill, Evidence and Roadmap pages, then the graph refreshes.
- Not supported by the data model, so not drawn: skill→skill prerequisites. At most 12 top-ranked open actions are drawn; the rest are in the Roadmap.
- Logic lives in `src/utils/graphModel.ts` and `graphDetail.ts`; tests in `tests/graphModel.test.ts`.

## Stage 9: grounded AI career assistant (extends Slices 1-2; no new endpoint, no migration)

`POST /api/assistant/chat` now grounds the model in more of the signed-in user's own data, read through user-scoped repositories:
- per-skill evidence titles, type, strength and source (descriptions are not sent), the user's completed and in-progress actions, and a `contextNotes` list that states what is missing or uncertain (no rated skills, no linked evidence, self-reported evidence, career-definition requirements);
- completed actions are reported separately and not recommended again; completing an action is never treated as proof of a skill;
- if the user's data cannot be loaded the server answers `503 context_unavailable` and does not call the model (a load failure never looks like "no data");
- a model reply that echoes the internal data block is rejected as a bad answer;
- the assistant has no write path: it cannot create, complete or delete anything. Conversations stay session-only in the browser (nothing is stored on the server).
- suggested questions only mention a gap or evidence when the user's data has one.

Setup is unchanged: `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` (and `AI_BASE_URL` for OpenAI-compatible servers) in `server/.env` only. Without them the app uses the clearly labelled local rule-based helper, never presented as AI.

## Connecting the frontend to the backend (local development)

1. Backend: `cd server`, copy `.env.example` to `.env`, set `DATABASE_URL` and a `JWT_SECRET` of at least 32 characters, then `npm run dev` (port 4000). CORS reads **`CLIENT_ORIGIN`** (comma-separated exact origins, default `http://localhost:5173`).
2. Frontend: create `.env.local` (or `.env`) next to the root `package.json`, NOT inside `server/`, containing `VITE_API_URL=http://localhost:4000/api` (it must end in `/api` exactly once), then **restart** `npm run dev`; Vite reads env files only at startup.
3. The dashboard footer (dev only) should now say `Data source: BACKEND (...)`. If it says `LOCAL MOCK DATA`, expand it: it states why (file not loaded, blank value, or Vite not restarted).
4. A configured API that is down or rejects a request shows an error. The app never swaps in mock data after a failure. A production build with no API URL shows a visible "Demo mode" notice.
5. Requests time out after 30 seconds (130 seconds for the assistant). Evidence is read page by page (200 per page).

### Local AI with Ollama (optional)
In `server/.env`: `AI_PROVIDER=openai-compatible`, `AI_BASE_URL=http://localhost:11434/v1`, `AI_MODEL=<a model you have pulled>`, `AI_API_KEY=ollama` (any non-empty value; Ollama ignores it) and a longer `AI_TIMEOUT_MS=60000` for slower local models. Restart the API. The Assistant page shows the configured model, or "not configured" with the settings above.

### Graph layout
The career action graph is drawn at the width it is given (measured container, no horizontal scrollbar). Its details panel sits beside the graph only on very wide screens (1536px and up) and under it otherwise, so labels keep their space. On phones the List view is shown first.

## Audit fixes (screen-recording review)
- Graph action nodes read `#1 Rate: <skill>`, `Raise: <skill>`, `Evidence: <skill>` so they stay distinguishable after truncation (full title stays in the tooltip, accessible name and panel).
- Profile completeness is computed from visible facts (target career, education, a line about you, a rating for the target career, one evidence item) and the missing ones are named; the old stored number and the "last analysis" date are no longer shown.
- Profile shows ratings for the current career separately from ratings kept for other careers.

## Backend, demo mode or neither: how the app decides (explicit, never silent)
- `VITE_API_URL` set -> **backend mode**: real sign-in and data. If the server is down you get a connection error with a "Try again" button; the app never falls back to mock data or the demo account.
- `VITE_DEMO_MODE=true` (and no API URL) -> **demo mode**: browser-only data, clearly labelled, demo credentials shown.
- Neither -> **not configured**: login and sign-up show setup steps instead of a form. (This is what you saw when `.env.local` was missing: the old build silently became demo mode.)
- The Node test runner has no Vite environment and keeps behaving as demo mode, so the existing tests are unchanged.

### Windows setup (no secrets are shown here)
1. Backend: copy `server\.env.example` to `server\.env`, then set `DATABASE_URL`, a `JWT_SECRET` of at least 32 random characters and `CLIENT_ORIGIN=http://localhost:5173`. Optional AI drafting and assistant: `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` (and `AI_BASE_URL` for openai-compatible). These live only in `server\.env`, never in the frontend.
2. Frontend: in the folder containing `package.json` create `.env.local` with one line: `VITE_API_URL=http://localhost:4000/api` (UTF-8, not `.env.txt`).
3. Terminal 1: `cd server`, `npm install`, `npm run dev`. Terminal 2 (project root): `npm install`, `npm run dev`. Restart `npm run dev` after any env change.

## AI-assisted custom career models
`POST /api/careers/draft` (Bearer token, per-user rate limit, provider timeout; body `{name, category?, description?}`) asks the configured AI provider for a model with capabilities, skills, plain-language skill descriptions, required levels (1-5) and an evidence expectation per skill. The output must match a strict schema (3-10 capabilities, 2-8 skills each, <=60 skills, unique names, no extra fields); anything else is rejected with 502 `ai_invalid_output` and nothing is returned or saved. Failures return 503 `ai_not_configured`, 504 `ai_timeout`, 502 `ai_unavailable` or 429 `rate_limited`: the template is never substituted automatically. The endpoint never saves. In **Career Explorer -> Analyze any career** (backend mode) the draft opens in an editable review labelled "AI-generated draft - unverified"; "Use the template instead (not AI)" opens the old keyword template labelled "Template fallback - not AI-generated". Saving needs the "Save career..." button and a confirmation dialog, then uses the existing `POST /api/careers`.
Persistence (no migration): skill descriptions use the existing `skills.description` column. There is no per-skill evidence column, so each evidence expectation is appended to its skill's description under the label "Evidence to show:". A structured column would need a small additive migration, which has NOT been added (approval needed).

## Student guidance: actionable roadmap steps
Each ranked action from `GET /api/careers/:id/actions` now carries a `guidance` object built by `server/src/domain/guidance.ts` from data that already exists (the action, the skill's own description and "Evidence to show" note, the career's evidence expectations). It adds no score, changes no ranking, and does not touch ratings or the readiness engine.
- **Fields:** kind (learning the basics / practice exercise / portfolio project / quick self-check / add proof), plain title, why it matters, why now, outcome, numbered steps, before-you-start notes, time (always labelled an estimate), "you are done when" criteria, evidence to add, and search hints.
- **Task size follows your current level**, not the final target: someone rated 0-1 gets basics; a portfolio project is suggested only from level 3 up.
- **Unrated skills** get a quick self-check, never a gap plan. **Rated 0** is a real rating and can be a gap.
- **No invented links, certifications, salaries or job requirements.** `resources` holds search terms only, because no links have been checked.
- **Marking an action done records a statement only.** Ratings and readiness change only when you change a rating or add evidence. A completed action that still ranks shows a note explaining the gap is still open.
- The roadmap shows an expandable "How to do this" per action; the dashboard has an "In plain words" summary (built from the same server numbers) that says what is rated, what is unrated, what supports it, and the next step. The percentage is described as a progress indicator, not a prediction of hiring.
- No migration was added.

## Verification status and browser checklist
**Run in the development sandbox (no npm registry, no PostgreSQL, no real browser):** all frontend tests, all backend tests, the server typecheck, a stub-based TSX typecheck (hand-written React/router type stubs, so React-specific typing is NOT checked), an esbuild bundle, and a server-side render of the new components with the real `react-dom`. **Not run there:** `npm run build` (`tsc --noEmit && vite build`), PostgreSQL, a live AI provider, a real browser.

Run locally: `npm install && npm run build && npm test`, then `cd server && npm install && npm run typecheck && npm test`.

Browser test (backend mode, `VITE_API_URL` set, both servers running):
1. Open the app: the login page shows no demo credentials and no setup warning. Stop the backend and try to log in: you get "Could not reach the server" and a "Try again" button, never a demo login.
2. Sign up, then pick or create a career (Career Explorer -> Analyze any career -> Draft with AI, or "Use the template instead"). The draft shows its label, you can edit/add/remove, and nothing is saved until "Save career..." and the confirmation.
3. Skills page: open an unrated skill. The level box says "Choose a level…" and Save is disabled until you choose. Save a 0 on one skill and leave another untouched: the first becomes a gap, the second stays "Not assessed".
4. Skill page: "What this skill means", "What counts as evidence" and "What the expected level means" appear.
5. Add evidence and link it to a skill; the skill shows it as unverified.
6. Dashboard: "In plain words" names rated and unrated skills and the best next step; the percentage is described as a progress indicator.
7. Roadmap: expand "How to do this" on an action. Check steps, time labelled "(estimate)", "You are done when", evidence to add, and the "Template guidance ... not verified" line.
8. Mark an action complete, reload the page: it stays complete, ratings/evidence/readiness are unchanged, and the action still shows a note that the gap is open.
9. Click through Dashboard, Skills, a skill, Evidence, Roadmap, Profile: no dead links. Check at phone width and with the keyboard (Tab, Enter, Esc on the dialog).
