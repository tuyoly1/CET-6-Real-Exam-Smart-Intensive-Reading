"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpenText,
  CheckCircle2,
  Columns2,
  Download,
  Eye,
  EyeOff,
  Headphones,
  KeyRound,
  Languages,
  ListTree,
  Loader2,
  PenLine,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X
} from "lucide-react";
import {
  sectionTypeLabels,
  sectionTypeOrder,
  sectionTypeShortLabels,
  type SectionType
} from "@/lib/question-types";
import { groupQuestionBlocks } from "@/lib/question-structure";
import { parsePassageJson, type Passage } from "@/lib/passage-structure";

type PaperStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";
type ReaderMode = "original" | "parallel" | "sentence" | "hideChinese";
type SelectedSection = "ALL" | string;

type PaperSummary = {
  id: string;
  title: string;
  status: PaperStatus;
  progress: number;
  error?: string | null;
};

type BlockDto = {
  id: string;
  blockType: string;
  questionNumber: number | null;
  optionLabel: string | null;
  originalText: string;
  translatedText: string | null;
  paragraphsJson: string | null;
  translationError: string | null;
  pageNumber: number;
  orderIndex: number;
};

type SectionDto = {
  id: string;
  type: SectionType;
  title: string;
  subtitle: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  orderIndex: number;
  blocks: BlockDto[];
};

type TranslationStatus = {
  configured: boolean;
  message: string;
};

type TranslationConfig = {
  apiKeyConfigured: boolean;
  maskedApiKey: string;
  baseUrl: string;
  apiMode: "auto" | "chat" | "responses";
  translationModel: string;
};

type TranslationProgressState = {
  paperId: string;
  status: "idle" | "running" | "finished" | "failed";
  total: number;
  completed: number;
  cached: number;
  translated: number;
  failed: number;
  batchesDone: number;
  batchesTotal: number;
  message: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
};

type ActiveWordTooltip = {
  word: string;
  x: number;
  y: number;
  status: "loading" | "ready" | "error";
  translation?: string;
  error?: string;
};

type VocabularyCard = {
  id: string;
  word: string;
  translation: string;
  status: "loading" | "ready" | "error";
  error?: string;
  context?: string;
  count: number;
  updatedAt: string;
};

const wordLookupCache = new Map<string, string>();
const wordPattern = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g;
const WORD_LOOKUP_DELAY_MS = 450;

const modeOptions: Array<{
  value: ReaderMode;
  title: string;
  label: string;
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}> = [
  { value: "original", title: "原文模式", label: "原文", icon: Eye },
  { value: "parallel", title: "左右对照", label: "对照", icon: Columns2 },
  { value: "sentence", title: "逐句对照", label: "逐句", icon: ListTree },
  { value: "hideChinese", title: "隐藏中文", label: "隐藏中文", icon: EyeOff }
];

function statusText(status: PaperStatus) {
  if (status === "READY") return "完成";
  if (status === "FAILED") return "失败";
  if (status === "PROCESSING") return "处理中";
  return "排队";
}

function StageIcon({ status }: { status: PaperStatus }) {
  if (status === "READY") return <CheckCircle2 size={15} aria-hidden />;
  if (status === "FAILED") return <AlertCircle size={15} aria-hidden />;
  return <Loader2 size={15} aria-hidden />;
}

function sectionIcon(type: SectionType) {
  if (type === "writing") return PenLine;
  if (type === "listening") return Headphones;
  if (type === "translation") return Languages;
  return BookOpenText;
}

function questionRange(section: SectionDto) {
  const numbers = section.blocks
    .map((block) => block.questionNumber)
    .filter((value): value is number => typeof value === "number");
  if (numbers.length === 0) return "无题号";
  return `${Math.min(...numbers)}-${Math.max(...numbers)}`;
}

function pageRange(section: SectionDto) {
  if (!section.pageStart) return "页码未知";
  if (!section.pageEnd || section.pageStart === section.pageEnd) return `P${section.pageStart}`;
  return `P${section.pageStart}-${section.pageEnd}`;
}

function sectionTranslationProgress(section: SectionDto, translation: TranslationStatus) {
  if (!translation.configured) return "待配置";
  const translatable = section.blocks.filter((block) => block.blockType !== "heading");
  if (translatable.length === 0) return "已解析";
  const translated = translatable.filter((block) => block.translatedText).length;
  if (translated === translatable.length) return "已翻译";
  if (translated > 0) return `${translated}/${translatable.length}`;
  return "待翻译";
}

function translationText(block: BlockDto, translation: TranslationStatus) {
  if (block.translationError) return block.translationError;
  if (block.translatedText) return block.translatedText;
  return translation.configured ? "待翻译" : "未配置翻译接口";
}

function progressPercent(progress: TranslationProgressState | null) {
  if (!progress || progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.completed / progress.total) * 100));
}

function isLongTextBlock(block: BlockDto) {
  return ["directions", "passage", "paragraph", "translation_prompt"].includes(block.blockType);
}

function blockPassage(block: BlockDto): Passage {
  return parsePassageJson(block.paragraphsJson, {
    id: block.id,
    en: block.originalText,
    zh: block.translatedText
  });
}

function displayZh(text: string, block: BlockDto, translation: TranslationStatus) {
  return text.trim() || translationText(block, translation);
}

