import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type TranslationConfigInput = {
  apiKey?: string;
  baseUrl?: string;
  apiMode?: "auto" | "chat" | "responses";
  translationModel?: string;
};

const CONFIG_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_MODE",
  "OPENAI_TRANSLATION_MODEL"
] as const;

function envPath() {
  return path.join(process.cwd(), ".env");
}

function parseEnvLine(line: string) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;
  return {
    key: match[1],
    value: match[2].replace(/^["']|["']$/g, "").trim()
  };
}

function readProjectEnv() {
  const filePath = envPath();
  if (!existsSync(filePath)) return { lines: [] as string[], values: new Map<string, string>() };

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const values = new Map<string, string>();
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (parsed) values.set(parsed.key, parsed.value);
  }
  return { lines, values };
}

function quoteEnvValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function maskKey(key: string | undefined) {
  if (!key) return "";
  if (key.length <= 10) return `${key.slice(0, 2)}****${key.slice(-2)}`;
  return `${key.slice(0, 6)}****${key.slice(-4)}`;
}

export function projectEnvValue(name: string) {
  const projectValue = readProjectEnv().values.get(name);
  if (projectValue !== undefined) return projectValue || undefined;
  return process.env[name]?.trim() || undefined;
}

export function getTranslationConfig() {
  const apiKey = projectEnvValue("OPENAI_API_KEY");
  const baseUrl = projectEnvValue("OPENAI_BASE_URL") ?? "";
  const apiModeValue = projectEnvValue("OPENAI_API_MODE") ?? "chat";
  const apiMode: "auto" | "chat" | "responses" =
    apiModeValue === "responses" || apiModeValue === "auto" ? apiModeValue : "chat";
  const translationModel = projectEnvValue("OPENAI_TRANSLATION_MODEL") ?? "gpt-4.1-mini";

  return {
    apiKeyConfigured: Boolean(apiKey),
    maskedApiKey: maskKey(apiKey),
    baseUrl,
    apiMode,
    translationModel
  };
}

export function saveTranslationConfig(input: TranslationConfigInput) {
  const { lines, values } = readProjectEnv();
  const nextValues = new Map(values);

  if (input.apiKey?.trim()) {
    nextValues.set("OPENAI_API_KEY", input.apiKey.trim());
  }
  if (input.baseUrl !== undefined) {
    nextValues.set("OPENAI_BASE_URL", input.baseUrl.trim());
  }
  if (input.apiMode !== undefined) {
    nextValues.set("OPENAI_API_MODE", input.apiMode);
  }
  if (input.translationModel !== undefined) {
    nextValues.set("OPENAI_TRANSLATION_MODEL", input.translationModel.trim());
  }

  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed || !CONFIG_KEYS.includes(parsed.key as (typeof CONFIG_KEYS)[number])) return line;

    seen.add(parsed.key);
    return `${parsed.key}=${quoteEnvValue(nextValues.get(parsed.key) ?? "")}`;
  });

  for (const key of CONFIG_KEYS) {
    if (!seen.has(key) && nextValues.has(key)) {
      nextLines.push(`${key}=${quoteEnvValue(nextValues.get(key) ?? "")}`);
    }
  }

  writeFileSync(envPath(), `${nextLines.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
  return getTranslationConfig();
}
