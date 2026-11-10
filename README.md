# CareerGraph — Personalized Career Readiness Platform

**Choose a career. Understand the skills it needs. See what you're missing. Know what to do next.**

🔗 **Live demo:** https://career-graph-ten.vercel.app/

💻 **Source:** https://github.com/PriyankaBagri/CareerGraph

## Overview

CareerGraph helps students turn a career goal into concrete next steps. A student picks a career, rates their skills, adds evidence of what they can do, sees their readiness and skill gaps, and gets a ranked list of actions and a weekly plan. They can also find a sample mentor for their career and book a session, paying through PayPal **Sandbox** (test money only).

## Features

- **Career exploration:** a catalogue of careers, a "More careers to try" list, and custom careers you create yourself (optionally drafted by AI).
- **Skills and evidence:** rate your skills and attach projects, certificates or experience.
- **Readiness and gaps:** a rule-based readiness estimate. It is not a prediction of hiring or job success, and unrated skills count as unknown, not zero.
- **Roadmap and actions:** ranked next actions with progress tracking.
- **Assistant and weekly plan:** a chat assistant and a weekly plan built from your real actions. Both work without AI configured (see [AI configuration](#ai-configuration)).
- **Mentorship and bookings:** mentors are matched to the career you selected, and a booking is only confirmed after a verified PayPal Sandbox payment.

> **Demo data:** the mentors and their sessions are **sample profiles stored in the database by the seed script**. They are not real or verified professionals, and the sessions are offerings, not real appointment times. There is no mentor sign-up yet. Payments use the PayPal Sandbox only; Live payments are not supported.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js (20.11+), Express, TypeScript (run with `tsx`) |
| Database | PostgreSQL |
| Payments | PayPal Sandbox REST API (server-side, native `fetch`) |
| Hosting | Vercel (frontend), Render (API), Neon (database) |

The frontend only talks to the backend API. The backend owns all prices, payments and AI keys.

## Setup (local)

You need Node.js 20.11 or later, npm and a PostgreSQL database.

### 1. Install

```bash
git clone https://github.com/PriyankaBagri/CareerGraph.git
cd CareerGraph
npm run install:all
```

### 2. Configure

Frontend: create `.env.local` in the project root (see `.env.example`):

```env
VITE_API_URL=http://localhost:4000/api
```

Backend: copy `server/.env.example` to `server/.env` and fill it in. The essentials:

```env
PORT=4000
DATABASE_URL="postgres://USER:PASSWORD@localhost:5432/careergraph"
DATABASE_SSL=false
CLIENT_ORIGIN=http://localhost:5173
NODE_ENV=development
JWT_SECRET=<at least 32 random characters>
```

Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Never commit `.env` files, and never put secrets in a `VITE_` variable.

### 3. Migrate and seed

```bash
npm run db:check      # can the server reach the database?
npm run db:migrate    # applies server/migrations/001 … 007, in order
npm run db:seed       # careers + sample mentors/sessions (safe to run again)
```

Migrations are additive. An already-applied migration is never re-run, and if one was edited after being applied the runner stops instead of guessing. Never edit an applied migration; add a new numbered file. SQL files must keep LF line endings (`.gitattributes` enforces this) because their checksums are computed on the raw bytes.

### 4. Run

```bash
npm run dev:api   # terminal 1: API on http://localhost:4000
npm run dev       # terminal 2: app on http://localhost:5173
```

## PayPal Sandbox configuration

Payments are optional. Without keys, every other feature works and payment endpoints answer `503`.

1. In the [PayPal developer dashboard](https://developer.paypal.com/dashboard/applications/sandbox), create a **Sandbox** REST app and copy its Client ID and Secret.
2. Put them in `server/.env` (on Render: in the service's environment settings):

```env
PAYPAL_CLIENT_ID=<sandbox client id>
PAYPAL_CLIENT_SECRET=<sandbox secret>
PAYPAL_MODE=sandbox
```

3. PayPal sends the buyer back to the **first** origin in `CLIENT_ORIGIN` (for example `http://localhost:5173/bookings/payment/return`). In production, put your Vercel URL first.
4. Check the setup: `npm run paypal:check`. It signs in to the Sandbox and creates one unpaid $1 order. It prints step names and results only, never secrets, and charges nobody.
5. To pay in the app, use a Sandbox **buyer** account from the same dashboard.

The payment flow is: booking is created with the price copied from the database → server creates the PayPal order → student approves at PayPal → server captures it and confirms the booking only if PayPal reports `COMPLETED` for that booking, amount and currency. Returning from PayPal alone never confirms a booking.

## AI configuration

AI is optional and server-side only. Leave `AI_PROVIDER` empty to run without it. Then the weekly plan is a **"Rule-based starter plan"** built from your existing actions, and career drafts use a template labelled "not AI-generated".

```env
AI_PROVIDER=anthropic          # or openai-compatible
AI_API_KEY=<key>
AI_MODEL=<model name>
AI_BASE_URL=                   # required for openai-compatible, optional for anthropic
```

The server log says at startup whether AI is enabled. The key stays on the server; never prefix it with `VITE_`. A chat subscription does not include API access, so you need an API key from the provider. AI answers are labelled as AI-generated and can be wrong.

## Testing

```bash
npm run test:api       # backend tests (node:test via tsx)
npm run typecheck:api  # backend TypeScript check
npm test               # frontend tests
npm run build          # frontend TypeScript check + production build
git diff --check       # whitespace problems
```

All payment tests use a fake PayPal; none contact PayPal. The PostgreSQL integration tests (`npm run test:pg`) are opt-in: set `TEST_DATABASE_URL` in `server/.env` to a database whose name ends in `_test`.

## Deployment

**Database (Neon).** Create a database and copy its connection string.

**API (Render).** Use `server` as the root directory.

- Build command: `npm install`
- Start command: `npm run start:prod`
- Environment: `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_SSL=true`, `JWT_SECRET` (32+ characters; the server refuses to start in production without it), `CLIENT_ORIGIN` (your Vercel URL first), plus the optional PayPal and AI variables above.
- Run once, and again after each release that adds a migration (Render shell or pre-deploy command):

```bash
npm run db:migrate:prod
npm run db:seed:prod    # sample careers and demo mentors; safe to run again
npm run db:check:prod
```

The `:prod` scripts read the settings from the environment and do not need a `.env` file.

**Frontend (Vercel).** Set `VITE_API_URL=https://<your-render-host>/api`. `vercel.json` rewrites every path to `index.html`, so direct visits and the PayPal return page (`/bookings/payment/return`) load the app instead of a 404. Static assets are still served as files.

After deploying, check the Render logs for "PayPal Sandbox payments enabled".

## Project status

Not built yet: mentor sign-up, real scheduling, refunds, webhooks and a payment-history page. The bookings list shows a cancelled or failed payment as "Payment pending", and an abandoned PayPal order is reused rather than replaced.

## License

[MIT](LICENSE) © 2026 Priyanka Bagri

## Author

**Priyanka Bagri** — B.Tech, Information Technology, Heritage Institute of Technology
