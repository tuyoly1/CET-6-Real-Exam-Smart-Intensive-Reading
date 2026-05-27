import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { translateAndCacheBlocks, translationProviderStatus } from "@/lib/translation";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const provider = translationProviderStatus();

  if (!provider.configured) {
    return NextResponse.json({ error: provider.message, translation: provider }, { status: 400 });
  }

  const blocks = await prisma.paperBlock.findMany({
    where: { paperId: id },
    orderBy: { orderIndex: "asc" }
  });
  const result = await translateAndCacheBlocks(blocks);

  return NextResponse.json({ result, translation: translationProviderStatus() });
}
