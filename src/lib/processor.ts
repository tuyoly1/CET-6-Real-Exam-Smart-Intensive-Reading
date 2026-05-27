import type { JobStage, PaperStatus } from "@prisma/client";
import { parseCet6Paper } from "@/lib/cet6-parser";
import { buildPassageJson } from "@/lib/passage-structure";
import { prisma } from "@/lib/prisma";
import { extractPdfPages, readablePageText } from "@/lib/pdf";
import { translateAndCacheBlocks } from "@/lib/translation";

async function setProgress(
  paperId: string,
  stage: JobStage,
  progress: number,
  status: PaperStatus = "PROCESSING",
  error?: string
) {
  await prisma.$transaction([
    prisma.paper.update({
      where: { id: paperId },
      data: {
        status,
        progress,
        error
      }
    }),
    prisma.processingJob.upsert({
      where: { paperId },
      create: {
        paperId,
        stage,
        progress,
        error,
        startedAt: new Date()
      },
      update: {
        stage,
        progress,
        error,
        startedAt: stage === "PARSING" ? new Date() : undefined,
        finishedAt: status === "READY" || status === "FAILED" ? new Date() : undefined
      }
    })
  ]);
}

export async function processPaper(paperId: string) {
  try {
    const paper = await prisma.paper.findUniqueOrThrow({
      where: { id: paperId }
    });

    await setProgress(paperId, "PARSING", 5);

    const extractedPages = await extractPdfPages(paper.filePath, async (pageNumber, totalPages, source) => {
      const pageProgress = 8 + Math.round((pageNumber / totalPages) * 38);
      await setProgress(paperId, source === "OCR" || source === "MIXED" ? "OCR" : "PARSING", pageProgress);
    });

    await setProgress(paperId, "STRUCTURING", 52);
    await prisma.$transaction([
      prisma.paperBlock.deleteMany({ where: { paperId } }),
      prisma.paperSection.deleteMany({ where: { paperId } }),
      prisma.page.deleteMany({ where: { paperId } })
    ]);

    for (const page of extractedPages) {
      await prisma.page.create({
        data: {
          paperId,
          pageNumber: page.pageNumber,
          rawText: page.rawText,
          ocrText: page.ocrText,
          source: page.source,
          confidence: page.confidence
        }
      });
    }

    const parsed = parseCet6Paper(
      extractedPages.map((page) => ({
        pageNumber: page.pageNumber,
        text: readablePageText(page)
      }))
    );

    const createdBlocks = [];
    for (const sectionDraft of parsed.sections) {
      const section = await prisma.paperSection.create({
        data: {
          paperId,
          type: sectionDraft.type,
          title: sectionDraft.title,
          subtitle: sectionDraft.subtitle,
          pageStart: sectionDraft.pageStart,
          pageEnd: sectionDraft.pageEnd,
          orderIndex: sectionDraft.orderIndex
        }
      });

      for (const blockDraft of sectionDraft.blocks) {
        const block = await prisma.paperBlock.create({
          data: {
            paperId,
            sectionId: section.id,
            blockType: blockDraft.blockType,
            questionNumber: blockDraft.questionNumber,
            optionLabel: blockDraft.optionLabel,
            originalText: blockDraft.originalText,
            paragraphsJson: buildPassageJson(blockDraft.clientId, blockDraft.originalText),
            pageNumber: blockDraft.pageNumber,
            orderIndex: blockDraft.orderIndex,
            textHash: blockDraft.textHash
          }
        });
        createdBlocks.push(block);
      }
    }

    await setProgress(paperId, "TRANSLATING", 72);
    await translateAndCacheBlocks(createdBlocks);

    await setProgress(paperId, "READY", 100, "READY");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    await setProgress(paperId, "FAILED", 100, "FAILED", message);
  }
}
