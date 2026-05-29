import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { translateAndCacheBlocks, translationProviderStatus } from "@/lib/translation";
import {
  failTranslationProgress,
  finishTranslationProgress,
  getTranslationProgress,
  startTranslationProgress,
  updateTranslationProgress
} from "@/lib/translation-progress";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return NextResponse.json({ progress: getTranslationProgress(id) });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const provider = translationProviderStatus();

  if (!provider.configured) {
    return NextResponse.json({ error: provider.message, translation: provider }, { status: 400 });
  }

  const currentProgress = getTranslationProgress(id);
  if (currentProgress.status === "running") {
    return NextResponse.json(
      { progress: currentProgress, translation: provider, alreadyRunning: true },
      { status: 202 }
    );
  }

  const blocks = await prisma.paperBlock.findMany({
    where: { paperId: id },
    orderBy: { orderIndex: "asc" }
  });
  const progress = startTranslationProgress(id, blocks.length);

  void (async () => {
    try {
      await translateAndCacheBlocks(blocks, (nextProgress) => {
        updateTranslationProgress(id, {
          status: "running",
          ...nextProgress
        });
      });
      finishTranslationProgress(id, "翻译完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "翻译失败";
      failTranslationProgress(id, message);
    }
  })();

  return NextResponse.json(
    {
      progress,
      translation: translationProviderStatus()
    },
    { status: 202 }
  );
}
