import { textHash } from "@/lib/hash";
import {
  listeningSectionTitle,
  sectionTypeFromQuestionNumber,
  sectionTypeFromReadingSection,
  type SectionType
} from "@/lib/question-types";

export type ParserPageInput = {
  pageNumber: number;
  text: string;
};

export type Cet6BlockType =
  | "heading"
  | "directions"
  | "passage"
  | "paragraph"
  | "question_group"
  | "question"
  | "option"
  | "word_bank"
  | "translation_prompt";

export type ParsedBlockDraft = {
  clientId: string;
  sectionClientId: string;
  blockType: Cet6BlockType;
  questionNumber?: number;
  optionLabel?: string;
  originalText: string;
  pageNumber: number;
  orderIndex: number;
  textHash: string;
};

export type ParsedSectionDraft = {
  clientId: string;
  type: SectionType;
  title: string;
  subtitle?: string;
  pageStart?: number;
  pageEnd?: number;
  orderIndex: number;
  blocks: ParsedBlockDraft[];
};

type NormalizedLine = {
  text: string;
  pageNumber: number;
};

type PartContext = "writing" | "listening" | "reading" | "translation" | "unknown";

type BufferState = {
  blockType: Cet6BlockType;
  pageNumber: number;
  lines: string[];
};

type PendingSection = {
  label: string;
  pageNumber: number;
  lines: NormalizedLine[];
};

const romanPartTypes: Record<string, PartContext> = {
  I: "writing",
  II: "listening",
  III: "reading",
  IV: "translation"
};

const romanPartTitles: Record<string, string> = {
  I: "Part I Writing",
  II: "Part II Listening Comprehension",
  III: "Part III Reading Comprehension",
  IV: "Part IV Translation"
};

const footerPatterns = [
  /^\d+$/,
  /^第\s*\d+\s*页\s*(?:共\s*\d+\s*页)?$/,
  /^\d{4}\s*年.*大学英语.*第\s*\d+\s*页\s*共\s*\d+\s*页/,
  /^大学英语.*真题.*第\s*\d+\s*页/,
  /^Warning:\s+UnknownErrorException/i
];

