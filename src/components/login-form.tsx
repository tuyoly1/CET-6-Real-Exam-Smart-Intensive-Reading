"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Loader2, LogIn } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const data = (await response.json()) as { error?: string };
    setIsSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "登录失败");
      return;
    }

    router.replace(nextPath.startsWith("/") ? nextPath : "/");
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={(event) => void submit(event)}>
      <div className="login-icon">
        <KeyRound size={24} aria-hidden />
      </div>
      <div>
        <h1>输入访问密码</h1>
        <p>学校网络下已启用保护，验证后才能访问试卷、上传和翻译配置。</p>
      </div>
      <label className="settings-field">
        <span>访问密码</span>
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error ? <p className="config-message error">{error}</p> : null}
      <button className="primary-button login-button" type="submit" disabled={!password || isSubmitting}>
        {isSubmitting ? <Loader2 size={18} aria-hidden /> : <LogIn size={18} aria-hidden />}
        进入
      </button>
    </form>
  );
}
