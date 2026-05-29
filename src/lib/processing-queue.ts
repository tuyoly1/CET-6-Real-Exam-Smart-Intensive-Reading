import { processPaper } from "@/lib/processor";

type QueueEntry = {
  paperId: string;
  started: Promise<void>;
};

const queue: string[] = [];
const active = new Map<string, QueueEntry>();
let running = false;
const MAX_CONCURRENCY = Math.max(1, Number(process.env.IMPORT_PROCESSING_CONCURRENCY ?? 1));

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