function shouldShowQuestionTranslation(mode: ReaderMode) {
  return mode === "parallel" || mode === "sentence";
}

function shouldShowWordBankTranslation(mode: ReaderMode) {
  return mode !== "hideChinese";
}

function alphabeticLabelRank(block: BlockDto) {
  const label = block.optionLabel?.trim().toUpperCase() || block.originalText.match(/^\s*([A-Z])\)/)?.[1] || "";
  if (!/^[A-Z]$/.test(label)) return Number.POSITIVE_INFINITY;
  return label.charCodeAt(0) - "A".charCodeAt(0);
}

function translationPromptText(block: BlockDto, translation: TranslationStatus) {
  if (block.translationError) return block.translationError;
  if (block.translatedText?.trim()) return block.translatedText;
  return translation.configured ? "待翻译/待生成参考译文" : "未配置翻译接口";
}

function normalizeDisplayText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeLookupWord(word: string) {
  return word.toLowerCase().replace(/^['-]+|['-]+$/g, "");
}

function compactContext(text: string) {
  return normalizeDisplayText(text).slice(0, 220);
}

function vocabularyStorageKey(paperId: string) {
  return `cet6:vocabulary:${paperId}`;
}

function loadStoredVocabulary(paperId: string): VocabularyCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(vocabularyStorageKey(paperId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as VocabularyCard[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((card) => card.id && card.word).slice(0, 200);
  } catch {
    return [];
  }
}

function saveStoredVocabulary(paperId: string, cards: VocabularyCard[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(vocabularyStorageKey(paperId), JSON.stringify(cards.slice(0, 200)));
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "cet6-vocabulary";
}

async function lookupWordTranslation(word: string) {
  const normalized = normalizeLookupWord(word);
  const cached = wordLookupCache.get(normalized);
  if (cached) return cached;

  const response = await fetch(`/api/words/translate?word=${encodeURIComponent(word)}`, {
    cache: "no-store"
  });
  const data = (await response.json()) as { translation?: string; error?: string };
  if (!response.ok || !data.translation) {
    throw new Error(data.error ?? "翻译失败");
  }
  wordLookupCache.set(normalized, data.translation);
  return data.translation;
}

function splitTextByWords(text: string) {
  const parts: Array<{ text: string; word?: string }> = [];
  let cursor = 0;

  for (const match of text.matchAll(wordPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ text: text.slice(cursor, index) });
    }
    parts.push({ text: match[0], word: match[0] });
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor) });
  }

  return parts;
}

function isBareQuestionNumberText(text: string) {
  return /^\d{1,2}\.$/.test(normalizeDisplayText(text));
}

function isResidualNoiseBlock(block: BlockDto) {
  const text = normalizeDisplayText(block.originalText);
  return block.blockType === "paragraph" && /^(?:\(\d+\s+minutes\)\s*)+(?:with)?$/i.test(text);
}

function TranslatedMiniBlock({
  block,
  translation,
  showTranslation,
  onWordTooltip,
  onWordCollect,
  className = ""
}: {
  block: BlockDto;
  translation: TranslationStatus;
  showTranslation: boolean;
  onWordTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onWordCollect: (word: string, context: string) => void;
  className?: string;
}) {
  const rawTranslation = block.translationError || block.translatedText?.trim();
  const hasDistinctTranslation =
    Boolean(rawTranslation) && normalizeDisplayText(rawTranslation ?? "") !== normalizeDisplayText(block.originalText);
  const shouldRenderTranslation =
    showTranslation && (hasDistinctTranslation || (!rawTranslation && !isBareQuestionNumberText(block.originalText)));

  return (
    <div className={`translated-mini-block ${className}`.trim()}>
      <div className="mini-source">
        <HoverableEnglishText text={block.originalText} onTooltip={onWordTooltip} onCollect={onWordCollect} />
      </div>
      {shouldRenderTranslation ? (
        <div className={`mini-translation ${block.translationError ? "error" : ""}`}>
          {translationText(block, translation)}
        </div>
      ) : null}
    </div>
  );
}

function WordTooltip({ tooltip }: { tooltip: ActiveWordTooltip }) {
  return (
    <div
      className={`floating-word-tooltip ${tooltip.status}`}
      style={{
        left: tooltip.x,
        top: tooltip.y
      }}
    >
      {tooltip.status === "loading" ? "翻译中..." : tooltip.translation ?? tooltip.error}
    </div>
  );
}

function HoverWord({
  word,
  context,
  onTooltip,
  onCollect
}: {
  word: string;
  context: string;
  onTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onCollect: (word: string, context: string) => void;
}) {
  const hoverTimer = useRef<number | null>(null);
  const normalized = normalizeLookupWord(word);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    };
  }, []);

  async function lookupWord(target: HTMLSpanElement) {
    if (!normalized || normalized.length <= 1) return;
    const rect = target.getBoundingClientRect();
    const position = {
      x: rect.left + rect.width / 2,
      y: rect.top - 8
    };

    onTooltip({ word, ...position, status: "loading" });
    try {
      const translation = await lookupWordTranslation(word);
      onTooltip({ word, ...position, status: "ready", translation });
    } catch (error) {
      onTooltip({
        word,
        ...position,
        status: "error",
        error: error instanceof Error ? error.message : "翻译失败"
      });
    }
  }

  return (
    <span
      className="hover-word"
      data-word={word}
      title="停留查看释义，单击加入生词"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onMouseEnter={(event) => {
        if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
        const target = event.currentTarget;
        hoverTimer.current = window.setTimeout(() => {
          void lookupWord(target);
        }, WORD_LOOKUP_DELAY_MS);
      }}
      onMouseLeave={() => {
        if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
        onTooltip(null);
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
        onTooltip(null);
        onCollect(word, context);
      }}
    />
  );
}

