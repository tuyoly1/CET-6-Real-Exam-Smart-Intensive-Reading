import { NextResponse } from "next/server";
import { z } from "zod";
import { listAvailableOpenAiModels } from "@/lib/openai-service";

export const runtime = "nodejs";

const modelProbeSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = modelProbeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "模型识别参数不正确" }, { status: 400 });
  }

  try {
    const models = await listAvailableOpenAiModels(parsed.data);
    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "识别模型失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
