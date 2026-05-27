import { describe, expect, it } from "vitest";
import {
  buildParagraphStructure,
  buildPassageStructure,
  splitChineseSentences,
  splitEnglishSentences
} from "@/lib/passage-structure";

describe("passage structure", () => {
  it("splits English and Chinese sentences", () => {
    expect(splitEnglishSentences("One. Two? Three!")).toEqual(["One.", "Two?", "Three!"]);
    expect(splitChineseSentences("一。二？三！四；")).toEqual(["一。", "二？", "三！", "四；"]);
  });

  it("builds aligned sentence pairs for a paragraph", () => {
    const passage = buildPassageStructure("block-1", "First sentence. Second sentence.", "第一句。第二句。");
    expect(passage.paragraphs).toHaveLength(1);
    expect(passage.paragraphs[0].sentences).toEqual([
      { id: "block-1-p-0-s-0", en: "First sentence.", zh: "第一句。", order: 0 },
      { id: "block-1-p-0-s-1", en: "Second sentence.", zh: "第二句。", order: 1 }
    ]);
  });

  it("keeps paragraph boundaries when the source already has them", () => {
    const paragraphs = buildParagraphStructure(
      "block-2",
      "First paragraph.\n\nSecond paragraph.",
      "第一段。\n\n第二段。"
    );

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].en).toBe("First paragraph.");
    expect(paragraphs[0].zh).toBe("第一段。");
    expect(paragraphs[1].en).toBe("Second paragraph.");
    expect(paragraphs[1].zh).toBe("第二段。");
  });
});
