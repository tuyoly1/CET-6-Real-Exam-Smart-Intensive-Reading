"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpenText,
  CheckCircle2,
  Columns2,
  Eye,
  EyeOff,
  Headphones,
  Languages,
  ListTree,
  Loader2,
  PenLine,
  RefreshCw,
  Search
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

function translationProgress(section: SectionDto, translation: TranslationStatus) {
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
  className = ""
}: {
  block: BlockDto;
  translation: TranslationStatus;
  showTranslation: boolean;
  className?: string;
}) {
  const rawTranslation = block.translationError || block.translatedText?.trim();
  const hasDistinctTranslation =
    Boolean(rawTranslation) && normalizeDisplayText(rawTranslation ?? "") !== normalizeDisplayText(block.originalText);
  const shouldRenderTranslation =
    showTranslation && (hasDistinctTranslation || (!rawTranslation && !isBareQuestionNumberText(block.originalText)));

  return (
    <div className={`translated-mini-block ${className}`.trim()}>
      <div className="mini-source">{block.originalText}</div>
      {shouldRenderTranslation ? (
        <div className={`mini-translation ${block.translationError ? "error" : ""}`}>
          {translationText(block, translation)}
        </div>
      ) : null}
    </div>
  );
}

export function Reader({
  initialPaper,
  initialSections,
  initialTranslation
}: {
  initialPaper: PaperSummary;
  initialSections: SectionDto[];
  initialTranslation: TranslationStatus;
}) {
  const [paper, setPaper] = useState(initialPaper);
  const [sections, setSections] = useState<SectionDto[]>(initialSections);
  const [translation, setTranslation] = useState(initialTranslation);
  const [selectedSection, setSelectedSection] = useState<SelectedSection>("ALL");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ReaderMode>("parallel");
  const [isTranslating, setIsTranslating] = useState(false);

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
    try {
      const response = await fetch(`/api/papers/${initialPaper.id}/translate`, {
        method: "POST"
      });
      const data = (await response.json()) as { translation?: TranslationStatus };
      if (data.translation) setTranslation(data.translation);
      if (response.ok) await fetchSections();
    } finally {
      setIsTranslating(false);
    }
  }

  return (
    <main className="reader-shell">
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
        <div className={`translation-status ${translation.configured ? "ready" : "missing"}`}>
          {translation.message}
        </div>
        <button
          className="icon-text-button"
          type="button"
          disabled={isTranslating || !translation.configured}
          onClick={() => void retranslate()}
          title={translation.configured ? "重新翻译" : "未配置翻译接口"}
        >
          {isTranslating ? <Loader2 size={16} aria-hidden /> : <RefreshCw size={16} aria-hidden />}
          重新翻译
        </button>
        <div className="progress-track" aria-label="处理进度">
          <div className="progress-bar" style={{ width: `${paper.progress}%` }} />
        </div>
      </section>

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
                      <span className="directory-state">{translationProgress(section, translation)}</span>
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
                onTypeChange={(type) => void updateSectionType(section.id, type)}
              />
            ))
          )}
        </section>
      </div>
    </main>
  );
}

function StudySection({
  section,
  mode,
  translation,
  onTypeChange
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
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
      <SectionBody section={section} mode={mode} translation={translation} />
    </article>
  );
}

function SectionBody({
  section,
  mode,
  translation
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
}) {
  if (section.type === "listening") {
    return <QuestionSection section={section} mode={mode} translation={translation} />;
  }
  if (section.type === "reading_bank") {
    return <ReadingBank section={section} mode={mode} translation={translation} />;
  }
  if (section.type === "reading_matching") {
    return <ReadingMatching section={section} mode={mode} translation={translation} />;
  }
  if (section.type === "reading_careful") {
    return <QuestionSection section={section} mode={mode} translation={translation} />;
  }
  if (section.type === "translation") {
    return <TranslationSection section={section} mode={mode} translation={translation} />;
  }
  return <GeneralSection section={section} mode={mode} translation={translation} />;
}

function GeneralSection({
  section,
  mode,
  translation
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
}) {
  return (
    <div className="study-block-list">
      {section.blocks.map((block) => (
        <TextBlock key={block.id} block={block} mode={mode} translation={translation} />
      ))}
    </div>
  );
}

function ReadingBank({
  section,
  mode,
  translation
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
}) {
  const wordBank = [...section.blocks.filter((block) => block.blockType === "word_bank")].sort(
    (a, b) => alphabeticLabelRank(a) - alphabeticLabelRank(b) || a.orderIndex - b.orderIndex
  );
  const content = section.blocks.filter((block) => block.blockType !== "word_bank");
  const showTranslation = shouldShowWordBankTranslation(mode);

  return (
    <div className="study-block-list">
      {content.map((block) => (
        <TextBlock key={block.id} block={block} mode={mode} translation={translation} />
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
  translation
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
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
          <TextBlock key={block.id} block={block} mode={mode} translation={translation} />
        ))}
        {paragraphs.map((block) => (
          <TextBlock key={block.id} block={block} mode={mode} translation={translation} />
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
  translation
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
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
        <TextBlock key={block.id} block={block} mode={mode} translation={translation} />
      ))}
      {groupQuestionBlocks(section.blocks).map(([number, group]) => (
        <div className="question-card" key={number}>
          {group.question ? (
            <TranslatedMiniBlock
              block={group.question}
              translation={translation}
              showTranslation={showTranslation}
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
  translation
}: {
  section: SectionDto;
  mode: ReaderMode;
  translation: TranslationStatus;
}) {
  const promptBlocks = section.blocks.filter((block) => block.blockType === "translation_prompt");
  const supportingBlocks = section.blocks.filter((block) => block.blockType !== "translation_prompt");

  return (
    <div className="study-block-list">
      {supportingBlocks.map((block) => (
        <TextBlock key={block.id} block={block} mode={mode} translation={translation} />
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
  translation
}: {
  block: BlockDto;
  mode: ReaderMode;
  translation: TranslationStatus;
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
            <p className="reader-paragraph english">{sentence.en}</p>
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
            <p className="reader-paragraph english">{paragraph.en}</p>
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
              {paragraph.en}
            </p>
          ))}
        </div>
        {mode === "hideChinese" ? <p className="translation hidden-copy">中文已隐藏</p> : null}
      </div>
    );
  }

  return null;
}
