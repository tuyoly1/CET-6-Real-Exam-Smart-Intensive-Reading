// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Reader } from "@/components/reader";

type BlockInput = {
  blockType: string;
  originalText: string;
  translatedText?: string | null;
  questionNumber?: number | null;
  optionLabel?: string | null;
  orderIndex?: number;
};

function block(input: BlockInput) {
  return {
    id: `${input.blockType}-${input.orderIndex ?? 0}-${input.optionLabel ?? input.questionNumber ?? "x"}`,
    blockType: input.blockType,
    questionNumber: input.questionNumber ?? null,
    optionLabel: input.optionLabel ?? null,
    originalText: input.originalText,
    translatedText: input.translatedText ?? null,
    paragraphsJson: null,
    translationError: null,
    pageNumber: 1,
    orderIndex: input.orderIndex ?? 0
  };
}

function renderReader(sections: ComponentProps<typeof Reader>["initialSections"]) {
  return render(
    <Reader
      initialPaper={{
        id: "paper-1",
        title: "2021 年 12 月六级真题",
        status: "READY",
        progress: 100
      }}
      initialSections={sections}
      initialTranslation={{ configured: true, message: "翻译接口已配置 · chat" }}
      initialTranslationConfig={{
        apiKeyConfigured: true,
        maskedApiKey: "sk****test",
        baseUrl: "https://api.example.com/v1",
        apiMode: "chat",
        translationModel: "gpt-test"
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Reader translation display", () => {
  it("shows question and option translations in contrast modes and hides them in hidden Chinese mode", () => {
    renderReader([
      {
        id: "listening",
        type: "listening",
        title: "Part II Listening Comprehension",
        subtitle: null,
        pageStart: 1,
        pageEnd: 1,
        orderIndex: 0,
        blocks: [
          block({
            blockType: "question",
            questionNumber: 1,
            originalText: "1. Why was the man absent?",
            translatedText: "1. 这名男子为什么缺席？",
            orderIndex: 1
          }),
          block({
            blockType: "option",
            questionNumber: 1,
            optionLabel: "A",
            originalText: "A) He was enjoying his holiday.",
            translatedText: "A) 他正在享受假期。",
            orderIndex: 2
          })
        ]
      }
    ]);

    expect(screen.getByText("1. 这名男子为什么缺席？")).toBeInTheDocument();
    expect(screen.getByText("A) 他正在享受假期。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "隐藏中文" }));

    expect(screen.queryByText("1. 这名男子为什么缺席？")).not.toBeInTheDocument();
    expect(screen.queryByText("A) 他正在享受假期。")).not.toBeInTheDocument();
    expect(screen.getByText("A) He was enjoying his holiday.")).toBeInTheDocument();
  });

  it("does not duplicate translations for bare question numbers or residual minute fragments", () => {
    const { container } = renderReader([
      {
        id: "listening",
        type: "listening",
        title: "Section A 长对话",
        subtitle: null,
        pageStart: 1,
        pageEnd: 1,
        orderIndex: 0,
        blocks: [
          block({
            blockType: "paragraph",
            originalText: "(30 minutes) (30 minutes) with",
            translatedText: "（30分钟）（30分钟）用",
            orderIndex: 1
          }),
          block({
            blockType: "question",
            questionNumber: 1,
            originalText: "1.",
            translatedText: "1.",
            orderIndex: 2
          }),
          block({
            blockType: "option",
            questionNumber: 1,
            optionLabel: "A",
            originalText: "A) He was enjoying his holiday.",
            translatedText: "A) 他正在享受假期。",
            orderIndex: 3
          })
        ]
      }
    ]);

    expect(screen.queryByText("(30 minutes) (30 minutes) with")).not.toBeInTheDocument();
    expect(screen.queryByText("（30分钟）（30分钟）用")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".question-title .mini-source")).toHaveLength(1);
    expect(container.querySelectorAll(".question-title .mini-translation")).toHaveLength(0);
  });

  it("sorts word bank entries by label and shows Chinese meanings", () => {
    const { container } = renderReader([
      {
        id: "bank",
        type: "reading_bank",
        title: "Section A 选词填空",
        subtitle: null,
        pageStart: 3,
        pageEnd: 4,
        orderIndex: 0,
        blocks: [
          block({
            blockType: "word_bank",
            optionLabel: "K",
            originalText: "K) longevity",
            translatedText: "K) 长寿",
            orderIndex: 1
          }),
          block({
            blockType: "word_bank",
            optionLabel: "A",
            originalText: "A) affect",
            translatedText: "A) 影响",
            orderIndex: 2
          }),
          block({
            blockType: "word_bank",
            optionLabel: "B",
            originalText: "B) boost",
            translatedText: "B) 提升",
            orderIndex: 3
          })
        ]
      }
    ]);

    const sources = [...container.querySelectorAll(".word-bank-item .mini-source")].map(
      (node) => node.textContent
    );
    expect(sources).toEqual(["A) affect", "B) boost", "K) longevity"]);
    expect(screen.getByText("A) 影响")).toBeInTheDocument();
    expect(screen.getByText("K) 长寿")).toBeInTheDocument();
  });

  it("shows translations in the reading matching question panel", () => {
    renderReader([
      {
        id: "matching",
        type: "reading_matching",
        title: "Section B 长篇匹配",
        subtitle: null,
        pageStart: 4,
        pageEnd: 6,
        orderIndex: 0,
        blocks: [
          block({
            blockType: "question",
            questionNumber: 36,
            originalText: "36. It was once a symbol of British luxury.",
            translatedText: "36. 它曾经是英国奢侈品的象征。",
            orderIndex: 1
          })
        ]
      }
    ]);

    expect(screen.getByText("36. It was once a symbol of British luxury.")).toBeInTheDocument();
    expect(screen.getByText("36. 它曾经是英国奢侈品的象征。")).toBeInTheDocument();
  });

  it("renders Part IV as Chinese source plus English reference translation", () => {
    renderReader([
      {
        id: "translation",
        type: "translation",
        title: "Part IV Translation",
        subtitle: null,
        pageStart: 8,
        pageEnd: 8,
        orderIndex: 0,
        blocks: [
          block({
            blockType: "translation_prompt",
            originalText: "中国茶文化历史悠久。",
            translatedText: "China's tea culture has a long history.",
            orderIndex: 1
          })
        ]
      }
    ]);

    expect(screen.getByText("中文原文")).toBeInTheDocument();
    expect(screen.getByText("中国茶文化历史悠久。")).toBeInTheDocument();
    expect(screen.getByText("英文参考译文")).toBeInTheDocument();
    expect(screen.getByText("China's tea culture has a long history.")).toBeInTheDocument();
  });

  it("adds a clicked word to vocabulary cards with translation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ translation: "n. 信心；信任" })
      }))
    );

    const { container } = renderReader([
      {
        id: "writing",
        type: "writing",
        title: "Part I Writing",
        subtitle: null,
        pageStart: 1,
        pageEnd: 1,
        orderIndex: 0,
        blocks: [
          block({
            blockType: "paragraph",
            originalText: "Students need confidence when identifying false information.",
            translatedText: "学生在识别虚假信息时需要信心。",
            orderIndex: 1
          })
        ]
      }
    ]);

    const word = container.querySelector('.hover-word[data-word="confidence"]');
    expect(word).not.toBeNull();

    fireEvent.click(word as Element);

    expect(screen.getByText("confidence")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("n. 信心；信任")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "导出卡片" })).toBeEnabled());
  });
});
