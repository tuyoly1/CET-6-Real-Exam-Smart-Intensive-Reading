import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const paper = await prisma.paper.findUnique({
    where: { id },
    include: {
      job: true,
      _count: {
        select: {
          pages: true,
          blocks: true
        }
      }
    }
  });

  if (!paper) {
    return NextResponse.json({ error: "试卷不存在。" }, { status: 404 });
  }

  return NextResponse.json({ paper });
}
