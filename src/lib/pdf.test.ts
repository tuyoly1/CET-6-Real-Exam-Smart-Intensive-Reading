import { describe, expect, it } from "vitest";
import {
  detectGarbledText,
  extractTextFromPdfTextItems,
  normalizeExtractedText,
  normalizePdfTextItem,
  shouldRunOcr,
  sortTextItemsForReading
} from "@/lib/pdf";

function textItem(str: string, x: number, y: number, width = str.length * 6) {
  return {
    str,
    transform: [1, 0, 0, 12, x, y],
    width,
    height: 12
  };
}

describe("PDF text extraction quality", () => {
  it("sorts two-column option text by column before y to preserve ABCD order", () => {
    const items = [
      textItem("A) Santa Claus.", 50, 700, 90),
      textItem("C) Cocoa seeds.", 320, 700, 94),
      textItem("B) A polar bear.", 50, 680, 98),
      textItem("D) A glass bottle.", 320, 680, 110)
    ];
    const normalizedItems = items
      .map((item, index) => normalizePdfTextItem(item, index))
      .filter((item) => item !== null);

    expect(sortTextItemsForReading(normalizedItems).map((item) => item.text[0])).toEqual(["A", "B", "C", "D"]);
    expect(extractTextFromPdfTextItems(items)).toBe(
      ["A) Santa Claus.", "B) A polar bear.", "C) Cocoa seeds.", "D) A glass bottle."].join("\n")
    );
  });

  it("detects mojibake-like PDF text and asks for OCR fallback", () => {
    const garbled = "tOOA ½ ~?~?~?~?~?~? □◆ ".repeat(8);
    const report = detectGarbledText(garbled);

    expect(report.garbled).toBe(true);
    expect(report.reasons).toEqual(expect.arrayContaining(["known-mojibake", "dense-question-tilde"]));
    expect(shouldRunOcr(garbled)).toBe(true);
  });

  it("normalizes common extraction-layer broken words", () => {
    expect(normalizeExtractedText("three or f our questions\nfo llowing passage\nPart 1V Translation")).toBe(
      "three or four questions\nfollowing passage\nPart IV Translation"
    );
  });
});