export function normalizeCet6Line(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/Questionsl\b/gi, "Questions 1")
    .replace(/\bfo\s+llowing\b/gi, "following")
    .replace(/\bf\s+our\b/gi, "four")
    .replace(/\bTum\b/g, "Turn")
    .replace(/\b1s\b/g, "is")
    .replace(/\d{4}\s*年\s*\d{1,2}\s*月\s*(?:大学)?\s*英语\s*六\s*级\s*真题.*?第\s*\d+\s*页\s*共\s*\d+\s*页/gi, "")
    .replace(/([A-O])\)\s*/g, "$1) ")
    .replace(/\b(\d{1,2})\s+\./g, "$1.")
    .replace(/\s+([,.;:?!])/g, "$1")
    .replace(/([.!?])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePages(pages: ParserPageInput[]) {
  const lines: NormalizedLine[] = [];

  for (const page of pages) {
    for (const rawLine of page.text.split(/\r?\n/)) {
      const text = normalizeCet6Line(rawLine);
      if (!text) continue;
      if (footerPatterns.some((pattern) => pattern.test(text))) continue;
      lines.push({ text, pageNumber: page.pageNumber });
    }
  }

  return lines;
}

export function isAnswerSheetText(text: string) {
  return /^Answer Sheet\s*[12]\b/i.test(normalizeCet6Line(text));
}

export function shouldDropFragment(
  text: string,
  options: { inWordBank?: boolean } = {}
) {
  const normalized = normalizeCet6Line(text);
  if (!normalized) return true;
  if (options.inWordBank) return false;
  if (footerPatterns.some((pattern) => pattern.test(normalized))) return true;
  if (/^(?:\(\d+\s+minutes\)\s*)+(?:with)?$/i.test(normalized)) return true;
  if (/^[,.;:!?()[\]{}'"-]+$/.test(normalized)) return true;
  if (/^\d{1,3}\.?$/.test(normalized)) return true;
  if (/^(?:with|and|or|to|in|of|the|a|an)$/i.test(normalized)) return true;
  return normalized.length < 3 && !/[A-Za-z\u4e00-\u9fff]/.test(normalized);
}

export function classifyHeading(
  text: string,
  context: { currentPart?: PartContext } = {}
): SectionType {
  const normalized = normalizeCet6Line(text);
  if (/^Part\s*I\b.*Writing/i.test(normalized)) return "writing";
  if (/^Part\s*II\b.*Listening/i.test(normalized)) return "listening";
  if (/^Part\s*IV\b.*Translation/i.test(normalized)) return "translation";
  if (/^Section\s+([ABC])\b/i.test(normalized) && context.currentPart === "reading") {
    return sectionTypeFromReadingSection(RegExp.$1);
  }
  if (/^Section\s+[ABC]\b/i.test(normalized) && context.currentPart === "listening") {
    return "listening";
  }
  return "unknown";
}

export function parseQuestionRange(text: string) {
  const normalized = normalizeCet6Line(text);
  const match = normalized.match(/\bQuestions?\s*(\d{1,2})\s*(?:to|-|--|—)\s*(\d{1,2})\b/i);
  if (!match) return null;

  return {
    start: Number(match[1]),
    end: Number(match[2])
  };
}

export function parseQuestionLead(text: string) {
  const normalized = normalizeCet6Line(text);
  const match = normalized.match(/^(\d{1,2})\.\s*(.*)$/);
  if (!match) return null;

  return {
    questionNumber: Number(match[1]),
    rest: match[2].trim()
  };
}

export function parseOptionLine(text: string) {
  const normalized = normalizeCet6Line(text);
  const matches = [...normalized.matchAll(/(?:^|\s)([A-D])\)\s*/g)];
  if (matches.length === 0) return [];

  return matches
    .map((match, index) => {
      const start = match.index ?? 0;
      const textStart = start + match[0].length;
      const nextStart = matches[index + 1]?.index ?? normalized.length;
      return {
        label: match[1],
        text: normalized.slice(textStart, nextStart).trim()
      };
    })
    .filter((option) => /[A-Za-z0-9\u4e00-\u9fff]/.test(option.text));
}

export function parseWordBankLine(text: string) {
  const normalized = normalizeCet6Line(text).replace(/^0\)/, "O)");
  const match = normalized.match(/^([A-O])\)\s*(.+)$/i);
  if (!match) return null;
  const word = match[2].trim();
  if (!isWordBankValue(word)) return null;

  return {
    label: match[1].toUpperCase(),
    text: word
  };
}

export function parseWordBankEntries(text: string) {
  const normalized = normalizeCet6Line(text).replace(/(^|\s)0\)/g, "$1O)");
  const matches = [...normalized.matchAll(/(?:^|\s)([A-O])\)\s*/gi)];
  if (matches.length === 0) return [];

  return matches
    .map((match, index) => {
      const start = match.index ?? 0;
      const textStart = start + match[0].length;
      const nextStart = matches[index + 1]?.index ?? normalized.length;
      return {
        label: match[1].toUpperCase(),
        text: normalized.slice(textStart, nextStart).trim()
      };
    })
    .filter((entry) => isWordBankValue(entry.text));
}

export function isBurberryParagraph(text: string) {
  const normalized = normalizeCet6Line(text);
  return /^[A-L]\)\s+/.test(normalized) && !parseOptionLine(normalized).some((option) => option.label !== normalized[0]);
}

