import { createHash } from "node:crypto";

export function normalizeTextForHash(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim()
    .toLowerCase();
}

export function textHash(text: string) {
  return createHash("sha256").update(normalizeTextForHash(text)).digest("hex");
}
