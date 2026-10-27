# CareerGraph — Personalized Career Readiness Platform

**Explore your target career. Understand the skills it requires. Build a roadmap to become career-ready.**

🔗 **Live Demo:** https://career-graph-ten.vercel.app/  
💻 **Source Code:** https://github.com/PriyankaBagri/CareerGraph

## Overview

CareerGraph is a career-readiness platform designed to help students turn career aspirations into actionable learning plans. Instead of leaving students confused about what to learn next, it connects career goals with required skills, evidence of learning, readiness assessments, skill gaps, and recommended actions.

The goal is to make career planning more structured, understandable, and actionable for students.

## Key Features

- **Career Exploration:** Explore a target career and understand the capabilities it requires.
- **Skill Mapping:** Connect career requirements with relevant skills and expected evidence of learning.
- **Personalized Roadmaps:** Organize learning goals into actionable steps.
- **Readiness and Gap Analysis:** Identify areas that need improvement relative to a selected career.
- **Progress Tracking:** Track the status of career-development actions.
- **Custom Careers:** Support career targets beyond a fixed list of predefined options.
- **Persistent Data:** Use a PostgreSQL-backed backend for application data.

*Feature availability may vary; use the live demo to explore the current implementation.*

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Deployment | Vercel (frontend), Render (API), Neon (database) |

## Architecture

The application uses a separate frontend and backend:

- **Frontend:** Deployed on Vercel.
- **REST API:** Hosted on Render.
- **Database:** PostgreSQL hosted on Neon.

The frontend communicates with the backend API, which handles application requests and database operations.

## Getting Started

### Prerequisites

- Node.js 20.11 or later
- npm
- A PostgreSQL database

### 1. Clone the repository

```bash
git clone https://github.com/PriyankaBagri/CareerGraph.git
cd CareerGraph
npm install
npm --prefix server install
```

### 2. Configure environment variables

Create a `.env.local` file in the project root for the frontend:

```env
VITE_API_URL=http://localhost:4000/api
```

Create a `server/.env` file for the backend:

```env
PORT=4000
DATABASE_URL=your_postgresql_connection_string
DATABASE_SSL=false
CLIENT_ORIGIN=http://localhost:5173
NODE_ENV=development
JWT_SECRET=your_local_secret_at_least_32_characters
```

Use your own database connection string and a secure local secret. Never commit environment files, credentials, or API keys.

### 3. Prepare the database

Ensure PostgreSQL is available and the backend environment is configured. Run the database migrations using:

```bash
npm run db:migrate
npm run db:check
```

### 4. Start the application

Open two terminals in the project root.

**Terminal 1 — Backend**

```bash
npm run dev:api
```

**Terminal 2 — Frontend**

```bash
npm run dev
```

Open the local Vite URL shown in your terminal, usually `http://localhost:5173`.

## Project Goal

CareerGraph aims to make career preparation less overwhelming by helping students understand the relationship between career goals, skills, practical evidence, readiness, and next steps.

## Future Improvements

- Expand career and skill coverage.
- Improve the accuracy and personalization of career recommendations.
- Enhance the user experience for tracking progress.
- Add more guidance and evidence-based readiness assessments.

## Author

**Priyanka Bagri**  
B.Tech — Information Technology  
Heritage Institute of Technology

---

*CareerGraph is an evolving student project. The live demo and repository reflect the current development state.*
