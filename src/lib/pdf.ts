import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createCanvas, DOMMatrix, DOMPoint, Path2D } from "@napi-rs/canvas";
import type { PageSource } from "@prisma/client";
import type { PDFPageProxy, RenderParameters } from "pdfjs-dist/types/src/display/api";

const execFileAsync = promisify(execFile);

export type ExtractedPage = {
  pageNumber: number;
  rawText: string;
  ocrText?: string;
  source: PageSource;
  confidence?: number;
};

type ProgressCallback = (pageNumber: number, totalPages: number, source: PageSource) => Promise<void> | void;

export type NormalizedPdfTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasTransform: boolean;
  hasEol: boolean;
  index: number;
};

type ReadingLine = {
  items: NormalizedPdfTextItem[];
  text: string;
  x: number;
  maxX: number;
  y: number;
  column: number;
  order: number;
};

type CanvasGlobal = typeof globalThis & {
  Path2D?: unknown;
  DOMMatrix?: unknown;
  DOMPoint?: unknown;
};

export type TextQualityReport = {
  compactLength: number;
  cjkRatio: number;
  abnormalSymbolRatio: number;
  replacementCharRatio: number;
  denseQuestionTilde: boolean;
  hasKnownMojibake: boolean;
  hasReadableEnglish: boolean;
  garbled: boolean;
  reasons: string[];
};

const BROKEN_WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bPart\s+[1l]V\b/gi, "Part IV"],
  [/\bf\s+our\b/gi, "four"],
  [/\bfo\s+llowing\b/gi, "following"],
  [/\bfol\s+lowing\b/gi, "following"],
  [/\bfollow\s+ing\b/gi, "following"],
  [/\bquest\s+ions\b/gi, "questions"],
  [/\bques\s+tions\b/gi, "questions"],
  [/\bcorres\s+ponding\b/gi, "corresponding"]
];

const COMMON_ENGLISH_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "they",
  "this",
  "to",
  "was",
  "were",
  "which",
  "with",
  "you"
]);

function installCanvasGlobals() {
  const canvasGlobal = globalThis as CanvasGlobal;
  const target = canvasGlobal as Record<string, unknown>;
  if (!target.Path2D) target.Path2D = Path2D;
  if (!target.DOMMatrix) target.DOMMatrix = DOMMatrix;
  if (!target.DOMPoint) target.DOMPoint = DOMPoint;
}

