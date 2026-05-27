import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSectionType } from "@/lib/question-types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await request.json()) as { type?: string };

  if (!body.type || !isSectionType(body.type)) {
    return NextResponse.json({ error: "题型不合法。" }, { status: 400 });
  }

  const section = await prisma.paperSection.update({
    where: { id },
    data: { type: body.type }
  });

  return NextResponse.json({ section });
}