function isWordBankValue(text: string) {
  const normalized = normalizeCet6Line(text);
  if (normalized.length > 32) return false;
  if (/[,.?!;:"]/g.test(normalized)) return false;
  return /^[A-Za-z][A-Za-z-]*$/.test(normalized);
}

function isSectionLine(text: string) {
  return /^Section\s+[ABC]\b/i.test(text);
}

function sectionLabel(text: string) {
  return text.match(/^Section\s+([ABC])\b/i)?.[1].toUpperCase() ?? null;
}

function isPartLine(text: string) {
  return /^Part\s*(?:[IVX]+)?$/i.test(text) || /^Part\s+[IVX]+\b/i.test(text);
}

function readPartHeading(lines: NormalizedLine[], index: number) {
  const line = lines[index];
  const parts = [line.text];
  let roman = line.text.match(/^Part\s+([IVX]+)\b/i)?.[1]?.toUpperCase();
  let nextIndex = index + 1;

  if (!roman && /^Part$/i.test(line.text)) {
    const next = lines[nextIndex];
    if (next?.text.match(/^[IVX]+$/i)) {
      roman = next.text.toUpperCase();
      parts.push(next.text);
      nextIndex += 1;
    }
  }

  if (!roman || !(roman in romanPartTypes)) return null;

  const titleLine = lines[nextIndex]?.text;
  if (
    titleLine &&
    !isSectionLine(titleLine) &&
    /^(Writing|Listening Comprehension|Reading Comprehension|Translation)$/i.test(titleLine)
  ) {
    parts.push(titleLine);
    nextIndex += 1;
  }

  const minutesLine = lines[nextIndex]?.text;
  if (minutesLine && /^\(\d+\s+minutes\)$/i.test(minutesLine)) {
    parts.push(minutesLine);
    nextIndex += 1;
  }

  return {
    heading: romanPartTitles[roman],
    displayText: parts.join(" "),
    partType: romanPartTypes[roman],
    nextIndex
  };
}

function appendLine(buffer: BufferState | null, line: NormalizedLine, blockType: Cet6BlockType) {
  if (!buffer) {
    return {
      blockType,
      pageNumber: line.pageNumber,
      lines: [line.text]
    };
  }

  if (buffer.blockType !== blockType) {
    return {
      blockType,
      pageNumber: line.pageNumber,
      lines: [line.text]
    };
  }

  buffer.lines.push(line.text);
  return buffer;
}

function joinBufferedLines(lines: string[]) {
  return lines.reduce((joined, line) => {
    if (!joined) return line;
    if (joined.endsWith("-")) return `${joined.slice(0, -1)}${line}`;
    return `${joined} ${line}`;
  }, "");
}

function splitInlineDirections(text: string) {
  const normalized = normalizeCet6Line(text);
  const match = normalized.match(/^Directions:\s+(.+)$/i);
  if (!match) return null;

  const content = match[1];
  const knownEndings = [
    /^(.*?Answer Sheet 2\.)(\s+.+)$/i,
    /^(.*?Answer Sheet 1 with a single line through the centre\.)(\s+.+)$/i,
    /^(.*?no more than 200 words\.)(\s+.+)$/i,
    /^(.*?more than once\.)(\s+.+)$/i
  ];

  for (const pattern of knownEndings) {
    const endingMatch = content.match(pattern);
    if (endingMatch) {
      return {
        directions: `Directions: ${endingMatch[1]}`,
        rest: endingMatch[2].trim()
      };
    }
  }

  return {
    directions: `Directions: ${content}`,
    rest: ""
  };
}

function optionRank(label: string) {
  return label.toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
}

function wordBankRank(label: string) {
  return label.toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
}

export function parseCet6Paper(pages: ParserPageInput[]) {
  const lines = normalizePages(pages);
  const sections: ParsedSectionDraft[] = [];
  let currentPart: PartContext = "unknown";
  let currentSection: ParsedSectionDraft | null = null;
  let pendingPartHeading: string | null = null;
  let pendingSection: PendingSection | null = null;
  let buffer: BufferState | null = null;
  let orderIndex = 0;
  let sectionOrderIndex = 0;
  let lastQuestionNumber: number | undefined;
  let lastOptionRank = -1;
  let lastWordBankRank = -1;
  let pendingWordBankLabel: string | null = null;
  let lastOptionBlock: ParsedBlockDraft | null = null;

  function startSection(
    type: SectionType,
    title: string,
    pageNumber: number,
    subtitle?: string
  ) {
    flushBuffer();
    if (currentSection) {
      currentSection.pageEnd = Math.max(currentSection.pageEnd ?? pageNumber, pageNumber);
    }

    currentSection = {
      clientId: `section-${sectionOrderIndex}`,
      type,
      title,
      subtitle,
      pageStart: pageNumber,
      pageEnd: pageNumber,
      orderIndex: sectionOrderIndex++,
      blocks: []
    };
    sections.push(currentSection);

    if (pendingPartHeading) {
      addBlock("heading", pendingPartHeading, pageNumber);
      pendingPartHeading = null;
    }
  }

  function ensureSection(pageNumber: number) {
    if (!currentSection) {
      startSection("unknown", "未分类内容", pageNumber);
    }
    if (!currentSection) {
      throw new Error("Failed to initialize parser section");
    }
    return currentSection;
  }

  function getCurrentSection() {
    return currentSection as ParsedSectionDraft | null;
  }

  function addBlock(
    blockType: Cet6BlockType,
    originalText: string,
    pageNumber: number,
    metadata: { questionNumber?: number; optionLabel?: string } = {}
  ): ParsedBlockDraft | null {
    const text = normalizeCet6Line(originalText);
    const inWordBank = blockType === "word_bank";
    const isBareQuestionNumber =
      blockType === "question" && metadata.questionNumber && /^\d{1,2}\.$/.test(text);
    if (!isBareQuestionNumber && shouldDropFragment(text, { inWordBank })) return null;

    const section = ensureSection(pageNumber);
    section.pageStart = Math.min(section.pageStart ?? pageNumber, pageNumber);
    section.pageEnd = Math.max(section.pageEnd ?? pageNumber, pageNumber);
    const block: ParsedBlockDraft = {
      clientId: `block-${orderIndex}`,
      sectionClientId: section.clientId,
      blockType,
      questionNumber: metadata.questionNumber,
      optionLabel: metadata.optionLabel,
      originalText: text,
      pageNumber,
      orderIndex,
      textHash: textHash(text)
    };
    section.blocks.push(block);
    orderIndex += 1;
    lastOptionBlock = blockType === "option" ? block : null;
    return block;
  }

  function flushBuffer() {
    if (!buffer) return;
    const text = joinBufferedLines(buffer.lines);
    addBlock(buffer.blockType, text, buffer.pageNumber);
    buffer = null;
  }

  function startPendingSectionIfReady(pageNumber: number) {
    if (!pendingSection) return;
    const label = pendingSection.label;
    const pendingLines = pendingSection.lines;
    const pendingPageNumber = pendingSection.pageNumber;
    if (currentPart === "reading") {
      const type = sectionTypeFromReadingSection(label);
      startSection(type, `Section ${label} ${sectionTypeTitle(type)}`, pendingPageNumber);
    } else if (currentPart === "listening") {
      startSection("listening", listeningSectionTitle(label), pendingPageNumber);
    } else {
      startSection("unknown", `Section ${label}`, pendingPageNumber);
    }
    pendingSection = null;
    lastOptionRank = -1;
    lastWordBankRank = -1;
    const activeSection = getCurrentSection();
    if (activeSection) activeSection.pageEnd = Math.max(activeSection.pageEnd ?? pageNumber, pageNumber);

    if (pendingLines.length > 0) {
      const text = joinBufferedLines(pendingLines.map((line) => line.text));
      const inlineDirections = splitInlineDirections(text);
      if (inlineDirections) {
        addBlock("directions", inlineDirections.directions, pendingLines[0].pageNumber);
        if (inlineDirections.rest) {
          addBlock(defaultBlockType(activeSection?.type), inlineDirections.rest, pendingLines[0].pageNumber);
        }
      } else {
        addBlock(defaultBlockType(activeSection?.type), text, pendingLines[0].pageNumber);
      }
    }
  }

  function handleOptions(text: string, pageNumber: number, questionNumber = lastQuestionNumber) {
    const options = parseOptionLine(text);
    if (options.length === 0) return false;

    for (const option of options) {
      addBlock("option", `${option.label}) ${option.text}`, pageNumber, {
        questionNumber,
        optionLabel: option.label
      });
      lastOptionRank = Math.max(lastOptionRank, optionRank(option.label));
    }

    if (lastOptionRank >= optionRank("D")) {
      startPendingSectionIfReady(pageNumber);
    }

    return true;
  }

  function shouldAppendToPreviousOption(lineText: string) {
    if (!lastOptionBlock) return false;
    const activeSection = getCurrentSection();
    if (!activeSection || activeSection.type === "reading_matching" || activeSection.type === "reading_bank") {
      return false;
    }
    if (/[.!?。！？]"?$/.test(lastOptionBlock.originalText)) return false;
    if (
      isPartLine(lineText) ||
      isSectionLine(lineText) ||
      /^Directions:?$/i.test(lineText) ||
      parseQuestionRange(lineText) ||
      parseQuestionLead(lineText) ||
      parseOptionLine(lineText).length > 0
    ) {
      return false;
    }
    return /[A-Za-z0-9)]$/.test(lastOptionBlock.originalText) && lineText.length <= 140;
  }

  function shouldEndDirectionsBefore(lineText: string) {
    if (buffer?.blockType !== "directions") return false;
    const joined = joinBufferedLines(buffer.lines);
    const type = getCurrentSection()?.type;
    if (type === "writing" && /more than 200 words\.$/i.test(joined)) return true;
    if (type === "reading_bank" && /more than once\.$/i.test(joined)) return true;
    if (type === "reading_matching" && /Answer Sheet 2\.$/i.test(joined)) return true;
    if (type === "reading_careful" && /(?:centre|center)\.$/i.test(joined)) return true;
    if (type === "translation" && /Answer Sheet 2\.$/i.test(joined)) return true;
    return /^[A-Z][a-z]/.test(lineText) && /(?:centre|center|once|words)\.$/i.test(joined);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const part = isPartLine(line.text) ? readPartHeading(lines, index) : null;

    if (part) {
      flushBuffer();
      currentPart = part.partType === "reading" ? "reading" : part.partType;
      pendingPartHeading = part.heading;
      index = part.nextIndex - 1;

      if (part.partType === "writing") {
        startSection("writing", "Part I Writing", line.pageNumber);
      } else if (part.partType === "translation") {
        startSection("translation", "Part IV Translation", line.pageNumber);
      }
      continue;
    }

    const label = sectionLabel(line.text);
    if (label) {
      const activeSection = getCurrentSection();
      const wordBankIncomplete =
        activeSection?.type === "reading_bank" && lastWordBankRank >= 0 && lastWordBankRank < wordBankRank("O");
      const optionIncomplete = lastQuestionNumber !== undefined && lastOptionRank >= 0 && lastOptionRank < optionRank("D");

      if (wordBankIncomplete || optionIncomplete) {
        pendingSection = { label, pageNumber: line.pageNumber, lines: [] };
        continue;
      }

      flushBuffer();
      if (currentPart === "reading") {
        const type = sectionTypeFromReadingSection(label);
        startSection(type, `Section ${label} ${sectionTypeTitle(type)}`, line.pageNumber);
      } else if (currentPart === "listening") {
        startSection("listening", listeningSectionTitle(label), line.pageNumber);
      } else {
        startSection("unknown", `Section ${label}`, line.pageNumber);
      }
      continue;
    }

    if (
      pendingSection &&
      getCurrentSection()?.type === "reading_bank" &&
      lastWordBankRank >= 0 &&
      lastWordBankRank < wordBankRank("O")
    ) {
      const labelOnly = normalizeCet6Line(line.text)
        .replace(/^0\)$/, "O)")
        .match(/^([A-O])\)$/i);
      if (labelOnly) {
        pendingWordBankLabel = labelOnly[1].toUpperCase();
        continue;
      }

      if (pendingWordBankLabel && isWordBankValue(line.text)) {
        flushBuffer();
        addBlock("word_bank", `${pendingWordBankLabel}) ${line.text}`, line.pageNumber, {
          optionLabel: pendingWordBankLabel
        });
        lastWordBankRank = Math.max(lastWordBankRank, wordBankRank(pendingWordBankLabel));
        pendingWordBankLabel = null;
        if (lastWordBankRank >= wordBankRank("O")) {
          startPendingSectionIfReady(line.pageNumber);
        }
        continue;
      }

      const wordBankEntries = parseWordBankEntries(line.text);
      if (wordBankEntries.length > 0) {
        flushBuffer();
        for (const wordBank of wordBankEntries) {
          addBlock("word_bank", `${wordBank.label}) ${wordBank.text}`, line.pageNumber, {
            optionLabel: wordBank.label
          });
          lastWordBankRank = Math.max(lastWordBankRank, wordBankRank(wordBank.label));
        }
        if (lastWordBankRank >= wordBankRank("O")) {
          startPendingSectionIfReady(line.pageNumber);
        }
        continue;
      }

      pendingSection.lines.push(line);
      continue;
    }

    const inlineDirections = splitInlineDirections(line.text);
    if (inlineDirections) {
      flushBuffer();
      if (inlineDirections.rest) {
        addBlock("directions", inlineDirections.directions, line.pageNumber);
      } else {
        buffer = appendLine(null, { ...line, text: inlineDirections.directions }, "directions");
      }
      if (inlineDirections.rest) {
        const blockType = defaultBlockType(getCurrentSection()?.type);
        buffer = appendLine(null, { ...line, text: inlineDirections.rest }, blockType);
      }
      continue;
    }

    if (/^Directions:?$/i.test(line.text)) {
      flushBuffer();
      buffer = appendLine(null, line, "directions");
      continue;
    }

    const range = parseQuestionRange(line.text);
    if (range) {
      flushBuffer();
      const typeFromRange = sectionTypeFromQuestionNumber(range.start);
      const activeSection = getCurrentSection();
      if (
        activeSection &&
        activeSection.type !== typeFromRange &&
        typeFromRange !== "unknown" &&
        currentPart !== "listening"
      ) {
        startSection(typeFromRange, sectionTypeTitle(typeFromRange), line.pageNumber);
      }
      addBlock("question_group", line.text, line.pageNumber);
      lastQuestionNumber = range.start;
      lastOptionRank = -1;
      continue;
    }

    const question = parseQuestionLead(line.text);
    if (question) {
      flushBuffer();
      let questionRest = question.rest;
      const nextLine = lines[index + 1];
      if (
        !questionRest &&
        nextLine &&
        parseOptionLine(nextLine.text).length === 0 &&
        !isSectionLine(nextLine.text) &&
        !isPartLine(nextLine.text) &&
        !parseQuestionLead(nextLine.text) &&
        !parseQuestionRange(nextLine.text)
      ) {
        questionRest = nextLine.text;
        index += 1;
      }
      const questionType = sectionTypeFromQuestionNumber(question.questionNumber);
      const activeSection = getCurrentSection();
      if (
        activeSection &&
        activeSection.type !== questionType &&
        questionType !== "unknown" &&
        currentPart !== "listening"
      ) {
        startSection(questionType, sectionTypeTitle(questionType), line.pageNumber);
      }
      const restIsOptions = parseOptionLine(questionRest).length > 0 && /^[A-D]\)/.test(questionRest);
      addBlock("question", `${question.questionNumber}.${questionRest && !restIsOptions ? ` ${questionRest}` : ""}`, line.pageNumber, {
        questionNumber: question.questionNumber
      });
      lastQuestionNumber = question.questionNumber;
      lastOptionRank = -1;
      if (questionRest) {
        handleOptions(questionRest, line.pageNumber, question.questionNumber);
      }
      continue;
    }

    if (buffer?.blockType === "directions") {
      if (shouldEndDirectionsBefore(line.text)) {
        flushBuffer();
      } else {
        buffer = appendLine(buffer, line, "directions");
        continue;
      }
    }

    if (shouldAppendToPreviousOption(line.text)) {
      flushBuffer();
      const optionBlock = lastOptionBlock as ParsedBlockDraft | null;
      if (optionBlock) {
        optionBlock.originalText = normalizeCet6Line(`${optionBlock.originalText} ${line.text}`);
        optionBlock.textHash = textHash(optionBlock.originalText);
      }
      continue;
    }

    if (getCurrentSection()?.type === "reading_matching" && /^[A-L]\)\s*/.test(line.text)) {
      flushBuffer();
      const labelMatch = line.text.match(/^([A-L])\)\s*(.+)$/);
      if (labelMatch) {
        buffer = appendLine(null, { ...line, text: `${labelMatch[1]}) ${labelMatch[2]}` }, "paragraph");
      } else {
        buffer = appendLine(null, line, "paragraph");
      }
      continue;
    }

    if (getCurrentSection()?.type === "reading_bank") {
      const labelOnly = normalizeCet6Line(line.text)
        .replace(/^0\)$/, "O)")
        .match(/^([A-O])\)$/i);
      if (labelOnly) {
        pendingWordBankLabel = labelOnly[1].toUpperCase();
        continue;
      }

      if (pendingWordBankLabel && isWordBankValue(line.text)) {
        flushBuffer();
        addBlock("word_bank", `${pendingWordBankLabel}) ${line.text}`, line.pageNumber, {
          optionLabel: pendingWordBankLabel
        });
        lastWordBankRank = Math.max(lastWordBankRank, wordBankRank(pendingWordBankLabel));
        pendingWordBankLabel = null;
        if (lastWordBankRank >= wordBankRank("O")) {
          startPendingSectionIfReady(line.pageNumber);
        }
        continue;
      }
    }

    const wordBankEntries = getCurrentSection()?.type === "reading_bank" ? parseWordBankEntries(line.text) : [];
    if (wordBankEntries.length > 0) {
      flushBuffer();
      for (const wordBank of wordBankEntries) {
        addBlock("word_bank", `${wordBank.label}) ${wordBank.text}`, line.pageNumber, {
          optionLabel: wordBank.label
        });
        lastWordBankRank = Math.max(lastWordBankRank, wordBankRank(wordBank.label));
      }
      if (lastWordBankRank >= wordBankRank("O")) {
        startPendingSectionIfReady(line.pageNumber);
      }
      continue;
    }

    if (getCurrentSection()?.type !== "reading_matching" && handleOptions(line.text, line.pageNumber)) {
      continue;
    }

    if (/^Passage\s+(?:One|Two|Three)\b/i.test(line.text)) {
      flushBuffer();
      addBlock("heading", line.text, line.pageNumber);
      continue;
    }

    const blockType = defaultBlockType(getCurrentSection()?.type);
    buffer = appendLine(buffer, line, blockType);
  }

  flushBuffer();
  const finalSection = getCurrentSection();
  if (finalSection) {
    finalSection.pageEnd = Math.max(
      finalSection.pageEnd ?? finalSection.pageStart ?? 1,
      finalSection.blocks.at(-1)?.pageNumber ?? finalSection.pageStart ?? 1
    );
  }

  const repairedSections = repairOptionAssignments(
    sections.filter((section) => section.blocks.length > 0).map(mergeQuestionContinuations)
  );

  return {
    sections: finalizeSections(repairedSections)
  };
}