function HoverableEnglishText({
  text,
  onTooltip,
  onCollect
}: {
  text: string;
  onTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onCollect: (word: string, context: string) => void;
}) {
  return (
    <span className="hoverable-text">
      <span className="hoverable-plain">
        {text}
      </span>
      <span className="hoverable-overlay" aria-hidden="true">
        {splitTextByWords(text).map((part, index) =>
          part.word ? (
            <HoverWord
              key={`${part.word}-${index}`}
              word={part.word}
              context={text}
              onTooltip={onTooltip}
              onCollect={onCollect}
            />
          ) : (
            <span key={index} className="hover-text-gap" data-text={part.text} />
          )
        )}
      </span>
    </span>
  );
}

export function Reader({
  initialPaper,
  initialSections,
  initialTranslation,
  initialTranslationConfig
}: {
  initialPaper: PaperSummary;
  initialSections: SectionDto[];
  initialTranslation: TranslationStatus;
  initialTranslationConfig: TranslationConfig;
}) {
  const [paper, setPaper] = useState(initialPaper);
  const [sections, setSections] = useState<SectionDto[]>(initialSections);
  const [translation, setTranslation] = useState(initialTranslation);
  const [translationConfig, setTranslationConfig] = useState(initialTranslationConfig);
  const [isTranslationSettingsOpen, setIsTranslationSettingsOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState<SelectedSection>("ALL");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ReaderMode>("parallel");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgressState | null>(null);
  const [activeWordTooltip, setActiveWordTooltip] = useState<ActiveWordTooltip | null>(null);
  const [vocabularyCards, setVocabularyCards] = useState<VocabularyCard[]>([]);
  const [hasLoadedVocabulary, setHasLoadedVocabulary] = useState(false);
  const lastTranslationCompleted = useRef(0);

  const fetchSections = useCallback(async () => {
    const response = await fetch(`/api/papers/${initialPaper.id}/blocks`, {
      cache: "no-store"
    });
    const data = (await response.json()) as {
      sections?: SectionDto[];
      translation?: TranslationStatus;
    };
    if (response.ok) {
      setSections(data.sections ?? []);
      if (data.translation) setTranslation(data.translation);
    }
  }, [initialPaper.id]);

  useEffect(() => {
    if (paper.status === "READY" || paper.status === "FAILED") return;

    const events = new EventSource(`/api/papers/${initialPaper.id}/events`);
    events.addEventListener("status", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as {
        status: PaperStatus;
        progress: number;
        error?: string | null;
      };

      setPaper((current) => ({
        ...current,
        status: data.status,
        progress: data.progress,
        error: data.error
      }));

      if (data.progress >= 52) {
        void fetchSections();
      }

      if (data.status === "READY" || data.status === "FAILED") {
        void fetchSections();
        events.close();
      }
    });

    events.addEventListener("error", () => {
      events.close();
    });

    return () => events.close();
  }, [fetchSections, initialPaper.id, paper.status]);

  useEffect(() => {
    if (!isTranslating && translationProgress?.status !== "running") return;

    let cancelled = false;
    const interval = window.setInterval(() => void pollProgress(), 1200);

    async function pollProgress() {
      const response = await fetch(`/api/papers/${initialPaper.id}/translate`, {
        cache: "no-store"
      });
      const data = (await response.json()) as { progress?: TranslationProgressState };
      if (!response.ok || !data.progress || cancelled) return;

      setTranslationProgress(data.progress);
      if (data.progress.completed !== lastTranslationCompleted.current) {
        lastTranslationCompleted.current = data.progress.completed;
        void fetchSections();
      }

      if (data.progress.status === "finished" || data.progress.status === "failed") {
        setIsTranslating(false);
        void fetchSections();
        window.clearInterval(interval);
      }
    }

    void pollProgress();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [fetchSections, initialPaper.id, isTranslating, translationProgress?.status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedCards = loadStoredVocabulary(initialPaper.id);
      setVocabularyCards((current) => (current.length > 0 ? current : storedCards));
      setHasLoadedVocabulary(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialPaper.id]);

  useEffect(() => {
    if (!hasLoadedVocabulary) return;
    saveStoredVocabulary(initialPaper.id, vocabularyCards);
  }, [hasLoadedVocabulary, initialPaper.id, vocabularyCards]);

  useEffect(() => {
    function closeTooltip() {
      setActiveWordTooltip(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeTooltip();
    }

    window.addEventListener("scroll", closeTooltip, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", closeTooltip, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const visibleSections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sections
      .filter((section) => selectedSection === "ALL" || section.id === selectedSection)
      .map((section) => {
        if (!normalizedQuery) return section;
        return {
          ...section,
          blocks: section.blocks.filter(
            (block) =>
              block.originalText.toLowerCase().includes(normalizedQuery) ||
              block.translatedText?.toLowerCase().includes(normalizedQuery) ||
              String(block.pageNumber) === normalizedQuery ||
              String(block.questionNumber ?? "") === normalizedQuery
          )
        };
      })
      .filter((section) => section.blocks.length > 0 || !normalizedQuery);
  }, [query, sections, selectedSection]);

  const directoryGroups = useMemo(
    () => [
      { label: "写作", sections: sections.filter((section) => section.type === "writing") },
      { label: "听力", sections: sections.filter((section) => section.type === "listening") },
      {
        label: "阅读",
        sections: sections.filter((section) =>
          ["reading_bank", "reading_matching", "reading_careful"].includes(section.type)
        )
      },
      { label: "翻译", sections: sections.filter((section) => section.type === "translation") },
      { label: "未分类", sections: sections.filter((section) => section.type === "unknown") }
    ],
    [sections]
  );

  const searchScopeText = useMemo(() => {
    if (selectedSection === "ALL") return "当前搜索范围：全部";
    const section = sections.find((item) => item.id === selectedSection);
    return `当前搜索范围：${section?.title ?? "当前章节"}`;
  }, [sections, selectedSection]);

  async function updateSectionType(sectionId: string, type: SectionType) {
    setSections((current) =>
      current.map((section) => (section.id === sectionId ? { ...section, type } : section))
    );

    await fetch(`/api/sections/${sectionId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ type })
    });
  }

  async function retranslate() {
    setIsTranslating(true);
    lastTranslationCompleted.current = 0;
    setTranslationProgress({
      paperId: initialPaper.id,
      status: "running",
      total: 0,
      completed: 0,
      cached: 0,
      translated: 0,
      failed: 0,
      batchesDone: 0,
      batchesTotal: 0,
      message: "正在启动翻译任务"
    });
    try {
      const response = await fetch(`/api/papers/${initialPaper.id}/translate`, {
        method: "POST"
      });
      const data = (await response.json()) as {
        translation?: TranslationStatus;
        progress?: TranslationProgressState;
      };
      if (data.translation) setTranslation(data.translation);
      if (data.progress) setTranslationProgress(data.progress);
      if (response.ok && data.progress?.status !== "running") await fetchSections();
    } finally {
      setIsTranslating(false);
    }
  }

  const translationPercent = progressPercent(translationProgress);
  const translationRunning = isTranslating || translationProgress?.status === "running";

  const addVocabularyWord = useCallback((word: string, context: string) => {
    const normalized = normalizeLookupWord(word);
    if (!normalized || normalized.length <= 1) return;

    const timestamp = new Date().toISOString();
    const compactedContext = compactContext(context);
    let shouldLookup = true;

    setVocabularyCards((current) => {
      const existing = current.find((card) => card.id === normalized);
      if (existing?.status === "ready") {
        shouldLookup = false;
      }

      const nextCard: VocabularyCard = existing
        ? {
            ...existing,
            word,
            context: compactedContext || existing.context,
            count: existing.count + 1,
            updatedAt: timestamp,
            status: existing.status === "ready" ? "ready" : "loading",
            error: undefined
          }
        : {
            id: normalized,
            word,
            translation: "",
            status: "loading",
            context: compactedContext,
            count: 1,
            updatedAt: timestamp
          };

      return [nextCard, ...current.filter((card) => card.id !== normalized)].slice(0, 200);
    });

    if (!shouldLookup) return;

    void lookupWordTranslation(word)
      .then((meaning) => {
        setVocabularyCards((current) =>
          current.map((card) =>
            card.id === normalized
              ? {
                  ...card,
                  translation: meaning,
                  status: "ready",
                  error: undefined,
                  updatedAt: new Date().toISOString()
                }
              : card
          )
        );
      })
      .catch((error) => {
        setVocabularyCards((current) =>
          current.map((card) =>
            card.id === normalized
              ? {
                  ...card,
                  status: "error",
                  error: error instanceof Error ? error.message : "翻译失败",
                  updatedAt: new Date().toISOString()
                }
              : card
          )
        );
      });
  }, []);

  function removeVocabularyCard(id: string) {
    setVocabularyCards((current) => current.filter((card) => card.id !== id));
  }

  function exportVocabularyCards() {
    if (vocabularyCards.length === 0) return;
    const header = ["单词", "释义", "上下文", "次数", "状态"];
    const rows = vocabularyCards.map((card) => [
      card.word,
      card.translation || card.error || "",
      card.context ?? "",
      String(card.count),
      card.status
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(paper.title)}-生词卡片.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="reader-shell">
      {activeWordTooltip ? <WordTooltip tooltip={activeWordTooltip} /> : null}
      {isTranslationSettingsOpen ? (
        <TranslationConfigDialog
          initialConfig={translationConfig}
          initialStatus={translation}
          onClose={() => setIsTranslationSettingsOpen(false)}
          onSaved={(nextConfig, nextStatus) => {
            setTranslationConfig(nextConfig);
            setTranslation(nextStatus);
          }}
        />
      ) : null}
      <section className="reader-toolbar">
        <div className="paper-title-group">
          <strong>{paper.title}</strong>
          {paper.error ? <span className="reader-error">{paper.error}</span> : null}
        </div>
        <div className="search-area">
          <div className="search-box">
            <Search size={17} aria-hidden />
            <input
              value={query}
              placeholder="搜索原文、中文、题号或页码"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <span className="search-scope">{searchScopeText}</span>
        </div>
        <div className="mode-group" aria-label="阅读模式">
          {modeOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                title={option.title}
                className={`mode-button ${mode === option.value ? "active" : ""}`}
                onClick={() => setMode(option.value)}
              >
                <Icon size={17} aria-hidden />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        <div className={`status-pill ${paper.status === "READY" ? "ready" : ""} ${paper.status === "FAILED" ? "failed" : ""}`}>
          <StageIcon status={paper.status} />
          {statusText(paper.status)}
        </div>
        <button
          className={`translation-status ${translation.configured ? "ready" : "missing"}`}
          type="button"
          onClick={() => setIsTranslationSettingsOpen(true)}
          title="配置 OpenAI 兼容翻译接口和模型"
        >
          {translation.message}
        </button>
        <button
          className="icon-text-button"
          type="button"
          disabled={translationRunning || !translation.configured}
          onClick={() => void retranslate()}
          title={translation.configured ? "重新翻译" : "未配置翻译接口"}
        >
          {translationRunning ? <Loader2 size={16} aria-hidden /> : <RefreshCw size={16} aria-hidden />}
          重新翻译
        </button>
        <div className="progress-track" aria-label="处理进度">
          <div className="progress-bar" style={{ width: `${paper.progress}%` }} />
        </div>
      </section>

      {translationProgress && translationProgress.status !== "idle" ? (
        <section className={`translation-progress-panel ${translationProgress.status}`}>
          <div className="translation-progress-copy">
            <strong>{translationProgress.message}</strong>
            <span>
              {translationProgress.total > 0
                ? `${translationProgress.completed}/${translationProgress.total} 个学习单元`
                : "正在准备翻译内容"}
              {translationProgress.batchesTotal > 0
                ? ` · 批次 ${translationProgress.batchesDone}/${translationProgress.batchesTotal}`
                : ""}
            </span>
          </div>
          <div className="translation-progress-meter" aria-label="翻译进度">
            <div style={{ width: `${translationPercent}%` }} />
          </div>
          <div className="translation-progress-stats">
            <span>{translationPercent}%</span>
            <span>缓存 {translationProgress.cached}</span>
            <span>新译 {translationProgress.translated}</span>
            <span>失败 {translationProgress.failed}</span>
          </div>
        </section>
      ) : null}

      <div className="mobile-section-switcher">
        <label>
          <span>章节</span>
          <select
            value={selectedSection}
            onChange={(event) => setSelectedSection(event.target.value as SelectedSection)}
            aria-label="选择章节"
          >
            <option value="ALL">全部 · {sections.length} 节</option>
            {directoryGroups.map((group) =>
              group.sections.length > 0 ? (
                <optgroup label={group.label} key={group.label}>
                  {group.sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.title} · {questionRange(section)} · {pageRange(section)}
                    </option>
                  ))}
                </optgroup>
              ) : null
            )}
          </select>
        </label>
        <span>{searchScopeText}</span>
      </div>

      <div className="study-workspace">
        <VocabularyPanel
          cards={vocabularyCards}
          onExport={exportVocabularyCards}
          onRemove={removeVocabularyCard}
          onClear={() => setVocabularyCards([])}
        />

        <aside className="study-sidebar">
          <button
            type="button"
            className={`directory-button all ${selectedSection === "ALL" ? "active" : ""}`}
            onClick={() => setSelectedSection("ALL")}
          >
            <span>全部</span>
            <span>{sections.length} 节</span>
          </button>
          {directoryGroups.map((group) =>
            group.sections.length > 0 ? (
              <div className="directory-group" key={group.label}>
                <div className="directory-heading">{group.label}</div>
                {group.sections.map((section) => {
                  const Icon = sectionIcon(section.type);
                  return (
                    <button
                      key={section.id}
                      type="button"
                      className={`directory-button ${selectedSection === section.id ? "active" : ""}`}
                      onClick={() => setSelectedSection(section.id)}
                    >
                      <Icon size={16} aria-hidden />
                      <span className="directory-main">
                        <span>{section.title}</span>
                        <span className="directory-meta">
                          {questionRange(section)} · {pageRange(section)}
                        </span>
                      </span>
                      <span className="directory-state">{sectionTranslationProgress(section, translation)}</span>
                    </button>
                  );
                })}
              </div>
            ) : null
          )}
        </aside>

                <section className="study-surface">
          {visibleSections.length === 0 ? (
            <div className="empty-state">暂无内容</div>
          ) : (
            visibleSections.map((section) => (
              <StudySection
                key={section.id}
                section={section}
                mode={mode}
                translation={translation}
                onWordTooltip={setActiveWordTooltip}
                onWordCollect={addVocabularyWord}
                onTypeChange={(type) => void updateSectionType(section.id, type)}
              />
            ))
          )}
        </section>
      </div>
    </main>
  );
}

function VocabularyPanel({
  cards,
  onExport,
  onRemove,
  onClear
}: {
  cards: VocabularyCard[];
  onExport: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const readyCount = cards.filter((card) => card.status === "ready").length;

  return (
    <aside className="vocabulary-sidebar" aria-label="生词卡片">
      <section className="vocab-panel">
        <header className="vocab-head">
          <div>
            <p>生词卡片</p>
            <strong>{cards.length} 个</strong>
          </div>
          <span>{readyCount} 已完成</span>
        </header>
        {cards.length > 0 ? (
          <div className="vocab-list">
            {cards.map((card) => (
              <article className={`vocab-card ${card.status}`} key={card.id}>
                <div className="vocab-card-head">
                  <strong>{card.word}</strong>
                  <button type="button" title="移除" onClick={() => onRemove(card.id)}>
                    <X size={14} aria-hidden />
                  </button>
                </div>
                <p className="vocab-meaning">
                  {card.status === "loading" ? "翻译中..." : card.translation || card.error}
                </p>
                {card.context ? <p className="vocab-context">{card.context}</p> : null}
                {card.count > 1 ? <span className="vocab-count">出现 {card.count} 次</span> : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="vocab-empty">暂无生词</div>
        )}
        <div className="vocab-actions">
          <button className="icon-text-button" type="button" disabled={cards.length === 0} onClick={onExport}>
            <Download size={15} aria-hidden />
            导出卡片
          </button>
          <button className="vocab-clear-button" type="button" disabled={cards.length === 0} onClick={onClear} title="清空">
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      </section>
    </aside>
  );
}

function TranslationConfigDialog({
  initialConfig,
  initialStatus,
  onClose,
  onSaved
}: {
  initialConfig: TranslationConfig;
  initialStatus: TranslationStatus;
  onClose: () => void;
  onSaved: (config: TranslationConfig, status: TranslationStatus) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialConfig.baseUrl);
  const [apiMode, setApiMode] = useState(initialConfig.apiMode);
  const [translationModel, setTranslationModel] = useState(initialConfig.translationModel);
  const [maskedApiKey, setMaskedApiKey] = useState(initialConfig.maskedApiKey);
  const [status, setStatus] = useState(initialStatus);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isProbing, setIsProbing] = useState(false);

  async function probeModels() {
    setIsProbing(true);
    setProbeMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/settings/translation/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey || undefined,
          baseUrl
        })
      });
      const data = (await response.json()) as { models?: string[]; error?: string };
      if (!response.ok || !data.models) {
        throw new Error(data.error ?? "识别模型失败");
      }
      setAvailableModels(data.models);
      if (!data.models.includes(translationModel)) {
        setTranslationModel(data.models[0] ?? translationModel);
      }
      setProbeMessage(`已识别 ${data.models.length} 个模型`);
    } catch (probeError) {
      setAvailableModels([]);
      setProbeMessage(null);
      setError(probeError instanceof Error ? probeError.message : "识别模型失败");
    } finally {
      setIsProbing(false);
    }
  }

  async function save() {
    setIsSaving(true);
    setError(null);
    setProbeMessage(null);
    try {
      const response = await fetch("/api/settings/translation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          baseUrl,
          apiMode,
          translationModel
        })
      });
      const data = (await response.json()) as {
        error?: string;
        config?: TranslationConfig;
        translation?: TranslationStatus;
      };
      if (!response.ok || !data.config || !data.translation) {
        throw new Error(data.error ?? "保存失败");
      }

      setMaskedApiKey(data.config.maskedApiKey);
      setStatus(data.translation);
      setApiKey("");
      onSaved(data.config, data.translation);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="translation-modal-backdrop" onMouseDown={onClose}>
      <section className="translation-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="translation-modal-header">
          <div>
            <p>翻译接口配置</p>
            <h2>{status.message}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="settings-form modal-form">
          <label className="settings-field">
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              placeholder={maskedApiKey ? `留空则沿用已保存：${maskedApiKey}` : "sk-..."}
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <label className="settings-field">
            <span>Base URL</span>
            <input
              value={baseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <div className="settings-row">
            <label className="settings-field">
              <span>模式</span>
              <select value={apiMode} onChange={(event) => setApiMode(event.target.value as TranslationConfig["apiMode"])}>
                <option value="chat">Chat 兼容</option>
                <option value="responses">Responses</option>
                <option value="auto">自动判断</option>
              </select>
            </label>
            <label className="settings-field">
              <span>模型</span>
              <input
                list="translation-model-options"
                value={translationModel}
                placeholder="先识别模型，或手动输入"
                onChange={(event) => setTranslationModel(event.target.value)}
              />
              <datalist id="translation-model-options">
                {availableModels.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={() => void probeModels()} disabled={isProbing}>
              {isProbing ? <Loader2 size={16} aria-hidden /> : <KeyRound size={16} aria-hidden />}
              识别模型
            </button>
            <button className="secondary-button" type="button" onClick={() => setAvailableModels([])} disabled={availableModels.length === 0}>
              清空列表
            </button>
          </div>
          {probeMessage ? <p className="config-message">{probeMessage}</p> : null}
          {error ? <p className="config-message error">{error}</p> : null}
          {availableModels.length > 0 ? (
            <section className="recognized-models" aria-label="已识别模型列表">
              <div className="recognized-models-head">
                <span>已识别模型</span>
                <strong>{availableModels.length}</strong>
              </div>
              <div className="recognized-model-grid">
                {availableModels.map((model) => (
                  <button
                    key={model}
                    type="button"
                    className={`recognized-model ${translationModel === model ? "active" : ""}`}
                    onClick={() => setTranslationModel(model)}
                    title={`选择 ${model}`}
                  >
                    <span>{model}</span>
                    {translationModel === model ? <strong>当前</strong> : null}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={onClose}>
              取消
            </button>
            <button className="secondary-button settings-save" type="button" disabled={isSaving} onClick={() => void save()}>
              {isSaving ? <Loader2 size={16} aria-hidden /> : <Save size={16} aria-hidden />}
              保存并应用
            </button>
          </div>
          <p className="settings-hint">
            识别模型会调用你填写的 OpenAI 兼容中转站的 `/models` 接口。API Key 留空时会沿用已有配置。
          </p>
        </div>
      </section>
    </div>
  );
}

function StudySection({
  section,
  mode,
  translation,
  onWordTooltip,
  onWordCollect,
  onTypeChange
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
  onWordTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onWordCollect: (word: string, context: string) => void;
  onTypeChange: (type: SectionType) => void;
}) {
  return (
    <article className="study-section">
      <header className="study-section-header">
        <div>
          <p>{sectionTypeLabels[section.type]}</p>
          <h1>{section.title}</h1>
          <span>
            {questionRange(section)} · {pageRange(section)}
          </span>
        </div>
        <select
          value={section.type}
          onChange={(event) => onTypeChange(event.target.value as SectionType)}
          title="修改 section 题型"
        >
          {sectionTypeOrder.map((type) => (
            <option key={type} value={type}>
              修改为：{sectionTypeShortLabels[type]}
            </option>
          ))}
        </select>
      </header>
      <SectionBody
        section={section}
        mode={mode}
        translation={translation}
        onWordTooltip={onWordTooltip}
        onWordCollect={onWordCollect}
      />
    </article>
  );
}

function SectionBody({
  section,
  mode,
  translation,
  onWordTooltip,
  onWordCollect
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
  onWordTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onWordCollect: (word: string, context: string) => void;
}) {
  if (section.type === "listening") {
    return <QuestionSection section={section} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />;
  }
  if (section.type === "reading_bank") {
    return <ReadingBank section={section} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />;
  }
  if (section.type === "reading_matching") {
    return <ReadingMatching section={section} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />;
  }
  if (section.type === "reading_careful") {
    return <QuestionSection section={section} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />;
  }
  if (section.type === "translation") {
    return <TranslationSection section={section} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />;
  }
  return <GeneralSection section={section} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />;
}

function GeneralSection({
  section,
  mode,
  translation,
  onWordTooltip,
  onWordCollect
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
  onWordTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onWordCollect: (word: string, context: string) => void;
}) {
  return (
    <div className="study-block-list">
      {section.blocks.map((block) => (
        <TextBlock key={block.id} block={block} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />
      ))}
    </div>
  );
}

function ReadingBank({
  section,
  mode,
  translation,
  onWordTooltip,
  onWordCollect
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
  onWordTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onWordCollect: (word: string, context: string) => void;
}) {
  const wordBank = [...section.blocks.filter((block) => block.blockType === "word_bank")].sort(
    (a, b) => alphabeticLabelRank(a) - alphabeticLabelRank(b) || a.orderIndex - b.orderIndex
  );
  const content = section.blocks.filter((block) => block.blockType !== "word_bank");
  const showTranslation = shouldShowWordBankTranslation(mode);

  return (
    <div className="study-block-list">
      {content.map((block) => (
        <TextBlock key={block.id} block={block} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />
      ))}
      {wordBank.length > 0 ? (
        <div className="word-bank-panel">
          <h2>Word Bank</h2>
          <div className="word-bank-grid">
            {wordBank.map((block) => (
              <TranslatedMiniBlock
                key={block.id}
                block={block}
                translation={translation}
                showTranslation={showTranslation}
                onWordTooltip={onWordTooltip}
                onWordCollect={onWordCollect}
                className="word-bank-item"
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReadingMatching({
  section,
  mode,
  translation,
  onWordTooltip,
  onWordCollect
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
  onWordTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onWordCollect: (word: string, context: string) => void;
}) {
  const paragraphs = section.blocks.filter((block) => block.blockType === "paragraph");
  const questions = section.blocks.filter((block) => block.blockType === "question");
  const other = section.blocks.filter(
    (block) => block.blockType !== "paragraph" && block.blockType !== "question"
  );
  const showTranslation = shouldShowQuestionTranslation(mode);

  return (
    <div className="matching-layout">
      <div className="study-block-list">
        {other.map((block) => (
          <TextBlock key={block.id} block={block} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />
        ))}
        {paragraphs.map((block) => (
          <TextBlock key={block.id} block={block} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />
        ))}
      </div>
      <div className="question-list-panel">
        <h2>36-45 匹配题</h2>
        {questions.map((block) => (
          <TranslatedMiniBlock
            key={block.id}
            block={block}
            translation={translation}
            showTranslation={showTranslation}
            onWordTooltip={onWordTooltip}
            onWordCollect={onWordCollect}
            className="match-question"
          />
        ))}
      </div>
    </div>
  );
}

function QuestionSection({
  section,
  mode,
  translation,
  onWordTooltip,
  onWordCollect
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
  onWordTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onWordCollect: (word: string, context: string) => void;
}) {
  const questionBlocks = new Set(
    section.blocks
      .filter((block) => block.blockType === "question" || block.blockType === "option")
      .map((block) => block.id)
  );
  const leadingBlocks = section.blocks.filter(
    (block) => !questionBlocks.has(block.id) && !isResidualNoiseBlock(block)
  );
  const showTranslation = shouldShowQuestionTranslation(mode);

  return (
    <div className="study-block-list">
      {leadingBlocks.map((block) => (
        <TextBlock key={block.id} block={block} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />
      ))}
      {groupQuestionBlocks(section.blocks).map(([number, group]) => (
        <div className="question-card" key={number}>
          {group.question ? (
            <TranslatedMiniBlock
              block={group.question}
              translation={translation}
              showTranslation={showTranslation}
              onWordTooltip={onWordTooltip}
              onWordCollect={onWordCollect}
              className="question-title"
            />
          ) : (
            <div className="question-title">{number}.</div>
          )}
          <div className="option-grid">
            {group.options.map((option) => (
              <TranslatedMiniBlock
                key={option.id}
                block={option}
                translation={translation}
                showTranslation={showTranslation}
                onWordTooltip={onWordTooltip}
                onWordCollect={onWordCollect}
                className="option-item"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TranslationSection({
  section,
  mode,
  translation,
  onWordTooltip,
  onWordCollect
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
  onWordTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onWordCollect: (word: string, context: string) => void;
}) {
  const promptBlocks = section.blocks.filter((block) => block.blockType === "translation_prompt");
  const supportingBlocks = section.blocks.filter((block) => block.blockType !== "translation_prompt");

  return (
    <div className="study-block-list">
      {supportingBlocks.map((block) => (
        <TextBlock key={block.id} block={block} mode={mode} translation={translation} onWordTooltip={onWordTooltip} onWordCollect={onWordCollect} />
      ))}
      {promptBlocks.map((block) => {
        const passage = blockPassage(block);
        return (
          <div className="study-block translation-source-card" key={block.id}>
            <h2>中文原文</h2>
            <div className="paragraph-stack">
              {passage.paragraphs.map((paragraph) => (
                <p className="reader-paragraph chinese-source" key={paragraph.id}>
                  {paragraph.en}
                </p>
              ))}
            </div>
          </div>
        );
      })}
      <div className="reference-panel">
        <h2>英文参考译文</h2>
        {promptBlocks.length > 0 ? (
          promptBlocks.map((block) => (
            <p className={`reference-text ${block.translationError ? "error" : ""}`} key={block.id}>
              {translationPromptText(block, translation)}
            </p>
          ))
        ) : (
          <p className="reference-text">
            {translation.configured ? "待翻译/待生成参考译文" : "未配置翻译接口"}
          </p>
        )}
      </div>
    </div>
  );
}

function TextBlock({
  block,
  mode,
  translation,
  onWordTooltip,
  onWordCollect
}: {
  block: BlockDto;
  mode: ReaderMode;
  translation: TranslationStatus;
  onWordTooltip: (tooltip: ActiveWordTooltip | null) => void;
  onWordCollect: (word: string, context: string) => void;
}) {
  if (block.blockType === "heading") {
    return <h2 className="content-heading">{block.originalText}</h2>;
  }

  const passage = blockPassage(block);

  if (mode === "sentence" && isLongTextBlock(block)) {
    const sentencePairs = passage.paragraphs.flatMap((paragraph) => paragraph.sentences);
    return (
      <div className="study-block sentence-mode">
        {sentencePairs.map((sentence) => (
          <div className="sentence-pair" key={sentence.id}>
            <p className="reader-paragraph english">
              <HoverableEnglishText text={sentence.en} onTooltip={onWordTooltip} onCollect={onWordCollect} />
            </p>
            <p className="reader-paragraph translation">{displayZh(sentence.zh, block, translation)}</p>
          </div>
        ))}
      </div>
    );
  }

  if (mode === "parallel" || mode === "sentence") {
    return (
      <div className={`study-block parallel-block structured ${block.blockType}`}>
        {passage.paragraphs.map((paragraph) => (
          <div className="paragraph-pair" key={paragraph.id}>
            <p className="reader-paragraph english">
              <HoverableEnglishText text={paragraph.en} onTooltip={onWordTooltip} onCollect={onWordCollect} />
            </p>
            <p className="reader-paragraph translation">{displayZh(paragraph.zh, block, translation)}</p>
          </div>
        ))}
      </div>
    );
  }

  if (mode === "hideChinese" || mode === "original") {
    return (
      <div className={`study-block ${block.blockType}`}>
        <div className="paragraph-stack">
          {passage.paragraphs.map((paragraph) => (
            <p className="reader-paragraph english" key={paragraph.id}>
              <HoverableEnglishText text={paragraph.en} onTooltip={onWordTooltip} onCollect={onWordCollect} />
            </p>
          ))}
        </div>
        {mode === "hideChinese" ? <p className="translation hidden-copy">中文已隐藏</p> : null}
      </div>
    );
  }

  return null;
}
