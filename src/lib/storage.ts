import { mkdir } from "node:fs/promises";
import path from "node:path";

export const storageRoot = path.join(process.cwd(), "storage");
export const uploadsDir = path.join(storageRoot, "uploads");

export async function ensureStorage() {
  await mkdir(uploadsDir, { recursive: true });
}

export function uploadPathFor(paperId: string, originalName: string) {
  const safeName = originalName
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  return path.join(uploadsDir, `${paperId}-${safeName || "paper.pdf"}`);
}