type QuestionState = {
  questionNumber: number;
  section: ParsedSectionDraft;
  question: ParsedBlockDraft;
  options: ParsedBlockDraft[];
};

function hasSubstantiveOptionText(option: ParsedBlockDraft) {
  return /[A-Za-z0-9\u4e00-\u9fff]/.test(option.originalText.replace(/^[A-D]\)\s*/i, ""));
}

function removeBlockFromSection(section: ParsedSectionDraft, block: ParsedBlockDraft) {
  const index = section.blocks.indexOf(block);
  if (index >= 0) section.blocks.splice(index, 1);
}

function insertOptionIntoTarget(target: QuestionState, option: ParsedBlockDraft) {
  option.questionNumber = target.questionNumber;
  option.sectionClientId = target.section.clientId;
  const questionIndex = target.section.blocks.indexOf(target.question);
  const insertAfter = Math.max(
    questionIndex,
    ...target.options.map((targetOption) => target.section.blocks.indexOf(targetOption)).filter((index) => index >= 0)
  );
  target.section.blocks.splice(insertAfter + 1, 0, option);
  target.options.push(option);
}

function repairOptionAssignments(sections: ParsedSectionDraft[]) {
  const states = new Map<number, QuestionState>();

  for (const section of sections) {
    for (const block of section.blocks) {
      if (block.blockType === "question" && typeof block.questionNumber === "number") {
        states.set(block.questionNumber, {
          questionNumber: block.questionNumber,
          section,
          question: block,
          options: []
        });
      }
    }
  }

  for (const section of sections) {
    for (const block of section.blocks) {
      if (block.blockType === "option" && typeof block.questionNumber === "number") {
        states.get(block.questionNumber)?.options.push(block);
      }
    }
  }

  const orderedStates = [...states.values()].sort((a, b) => a.questionNumber - b.questionNumber);

  for (const state of orderedStates) {
    for (const option of [...state.options]) {
      if (!hasSubstantiveOptionText(option)) {
        removeBlockFromSection(state.section, option);
        state.options = state.options.filter((item) => item !== option);
      }
    }
  }

  for (const state of orderedStates) {
    const byLabel = new Map<string, ParsedBlockDraft[]>();
    for (const option of state.options) {
      if (!option.optionLabel) continue;
      const label = option.optionLabel.toUpperCase();
      byLabel.set(label, [...(byLabel.get(label) ?? []), option]);
    }

    const duplicates = [...byLabel.values()]
      .flatMap((options) => (options.length > 1 ? options.slice(0, -1) : []))
      .sort((a, b) => a.orderIndex - b.orderIndex);

    for (const duplicate of duplicates) {
      const label = duplicate.optionLabel?.toUpperCase();
      if (!label) continue;
      const target = orderedStates.find(
        (candidate) =>
          candidate.questionNumber < state.questionNumber &&
          candidate.options.length < 4 &&
          !candidate.options.some((option) => option.optionLabel?.toUpperCase() === label)
      );

      removeBlockFromSection(state.section, duplicate);
      state.options = state.options.filter((option) => option !== duplicate);

      if (target) {
        insertOptionIntoTarget(target, duplicate);
      }
    }
  }

  return sections;
}

