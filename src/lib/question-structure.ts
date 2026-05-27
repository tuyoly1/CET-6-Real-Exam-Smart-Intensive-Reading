export type QuestionBlockLike = {
  blockType: string;
  questionNumber?: number | null;
  optionLabel?: string | null;
  orderIndex: number;
};

export function optionLabelRank(label: string | null | undefined) {
  if (!label) return Number.POSITIVE_INFINITY;
  const normalized = label.trim().toUpperCase();
  if (!/^[A-D]$/.test(normalized)) return Number.POSITIVE_INFINITY;
  return normalized.charCodeAt(0) - "A".charCodeAt(0);
}

export function groupQuestionBlocks<T extends QuestionBlockLike>(blocks: T[]) {
  const groups = new Map<number, { question?: T; options: T[] }>();
  for (const block of blocks) {
    if (typeof block.questionNumber !== "number") continue;
    const group = groups.get(block.questionNumber) ?? { options: [] };
    if (block.blockType === "question") group.question = block;
    if (block.blockType === "option") group.options.push(block);
    groups.set(block.questionNumber, group);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, group]) => [
      number,
      {
        ...group,
        options: [...group.options].sort(
          (a, b) => optionLabelRank(a.optionLabel) - optionLabelRank(b.optionLabel) || a.orderIndex - b.orderIndex
        )
      }
    ] as const);
}
