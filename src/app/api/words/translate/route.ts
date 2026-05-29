import { NextResponse } from "next/server";
import { hasOpenAiKey, translateWithOpenAi } from "@/lib/openai-service";

export const runtime = "nodejs";

const wordCache = new Map<string, string>();

function normalizeWord(word: string) {
  return word.trim().toLowerCase();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const word = searchParams.get("word")?.trim();

  if (!word) {
    return NextResponse.json({ error: "请提供单词。" }, { status: 400 });
  }

  const normalized = normalizeWord(word);
  if (wordCache.has(normalized)) {
    return NextResponse.json({ word, translation: wordCache.get(normalized), cached: true });
  }

  if (!hasOpenAiKey()) {
    return NextResponse.json({ error: "未配置翻译接口" }, { status: 400 });
  }

  try {
    const result = await translateWithOpenAi([{ blockId: normalized, text: word }], "word_lookup_zh");
    const translation = result.get(normalized)?.trim() || "";
    if (!translation) {
      return NextResponse.json({ error: "未获取到释义" }, { status: 502 });
    }
    wordCache.set(normalized, translation);
    return NextResponse.json({ word, translation, cached: false });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "翻译失败" },
      { status: 502 }
    );
  }
}
