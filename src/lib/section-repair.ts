import type { PaperSectionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sectionTypeFromQuestionNumber } from "@/lib/question-types";

type RepairBlock = {
  blockType: string;
  questionNumber: number | null;
  originalText: string;
};

export type RepairableSection = {
  id?: string;
  type: PaperSectionType;
  title: string;
  subtitle?: string | null;
  blocks: RepairBlock[];
};

export function inferSectionTypeForRepair(section: RepairableSection): PaperSectionType {
  const evidence = [section.title, section.subtitle ?? "", ...section.blocks.slice(0, 4).map((block) => block.originalText)]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (/Part\s*I\b.*Writing/i.test(evidence)) return "writing";
  if (/Part\s*II\b.*Listening|Section\s+[ABC]\s*(?:长对话|短文|讲座)/i.test(evidence)) return "listening";
  if (/Section\s*A\b.*(?:选词填空|word bank)/i.test(evidence)) return "reading_bank";
  if (/Section\s*B\b.*(?:长篇匹配|matching)/i.test(evidence)) return "reading_matching";
  if (/Section\s*C\b.*(?:仔细阅读|careful)/i.test(evidence)) return "reading_careful";
  if (/Part\s*IV\b.*Translation/i.test(evidence)) return "translation";

  const questionNumbers = section.blocks
    .map((block) => block.questionNumber)
    .filter((value): value is number => typeof value === "number");
  if (questionNumbers.length > 0) {
    return sectionTypeFromQuestionNumber(Math.min(...questionNumbers)) as PaperSectionType;
  }

  return section.type;
}

export async function repairPaperSectionTypes(paperId: string) {
  const sections = await prisma.paperSection.findMany({
    where: { paperId },
    include: {
      blocks: {
        orderBy: { orderIndex: "asc" },
        select: {
          blockType: true,
          questionNumber: true,
          originalText: true
        }
      }
    }
  });

  const repairs = sections
    .map((section) => ({
      id: section.id,
      from: section.type,
      to: inferSectionTypeForRepair(section)
    }))
    .filter((repair) => repair.from !== repair.to);

  if (repairs.length > 0) {
    await prisma.$transaction(
      repairs.map((repair) =>
        prisma.paperSection.update({
          where: { id: repair.id },
          data: { type: repair.to }
        })
      )
    );
  }

  return repairs;
}
