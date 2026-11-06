import { NextResponse } from "next/server";

/** API index — describes the service honestly instead of a scaffold stub. */
export async function GET() {
  return NextResponse.json({
    service: "Carmaze API",
    status: "ok",
    health: "/api/health",
    docs: "Kenyan automotive ecosystem: marketplace, showrooms, garages, suppliers, logistics, procurement",
  });
}
