import { NextResponse } from "next/server";
import { repairPaperSectionTypes } from "@/lib/section-repair";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const repairs = await repairPaperSectionTypes(id);
  return NextResponse.json({ repairs });
}
