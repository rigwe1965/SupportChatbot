# SupportChatbot

A customer support chatbot built with Next.js 14 (App Router), TypeScript, Tailwind CSS and Prisma.

## Stack

- [Next.js 14](https://nextjs.org/) – App Router
- TypeScript + ESLint
- Tailwind CSS – class-based dark/light mode (follows OS preference, persisted in `localStorage`)
- Prisma (SQLite by default)

## Getting started

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
docker compose up -d        # local PostgreSQL (or point DATABASE_URL at your own)
npx prisma migrate deploy
npm run dev
```

### Authentication

NextAuth.js v4 with Google and GitHub, Prisma adapter, JWT sessions.

1. Create OAuth apps and fill in `GOOGLE_CLIENT_*` / `GITHUB_*` in `.env`
   (callback URLs are listed in `.env.example`).
2. Set `NEXTAUTH_SECRET` (`openssl rand -base64 32`).
3. Emails in `ADMIN_EMAILS` become `ADMIN` on sign-in; everyone else is `FREE`.

- Protected routes: `/dashboard` (any user), `/admin` (admin only) — see `middleware.ts`.
- Server: `getSession()` from `lib/auth.ts`. Client: `useSession()`.

Open <http://localhost:3000>. Health check: <http://localhost:3000/api/health>.

## Deploying to Vercel

Database: **Neon Postgres** (the Vercel Marketplace integration replaces Vercel Postgres). pgvector is supported.

1. **Push to GitHub** and import the repo at <https://vercel.com/new> (framework: Next.js; the build command comes from the `vercel-build` script).
2. **Add the database**: Project → Storage → Create → *Neon* (Postgres). It injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`.
   - Edit `DATABASE_URL` to end with `?sslmode=require&pgbouncer=true&connect_timeout=15`.
   - Add `DIRECT_URL` = the value of `DATABASE_URL_UNPOOLED` (used by `prisma migrate`; pooled connections can't run migrations).
   - The first migration runs `CREATE EXTENSION vector`; Neon allows this on every plan.
3. **Set the other variables** (see `.env.example` for the full list):
   `NEXTAUTH_URL` (your production URL), `NEXTAUTH_SECRET`, `OPENAI_API_KEY`, `ADMIN_EMAILS`, the OAuth keys, and optionally Slack.
4. **OAuth apps** — register the production callback URLs:
   - Google: `https://<domain>/api/auth/callback/google` (and set the consent screen to *In production*)
   - GitHub: `https://<domain>/api/auth/callback/github` (GitHub allows one callback per app, so create a separate app from your local one)
5. **Deploy.** `vercel-build` checks the env vars (failing with a clear message if something is missing), runs `prisma migrate deploy`, then builds.
6. **Bootstrap**: sign in with an email listed in `ADMIN_EMAILS`, open `/admin/articles`, add articles, then try `/chat`.

Notes
- OAuth only works on the domain in `NEXTAUTH_URL`, so preview deployments can't sign in. Give Preview its own Neon branch/database so `migrate deploy` never touches production data.
- Chat and bulk re-embedding functions are capped at 60 s (`maxDuration`).
- Rotate `NEXTAUTH_SECRET` and never commit `.env`.

## Project structure

```
app/           Routes, layouts, API route handlers (app/api/*)
components/    Reusable UI components
lib/           Shared utilities (e.g. Prisma client in lib/db.ts)
types/         Shared TypeScript types
prisma/        Prisma schema and migrations
```

## Scripts

| Command         | Description              |
| --------------- | ------------------------ |
| `npm run dev`   | Start the dev server     |
| `npm run build` | Production build         |
| `npm start`     | Run the production build |
| `npm run lint`  | Lint with ESLint         |
| `npm test`      | Run the Vitest suite     |

## Roadmap

- [ ] Chat UI
- [ ] `/api/chat` endpoint
- [ ] Persist conversations with Prisma

## License

TBD
