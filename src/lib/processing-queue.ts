import { processPaper } from "@/lib/processor";
import os from "node:os";

type QueueEntry = {
  paperId: string;
  started: Promise<void>;
};

const queue: string[] = [];
const active = new Map<string, QueueEntry>();
let running = false;
function defaultConcurrency() {
  const cpuCount = os.cpus().length || 1;
  if (cpuCount >= 8) return 2;
  if (cpuCount >= 4) return 2;
  return 1;
}

function processingConcurrency() {
  const configured = process.env.IMPORT_PROCESSING_CONCURRENCY?.trim();
  if (configured) {
    const value = Number(configured);
    if (Number.isFinite(value) && value > 0) return Math.max(1, Math.floor(value));
  }
  return defaultConcurrency();
}

const MAX_CONCURRENCY = processingConcurrency();

async function runNext() {
  if (running) return;
  running = true;
  try {
    while (active.size < MAX_CONCURRENCY && queue.length > 0) {
      const paperId = queue.shift();
      if (!paperId || active.has(paperId)) continue;
      const started = processPaper(paperId)
        .catch((error) => {
          console.error("Queued paper processing failed", error);
        })
        .finally(() => {
          active.delete(paperId);
          void runNext();
        });
      active.set(paperId, { paperId, started });
    }
  } finally {
    running = false;
  }

  if (queue.length > 0 && active.size < MAX_CONCURRENCY) {
    void runNext();
  }
}

export function enqueuePaperProcessing(paperId: string) {
  if (active.has(paperId) || queue.includes(paperId)) return;
  queue.push(paperId);
  void runNext();
}
