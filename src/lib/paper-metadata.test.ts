import { describe, expect, it } from "vitest";
import { inferPaperMetadata, paperPeriodLabel } from "@/lib/paper-metadata";

describe("paper metadata", () => {
  it("classifies CET-6 real exam files by year and kind", () => {
    const metadata = inferPaperMetadata("2022年06月大学英语6级真题（卷二）.pdf");

    expect(metadata).toMatchObject({
      year: "2022",
      month: "06",
      kind: "exam",
      kindLabel: "真题"
    });
    expect(paperPeriodLabel(metadata)).toBe("2022年6月");
  });

  it("classifies answer analysis files separately", () => {
    expect(inferPaperMetadata("2022年06月大学英语6级答案解析（卷二）.pdf")).toMatchObject({
      year: "2022",
      month: "06",
      kind: "answer",
      kindLabel: "答案解析"
    });
  });

  it("keeps unknown year files in an unrecognized group", () => {
    expect(inferPaperMetadata("六级听力补充材料.pdf")).toMatchObject({
      year: "未识别年份",
      kind: "other"
    });
  });
});
