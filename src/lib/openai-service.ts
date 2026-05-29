import OpenAI from "openai";
import { z } from "zod";
import { projectEnvValue } from "@/lib/translation-config";

const translationResponseSchema = z.object({
  translations: z.array(
    z.object({
      blockId: z.string(),
      translation: z.string()
    })
  )
});

export type TranslationInput = {
  blockId: string;
  text: string;
};

export type ModelListInput = {
  apiKey?: string;
  baseUrl?: string;
};

export function translationInstructionsForStyle(style: string) {
  if (style === "word_lookup_zh") {
    return '你是大学英语六级备考词典。请把英文单词或短语翻译成简洁中文释义。要求：只给 1-3 个常用中文释义；必要时标注词性；不要造句；不要解释题目。只返回紧凑 JSON，格式为 {"translations":[{"blockId":"...","translation":"..."}]}。';
  }

  if (style === "cet6_cn_to_en_reference") {
    return '请将以下大学英语六级翻译题中文原文翻译成英文参考译文。要求：保留数字、专有名词和题目结构；英文表达自然，适合作为考试参考译文；不要添加解释、点评或额外标题。只返回紧凑 JSON，格式为 {"translations":[{"blockId":"...","translation":"..."}]}。';
  }

  return '请将以下大学英语六级试卷内容翻译成中文。要求：保留题号、选项编号、段落编号；不要改写题目结构；英文专有名词可保留；翻译要适合中国大学生备考理解；不要添加额外解释。只返回紧凑 JSON，格式为 {"translations":[{"blockId":"...","translation":"..."}]}。';
}

function configuredOpenAiKey() {
  const projectKey = projectEnvValue("OPENAI_API_KEY");
  if (projectKey !== undefined) return projectKey || undefined;
  return process.env.OPENAI_API_KEY?.trim() || undefined;
}

function configuredOpenAiBaseUrl() {
  const projectBaseUrl = projectEnvValue("OPENAI_BASE_URL");
  if (projectBaseUrl !== undefined) return projectBaseUrl || undefined;
  return process.env.OPENAI_BASE_URL?.trim() || undefined;
}

function normalizedBaseUrl(baseUrl: string | undefined) {
  return (baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/g, "");
}

function modelListUrls(baseUrl: string) {
  const primary = `${baseUrl}/models`;
  if (/\/v1$/i.test(baseUrl)) return [primary];
  return [primary, `${baseUrl}/v1/models`];
}

export function openAiApiMode() {
  const configuredMode = projectEnvValue("OPENAI_API_MODE") || process.env.OPENAI_API_MODE;
  if (configuredMode === "responses" || configuredMode === "chat") return configuredMode;

  const baseURL = configuredOpenAiBaseUrl();
  if (baseURL && !baseURL.includes("api.openai.com")) return "chat";
  return "responses";
}

export function hasOpenAiKey() {
  return Boolean(configuredOpenAiKey());
}

function getClient() {
  const baseURL = configuredOpenAiBaseUrl();
  return new OpenAI({
    apiKey: configuredOpenAiKey(),
    ...(baseURL ? { baseURL } : {})
  });
}

export function translationModel() {
  return projectEnvValue("OPENAI_TRANSLATION_MODEL") || process.env.OPENAI_TRANSLATION_MODEL || "gpt-4.1-mini";
}

export async function listAvailableOpenAiModels(input: ModelListInput = {}) {
  const apiKey = input.apiKey?.trim() || configuredOpenAiKey();
  if (!apiKey) throw new Error("请先填写 API Key");

  const baseUrl = normalizedBaseUrl(input.baseUrl?.trim() || configuredOpenAiBaseUrl());
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };

  let lastMessage = "识别模型失败";
  for (const url of modelListUrls(baseUrl)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
        cache: "no-store"
      });
      const data = (await response.json().catch(() => null)) as
        | { data?: Array<{ id?: string }> | unknown; error?: { message?: string } }
        | null;

      if (!response.ok) {
        lastMessage = data?.error?.message || `模型接口返回 ${response.status}`;
        continue;
      }

      const models = Array.isArray(data?.data)
        ? data.data
            .map((item) => (item && typeof item === "object" && "id" in item ? String(item.id) : ""))
            .filter(Boolean)
        : [];

      if (models.length === 0) {
        lastMessage = "模型接口没有返回可用模型";
        continue;
      }

      return Array.from(new Set(models)).sort((a, b) => a.localeCompare(b));
    } catch (error) {
      lastMessage = error instanceof Error && error.name === "AbortError" ? "识别模型超时" : "无法连接模型接口";
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastMessage);
}

function parseJson<T>(raw: string, schema: z.ZodSchema<T>) {
  let source = raw.trim();
  if (!source.startsWith("{")) {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) {
      source = source.slice(start, end + 1);
    }
  }

  const parsed = JSON.parse(source);
  return schema.parse(parsed);
}

async function translateWithChatCompletions(
  client: OpenAI,
  inputs: TranslationInput[],
  style: string
) {
  const response = await client.chat.completions.create({
    model: translationModel(),
    messages: [
      {
        role: "system",
        content: translationInstructionsForStyle(style)
      },
      {
        role: "user",
        content: JSON.stringify({
          style,
          items: inputs
        })
      }
    ],
    temperature: 0
  });

  return response.choices[0]?.message?.content ?? "";
}

export async function translateWithOpenAi(inputs: TranslationInput[], style = "exam_intensive_zh") {
  if (inputs.length === 0) return new Map<string, string>();

  if (!hasOpenAiKey()) {
    throw new Error("未配置翻译接口");
  }

  const client = getClient();

  let rawJson: string;
  if (openAiApiMode() === "chat") {
    rawJson = await translateWithChatCompletions(client, inputs, style);
  } else {
    try {
      const response = await client.responses.create({
        model: translationModel(),
        instructions: `${translationInstructionsForStyle(style)} Return only valid JSON matching the schema.`,
        input: JSON.stringify({
          style,
          items: inputs
        }),
        text: {
          format: {
            type: "json_schema",
            name: "cet6_translations",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                translations: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      blockId: { type: "string" },
                      translation: { type: "string" }
                    },
                    required: ["blockId", "translation"]
                  }
                }
              },
              required: ["translations"]
            }
          }
        }
      });
      rawJson = response.output_text;
    } catch {
      rawJson = await translateWithChatCompletions(client, inputs, style);
    }
  }

  const parsed = parseJson(rawJson, translationResponseSchema);
  return new Map(parsed.translations.map((item) => [item.blockId, item.translation]));
}
