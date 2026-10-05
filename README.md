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

## Roadmap

- [ ] Chat UI
- [ ] `/api/chat` endpoint
- [ ] Persist conversations with Prisma

## License

TBD
