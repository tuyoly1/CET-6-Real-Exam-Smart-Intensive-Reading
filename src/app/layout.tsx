import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenText } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "六级真题智能精读",
  description: "CET-6 PDF reader with bilingual study views"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <Link href="/" className="brand" title="首页">
              <span className="brand-mark">
                <BookOpenText size={19} aria-hidden />
              </span>
              <span>六级真题智能精读</span>
            </Link>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
