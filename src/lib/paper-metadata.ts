export type PaperKind = "exam" | "answer" | "other";

export type PaperMetadata = {
  year: string;
  month?: string;
  kind: PaperKind;
  kindLabel: string;
};

const MONTH_LABELS: Record<string, string> = {
  "01": "1月",
  "02": "2月",
  "03": "3月",
  "04": "4月",
  "05": "5月",
  "06": "6月",
  "07": "7月",
  "08": "8月",
  "09": "9月",
  "10": "10月",
  "11": "11月",
  "12": "12月"
};

function normalizeMonth(month: string) {
  return month.padStart(2, "0");
}

export function inferPaperMetadata(name: string): PaperMetadata {
  const normalized = name.replace(/\.pdf$/i, "");
  const yearMonth = normalized.match(/(20\d{2})\s*[年.\-_]?\s*(0?[1-9]|1[0-2])\s*月?/);
  const year = yearMonth?.[1] ?? normalized.match(/(20\d{2})/)?.[1] ?? "未识别年份";
  const month = yearMonth?.[2] ? normalizeMonth(yearMonth[2]) : undefined;

  const kind: PaperKind = /答案|解析|answer/i.test(normalized)
    ? "answer"
    : /真题|试题|卷[一二三四五六七八九十]|exam|paper/i.test(normalized)
      ? "exam"
      : "other";

  return {
    year,
    month,
    kind,
    kindLabel: kind === "exam" ? "真题" : kind === "answer" ? "答案解析" : "其他资料"
  };
}

export function paperPeriodLabel(metadata: Pick<PaperMetadata, "year" | "month">) {
  if (metadata.year === "未识别年份") return metadata.year;
  return metadata.month ? `${metadata.year}年${MONTH_LABELS[metadata.month] ?? `${Number(metadata.month)}月`}` : `${metadata.year}年`;
}
