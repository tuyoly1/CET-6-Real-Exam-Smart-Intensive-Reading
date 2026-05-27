import { describe, expect, it } from "vitest";
import {
  EN_TO_ZH_STYLE,
  ZH_TO_EN_REFERENCE_STYLE,
  translationStyleForBlock
} from "@/lib/translation";

describe("translation style selection", () => {
  it("uses Chinese-to-English reference translation for Part IV prompts", () => {
    expect(translationStyleForBlock({ blockType: "translation_prompt" })).toBe(
      ZH_TO_EN_REFERENCE_STYLE
    );
  });

  it("uses exam intensive Chinese translation for normal English content", () => {
    expect(translationStyleForBlock({ blockType: "option" })).toBe(EN_TO_ZH_STYLE);
    expect(translationStyleForBlock({ blockType: "paragraph" })).toBe(EN_TO_ZH_STYLE);
  });
});
