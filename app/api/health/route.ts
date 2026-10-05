import { NextResponse } from "next/server";
import type { ApiResponse } from "@/types";

export function GET() {
  const body: ApiResponse<{ status: "ok" }> = { data: { status: "ok" } };
  return NextResponse.json(body);
}
