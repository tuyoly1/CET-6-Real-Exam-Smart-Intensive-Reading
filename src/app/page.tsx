import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock3, FileText } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getTranslationConfig } from "@/lib/translation-config";
import { translationProviderStatus } from "@/lib/translation";
import { TranslationSettings } from "@/components/translation-settings";
import { UploadPanel } from "@/components/upload-panel";

function statusLabel(status: string) {
  if (status === "READY") return "完成";
  if (status === "FAILED") return "失败";
  if (status === "PROCESSING") return "处理中";
  return "排队";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "READY") return <CheckCircle2 size={14} aria-hidden />;
  if (status === "FAILED") return <AlertCircle size={14} aria-hidden />;
  return <Clock3 size={14} aria-hidden />;
}

export default async function HomePage() {
  const translationConfig = getTranslationConfig();
  const translationStatus = translationProviderStatus();
  const papers = await prisma.paper.findMany({
    where: { ownerId: "local" },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          pages: true,
          sections: true,
          blocks: true
        }
      }
    }
  });

  return (
    <main className="home-grid">
      <div className="home-side">
        <UploadPanel />
        <TranslationSettings initialConfig={translationConfig} initialStatus={translationStatus} />
      </div>
      <section className="panel history-panel">
        <div className="section-header">
          <h1>我的试卷</h1>
          <span className="muted">{papers.length}</span>
        </div>
        {papers.length === 0 ? (
          <div className="empty-state">暂无试卷</div>
        ) : (
          <table className="paper-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>状态</th>
                <th>内容</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {papers.map((paper) => (
                <tr key={paper.id}>
                  <td>
                    <Link href={`/papers/${paper.id}`} className="brand" title="打开试卷">
                      <FileText size={18} aria-hidden />
                      <span>{paper.title}</span>
                    </Link>
                  </td>
                  <td>
                    <span className={`status-pill ${paper.status === "READY" ? "ready" : ""} ${paper.status === "FAILED" ? "failed" : ""}`}>
                      <StatusIcon status={paper.status} />
                      {statusLabel(paper.status)}
                    </span>
                  </td>
                  <td className="muted">
                    {paper._count.pages} 页 / {paper._count.sections} 节 / {paper._count.blocks} 个学习单元
                  </td>
                  <td className="muted">{paper.createdAt.toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
