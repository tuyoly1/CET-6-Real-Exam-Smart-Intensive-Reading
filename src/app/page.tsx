import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock3, FileText } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getTranslationConfig } from "@/lib/translation-config";
import { translationProviderStatus } from "@/lib/translation";
import { TranslationSettings } from "@/components/translation-settings";
import { UploadPanel } from "@/components/upload-panel";

export const dynamic = "force-dynamic";

function statusLabel(status: string) {
  if (status === "READY") return "完成";
  if (status === "FAILED") return "失败";
  if (status === "PROCESSING") return "处理中";
  return "排队";
}

function stageLabel(stage?: string | null) {
  if (stage === "PARSING") return "抽取文本";
  if (stage === "OCR") return "OCR 识别";
  if (stage === "STRUCTURING") return "识别题型";
  if (stage === "TRANSLATING") return "生成翻译";
  if (stage === "READY") return "完成";
  if (stage === "FAILED") return "失败";
  return "等待处理";
}

function StatusIcon({ status }: { status: string }) {
  if (status === "READY") return <CheckCircle2 size={14} aria-hidden />;
  if (status === "FAILED") return <AlertCircle size={14} aria-hidden />;
  return <Clock3 size={14} aria-hidden />;
}

export default async function HomePage() {
  const translationConfig = getTranslationConfig();
  const translationStatus = translationProviderStatus();
  await prisma.$executeRaw`
    UPDATE Paper
    SET status = 'FAILED',
        progress = 100,
        error = '处理被中断，请重新上传或导入副本。',
        updatedAt = CURRENT_TIMESTAMP
    WHERE ownerId = 'local'
      AND status IN ('QUEUED', 'PROCESSING')
      AND updatedAt < datetime('now', '-10 minutes')
  `;
  await prisma.$executeRaw`
    UPDATE ProcessingJob
    SET stage = 'FAILED',
        progress = 100,
        error = '处理被中断，请重新上传或导入副本。',
        finishedAt = CURRENT_TIMESTAMP,
        updatedAt = CURRENT_TIMESTAMP
    WHERE paperId IN (
      SELECT id
      FROM Paper
      WHERE ownerId = 'local'
        AND status = 'FAILED'
        AND error = '处理被中断，请重新上传或导入副本。'
    )
      AND stage IN ('QUEUED', 'PARSING', 'OCR', 'STRUCTURING', 'TRANSLATING')
  `;
  const papers = await prisma.paper.findMany({
    where: { ownerId: "local" },
    orderBy: { createdAt: "desc" },
    include: {
      job: true,
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
                    <div className="paper-progress-cell">
                      <span className={`status-pill ${paper.status === "READY" ? "ready" : ""} ${paper.status === "FAILED" ? "failed" : ""}`}>
                        <StatusIcon status={paper.status} />
                        {statusLabel(paper.status)}
                      </span>
                      {paper.status === "PROCESSING" || paper.status === "QUEUED" ? (
                        <>
                          <div className="mini-progress-track" aria-label="处理进度">
                            <div className="mini-progress-bar" style={{ width: `${paper.progress}%` }} />
                          </div>
                          <span className="muted">
                            {stageLabel(paper.job?.stage)} · {paper.progress}%
                          </span>
                        </>
                      ) : paper.status === "FAILED" && paper.error ? (
                        <span className="muted">{paper.error}</span>
                      ) : null}
                    </div>
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