function mergeQuestionContinuations(section: ParsedSectionDraft): ParsedSectionDraft {
  const blocks: ParsedBlockDraft[] = [];

  for (const block of section.blocks) {
    const previous = blocks.at(-1);
    if (
      section.type === "reading_matching" &&
      previous?.blockType === "question" &&
      block.blockType === "paragraph" &&
      !block.optionLabel
    ) {
      previous.originalText = normalizeCet6Line(`${previous.originalText} ${block.originalText}`);
      previous.textHash = textHash(previous.originalText);
      continue;
    }

    blocks.push(block);
  }

  return {
    ...section,
    blocks
  };
}

function finalizeSections(sections: ParsedSectionDraft[]) {
  const merged: ParsedSectionDraft[] = [];

  for (const section of sections) {
    const previous = merged.at(-1);
    if (previous && previous.type === section.type && section.type === "reading_careful") {
      previous.pageEnd = Math.max(previous.pageEnd ?? 0, section.pageEnd ?? 0);
      previous.blocks.push(...section.blocks);
      continue;
    }
    merged.push({ ...section, blocks: [...section.blocks] });
  }

  let blockIndex = 0;
  return merged.map((section, sectionIndex) => {
    const clientId = `section-${sectionIndex}`;
    return {
      ...section,
      clientId,
      orderIndex: sectionIndex,
      blocks: section.blocks.map((block) => ({
        ...block,
        sectionClientId: clientId,
        orderIndex: blockIndex++
      }))
    };
  });
}

function sectionTypeTitle(type: SectionType) {
  if (type === "writing") return "写作";
  if (type === "listening") return "听力";
  if (type === "reading_bank") return "选词填空";
  if (type === "reading_matching") return "长篇匹配";
  if (type === "reading_careful") return "仔细阅读";
  if (type === "translation") return "翻译";
  return "未分类";
}

function defaultBlockType(type?: SectionType): Cet6BlockType {
  if (type === "translation") return "translation_prompt";
  if (type === "reading_bank" || type === "reading_careful") return "passage";
  if (type === "reading_matching") return "paragraph";
  if (type === "writing") return "paragraph";
  return "paragraph";
}
