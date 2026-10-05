const features = [
  { title: "Next.js 14", body: "App Router, server components and API routes." },
  { title: "Tailwind CSS", body: "Token-based theming with class dark mode." },
  { title: "Prisma", body: "Typed database access, SQLite out of the box." },
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="space-y-4 text-center sm:text-left">
        <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          Support, <span className="text-brand">automated</span>.
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          Starter project ready for building your support chatbot. Edit{" "}
          <code className="rounded bg-foreground/5 px-1.5 py-0.5 font-mono text-sm">
            app/page.tsx
          </code>{" "}
          to get going.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-border p-5">
            <h2 className="font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-muted">{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
