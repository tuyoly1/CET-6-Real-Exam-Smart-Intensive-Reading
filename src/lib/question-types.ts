export const sectionTypes = [
  "writing",
  "listening",
  "reading_bank",
  "reading_matching",
  "reading_careful",
  "translation",
  "unknown"
] as const;

export type SectionType = (typeof sectionTypes)[number];

export const sectionTypeLabels: Record<SectionType, string> = {
  writing: "写作",
  listening: "听力",
  reading_bank: "阅读 Section A 选词填空",
  reading_matching: "阅读 Section B 长篇匹配",
  reading_careful: "阅读 Section C 仔细阅读",
  translation: "翻译",
  unknown: "未分类"
};

export const sectionTypeShortLabels: Record<SectionType, string> = {
  writing: "写作",
  listening: "听力",
  reading_bank: "选词填空",
  reading_matching: "长篇匹配",
  reading_careful: "仔细阅读",
  translation: "翻译",
  unknown: "未分类"
};

export const sectionTypeOrder: SectionType[] = [
  "writing",
  "listening",
  "reading_bank",
  "reading_matching",
  "reading_careful",
  "translation",
  "unknown"
];

export function isSectionType(value: string): value is SectionType {
  return sectionTypes.includes(value as SectionType);
}

export function sectionTypeFromQuestionNumber(questionNumber: number): SectionType {
  if (questionNumber >= 1 && questionNumber <= 25) return "listening";
  if (questionNumber >= 26 && questionNumber <= 35) return "reading_bank";
  if (questionNumber >= 36 && questionNumber <= 45) return "reading_matching";
  if (questionNumber >= 46 && questionNumber <= 55) return "reading_careful";
  return "unknown";
}

export function sectionTypeFromReadingSection(sectionLabel: string): SectionType {
  const normalized = sectionLabel.trim().toUpperCase();
  if (normalized === "A") return "reading_bank";
  if (normalized === "B") return "reading_matching";
  if (normalized === "C") return "reading_careful";
  return "unknown";
}

export function listeningSectionTitle(sectionLabel: string) {
  const normalized = sectionLabel.trim().toUpperCase();
  if (normalized === "A") return "Section A 长对话";
  if (normalized === "B") return "Section B 短文";
  if (normalized === "C") return "Section C 讲座";
  return `Section ${normalized}`;
}
