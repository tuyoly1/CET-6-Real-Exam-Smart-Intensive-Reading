import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getTranslationConfig } from "@/lib/translation-config";
import { translationProviderStatus } from "@/lib/translation";
import { Reader } from "@/components/reader";

export default async function PaperPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const paper = await prisma.paper.findUnique({
    where: { id },
    include: {
      sections: {
        orderBy: { orderIndex: "asc" },
        include: {
          blocks: {
            orderBy: { orderIndex: "asc" }
          }
        }
      }
    }
  });

  if (!paper) {
    notFound();
  }

  return (
    <Reader
      initialPaper={{
        id: paper.id,
        title: paper.title,
        status: paper.status,
        progress: paper.progress,
        error: paper.error
      }}
      initialSections={paper.sections.map((section) => ({
        id: section.id,
        type: section.type,
        title: section.title,
        subtitle: section.subtitle,
        pageStart: section.pageStart,
        pageEnd: section.pageEnd,
        orderIndex: section.orderIndex,
        blocks: section.blocks.map((block) => ({
          id: block.id,
          blockType: block.blockType,
          questionNumber: block.questionNumber,
          optionLabel: block.optionLabel,
          originalText: block.originalText,
          translatedText: block.translatedText,
          paragraphsJson: block.paragraphsJson,
          translationError: block.translationError,
          pageNumber: block.pageNumber,
          orderIndex: block.orderIndex
        }))
      }))}
      initialTranslation={translationProviderStatus()}
      initialTranslationConfig={getTranslationConfig()}
    />
  );
}
