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

export function translationProviderStatus() {
  return hasOpenAiKey()
    ? ({ configured: true, message: `翻译接口已配置 · ${openAiApiMode()}` } as const)
    : ({ configured: false, message: "未配置翻译接口" } as const);
}

async function applyCachedTranslation(
  block: PaperBlock,
  style: string,
  provider: string,
  model: string
) {
  for (const cacheStyle of [style, ...cacheFallbackStyles(style)]) {
    const cached = await prisma.translationCache.findUnique({
      where: {
        textHash_provider_model_style: {
          textHash: block.textHash,
          provider,
          model,
          style: cacheStyle
        }
      }
    });

    if (!cached) continue;

    const blockParagraphsJson = buildPassageJson(block.id, block.originalText, cached.translation);
    const cacheParagraphsJson =
      cached.paragraphsJson ?? buildPassageJson(`cache-${block.textHash}`, block.originalText, cached.translation);
    const writes: Prisma.PrismaPromise<unknown>[] = [
      prisma.paperBlock.update({
        where: { id: block.id },
        data: {
          translatedText: cached.translation,
          paragraphsJson: blockParagraphsJson,
          translationError: null
        }
      })
    ];

    if (cacheStyle !== style) {
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

    await prisma.$transaction(writes);
    return true;
  }

  return false;
}

export async function translateAndCacheBlocks(blocks: PaperBlock[]) {
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
  let cachedCount = 0;

  for (const block of translatable) {
    const style = translationStyleForBlock(block);
    if (await applyCachedTranslation(block, style, provider, model)) {
      cachedCount += 1;
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

      return translatedInBatch;
    } catch (error) {
      const message = error instanceof Error ? error.message : "翻译失败";
      await prisma.paperBlock.updateMany({
        where: {
          id: { in: batch.map((block) => block.id) }
        },
        data: {
          translationError: message
        }
      });
      return 0;
    }
  });

  const translated = batchResults.reduce((sum, value) => sum + value, 0);

  return {
    translated,
    cached: cachedCount,
    batches: styledBatches.length,
    concurrency,
    skipped: blocks.length - translatable.length
  };
}
