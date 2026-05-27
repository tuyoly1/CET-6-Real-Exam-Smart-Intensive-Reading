import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSectionType } from "@/lib/question-types";
import { translationProviderStatus } from "@/lib/translation";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const query = searchParams.get("q")?.trim();

  const blockWhere: Prisma.PaperBlockWhereInput = {};
  if (query) {
    const searchClauses: Prisma.PaperBlockWhereInput[] = [
      { originalText: { contains: query } },
      { translatedText: { contains: query } }
    ];

    const pageNumber = Number(query);
    if (Number.isInteger(pageNumber)) {
      searchClauses.push({ pageNumber });
    }

    blockWhere.OR = searchClauses;
  }

  const sections = await prisma.paperSection.findMany({
    where: {
      paperId: id,
      ...(type && isSectionType(type) ? { type } : {})
    },
    orderBy: { orderIndex: "asc" },
    include: {
      blocks: {
        where: blockWhere,
        orderBy: { orderIndex: "asc" }
      }
    }
  });

  return NextResponse.json({
    sections: sections.filter((section) => section.blocks.length > 0 || !query),
    translation: translationProviderStatus()
  });
}
