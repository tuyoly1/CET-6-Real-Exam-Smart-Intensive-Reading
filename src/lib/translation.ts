import type { PaperBlock, PaperBlockType, Prisma } from "@prisma/client";
import { buildPassageJson } from "@/lib/passage-structure";
import { prisma } from "@/lib/prisma";
import { hasOpenAiKey, openAiApiMode, translateWithOpenAi, translationModel } from "@/lib/openai-service";

const DEFAULT_BATCH_SIZE = 48;
const DEFAULT_BATCH_CHARS = 6500;
const DEFAULT_CONCURRENCY = 6;
export const EN_TO_ZH_STYLE = "exam_intensive_zh";
export const ZH_TO_EN_REFERENCE_STYLE = "cet6_cn_to_en_reference";
const LEGACY_EN_TO_ZH_STYLE = "exam_intensive";
const TRANSLATABLE_TYPES: PaperBlockType[] = [
  "directions",
  "passage",
  "paragraph",
  "question_group",
  "question",
  "option",
  "word_bank",
  "translation_prompt"
];

export type TranslationProgressSnapshot = {
  total: number;
  completed: number;
  cached: number;
  translated: number;
  failed: number;
  batchesDone: number;
  batchesTotal: number;
  message: string;
};

type CachedTranslationHit = {
  translation: string;
  paragraphsJson: string | null;
  style: string;
};

type TranslationProgressCallback = (
  progress: TranslationProgressSnapshot
) => Promise<void> | void;

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createBatches(blocks: PaperBlock[]) {
  const maxItems = numberFromEnv("TRANSLATION_BATCH_SIZE", DEFAULT_BATCH_SIZE);
  const maxChars = numberFromEnv("TRANSLATION_BATCH_CHARS", DEFAULT_BATCH_CHARS);
  const batches: PaperBlock[][] = [];
  let batch: PaperBlock[] = [];
  let batchChars = 0;

  for (const block of blocks) {
    const blockChars = block.originalText.length;
    const shouldStartNext =
      batch.length > 0 && (batch.length >= maxItems || batchChars + blockChars > maxChars);

    if (shouldStartNext) {
      batches.push(batch);
      batch = [];
      batchChars = 0;
    }

    batch.push(block);
    batchChars += blockChars;
  }

  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  return results;
}

function shouldTranslate(block: PaperBlock) {
  return TRANSLATABLE_TYPES.includes(block.blockType) && block.originalText.trim().length >= 2;
}

export function translationStyleForBlock(block: Pick<PaperBlock, "blockType">) {
  return block.blockType === "translation_prompt" ? ZH_TO_EN_REFERENCE_STYLE : EN_TO_ZH_STYLE;
}

function cacheFallbackStyles(style: string) {
  return style === EN_TO_ZH_STYLE ? [LEGACY_EN_TO_ZH_STYLE] : [];
}

function buildCacheStyleOrder(style: string) {
  return [style, ...cacheFallbackStyles(style)];
}

async function loadCachedTranslations(blocks: PaperBlock[], provider: string, model: string) {
  const groupedByStyle = new Map<string, PaperBlock[]>();
  for (const block of blocks) {
    const style = translationStyleForBlock(block);
    const list = groupedByStyle.get(style) ?? [];
    list.push(block);
    groupedByStyle.set(style, list);
  }

  const cachedByStyle = new Map<string, Map<string, CachedTranslationHit>>();

  await Promise.all(
    [...groupedByStyle.entries()].map(async ([style, styleBlocks]) => {
      const hashes = Array.from(new Set(styleBlocks.map((block) => block.textHash)));
      const styleOrder = buildCacheStyleOrder(style);
      const rank = new Map(styleOrder.map((item, index) => [item, index]));
      const records = await prisma.translationCache.findMany({
        where: {
          textHash: { in: hashes },
          provider,
          model,
          style: { in: styleOrder }
        },
        select: {
          textHash: true,
          translation: true,
          paragraphsJson: true,
          style: true
        }
      });

      const cacheMap = new Map<string, CachedTranslationHit>();
      for (const record of records) {
        const current = cacheMap.get(record.textHash);
        if (!current) {
          cacheMap.set(record.textHash, {
            translation: record.translation,
            paragraphsJson: record.paragraphsJson,
            style: record.style
          });
          continue;
        }

        const currentRank = rank.get(current.style) ?? Number.POSITIVE_INFINITY;
        const nextRank = rank.get(record.style) ?? Number.POSITIVE_INFINITY;
        if (nextRank < currentRank) {
          cacheMap.set(record.textHash, {
            translation: record.translation,
            paragraphsJson: record.paragraphsJson,
            style: record.style
          });
        }
      }

      cachedByStyle.set(style, cacheMap);
    })
  );

  return cachedByStyle;
}

export function translationProviderStatus() {
  return hasOpenAiKey()
    ? ({ configured: true, message: `翻译接口已配置 · ${openAiApiMode()}` } as const)
    : ({ configured: false, message: "未配置翻译接口" } as const);
}

