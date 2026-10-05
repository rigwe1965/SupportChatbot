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
npx prisma migrate dev --name init
npm run dev
```

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
