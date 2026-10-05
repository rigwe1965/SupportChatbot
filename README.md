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

### Email + password accounts

Besides Google/GitHub, people can sign up with an email and password (`/register`, `/signin`).

- Sign-up emails a confirmation link; the account can't sign in until it's confirmed. This also stops anyone
  from claiming an `ADMIN_EMAILS` address by signing up with it.
- `/forgot-password` emails a one-hour, single-use reset link (`/reset-password`). It also works for
  Google/GitHub accounts, which is how they add a password.
- Passwords are hashed with scrypt; reset/confirmation tokens are stored only as SHA-256 hashes.
- Sign-up, reset and sign-in attempts are rate limited, and responses don't reveal whether an email has an account.
- Emails are sent through Resend (`RESEND_API_KEY`). In development without a key, the email (and its link) is
  printed in the server console instead.
- Known limits: signing in with a password and with Google/GitHub for the same address are separate until the
  person sets a password via "Forgot password"; and changing a password while signed in doesn't sign out other
  devices (a reset from the emailed link does, and so does "Sign out everywhere").

### Signing out everywhere

`/account` has a "Sign out everywhere" button. Sessions are JWTs, which can't be revoked one by one, so each user has a
`sessionsValidFrom` time: every sign-in records when it happened, and `getSession()` rejects any session that began
before that time. The same cutoff is applied when a password is reset from the emailed link, so whoever had the old
password is signed out. Changing a password while signed in does not sign out other devices. Needs migration
`20261005120000_sessions_valid_from`. Sessions that existed before this feature have no sign-in time, so they are signed
out the first time anyone uses the button; until then they keep working.

### Changing your password

`/account` lets people with a password change it (current password + new one, same rules as sign-up). It is limited to
5 attempts per hour per user, voids any outstanding email links, and sends a "password changed" email. To sign
other devices out, use "Sign out everywhere". Google/GitHub-only accounts are pointed to "Forgot password" to set a first password.

### Downloading your data

`/account` has a "Download my data" button (password required for password accounts). It returns a JSON file with the
profile, all conversations and messages (including feedback given) and support tickets. Password hashes, one-time
links, OAuth tokens and admin-only bookkeeping are never included. Limited to 5 exports per hour per user.

### Deleting an account

Signed-in users can delete their own account at `/account` (typing `DELETE`, plus their password if they have one).

- Their conversations and messages are deleted, along with their sign-in methods, sessions and email links.
- Support tickets are kept for the team's records, but the name, email, question, answer and transcript are removed.
- Articles an admin wrote stay without an author. Audit entries stay, including the admin's email in them.
- The only remaining admin can't delete their account. An admin deleting themselves is recorded in the audit log.
- `getSession()` checks the user still exists, so a session on another device stops working right away.
- Google/GitHub-only accounts have no password to re-enter, so they only type `DELETE`.

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
- Old audit log entries are deleted by a daily Vercel Cron job (`vercel.json` → `/api/cron/audit-retention`), after `AUDIT_RETENTION_DAYS` (default 365; `0` keeps everything). Set `CRON_SECRET` so the job is authorised.
- New tickets can be emailed to the team via Resend (`RESEND_API_KEY`, `EMAIL_FROM`, `TICKET_NOTIFY_EMAILS`, defaulting to `ADMIN_EMAILS`). Verify your sending domain in Resend first.
- Chat is rate limited per user (default 10/minute, 100/hour; see `RATE_LIMIT_CHAT_*`). Counters live in Postgres (`RateLimit` table), so no extra service is needed.
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
