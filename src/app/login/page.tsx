import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="panel login-panel">
        <Suspense fallback={<div className="empty-state">加载中</div>}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