export function normalizeExtractedText(text: string) {
  let normalized = text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "")
    .replace(/(?<=[\u3400-\u9fff])\s+([，。；：？！、])/g, "$1")
    .replace(/([，。；：？！、])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  for (const [pattern, replacement] of BROKEN_WORD_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.trim();
}

export function normalizePdfTextItem(item: unknown, index = 0): NormalizedPdfTextItem | null {
  if (typeof item !== "object" || !item || !("str" in item)) return null;

  const source = item as {
    str: unknown;
    transform?: unknown;
    width?: unknown;
    height?: unknown;
    hasEOL?: unknown;
  };
  const text = String(source.str ?? "");
  const transform = Array.isArray(source.transform) ? source.transform : [];
  const x = typeof transform[4] === "number" && Number.isFinite(transform[4]) ? transform[4] : 0;
  const y = typeof transform[5] === "number" && Number.isFinite(transform[5]) ? transform[5] : 0;
  const width = typeof source.width === "number" && Number.isFinite(source.width) ? source.width : 0;
  const transformHeight = typeof transform[3] === "number" && Number.isFinite(transform[3]) ? Math.abs(transform[3]) : 0;
  const height = typeof source.height === "number" && Number.isFinite(source.height) ? source.height : transformHeight;

  return {
    text,
    x,
    y,
    width,
    height,
    hasTransform: transform.length >= 6,
    hasEol: source.hasEOL === true,
    index
  };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function minOf(values: number[]) {
  return values.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
}

function maxOf(values: number[]) {
  return values.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
}

function readingLineTolerance(items: NormalizedPdfTextItem[]) {
  const heights = items.map((item) => item.height).filter((height) => height > 0);
  return Math.max(2, median(heights) * 0.65 || 0);
}

function estimateCharWidth(item: NormalizedPdfTextItem) {
  const visibleLength = item.text.replace(/\s/g, "").length;
  if (!visibleLength || item.width <= 0) return 0;
  return item.width / visibleLength;
}

function shouldInsertSpace(previous: NormalizedPdfTextItem, current: NormalizedPdfTextItem) {
  if (!previous.text || !current.text) return false;
  if (/\s$/.test(previous.text) || /^\s/.test(current.text)) return false;
  if (/^[,.;:!?%)\]}]/.test(current.text)) return false;
  if (/[([{]$/.test(previous.text)) return false;

  const gap = current.x - (previous.x + previous.width);
  if (gap <= 0) return false;

  const charWidth = median([estimateCharWidth(previous), estimateCharWidth(current)].filter((width) => width > 0));
  return gap > Math.max(1.5, charWidth * 0.45);
}

function lineText(items: NormalizedPdfTextItem[]) {
  return items.reduce((text, item, index) => {
    if (index === 0) return item.text;
    const previous = items[index - 1];
    return `${text}${shouldInsertSpace(previous, item) ? " " : ""}${item.text}`;
  }, "");
}

function canShareReadingLine(line: ReadingLine, item: NormalizedPdfTextItem, tolerance: number) {
  if (Math.abs(line.y - item.y) > tolerance) return false;

  const itemMaxX = item.x + item.width;
  const horizontalGap = item.x >= line.maxX ? item.x - line.maxX : line.x - itemMaxX;
  return horizontalGap <= 72;
}

function buildReadingLines(items: NormalizedPdfTextItem[]) {
  const positioned = items.filter((item) => item.hasTransform && item.text.length > 0);
  const tolerance = readingLineTolerance(positioned);
  const lines: ReadingLine[] = [];

  for (const item of [...positioned].sort((a, b) => b.y - a.y || a.x - b.x || a.index - b.index)) {
    const line = lines.find((candidate) => canShareReadingLine(candidate, item, tolerance));

    if (line) {
      line.items.push(item);
      line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
      line.x = Math.min(line.x, item.x);
      line.maxX = Math.max(line.maxX, item.x + item.width);
      continue;
    }

    lines.push({
      items: [item],
      text: item.text,
      x: item.x,
      maxX: item.x + item.width,
      y: item.y,
      column: 0,
      order: lines.length
    });
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x || b.y - a.y || a.index - b.index);
    line.text = lineText(line.items);
    line.x = minOf(line.items.map((item) => item.x));
    line.maxX = maxOf(line.items.map((item) => item.x + item.width));
  }

  assignColumns(lines);
  return lines;
}

function assignColumns(lines: ReadingLine[]) {
  const candidates = lines.filter((line) => line.text.trim().length > 0);
  if (candidates.length < 4) return;

  const sortedX = [...candidates].sort((a, b) => a.x - b.x);
  let bestGap = 0;
  let splitIndex = -1;

  for (let index = 0; index < sortedX.length - 1; index += 1) {
    const gap = sortedX[index + 1].x - sortedX[index].x;
    if (gap > bestGap) {
      bestGap = gap;
      splitIndex = index;
    }
  }

  if (splitIndex < 0) return;

  const leftCount = splitIndex + 1;
  const rightCount = sortedX.length - leftCount;
  const minX = sortedX[0].x;
  const maxX = sortedX[sortedX.length - 1].x;
  const xRange = Math.max(1, maxX - minX);
  const hasColumnGap = leftCount >= 2 && rightCount >= 2 && bestGap >= Math.max(48, xRange * 0.18);
  if (!hasColumnGap) return;

  const splitX = (sortedX[splitIndex].x + sortedX[splitIndex + 1].x) / 2;
  for (const line of lines) {
    line.column = line.x >= splitX ? 1 : 0;
  }
}

function compareReadingLines(a: ReadingLine, b: ReadingLine) {
  const columnDifference = a.column - b.column;
  if (columnDifference !== 0) return columnDifference;
  if (Math.abs(a.y - b.y) <= 2) return a.x - b.x || a.order - b.order;
  return b.y - a.y || a.x - b.x || a.order - b.order;
}

export function sortTextItemsForReading(items: NormalizedPdfTextItem[]) {
  if (!items.some((item) => item.hasTransform)) return [...items].sort((a, b) => a.index - b.index);

  return buildReadingLines(items)
    .sort(compareReadingLines)
    .flatMap((line) => line.items);
}

export function extractTextFromPdfTextItems(items: unknown[]) {
  const normalizedItems = items
    .map((item, index) => normalizePdfTextItem(item, index))
    .filter((item): item is NormalizedPdfTextItem => item !== null);

  if (!normalizedItems.some((item) => item.hasTransform)) {
    return normalizeExtractedText(normalizedItems.map((item) => item.text).join("\n"));
  }

  const lines = buildReadingLines(normalizedItems).sort(compareReadingLines);

  return normalizeExtractedText(lines.map((line) => line.text).join("\n"));
}

function countMatches(text: string, pattern: RegExp) {
  return (text.match(pattern) ?? []).length;
}

export function detectGarbledText(text: string): TextQualityReport {
  const compact = text.replace(/\s/g, "");
  const compactLength = compact.length;
  const visible = compactLength || 1;
  const cjkChars = countMatches(compact, /[\u3400-\u9fff]/g);
  const replacementChars = countMatches(compact, /[�□■◆◇●]/g);
  const abnormalSymbols = countMatches(
    compact,
    /[^\p{L}\p{N}\s.,;:!?'"()[\]{}<>/@#$%&*+\-=\\|_`~，。、《》？；：“”‘’（）【】—…·]/gu
  );
  const questionTildeCount = countMatches(compact, /[~?？]/g);
  const words = text.toLowerCase().match(/[a-z]{2,}/g) ?? [];
  const commonWords = words.filter((word) => COMMON_ENGLISH_WORDS.has(word)).length;
  const cjkRatio = cjkChars / visible;
  const abnormalSymbolRatio = abnormalSymbols / visible;
  const replacementCharRatio = replacementChars / visible;
  const denseQuestionTilde = /(?:[~?？]\s*){6,}/.test(compact) || (questionTildeCount >= 8 && questionTildeCount / visible > 0.12);
  const hasKnownMojibake = /tOOA/i.test(text) || /[½¼¾¿¡]/.test(text);
  const hasReadableEnglish = words.length >= 8 && commonWords / words.length >= 0.18;
  const lowCjkSuspicious = compactLength >= 120 && cjkRatio < 0.005 && !hasReadableEnglish && abnormalSymbolRatio > 0.035;

  const reasons: string[] = [];
  if (replacementCharRatio > 0.04) reasons.push("replacement-chars");
  if (abnormalSymbolRatio > 0.06) reasons.push("abnormal-symbols");
  if (denseQuestionTilde) reasons.push("dense-question-tilde");
  if (hasKnownMojibake) reasons.push("known-mojibake");
  if (lowCjkSuspicious) reasons.push("low-cjk-with-symbol-noise");

  return {
    compactLength,
    cjkRatio,
    abnormalSymbolRatio,
    replacementCharRatio,
    denseQuestionTilde,
    hasKnownMojibake,
    hasReadableEnglish,
    garbled: reasons.length > 0,
    reasons
  };
}

function ocrErrorMessage(pageNumber: number, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return `OCR fallback failed on page ${pageNumber}: ${detail}`;
}

function assertReadableOcrResult(pageNumber: number, rawText: string, ocrText: string, quality: TextQualityReport) {
  if (ocrText) return;
  if (!rawText || quality.garbled) {
    const reason = quality.reasons.length ? ` after ${quality.reasons.join(", ")}` : "";
    throw new Error(`OCR fallback returned no readable text on page ${pageNumber}${reason}`);
  }
}

function ocrMode() {
  return (process.env.PDF_OCR_MODE ?? "garbled").toLowerCase();
}

function ocrScale() {
  const value = Number(process.env.PDF_OCR_SCALE);
  return Number.isFinite(value) && value > 0 ? value : 1.5;
}

export function shouldRunOcr(text: string) {
  const mode = ocrMode();
  if (mode === "off" || mode === "false") return false;
  if (mode === "always") return true;

  const compact = text.replace(/\s/g, "");
  if (!compact) return true;

  if (mode === "auto" && compact.length < 80) return true;
  return detectGarbledText(text).garbled;
}

function pdftoppmDpi() {
  const value = Number(process.env.PDFTOPPM_DPI);
  if (Number.isFinite(value) && value >= 72 && value <= 600) return Math.round(value);
  return Math.round(144 * ocrScale());
}

export function resolvePdftoppmCommand() {
  const configured = process.env.PDFTOPPM_PATH?.trim();
  if (!configured) return "pdftoppm";

  const lower = configured.toLowerCase();
  if (lower.endsWith("pdftoppm") || lower.endsWith("pdftoppm.exe")) return configured;

  return path.join(configured, process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm");
}

export function buildPdftoppmArgs(filePath: string, pageNumber: number, outputPrefix: string) {
  return [
    "-f",
    String(pageNumber),
    "-l",
    String(pageNumber),
    "-r",
    String(pdftoppmDpi()),
    "-png",
    filePath,
    outputPrefix
  ];
}

function isMissingExecutableError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function pdftoppmErrorMessage(error: unknown) {
  if (isMissingExecutableError(error)) {
    return "pdftoppm is not installed or not in PATH. Install Poppler and set PDFTOPPM_PATH to the pdftoppm executable or Poppler bin directory.";
  }

  if (error instanceof Error) return error.message;
  return String(error);
}

async function readGeneratedPng(tempDir: string) {
  const entries = await readdir(tempDir);
  const pngName = entries
    .filter((entry) => entry.toLowerCase().endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];

  if (!pngName) throw new Error("pdftoppm did not create a PNG file");
  return readFile(path.join(tempDir, pngName));
}

async function renderPageToPngWithPdfjs(page: PDFPageProxy) {
  installCanvasGlobals();
  const viewport = page.getViewport({ scale: ocrScale() });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const canvasContext = canvas.getContext("2d");

  const renderParams: RenderParameters = {
    canvas: null,
    canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
    viewport
  };

  await page.render(renderParams).promise;

  return canvas.toBuffer("image/png");
}

async function renderPageToPngWithPdftoppm(filePath: string, pageNumber: number) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cet6-pdftoppm-"));
  const outputPrefix = path.join(tempDir, "page");

  try {
    await execFileAsync(resolvePdftoppmCommand(), buildPdftoppmArgs(filePath, pageNumber, outputPrefix), {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024 * 8
    });

    return await readGeneratedPng(tempDir);
  } catch (error) {
    throw new Error(pdftoppmErrorMessage(error));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function renderPageToPng(page: PDFPageProxy, filePath: string, pageNumber: number) {
  try {
    return await renderPageToPngWithPdfjs(page);
  } catch (pdfjsError) {
    try {
      return await renderPageToPngWithPdftoppm(filePath, pageNumber);
    } catch (pdftoppmError) {
      const pdfjsMessage = pdfjsError instanceof Error ? pdfjsError.message : String(pdfjsError);
      const pdftoppmMessage = pdftoppmError instanceof Error ? pdftoppmError.message : String(pdftoppmError);
      throw new Error(`pdfjs render failed (${pdfjsMessage}); pdftoppm fallback failed (${pdftoppmMessage})`);
    }
  }
}

async function recognizePage(page: PDFPageProxy, filePath: string, pageNumber: number) {
  const Tesseract = await import("tesseract.js");
  const recognize = Tesseract.recognize ?? Tesseract.default.recognize;
  const png = await renderPageToPng(page, filePath, pageNumber);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cet6-ocr-"));
  const imagePath = path.join(tempDir, `page-${Date.now()}.png`);

  try {
    await writeFile(imagePath, png);
    const result = await recognize(imagePath, "eng+chi_sim", {
      logger: () => undefined
    });

    return {
      text: normalizeExtractedText(result.data.text),
      confidence: result.data.confidence
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function extractPdfPages(filePath: string, onProgress?: ProgressCallback) {
  installCanvasGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = await readFile(filePath);
  const standardFontDataUrl = `${path
    .join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts")
    .replace(/\\/g, "/")}/`;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: false,
    standardFontDataUrl,
    useSystemFonts: true,
    verbosity: 0
  });
  const pdf = await loadingTask.promise;
  const pages: ExtractedPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const rawText = extractTextFromPdfTextItems(textContent.items);
    const quality = detectGarbledText(rawText);

    let source: PageSource = rawText ? "PDF_TEXT" : "EMPTY";
    let ocrText: string | undefined;
    let confidence: number | undefined;

    if (shouldRunOcr(rawText)) {
      let ocr: { text: string; confidence?: number };
      try {
        ocr = await recognizePage(page, filePath, pageNumber);
      } catch (error) {
        if (!rawText || quality.garbled) {
          throw new Error(ocrErrorMessage(pageNumber, error));
        }
        ocr = { text: "" };
      }

      ocrText = ocr.text;
      confidence = ocr.confidence;
      assertReadableOcrResult(pageNumber, rawText, ocrText, quality);
      source = ocrText ? (quality.garbled || !rawText ? "OCR" : "MIXED") : source;
    }

    pages.push({
      pageNumber,
      rawText,
      ocrText,
      source,
      confidence
    });

    await onProgress?.(pageNumber, pdf.numPages, source);
  }

  await loadingTask.destroy();
  return pages;
}

export function readablePageText(page: Pick<ExtractedPage, "rawText" | "ocrText" | "source">) {
  if (page.source === "OCR") return page.ocrText ?? "";
  if (page.source === "MIXED") return [page.rawText, page.ocrText].filter(Boolean).join("\n\n");
  return page.rawText;
}
