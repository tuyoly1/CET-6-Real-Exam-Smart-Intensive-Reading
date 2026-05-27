import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCet6Paper } from "@/lib/cet6-parser";
import { extractPdfPages, readablePageText } from "@/lib/pdf";
import { groupQuestionBlocks } from "@/lib/question-structure";

const regressionPdfPath =
  "D:/文档/xwechat_files/wxid_35nrk175moqf22_bac2/msg/file/2026-05/2021年12月大学英语6级真题（卷一）.pdf";

const runIfFixtureExists = existsSync(regressionPdfPath) ? it : it.skip;

describe("CET-6 PDF regression sample", () => {
  runIfFixtureExists(
    "extracts and structures the 2021-12 CET-6 paper without known regressions",
    async () => {
      const pages = await extractPdfPages(regressionPdfPath);
      const parsed = parseCet6Paper(
        pages.map((page) => ({
          pageNumber: page.pageNumber,
          text: readablePageText(page)
        }))
      );

      expect(parsed.sections.map((section) => section.type)).toEqual([
        "writing",
        "listening",
        "listening",
        "listening",
        "reading_bank",
        "reading_matching",
        "reading_careful",
        "translation"
      ]);

      const blocks = parsed.sections.flatMap((section) => section.blocks);
      const allText = blocks.map((block) => block.originalText).join("\n");
      const matchingSection = parsed.sections.find((section) => section.type === "reading_matching");
      const translationPrompt = blocks.find((block) => block.blockType === "translation_prompt")?.originalText ?? "";
      const cjkCount = (translationPrompt.match(/[\u4e00-\u9fff]/g) ?? []).length;

      expect(matchingSection?.title).toBe("Section B 长篇匹配");
      expect(matchingSection?.blocks.some((block) => /Burberry burnt/.test(block.originalText))).toBe(true);
      expect(matchingSection?.pageStart).toBeLessThanOrEqual(5);
      expect(translationPrompt).not.toMatch(/tOOA|½|[~?±]{4,}/);
      expect(translationPrompt).not.toMatch(/^Directions:/i);
      expect(translationPrompt).not.toMatch(/第\s*11\s*页\s*共\s*11\s*页|英语\s*六\s*级\s*真题/);
      expect(translationPrompt).not.toMatch(/[\u4e00-\u9fff]\s+[\u4e00-\u9fff]/);
      expect(cjkCount).toBeGreaterThan(50);
      expect(blocks.find((block) => block.blockType === "directions" && /Part IV Translation/.test(blocks[blocks.indexOf(block) - 1]?.originalText ?? ""))?.originalText).toContain(
        "translate a passage from Chinese into English"
      );
      expect(allText).toContain("three or four questions");
      expect(allText).not.toContain("three or f our questions");
      expect(allText).toContain("She is an acclaimed hostess of Book Talk");

      const grouped = groupQuestionBlocks(blocks);
      for (const questionNumber of [1, 2, 3, 4, 8, 9, 10, 12, 13, 15]) {
        const group = grouped.find(([number]) => number === questionNumber)?.[1];
        expect(group?.options.map((option) => option.optionLabel)).toEqual(["A", "B", "C", "D"]);
      }
    },
    180_000
  );
});
