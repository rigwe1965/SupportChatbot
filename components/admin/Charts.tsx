"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyPoint } from "@/lib/admin-stats";

const BRAND = "rgb(var(--brand))";
const GRID = "rgb(var(--border))";
const TEXT = "rgb(var(--muted))";
const tooltipStyle = {
  background: "rgb(var(--background))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "rgb(var(--foreground))",
};
const tick = { fill: TEXT, fontSize: 12 };

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      <div className="mt-4 h-64">{children}</div>
    </section>
  );
}

const Empty = () => (
  <div className="flex h-full items-center justify-center text-sm text-muted">No data for this period</div>
);

const shortDay = (d: string) => d.slice(5); // MM-DD

export function ConversationsChart({ data }: { data: DailyPoint[] }) {
  const empty = data.every((d) => d.conversations === 0);
  return (
    <Card title="Conversations per day">
      {empty ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="day" tickFormatter={shortDay} tick={tick} stroke={GRID} minTickGap={24} />
            <YAxis allowDecimals={false} tick={tick} stroke={GRID} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgb(var(--foreground) / 0.05)" }} />
            <Bar dataKey="conversations" name="Conversations" fill={BRAND} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export function EscalationChart({ data, overall }: { data: DailyPoint[]; overall: number | null }) {
  // Rate of conversations started that day which ended up with a ticket; days with no conversations are gaps.
  const points = data.map((d) => ({
    day: d.day,
    rate: d.conversations ? Math.round((d.escalated / d.conversations) * 100) : null,
  }));
  return (
    <Card
      title="Escalation rate"
      subtitle={overall === null ? undefined : `${overall}% of conversations in this period`}
    >
      {overall === null ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="day" tickFormatter={shortDay} tick={tick} stroke={GRID} minTickGap={24} />
            <YAxis domain={[0, 100]} unit="%" tick={tick} stroke={GRID} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}%`, "Escalated"]} />
            <Line type="monotone" dataKey="rate" stroke={BRAND} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export function TopicsChart({ data }: { data: { topic: string; count: number }[] }) {
  return (
    <Card title="Top topics" subtitle="Knowledge-base categories cited in answers">
      {data.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={tick} stroke={GRID} />
            <YAxis type="category" dataKey="topic" width={90} tick={tick} stroke={GRID} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgb(var(--foreground) / 0.05)" }} />
            <Bar dataKey="count" name="Answers" fill={BRAND} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
