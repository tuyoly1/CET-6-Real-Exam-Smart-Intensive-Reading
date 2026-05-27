import { describe, expect, it } from "vitest";
import {
  classifyHeading,
  isAnswerSheetText,
  parseCet6Paper,
  parseOptionLine,
  parseWordBankEntries,
  shouldDropFragment
} from "@/lib/cet6-parser";
import { sectionTypeFromQuestionNumber } from "@/lib/question-types";

describe("CET-6 parser rules", () => {
  it("classifies headings with reading context", () => {
    expect(classifyHeading("Part I Writing")).toBe("writing");
    expect(classifyHeading("Part II Listening Comprehension")).toBe("listening");
    expect(classifyHeading("Section A", { currentPart: "reading" })).toBe("reading_bank");
    expect(classifyHeading("Section B", { currentPart: "reading" })).toBe("reading_matching");
    expect(classifyHeading("Section C", { currentPart: "reading" })).toBe("reading_careful");
  });

  it("classifies question numbers by CET-6 ranges", () => {
    expect(sectionTypeFromQuestionNumber(1)).toBe("listening");
    expect(sectionTypeFromQuestionNumber(25)).toBe("listening");
    expect(sectionTypeFromQuestionNumber(26)).toBe("reading_bank");
    expect(sectionTypeFromQuestionNumber(35)).toBe("reading_bank");
    expect(sectionTypeFromQuestionNumber(36)).toBe("reading_matching");
    expect(sectionTypeFromQuestionNumber(45)).toBe("reading_matching");
    expect(sectionTypeFromQuestionNumber(46)).toBe("reading_careful");
    expect(sectionTypeFromQuestionNumber(55)).toBe("reading_careful");
  });

  it("does not classify Answer Sheet prompts as answer areas", () => {
    expect(isAnswerSheetText("Answer Sheet 1")).toBe(true);
    expect(classifyHeading("Answer Sheet 1")).toBe("unknown");

    const parsed = parseCet6Paper([
      {
        pageNumber: 1,
        text: [
          "Part II",
          "Listening Comprehension",
          "Section A",
          "Directions:",
          "Then mark the corresponding letter on",
          "Answer Sheet 1",
          "with a single line through the centre.",
          "Questions 1 to 4 are based on the conversation you have just heard."
        ].join("\n")
      }
    ]);

    expect(parsed.sections.flatMap((section) => section.blocks).some((block) => /Answer Sheet 1/.test(block.originalText))).toBe(
      true
    );
    expect(parsed.sections.map((section) => section.type)).not.toContain("unknown");
  });

  it("filters independent short fragments but keeps word bank entries", () => {
    expect(shouldDropFragment("with")).toBe(true);
    expect(shouldDropFragment("1")).toBe(true);
    expect(shouldDropFragment("")).toBe(true);
    expect(shouldDropFragment("(30 minutes) (30 minutes) with")).toBe(true);
    expect(shouldDropFragment("2021 年 12 月大学英语六级真题 第 1 页 共 11 页")).toBe(true);
    expect(shouldDropFragment("with", { inWordBank: true })).toBe(false);
    expect(parseWordBankEntries("A) affect B) beyond 0) trait")).toEqual([
      { label: "A", text: "affect" },
      { label: "B", text: "beyond" },
      { label: "O", text: "trait" }
    ]);
  });

  it("parses A/B/C/D options", () => {
    expect(parseOptionLine("A) Santa Claus. B) A polar bear. C) Cocoa seeds. D) A glass bottle.")).toEqual([
      { label: "A", text: "Santa Claus." },
      { label: "B", text: "A polar bear." },
      { label: "C", text: "Cocoa seeds." },
      { label: "D", text: "A glass bottle." }
    ]);
  });

  it("merges option continuations before the next option label", () => {
    const parsed = parseCet6Paper([
      {
        pageNumber: 1,
        text: [
          "Part II",
          "Listening Comprehension",
          "Section A",
          "Questions 5 to 8 are based on the conversation you have just heard.",
          "5.",
          "A) She is a critic of works on military affairs.",
          "B) She is an acclaimed hostess of",
          "Book Talk.",
          "C) She is a researcher of literary genres.",
          "D) She is a historian of military history."
        ].join("\n")
      }
    ]);

    const options = parsed.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.blockType === "option" && block.questionNumber === 5);

    expect(options.map((option) => option.optionLabel)).toEqual(["A", "B", "C", "D"]);
    expect(options.find((option) => option.optionLabel === "B")?.originalText).toContain(
      "She is an acclaimed hostess of Book Talk."
    );
  });

  it("moves duplicate late-column options back to earlier incomplete questions", () => {
    const parsed = parseCet6Paper([
      {
        pageNumber: 1,
        text: [
          "Part II",
          "Listening Comprehension",
          "Section B",
          "Questions 9 to 11 are based on the passage you have just heard.",
          "9.",
          "A) Santa Claus.",
          "B) A polar bear.",
          "10.",
          "A) To attract customer attention.",
          "B) To keep up with the times.",
          "C) To combat counterfeits.",
          "D) To promote its sales.",
          "Questions 12 to 15 are based on the passage you have just heard.",
          "13.",
          "A) Social anxiety.",
          "B) Excessive caution.",
          "Questions 16 to 18 are based on the recording you have just heard.",
          "18.",
          "A) They toil on farms.",
          "C) Cocoa seeds.",
          "D) A glass bottle.",
          "C) Lack of social skills.",
          "D) Preference for solitude.",
          "C) They live in Spanish-style houses.",
          "B) They live a poor life.",
          "D) They hire people to do housework."
        ].join("\n")
      }
    ]);

    const blocks = parsed.sections.flatMap((section) => section.blocks);
    const optionsFor = (questionNumber: number) =>
      blocks
        .filter((block) => block.blockType === "option" && block.questionNumber === questionNumber)
        .map((block) => block.optionLabel);

    expect(optionsFor(9)).toEqual(["A", "B", "C", "D"]);
    expect(optionsFor(13)).toEqual(["A", "B", "C", "D"]);
    expect(optionsFor(18)).toEqual(["A", "C", "B", "D"]);
  });

  it("keeps Burberry A-L labels as reading matching paragraphs instead of options", () => {
    const parsed = parseCet6Paper([
      {
        pageNumber: 1,
        text: [
          "Part III",
          "Reading Comprehension",
          "Section B",
          "Directions:",
          "Answer Sheet 2.",
          "No one in fashion is surprised that Burberry burnt £28 million of stock",
          "A) Last week, Burberry's annual report revealed that £28.6 million worth of stock was burnt last year.",
          "B) The practice of destroying unsold stock is commonplace for luxury labels.",
          "36. Burberry's executives are trying hard to attribute their practice to miscalculated production."
        ].join("\n")
      }
    ]);

    const matching = parsed.sections.find((section) => section.type === "reading_matching");
    expect(matching).toBeTruthy();
    expect(matching?.blocks.filter((block) => block.blockType === "paragraph").map((block) => block.originalText)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("A) Last week"),
        expect.stringContaining("B) The practice")
      ])
    );
    expect(matching?.blocks.some((block) => block.blockType === "option")).toBe(false);
  });
});
