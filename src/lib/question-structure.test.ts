import { describe, expect, it } from "vitest";
import { groupQuestionBlocks } from "@/lib/question-structure";

describe("question structure", () => {
  it("groups questions and sorts options by A/B/C/D label", () => {
    const grouped = groupQuestionBlocks([
      { blockType: "question", questionNumber: 1, optionLabel: null, orderIndex: 0 },
      { blockType: "option", questionNumber: 1, optionLabel: "A", orderIndex: 1 },
      { blockType: "option", questionNumber: 1, optionLabel: "C", orderIndex: 2 },
      { blockType: "option", questionNumber: 1, optionLabel: "B", orderIndex: 3 },
      { blockType: "option", questionNumber: 1, optionLabel: "D", orderIndex: 4 }
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0][1].options.map((option) => option.optionLabel)).toEqual(["A", "B", "C", "D"]);
  });
});
