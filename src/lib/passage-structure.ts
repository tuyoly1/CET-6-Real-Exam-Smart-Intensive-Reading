export type SentencePair = {
  id: string;
  en: string;
  zh: string;
  order: number;
};

export type ParagraphBlock = {
  id: string;
  order: number;
  en: string;
  zh: string;
  sentences: SentencePair[];
};

export type Passage = {
  id: string;
  paragraphs: ParagraphBlock[];
};

const MAX_SENTENCES_PER_SYNTHETIC_PARAGRAPH = 4;
const MAX_CHARS_PER_SYNTHETIC_PARAGRAPH = 620;

function cleanText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function compactInlineWhitespace(text: string) {
  return cleanText(text)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitEnglishSentences(text: string) {
  const normalized = compactInlineWhitespace(text).replace(/\s+/g, " ");
  if (!normalized) return [];

  const matches = normalized.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g);
  return (matches ?? [normalized]).map((part) => part.trim()).filter(Boolean);
}

export function splitChineseSentences(text: string) {
  const normalized = compactInlineWhitespace(text).replace(/\s+/g, "");
  if (!normalized) return [];

  const matches = normalized.match(/[^。！？；]+[。！？；]+|[^。！？；]+$/g);
  return (matches ?? [normalized]).map((part) => part.trim()).filter(Boolean);
}

function splitExplicitParagraphs(text: string) {
  const normalized = compactInlineWhitespace(text);
  if (!normalized) return [];

  const blankLineParagraphs = normalized
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
  if (blankLineParagraphs.length > 1) return blankLineParagraphs;

  const lineParagraphs = normalized
    .split(/\n/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20);
  if (lineParagraphs.length > 1) return lineParagraphs;

  return [normalized.replace(/\n+/g, " ")];
}

export function splitParagraphs(text: string) {
  const explicitParagraphs = splitExplicitParagraphs(text);
  if (explicitParagraphs.length !== 1) return explicitParagraphs;

  const [onlyParagraph] = explicitParagraphs;
  if (!onlyParagraph || onlyParagraph.length <= MAX_CHARS_PER_SYNTHETIC_PARAGRAPH) {
    return explicitParagraphs;
  }

  const sentences = splitEnglishSentences(onlyParagraph);
  if (sentences.length <= MAX_SENTENCES_PER_SYNTHETIC_PARAGRAPH) {
    return explicitParagraphs;
  }

  const paragraphs: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    const shouldStartNext =
      current.length > 0 &&
      (current.length >= MAX_SENTENCES_PER_SYNTHETIC_PARAGRAPH ||
        currentLength + sentence.length > MAX_CHARS_PER_SYNTHETIC_PARAGRAPH);

    if (shouldStartNext) {
      paragraphs.push(current.join(" "));
      current = [];
      currentLength = 0;
    }

    current.push(sentence);
    currentLength += sentence.length;
  }

  if (current.length > 0) paragraphs.push(current.join(" "));
  return paragraphs.length > 0 ? paragraphs : explicitParagraphs;
}

function alignSentencePairs(blockId: string, paragraphOrder: number, en: string, zhSentences: string[]) {
  const enSentences = splitEnglishSentences(en);
  const pairs = enSentences.length > 0 ? enSentences : [en.trim()].filter(Boolean);
  const extraZh = zhSentences.length > pairs.length ? zhSentences.slice(pairs.length).join("") : "";

  return pairs.map((sentence, index) => ({
    id: `${blockId}-p-${paragraphOrder}-s-${index}`,
    en: sentence,
    zh: `${zhSentences[index] ?? ""}${index === pairs.length - 1 ? extraZh : ""}`.trim(),
    order: index
  }));
}

export function buildParagraphStructure(blockId: string, en: string, zh?: string | null): ParagraphBlock[] {
  const enParagraphs = splitParagraphs(en);
  if (enParagraphs.length === 0) return [];

  const explicitZhParagraphs = zh ? splitExplicitParagraphs(zh) : [];
  const canAlignExplicitParagraphs =
    explicitZhParagraphs.length > 1 && explicitZhParagraphs.length === enParagraphs.length;
  const allZhSentences = zh ? splitChineseSentences(zh) : [];
  let zhSentenceCursor = 0;

  return enParagraphs.map((paragraphEn, paragraphIndex) => {
    const enSentenceCount = Math.max(splitEnglishSentences(paragraphEn).length, 1);
    const paragraphZh = canAlignExplicitParagraphs ? explicitZhParagraphs[paragraphIndex] : null;
    let zhSentences: string[] = [];

    if (paragraphZh) {
      zhSentences = splitChineseSentences(paragraphZh);
    } else if (allZhSentences.length > 0) {
      const isLastParagraph = paragraphIndex === enParagraphs.length - 1;
      zhSentences = allZhSentences.slice(
        zhSentenceCursor,
        isLastParagraph ? undefined : zhSentenceCursor + enSentenceCount
      );
      zhSentenceCursor += enSentenceCount;
    }

    const sentences = alignSentencePairs(blockId, paragraphIndex, paragraphEn, zhSentences);
    const alignedZh = paragraphZh ?? sentences.map((sentence) => sentence.zh).filter(Boolean).join("");

    return {
      id: `${blockId}-p-${paragraphIndex}`,
      order: paragraphIndex,
      en: paragraphEn,
      zh: alignedZh,
      sentences
    };
  });
}

export function buildPassageStructure(blockId: string, en: string, zh?: string | null): Passage {
  return {
    id: blockId,
    paragraphs: buildParagraphStructure(blockId, en, zh)
  };
}

export function buildPassageJson(blockId: string, en: string, zh?: string | null) {
  return JSON.stringify(buildPassageStructure(blockId, en, zh));
}

function isParagraphBlock(value: unknown): value is ParagraphBlock {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ParagraphBlock;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.order === "number" &&
    typeof candidate.en === "string" &&
    Array.isArray(candidate.sentences)
  );
}

export function parsePassageJson(
  json: string | null | undefined,
  fallback: { id: string; en: string; zh?: string | null }
): Passage {
  if (json) {
    try {
      const parsed = JSON.parse(json) as Passage | ParagraphBlock[];
      const paragraphs = Array.isArray(parsed) ? parsed : parsed.paragraphs;
      if (Array.isArray(paragraphs) && paragraphs.every(isParagraphBlock)) {
        return {
          id: Array.isArray(parsed) ? fallback.id : parsed.id,
          paragraphs
        };
      }
    } catch {
      // Fall through to a deterministic structure from the raw text.
    }
  }

  return buildPassageStructure(fallback.id, fallback.en, fallback.zh);
}