async function applyCachedTranslation(
  block: PaperBlock,
  style: string,
  provider: string,
  model: string,
  cached: CachedTranslationHit
) {
  const needsBlockWrite =
    block.translatedText?.trim() !== cached.translation.trim() ||
    !block.paragraphsJson ||
    Boolean(block.translationError);

  const writes: Prisma.PrismaPromise<unknown>[] = [];

  if (needsBlockWrite) {
    const blockParagraphsJson = buildPassageJson(block.id, block.originalText, cached.translation);
    writes.push(
      prisma.paperBlock.update({
        where: { id: block.id },
        data: {
          translatedText: cached.translation,
          paragraphsJson: blockParagraphsJson,
          translationError: null
        }
      })
    );
  }

  if (cached.style !== style) {
    const cacheParagraphsJson =
      cached.paragraphsJson ??
      buildPassageJson(`cache-${block.textHash}`, block.originalText, cached.translation);
    writes.push(
      prisma.translationCache.upsert({
        where: {
          textHash_provider_model_style: {
            textHash: block.textHash,
            provider,
            model,
            style
          }
        },
        create: {
          textHash: block.textHash,
          provider,
          model,
          style,
          translation: cached.translation,
          paragraphsJson: cacheParagraphsJson
        },
        update: {
          translation: cached.translation,
          paragraphsJson: cacheParagraphsJson
        }
      })
    );
  }

  if (writes.length > 0) {
    await prisma.$transaction(writes);
  }

  return true;
}

export async function translateAndCacheBlocks(
  blocks: PaperBlock[],
  onProgress?: TranslationProgressCallback
) {
  if (!hasOpenAiKey()) {
    return {
      translated: 0,
      skipped: blocks.length,
      error: "未配置翻译接口"
    };
  }

  const model = translationModel();
  const provider = "openai";
  const translatable = blocks.filter(shouldTranslate);
  const pendingByStyle = new Map<string, PaperBlock[]>();
  const cacheLookups = await loadCachedTranslations(translatable, provider, model);
  let cachedCount = 0;
  let completedCount = 0;
  let translatedCount = 0;
  let failedCount = 0;
  let batchesDone = 0;

  const emitProgress = async (message: string, batchesTotal = 0) => {
    await onProgress?.({
      total: translatable.length,
      completed: completedCount,
      cached: cachedCount,
      translated: translatedCount,
      failed: failedCount,
      batchesDone,
      batchesTotal,
      message
    });
  };

  await emitProgress("正在检查翻译缓存");

  for (const block of translatable) {
    const style = translationStyleForBlock(block);
    const cached = cacheLookups.get(style)?.get(block.textHash);
    if (cached && (await applyCachedTranslation(block, style, provider, model, cached))) {
      cachedCount += 1;
      completedCount += 1;
      await emitProgress("命中缓存，正在跳过已翻译内容");
    } else {
      const pending = pendingByStyle.get(style) ?? [];
      pending.push(block);
      pendingByStyle.set(style, pending);
    }
  }

  const styledBatches = [...pendingByStyle.entries()].flatMap(([style, pending]) =>
    createBatches(pending).map((batch) => ({ style, batch }))
  );
  const concurrency = numberFromEnv("TRANSLATION_CONCURRENCY", DEFAULT_CONCURRENCY);
  const batchesTotal = styledBatches.length;

  await emitProgress(
    batchesTotal > 0 ? `正在翻译 ${batchesTotal} 个批次` : "全部内容已命中缓存",
    batchesTotal
  );

  const batchResults = await mapWithConcurrency(styledBatches, concurrency, async ({ style, batch }) => {
    try {
      const translations = await translateWithOpenAi(
        batch.map((block) => ({
          blockId: block.id,
          text: block.originalText
        })),
        style
      );

      const writes = [];
      let translatedInBatch = 0;
      const missingIds: string[] = [];

      for (const block of batch) {
        const translation = translations.get(block.id);
        if (!translation) {
          missingIds.push(block.id);
          continue;
        }

        const blockParagraphsJson = buildPassageJson(block.id, block.originalText, translation);
        const cacheParagraphsJson = buildPassageJson(
          `cache-${block.textHash}`,
          block.originalText,
          translation
        );

        writes.push(
          prisma.translationCache.upsert({
            where: {
              textHash_provider_model_style: {
                textHash: block.textHash,
                provider,
                model,
                style
              }
            },
            create: {
              textHash: block.textHash,
              provider,
              model,
              style,
              translation,
              paragraphsJson: cacheParagraphsJson
            },
            update: {
              translation,
              paragraphsJson: cacheParagraphsJson
            }
          }),
          prisma.paperBlock.update({
            where: { id: block.id },
            data: {
              translatedText: translation,
              paragraphsJson: blockParagraphsJson,
              translationError: null
            }
          })
        );
        translatedInBatch += 1;
      }

      if (missingIds.length > 0) {
        failedCount += missingIds.length;
        writes.push(
          prisma.paperBlock.updateMany({
            where: { id: { in: missingIds } },
            data: { translationError: "翻译结果缺少对应条目" }
          })
        );
      }

      if (writes.length > 0) {
        await prisma.$transaction(writes);
      }

      translatedCount += translatedInBatch;
      completedCount += batch.length;
      batchesDone += 1;
      await emitProgress(`已完成 ${batchesDone}/${batchesTotal} 个翻译批次`, batchesTotal);
      return translatedInBatch;
    } catch (error) {
      const message = error instanceof Error ? error.message : "翻译失败";
      failedCount += batch.length;
      completedCount += batch.length;
      batchesDone += 1;
      await prisma.paperBlock.updateMany({
        where: {
          id: { in: batch.map((block) => block.id) }
        },
        data: {
          translationError: message
        }
      });
      await emitProgress(`有批次翻译失败：${message}`, batchesTotal);
      return 0;
    }
  });

  const translated = batchResults.reduce((sum, value) => sum + value, 0);
  await emitProgress("翻译完成", batchesTotal);

  return {
    translated,
    cached: cachedCount,
    batches: styledBatches.length,
    concurrency,
    skipped: blocks.length - translatable.length
  };
}
