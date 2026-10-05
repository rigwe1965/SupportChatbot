import { db } from "@/lib/db";

export interface DailyPoint {
  day: string; // YYYY-MM-DD
  conversations: number;
  escalated: number;
}

export interface OverviewStats {
  totalConversations: number;
  openTickets: number;
  totalTickets: number;
  resolvedTickets: number;
  /** Mean seconds from a customer message to the saved AI reply, over the selected range. */
  avgResponseSeconds: number | null;
  daily: DailyPoint[];
  topics: { topic: string; count: number }[];
}

export async function getOverviewStats(days: number): Promise<OverviewStats> {
  const [totalConversations, ticketCounts, avg, daily, topics] = await Promise.all([
    db.conversation.count(),
    db.ticket.groupBy({ by: ["status"], _count: true }),
    // Pairs each customer message with the next AI reply in the same conversation;
    // pairs over 5 minutes are ignored (those are retries/abandoned replies, not latency).
    db.$queryRaw<{ avg: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (a."createdAt" - u."createdAt")))::float8 AS avg
      FROM "Message" u
      JOIN LATERAL (
        SELECT m."createdAt" FROM "Message" m
        WHERE m."conversationId" = u."conversationId" AND m."role" = 'assistant' AND m."createdAt" > u."createdAt"
        ORDER BY m."createdAt" LIMIT 1
      ) a ON a."createdAt" - u."createdAt" < interval '5 minutes'
      WHERE u."role" = 'user' AND u."createdAt" > now() - make_interval(days => ${days}::int)`,
    db.$queryRaw<DailyPoint[]>`
      SELECT to_char(d::date, 'YYYY-MM-DD') AS "day",
             COUNT(c."id")::int AS "conversations",
             (COUNT(c."id") FILTER (WHERE EXISTS (SELECT 1 FROM "Ticket" t WHERE t."conversationId" = c."id")))::int AS "escalated"
      FROM generate_series(CURRENT_DATE - (${days}::int - 1), CURRENT_DATE, interval '1 day') d
      LEFT JOIN "Conversation" c ON c."createdAt"::date = d::date
      GROUP BY d ORDER BY d`,
    // A "topic" is the knowledge-base category of the articles an answer cited.
    db.$queryRaw<{ topic: string; count: number }[]>`
      SELECT s->>'category' AS "topic", COUNT(DISTINCT m."id")::int AS "count"
      FROM "Message" m, jsonb_array_elements(m."sources") s
      WHERE m."role" = 'assistant' AND jsonb_typeof(m."sources") = 'array'
        AND m."createdAt" > now() - make_interval(days => ${days}::int)
      GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
  ]);

  const count = (s: "OPEN" | "RESOLVED") => ticketCounts.find((t) => t.status === s)?._count ?? 0;
  const openTickets = count("OPEN");
  const resolvedTickets = count("RESOLVED");

  return {
    totalConversations,
    openTickets,
    resolvedTickets,
    totalTickets: openTickets + resolvedTickets,
    avgResponseSeconds: avg[0]?.avg ?? null,
    daily,
    topics,
  };
}
