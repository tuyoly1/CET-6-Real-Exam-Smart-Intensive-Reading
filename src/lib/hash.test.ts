import { describe, expect, it } from "vitest";
import { normalizeTextForHash, textHash } from "@/lib/hash";

describe("hash", () => {
  it("normalizes text before hashing", () => {
    expect(normalizeTextForHash("  “Hello”   WORLD  ")).toBe('"hello" world');
    expect(textHash("Hello world")).toBe(textHash(" hello   WORLD "));
  });
});
