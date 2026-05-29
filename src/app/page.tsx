import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock3, FileText } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { inferPaperMetadata, paperPeriodLabel } from "@/lib/paper-metadata";
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

type HomePageProps = {
  searchParams?: Promise<{
    kind?: string;
  }>;
};

function kindLabel(kind: string) {
  if (kind === "exam") return "真题";
  if (kind === "answer") return "答案解析";
  if (kind === "other") return "其他资料";
  return "全部";
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) ?? {};
  const kindFilter = params.kind === "exam" || params.kind === "answer" ? params.kind : "all";
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

  const categorizedPapers = papers
    .map((paper) => ({
      paper,
      metadata: inferPaperMetadata(paper.originalFileName || paper.title)
    }))
    .filter(({ metadata }) => kindFilter === "all" || metadata.kind === kindFilter);

  const groups = new Map<
    string,
    {
      year: string;
      papers: typeof categorizedPapers;
    }
  >();

  for (const item of categorizedPapers) {
    const group = groups.get(item.metadata.year) ?? { year: item.metadata.year, papers: [] };
    group.papers.push(item);
    groups.set(item.metadata.year, group);
  }

  const orderedGroups = [...groups.values()].sort((a, b) => b.year.localeCompare(a.year, "zh-Hans-CN", { numeric: true }));

  return (
    <main className="home-grid">
      <div className="home-side">
        <UploadPanel />
        <TranslationSettings initialConfig={translationConfig} initialStatus={translationStatus} />
      </div>
      <section className="panel history-panel">
        <div className="section-header history-header">
          <div>
            <h1>我的试卷</h1>
            <p className="muted">按年份和资料类型查看导入结果</p>
          </div>
          <div className="mode-group paper-kind-group" role="tablist" aria-label="列表分类">
            {(["all", "exam", "answer"] as const).map((kind) => (
              <Link key={kind} href={kind === "all" ? "/" : `/?kind=${kind}`} className={`mode-button ${kindFilter === kind ? "active" : ""}`}>
                {kindLabel(kind)}
              </Link>
            ))}
          </div>
        </div>
        <div className="history-summary">
          <span className="status-pill ready">{papers.length} 份资料</span>
          <span className="muted">{kindLabel(kindFilter)} · {orderedGroups.length} 个年份分组</span>
        </div>
        {categorizedPapers.length === 0 ? (
          <div className="empty-state">暂无试卷</div>
        ) : (
          <div className="paper-group-list">
            {orderedGroups.map((group) => {
              const examCount = group.papers.filter(({ metadata }) => metadata.kind === "exam").length;
              const answerCount = group.papers.filter(({ metadata }) => metadata.kind === "answer").length;
              return (
                <section key={group.year} className="paper-year-group">
                  <div className="paper-year-head">
                    <div>
                      <h2>{group.year} 年</h2>
                      <p className="muted">
                        {group.papers.length} 份 · 真题 {examCount} · 答案解析 {answerCount}
                      </p>
                    </div>
                  </div>
                  <div className="paper-kind-sections">
                    {(["exam", "answer", "other"] as const).map((kind) => {
                      const kindPapers = group.papers.filter(({ metadata }) => metadata.kind === kind);
                      if (kindPapers.length === 0) return null;
                      return (
                        <div key={kind} className="paper-kind-section">
                          <div className="paper-kind-head">
                            <strong>{kindLabel(kind)}</strong>
                            <span className="muted">{kindPapers.length}</span>
                          </div>
                          <div className="paper-cards">
                            {kindPapers.map(({ paper, metadata }) => (
                              <article key={paper.id} className="paper-card">
                                <div className="paper-card-top">
                                  <Link href={`/papers/${paper.id}`} className="brand" title="打开试卷">
                                    <FileText size={18} aria-hidden />
                                    <span>{paper.title}</span>
                                  </Link>
                                </div>
                                <div className="paper-card-meta">
                                  <span className="muted">{paperPeriodLabel(metadata)}</span>
                                  <span className="muted">
                                    {paper._count.pages} 页 · {paper._count.sections} 节 · {paper._count.blocks} 个单元
                                  </span>
                                </div>
                                {paper.status === "PROCESSING" || paper.status === "QUEUED" ? (
                                  <div className="paper-progress-cell">
                                    <div className="mini-progress-track" aria-label="处理进度">
                                      <div className="mini-progress-bar" style={{ width: `${paper.progress}%` }} />
                                    </div>
                                    <span className="muted">
                                      {stageLabel(paper.job?.stage)} · {paper.progress}%
                                    </span>
                                  </div>
                                ) : paper.status === "FAILED" && paper.error ? (
                                  <p className="muted paper-error">{paper.error}</p>
                                ) : null}
                                <div className="paper-card-bottom">
                                  <span className={`status-pill ${paper.status === "READY" ? "ready" : ""} ${paper.status === "FAILED" ? "failed" : ""}`}>
                                    <StatusIcon status={paper.status} />
                                    {statusLabel(paper.status)}
                                  </span>
                                  <span className="muted">{paper.createdAt.toLocaleString("zh-CN")}</span>
                                  <Link href={`/papers/${paper.id}`} className="secondary-button">
                                    打开
                                  </Link>
                                </div>
                              </article>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
