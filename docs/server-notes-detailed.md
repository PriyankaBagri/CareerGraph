# CareerGraph API (Backend Stage 1–4: foundation, authentication, profiles, core career data, readiness)

Express + PostgreSQL foundation: configuration, database layer, migrations, seed data, middleware, error handling, validation, CORS and `GET /api/health`.
**Included:** configuration, database layer, migrations, seed, middleware, `GET /api/health`, **authentication (JWT) and authenticated profiles**.
**Not included yet:** career, skill, evidence, readiness, roadmap and assistant endpoints (later stages). Apart from login/sign-up, the frontend still runs on its local data.

## Architecture
```
src/
  config.ts          validated env config (fails fast, never echoes secrets)
  errors.ts          AppError + helpers          logger.ts   JSON logger
  db/                types.ts (Db interface) · pool.ts (pg Pool, transactions) · migrations.ts + migrate.ts · seeding.ts + seed.ts
  http/              types.ts · handler.ts  <- routing, CORS, security headers, request ids, central error handling
  routes/            health.ts · auth.ts · profile.ts · index.ts (route table)
  controllers/       auth.ts · profile.ts (parse + validate input, call a service)
  services/          auth.ts · profile.ts · index.ts (business rules)
  repositories/      types.ts (interface) · pg.ts (PostgreSQL) · memory.ts (tests)
  utils/             password.ts (scrypt) · token.ts (HS256 JWT)
  validation/        Validator (collects all field errors → 400 validation_failed)
  app.ts             Express adapter (thin transport around http/handler.ts)    index.ts  server start/shutdown
migrations/          001_initial_schema.sql · 002_auth_profile.sql
tests/               node:test via tsx (no database or Express required)
```
Request flow in later phases: route → controller → service → repository → PostgreSQL. All queries must be parameterized.
The server reuses the frontend's pure seed data (`../src/data/careers.ts`) and will reuse its pure readiness/action engines, so there is one implementation.

## Setup
1. Node 20.11+ and PostgreSQL 14+.
2. Create a database and user, e.g. `createdb careergraph` (or `CREATE DATABASE careergraph;`).
3. `cd server && npm install && cp .env.example .env` and edit `DATABASE_URL`, `CLIENT_ORIGIN`.
4. `npm run db:migrate` — applies `migrations/*.sql` in order, in one transaction, under an advisory lock; re-running is a no-op; editing an applied migration is refused.
5. `npm run db:seed` — idempotent upsert of the seeded career catalogue (careers, capabilities, skills with category, requirements with required level and importance). Re-running updates in place. No user data, no example evidence. Seeded careers are the frontend's own datasets (`src/data/careers.ts`): Software Engineer, UX Designer, Financial Analyst.
6. `npm run dev` (or `npm start`), then `curl http://localhost:4000/api/health`.

## Environment variables
| Name | Purpose |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` (required) |
| `DATABASE_SSL` | `true` for managed databases requiring TLS |
| `PORT` | default 4000 |
| `CLIENT_ORIGIN` | comma-separated exact browser origins (no wildcard), default `http://localhost:5173` |
| `NODE_ENV` | `production` enables HSTS |
| `JWT_SECRET` | **required for auth**, 32+ random characters (see below) |
| `JWT_EXPIRES_IN_SECONDS` | access-token lifetime, default 86400 |

