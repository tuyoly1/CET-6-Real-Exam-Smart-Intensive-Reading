import { NextResponse } from "next/server";
import { z } from "zod";
import { accessPassword, accessToken, AUTH_COOKIE_NAME, isAuthConfigured } from "@/lib/auth-config";

export const runtime = "nodejs";

const loginSchema = z.object({
  password: z.string().min(1)
});

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: "未配置访问密码" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success || parsed.data.password !== accessPassword()) {
    return NextResponse.json({ error: "访问密码不正确" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: await accessToken(),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12
  });
  return response;
}
