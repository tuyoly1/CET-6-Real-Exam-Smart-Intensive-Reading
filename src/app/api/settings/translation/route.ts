import { NextResponse } from "next/server";
import { z } from "zod";
import { getTranslationConfig, saveTranslationConfig } from "@/lib/translation-config";
import { translationProviderStatus } from "@/lib/translation";

export const runtime = "nodejs";

const configSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  apiMode: z.enum(["auto", "chat", "responses"]).optional(),
  translationModel: z.string().min(1, "模型不能为空").optional()
});

export async function GET() {
  return NextResponse.json({
    config: getTranslationConfig(),
    translation: translationProviderStatus()
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = configSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "配置格式不正确" }, { status: 400 });
  }

  const config = saveTranslationConfig(parsed.data);
  return NextResponse.json({
    config,
    translation: translationProviderStatus()
  });
}