## Authentication
**Configure `JWT_SECRET`:** generate one (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`), put it in `server/.env`, restart. Without a valid secret the auth endpoints return `503 auth_not_configured` and create nothing; in production (`NODE_ENV=production`) the server will not start.
- **Passwords:** hashed with scrypt (Node built-in, random salt per password, constant-time compare). Only the hash is stored; hashes and passwords are never returned or logged. Rules: 8–128 chars, a letter and a number.
- **Tokens:** HS256 JWT, claims `sub` (user id), `typ: "access"`, `iat`, `exp`. Sent as `Authorization: Bearer <token>`. Verified on every request, and the account must still exist.
- **Identity** comes only from the verified token. Handlers never read a user id from the body, query or path, so one user cannot read or change another's profile.
- **Logout is stateless:** `POST /api/auth/logout` returns 204 and the client discards its token. The token is **not** revoked and stays valid until it expires (default 24 h). There are no refresh tokens and no revocation list yet.
- Login answers identically for an unknown email and a wrong password (no account enumeration).

## Endpoints
| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/health` | no | `200 ok` / `503 degraded` (database down) |
| `POST /api/auth/register` | no | `{name, email, password}` → `201 {token, tokenType, expiresIn, user, profile}`; `409` duplicate email; `400 validation_failed` with `fields` |
| `POST /api/auth/login` | no | `{email, password}` → `200` same shape; `401 invalid_credentials` |
| `GET /api/auth/me` | yes | `{user: {id, email, name}, profile}` |
| `POST /api/auth/logout` | no | `204` (see above) |
| `GET /api/profile` | yes | `{userId, name, email, targetCareerId, experienceSummary, educationSummary, aboutNote, stage, experienceLevel, onboardingComplete, completeness, createdAt, updatedAt}` |
| `PUT /api/profile` | yes | partial update of `name, targetCareerId, experienceSummary, educationSummary, aboutNote` (absent = unchanged, `null`/`""` = clear). `targetCareerId` must be a seeded career id, else `400`. Email cannot be changed here. |

### Stage 3: careers, skill assessments, evidence (all require `Authorization: Bearer <token>`)
Migration `003_career_core.sql` (re-runnable, additive; 001/002 untouched) adds to the 001 tables: `careers.updated_at`; `career_capabilities` and `skills` timestamps; `skills.description/category`; `career_skills.importance` (1–5, default 3); `skill_assessments.source/created_at/updated_at`; `evidence_skills.created_at`; evidence length and `http(s)` URL CHECK constraints; and lookup indexes. `career_skills` is the requirements table; `skill_assessments` is "user skills". `profiles.target_career_id` already had a foreign key to `careers` (001), so nothing was added there.

| Method & path | Notes |
|---|---|
| `GET /api/careers` | `{careers: [{id, name, category, description, source}]}`: seeded careers plus the caller's own custom careers |
| `GET /api/careers/:careerId` | `{career, capabilities[], skills[], requirements[]}`; `404 career_not_found` |
| `GET /api/careers/:careerId/skills` | `{careerId, skills: [{id, name, description, category, capabilityId, capabilityName, requiredLevel, importance}]}` |
| `GET /api/me/skills` | `{skills: [{skillId, assessed:true, level, source, assessedAt, updatedAt}]}`: only skills the user has rated |
| `GET /api/me/skills/:skillId` | an unrated skill returns `{assessed:false, level:null}`, never level 0; unknown skill `404 skill_not_found` |
| `PUT /api/me/skills/:skillId` | `{level: 0..5 integer, source?: text}` → upsert. Level 0 is a real rating |
| `DELETE /api/me/skills/:skillId` | `204`, back to not assessed (idempotent) |
| `GET/POST /api/evidence` | list own / create. Body: `title` (1–200), `description` (1–2000), `type`, `strength` (`weak\|moderate\|strong\|very_strong`), optional `url` (http/https), `date` (`YYYY-MM-DD`), `organization` (≤200), `skillIds[]`. `201` on create |
| `GET/PUT/DELETE /api/evidence/:evidenceId` | own evidence only; PUT is partial (at least one field; `skillIds` replaces the set); `404 evidence_not_found` |
| `POST /api/evidence/:evidenceId/skills/:skillId` | link → `201` evidence; `409 conflict` if already linked |
| `DELETE /api/evidence/:evidenceId/skills/:skillId` | unlink → `200` evidence; `404 link_not_found` |

Evidence types are the frontend's: Project, Internship, Work Experience, Certification, Course, Publication, Research, Assessment, Competition, Achievement, Volunteer Work, Portfolio, Case Study, Other (a superset of the 12 in the Stage 3 brief). Skill ids are career-namespaced (e.g. `swe:git`) and a skill is valid only if it belongs to a career visible to the caller.

Isolation: every user-owned repository method takes the token's user id first and its SQL filters on it. Someone else's evidence and a nonexistent id both answer the same `404`; a `userId` in a body is ignored. Example:
```
PUT /api/me/skills/swe:git   {"level": 3}
→ 200 {"skillId":"swe:git","assessed":true,"level":3,"source":"self","assessedAt":"…","updatedAt":"…"}
```

### Stage 4: readiness, skill gaps, next actions (read-only, all require a Bearer token)
No migration is needed: Stage 4 computes everything from existing tables (`career_skills` requirements with `required_level` and `importance`, the caller's `skill_assessments`, and the caller's `evidence` linked through `evidence_skills`). Nothing is stored. It reuses the Stage 3 user-scoped repositories, so isolation is inherited. The engine is `src/domain/readiness.ts`: pure, deterministic, rule-based. It uses no AI and no external service, and it does not predict hiring or job success.

| Method & path | Returns |
|---|---|
| `GET /api/careers/:careerId/readiness` | `{careerId, careerName, state, score, range, counts, weights, skills[], caveats[], formula}` |
| `GET /api/careers/:careerId/gaps` | `{careerId, counts, below[], unassessed[], meets[], caveats[]}` |
| `GET /api/careers/:careerId/actions?limit=5` | `{careerId, careerName, actions[], note}`; `limit` 1–10 (default 5) |

Errors: `401` without a valid token, `400 validation_failed` for a malformed career id or bad `limit`, `404 career_not_found`. The user id comes only from the token; a `userId` in the query or body is ignored.

**Formula.** For each *assessed* required skill:
```
levelRatio    = min(level / requiredLevel, 1)                  (requiredLevel <= 0 counts as 1)
evidencePts   = sum over the user's evidence linked to the skill: weak 1, moderate 2, strong 3, very_strong 4
evidenceRatio = min(evidencePts / (max(requiredLevel,1) * 1.2), 1)
skillScore    = 0.75 * levelRatio + 0.25 * evidenceRatio
score         = round(100 * sum(importance * skillScore) / sum(importance))      over ASSESSED skills only
range.min     = same numerator / total importance of ALL skills (unassessed counted as 0)
range.max     = unassessed counted as fully met
```
`importance` is 1–5 (default 3). **Unassessed skills are unknown, not zero**: they are excluded from `score`; `range` shows the bounds. `state`: `not_assessed` (nothing rated, `score: null`), `partial`, `assessed` (all rated), `no_requirements` (career has no skills, `score: null`). Each skill row shows `requiredLevel`, `currentLevel` (`null` if unassessed), `importance`, `status` (`meets|below|unassessed`), `gap`, evidence count/points/status (`none|thin|sufficient`), `weightShare` and `contribution` (points of the final score; they add up to `score`). Evidence strength and skill levels are self-reported, and `caveats` says so. This backend formula is deliberately simpler than the frontend's local readiness calculation (`src/utils/readiness.ts`) and does not replace it; the UI does not call these endpoints yet.

**Gaps.** `below`: assessed under the requirement, sorted by `gap × importance` (then importance, skill id). `unassessed`: sorted by importance, required level. `meets`: at or above the requirement.

**Actions** (deterministic, ties broken by skill id): `build_skill` for below-target skills (score `2 × gap × importance`; `high` if gap ≥ 2 or importance ≥ 4), `assess_skill` for unassessed ones (score `importance`, +1 if required level ≥ 4), `add_evidence` for met skills with no/thin evidence (score `0.5 × importance × (1 − evidenceRatio)`, `low`). Each has `skillId, skillName, capabilityName, reason, recommendation, priority, priorityScore, currentLevel, targetLevel, completionCriterion`.
```
GET /api/careers/swe/actions?limit=1   (Authorization: Bearer …)
→ {"actions":[{"id":"build_skill:swe:algorithms","rank":1,"type":"build_skill","priority":"high","targetLevel":4,"completionCriterion":"Reassess Algorithms at level 4 or higher.", …}], …}
```

Auth errors: `401` with codes `token_missing`, `invalid_token`, `token_expired`, `invalid_credentials` (+ `WWW-Authenticate: Bearer`).
Errors always look like `{ "error": { "code", "message", "requestId", "fields"? } }`; unexpected errors return a generic 500 and are logged server-side with the request id.
`GET /api/health` → `200 {status:"ok", database:"up", ...}`; `503 {status:"degraded", database:"down"}` (2 s timeout, no connection details).

## Frontend
Set `VITE_API_URL=http://localhost:4000/api` in the frontend `.env` (no other URL is hard-coded) and restart `npm run dev`. **Stage 5 integration** (`src/services/*`, flags in `src/services/api.ts`):

| Feature | Backend mode (`VITE_API_URL` set) |
|---|---|
| Sign-up / login / logout | `/api/auth/*`, JWT in browser storage; an expired/invalid token (401) ends the session and the route guards redirect to login |
| Careers (Explorer, detail, onboarding, compare) | `GET /api/careers`, `GET /api/careers/:id` (+ this browser's local custom careers) |
| Skill ratings (onboarding, skill detail) | `GET/PUT /api/me/skills`; only rated skills exist, so unrated stays unknown, never 0 |
| Evidence (list/create/edit/delete, skill links) | `/api/evidence`; server validation errors appear on the form fields |
| Readiness, gaps, next actions (Dashboard, Skills, Roadmap, Career detail, Assistant, Compare) | `GET /api/careers/:id/readiness`, `/gaps`, `/actions?limit=10`, mapped in `src/services/analysisApi.ts`; the readiness card shows coverage, the possible range, the server's caveats and a "rule-based estimate, not a prediction" note |
| Settings: clear evidence / reset account | also deletes this user's server-side evidence and ratings |

**Browser-only data:** since Stage 7 nothing user-specific stays in the browser when the backend is used. Profile details, target career, onboarding state, action progress and settings are served by `GET/PUT /api/profile`, `GET/PUT/DELETE /api/careers/:id/action-progress[/:actionKey]` and `GET/PUT /api/settings` (existing tables `profiles`, `actions` + `roadmap_items`, `user_settings`; no schema change). Data saved in a browser by older versions is only copied by the explicit import in Settings.

**Checking that the frontend really uses the backend (development):** the page footer shows "Data source: BACKEND (…)" or "LOCAL MOCK DATA" (dev builds only), and the browser console prints the same at startup, probes `<VITE_API_URL>/health`, and logs each API call as `METHOD path -> status (ms)` (never headers, bodies or tokens). If it says LOCAL MOCK DATA, the variable did not reach Vite: the file must be named exactly `.env` (not `.env.txt`), sit next to `package.json`, be saved as UTF-8 (PowerShell's `echo ... > .env` writes UTF-16, which Vite cannot read), and `npm run dev` must be restarted afterwards. In mock mode there are no network requests at all, so an empty Network tab is expected. Also: in the local calculation a career with fewer than half its skills rated shows "Not assessed", while the backend shows a percentage as soon as one skill is rated, with its range and caveats.
**Older browser-only data:** ratings and evidence saved in this browser before backend mode are copied once per session to the signed-in user's server account (evidence is removed locally only after the server accepted it; items the server rejects stay local).

## Tests
`cd server && npm test` — see the release notes for the current count (it was 137 at Stage 4) (89 from Stages 1–2, 28 for Stage 3, 20 for Stage 4 in `readiness.test.ts`: engine unit tests, API/isolation, Stage 1–3 route regression. Stage 3: `core.test.ts` API/isolation/validation, `migration003.test.ts` static SQL + recorded-SQL scoping). Frontend: `npm test` at the repo root, 101 tests (incl. `tests/integration.test.ts`: frontend services against the real backend request pipeline over in-memory repositories, not PostgreSQL or a browser). None of these needs PostgreSQL. Original 89 breakdown: config, validation, crypto (scrypt, JWT tamper/expiry/alg-none), routing/errors/CORS/headers, health, migration runner, SQL static checks (incl. migration 002 vs the repository's column names), seed, a real-socket smoke test, **auth/profile/isolation suites** over in-memory repositories, and a **frontend↔backend contract test** that runs the real frontend auth client against the real backend pipeline through a fake `fetch`.

## Limitations (honest)
- No rate limiting or lockout on login; add before exposing publicly.
- Tokens cannot be revoked before expiry; no refresh tokens; no password reset or email verification.
- The JWT lives in browser storage (readable by injected scripts); httpOnly cookies are a possible later hardening.
- The HS256 token code is small and tested but hand-written; `jsonwebtoken` is a drop-in alternative behind `utils/token.ts`.

## Verified vs not verified
Verified by the tests above: everything except the items below. **Not verified in the authoring environment** (no network, PostgreSQL or Express): `npm install`; migrations 001/002/003, the PostgreSQL repositories (`repositories/pg.ts`, `pg-core.ts`) and seed (including that migration 003 and the seed run twice cleanly) against a real database; the Express adapter; real HTTP from a browser. Run the Setup steps once locally and register/login against a real database to confirm.

## Stage 7 additions

- `GET/PUT /api/profile` now also stores `stage`, `experienceLevel`, `onboardingComplete`, `completeness`; `targetCareerId` must be a career visible to the caller (shared or their own custom career).
- `GET /api/careers/:careerId/action-progress`, `PUT|DELETE /api/careers/:careerId/action-progress/:actionKey`: progress the user recorded (`in_progress`, `completed`; "not started" = no row). Stored in `actions` + `roadmap_items`.
- `GET/PUT /api/settings`: `reduceMotion`, `assistantSuggestions` (`user_settings`).
- Evidence responses include `provenance` (`origin`, `verification.status`, `label`). `verified` requires a complete verification record that nothing can create yet; client-supplied `source`/`verified` fields are ignored.
- `POST/PUT /api/careers` accept optional `evaluationRules` (`levelWeight`, `evidenceFullFactor`, `evidenceThinBelow`, `strengthPoints`) and per-skill `minEvidence`; readiness responses include `evaluation` (`source`, `rules`, `description`). Needs migration 004 (additive, idempotent); without it the API uses defaults and answers 409 `migration_required` when asked to store custom settings.
- `description` is optional on career create/update (an empty string is valid).

## AI assistant (optional, server-side)

`GET /api/assistant/status` and `POST /api/assistant/chat` (both require a Bearer token). With no AI configuration the API and the app work as before:
status reports `available: false` and chat answers `503 ai_not_configured`. The server never substitutes a canned reply for a model.

**Configure (in `server/.env`, never in the frontend `.env`):** `AI_PROVIDER` (`anthropic` | `openai-compatible`), `AI_API_KEY`, `AI_MODEL`,
`AI_BASE_URL` (required for openai-compatible), and the optional `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_RATE_LIMIT_PER_MINUTE`. Incomplete settings switch the
assistant off (logged once at start-up, without secrets); they do not stop the server. Restart the API after editing `.env`.

**Cost and alternatives.** A hosted model is billed by the vendor per token; this app caps every answer (`AI_MAX_OUTPUT_TOKENS`, default 700), the conversation sent
(last 12 turns, 2000 characters each, 12000 in total), and requests per user (default 10 per minute). Check your vendor's current pricing before a public deployment.
For development without spending anything, point `openai-compatible` at a local open-source model server (for example Ollama at `http://localhost:11434/v1`).
Automated tests use a clearly named in-test fake model and never call a vendor.

**What the model receives:** a fixed system prompt plus a `<career_data>` block built **on the server** from the signed-in user's own readiness result for one career
(assessed/unassessed skills, levels, evidence counts, top actions) and their self-written profile notes, each cut to a length limit. No email, name, password or token is
included. Another user's career id returns `404 career_not_found` before any model call. Text a user typed is treated as data: it is escaped so it cannot close the data
block, and the prompt tells the model to ignore instructions inside it. This reduces, but cannot eliminate, prompt-injection risk with any language model.

**Errors:** `400 validation_failed`, `401`, `404 career_not_found`, `429 rate_limited` (with `Retry-After`), `502 ai_unavailable`, `504 ai_timeout`, `503 ai_not_configured`.
Logs record provider, duration and counts only, never message text, prompts or keys.

**Honest limitations:** the rate limiter is in memory per API process (use a shared store if you run several instances); answers are not streamed; conversations are not
stored on the server (the browser keeps the current one in memory only); there is no web search or retrieval, so the model cannot cite sources and is told not to invent any;
no content-moderation layer is added beyond the vendor's; `max_tokens` is sent for openai-compatible servers, which some newer vendor models replace with
`max_completion_tokens` (use a compatible model or gateway if your vendor rejects it); the real vendor calls have not been exercised by the automated tests in this repository.

## Backend sprint additions (after Stage 9; no migration, no new SQL)

| Endpoint | What it adds |
|---|---|
| `GET /api/careers/:id/graph` | The career graph as data: `nodes` (career, capability, skill, evidence, action; each with a `data` object) and `links` (`contains`, `supports`, `addresses`), a `summary` and `notes`. Built only from the career model, the user's own evidence links, the readiness result and the ranked actions with saved progress. Unrated skills have `currentLevel: null`; evidence has `verified: false`; there are no skill-to-skill links because the model has none. |
| `GET /api/careers/:id/actions` | Each action now carries `status` (`not_started`, `in_progress`, `completed`) and `completedAt` from saved progress, plus `summary` counts and `history` (saved progress not among the current actions: the gap closed, or it ranks below `limit`). Existing fields are unchanged. |
| `GET /api/evidence?limit&offset` | Newest-first paging with `total`. Default limit 200 (max 200). A user can hold up to 500 evidence items; the 501st create returns `409 evidence_limit_reached`. |
| `POST /api/auth/login` | Failed sign-ins are throttled per email (8 per 15 minutes, `429` + `Retry-After`), whether or not the account exists. A success resets the count. In memory, per process: a multi-instance deployment needs a shared store. |

Environment variables (all in `server/.env`, none committed): `DATABASE_URL`, `DATABASE_SSL`, `JWT_SECRET`, `JWT_EXPIRES_IN_SECONDS`, `PORT`, `CLIENT_ORIGIN` (comma-separated exact origins, default `http://localhost:5173`), and the optional `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_RATE_LIMIT_PER_MINUTE`.

Known backend limits: evidence has no verification workflow (everything is self-reported); actions have no dependency or deadline data; JWTs cannot be revoked before they expire (logout only tells the client to discard the token).

## AI career drafts
`POST /api/careers/draft` (auth required) returns a schema-validated, unverified AI draft and never saves it. See the root README section "AI-assisted custom career models". Output budget 3500 tokens (fixed; `AI_MAX_OUTPUT_TOKENS` applies to chat only); `AI_TIMEOUT_MS` and `AI_RATE_LIMIT_PER_MINUTE` apply. Logs contain only category, counts and timings.
