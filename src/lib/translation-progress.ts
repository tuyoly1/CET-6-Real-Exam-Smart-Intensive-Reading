export type TranslationRunStatus = "idle" | "running" | "finished" | "failed";

export type TranslationProgressState = {
  paperId: string;
  status: TranslationRunStatus;
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

const EMPTY_PROGRESS: Omit<TranslationProgressState, "paperId"> = {
  status: "idle",
  total: 0,
  completed: 0,
  cached: 0,
  translated: 0,
  failed: 0,
  batchesDone: 0,
  batchesTotal: 0,
  message: "尚未开始翻译"
};

declare global {
  var __cet6TranslationProgress:
    | Map<string, TranslationProgressState>
    | undefined;
}

const store = globalThis.__cet6TranslationProgress ?? new Map<string, TranslationProgressState>();
globalThis.__cet6TranslationProgress = store;

function nowIso() {
  return new Date().toISOString();
}

export function getTranslationProgress(paperId: string): TranslationProgressState {
  return store.get(paperId) ?? { paperId, ...EMPTY_PROGRESS };
}

export function startTranslationProgress(paperId: string, total: number) {
  const timestamp = nowIso();
  const state: TranslationProgressState = {
    paperId,
    status: "running",
    total,
    completed: 0,
    cached: 0,
    translated: 0,
    failed: 0,
    batchesDone: 0,
    batchesTotal: 0,
    message: total > 0 ? "正在检查翻译缓存" : "没有需要翻译的内容",
    startedAt: timestamp,
    updatedAt: timestamp
  };
  store.set(paperId, state);
  return state;
}

export function updateTranslationProgress(
  paperId: string,
  patch: Partial<Omit<TranslationProgressState, "paperId" | "startedAt">>
) {
  const current = getTranslationProgress(paperId);
  const next: TranslationProgressState = {
    ...current,
    ...patch,
    updatedAt: nowIso()
  };
  store.set(paperId, next);
  return next;
}

export function finishTranslationProgress(paperId: string, message = "翻译完成") {
  const timestamp = nowIso();
  const current = getTranslationProgress(paperId);
  const next: TranslationProgressState = {
    ...current,
    status: "finished",
    completed: current.total,
    message,
    updatedAt: timestamp,
    finishedAt: timestamp
  };
  store.set(paperId, next);
  return next;
}

export function failTranslationProgress(paperId: string, message: string) {
  const timestamp = nowIso();
  const current = getTranslationProgress(paperId);
  const next: TranslationProgressState = {
    ...current,
    status: "failed",
    message,
    updatedAt: timestamp,
    finishedAt: timestamp
  };
  store.set(paperId, next);
  return next;
}
