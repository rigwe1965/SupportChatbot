// Fails the Vercel build early, with a clear message, when required configuration is missing.
const missing = (name) => !process.env[name]?.trim();

const required = ["DATABASE_URL", "DIRECT_URL", "NEXTAUTH_SECRET", "OPENAI_API_KEY"];
if (process.env.VERCEL_ENV === "production") required.push("NEXTAUTH_URL");

const errors = required.filter(missing).map((n) => `Missing required env var: ${n}`);

const providers = [
  ["Google", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  ["GitHub", "GITHUB_ID", "GITHUB_SECRET"],
].filter(([, ...vars]) => vars.every((v) => !missing(v)));
if (providers.length === 0) {
  errors.push("Configure at least one OAuth provider (GOOGLE_CLIENT_ID/SECRET or GITHUB_ID/SECRET)");
}

if (process.env.DATABASE_URL?.includes("-pooler") && !process.env.DATABASE_URL.includes("pgbouncer=true")) {
  console.warn("Warning: DATABASE_URL looks like a pooled Neon URL; add `pgbouncer=true` for Prisma.");
}
if (missing("ADMIN_EMAILS")) console.warn("Warning: ADMIN_EMAILS is empty, nobody will be an admin.");
if (missing("SLACK_WEBHOOK_URL") && (missing("SLACK_BOT_TOKEN") || missing("SLACK_CHANNEL_ID"))) {
  console.warn("Warning: Slack is not configured, escalation tickets will not be posted to Slack.");
}

if (errors.length) {
  console.error(`\n${errors.map((e) => `✖ ${e}`).join("\n")}\n`);
  process.exit(1);
}
console.log("✔ Environment looks good");
