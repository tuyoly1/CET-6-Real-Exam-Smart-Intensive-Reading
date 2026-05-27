import { describe, expect, it } from "vitest";
import { inferSectionTypeForRepair } from "@/lib/section-repair";

describe("section repair", () => {
  it("repairs old Part I Writing sections misclassified as reading careful", () => {
    expect(
      inferSectionTypeForRepair({
        type: "reading_careful",
        title: "Part I Writing",
        blocks: [
          {
            blockType: "heading",
            questionNumber: null,
            originalText: "Part I Writing"
          }
        ]
      })
    ).toBe("writing");
  });
});
