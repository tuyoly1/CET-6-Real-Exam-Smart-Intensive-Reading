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
    year?: string;
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
  const yearFilter = params.year && /^20\d{2}$/.test(params.year) ? params.year : "all";
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

  const categorizedPapers = papers.map((paper) => ({
    paper,
    metadata: inferPaperMetadata(paper.originalFileName || paper.title)
  }));

  const examCount = categorizedPapers.filter(({ metadata }) => metadata.kind === "exam").length;
  const answerCount = categorizedPapers.filter(({ metadata }) => metadata.kind === "answer").length;
  const availableYears = [...new Set(categorizedPapers.map(({ metadata }) => metadata.year).filter((year) => year !== "未识别年份"))].sort(
    (a, b) => b.localeCompare(a, "zh-Hans-CN", { numeric: true })
  );
  const filteredPapers = categorizedPapers.filter(
    ({ metadata }) => (kindFilter === "all" || metadata.kind === kindFilter) && (yearFilter === "all" || metadata.year === yearFilter)
  );

  const groups = new Map<
    string,
    {
      year: string;
      papers: typeof filteredPapers;
    }
  >();

  for (const item of filteredPapers) {
    const group = groups.get(item.metadata.year) ?? { year: item.metadata.year, papers: [] };
    group.papers.push(item);
    groups.set(item.metadata.year, group);
  }

  const orderedGroups = [...groups.values()].sort((a, b) => b.year.localeCompare(a.year, "zh-Hans-CN", { numeric: true }));
  const filterHref = (next: { kind?: string; year?: string }) => {
    const kind = next.kind ?? kindFilter;
    const year = next.year ?? yearFilter;
    const query = new URLSearchParams();
    if (kind !== "all") query.set("kind", kind);
    if (year !== "all") query.set("year", year);
    const text = query.toString();
    return text ? `/?${text}` : "/";
  };

  return (
    <main className="home-grid">
      <div className="home-side">
        <UploadPanel />
        <TranslationSettings initialConfig={translationConfig} initialStatus={translationStatus} />
      </div>
      <section className="panel history-panel">
        <div className="section-header library-header">
          <div>
            <h1>我的试卷</h1>
            <p className="muted">按年份和真题 / 答案分类浏览</p>
          </div>
          <span className="library-total">{papers.length}</span>
        </div>
        <div className="library-filters">
          <div className="filter-row">
            <span className="filter-label">类型</span>
            <div className="filter-pills" role="tablist" aria-label="资料类型">
              <Link href={filterHref({ kind: "all" })} className={`filter-pill ${kindFilter === "all" ? "active" : ""}`}>
                全部 {papers.length}
              </Link>
              <Link href={filterHref({ kind: "exam" })} className={`filter-pill ${kindFilter === "exam" ? "active" : ""}`}>
                真题 {examCount}
              </Link>
              <Link href={filterHref({ kind: "answer" })} className={`filter-pill ${kindFilter === "answer" ? "active" : ""}`}>
                答案 {answerCount}
              </Link>
            </div>
          </div>
          <div className="filter-row">
            <span className="filter-label">年份</span>
            <div className="filter-pills" role="tablist" aria-label="年份">
              <Link href={filterHref({ year: "all" })} className={`filter-pill ${yearFilter === "all" ? "active" : ""}`}>
                全部
              </Link>
              {availableYears.map((year) => (
                <Link key={year} href={filterHref({ year })} className={`filter-pill ${yearFilter === year ? "active" : ""}`}>
                  {year}
                </Link>
              ))}
            </div>
          </div>
        </div>
        {filteredPapers.length === 0 ? (
          <div className="empty-state">暂无试卷</div>
        ) : (
          <div className="library-year-list">
            {orderedGroups.map((group) => {
              return (
                <section key={group.year} className="library-year-group">
                  <div className="library-year-head">
                    <h2>{group.year}</h2>
                    <span>{group.papers.length} 份</span>
                  </div>
                  <table className="library-table">
                    <thead>
                      <tr>
                        <th>名称</th>
                        <th>分类</th>
                        <th>状态</th>
                        <th>内容</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.papers.map(({ paper, metadata }) => (
                        <tr key={paper.id}>
                          <td>
                            <Link href={`/papers/${paper.id}`} className="library-title" title="打开试卷">
                              <FileText size={15} aria-hidden />
                              <span>{paper.title}</span>
                            </Link>
                            {paper.status === "FAILED" && paper.error ? <p className="paper-error muted">{paper.error}</p> : null}
                          </td>
                          <td>
                            <div className="classification-stack">
                              <span className="date-chip">{paperPeriodLabel(metadata).replace("年", "年").replace("月", "月")}</span>
                              <span className={`type-chip ${metadata.kind}`}>{kindLabel(metadata.kind)}</span>
                            </div>
                          </td>
                          <td>
                            <div className="table-status-cell">
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
                              ) : null}
                            </div>
                          </td>
                          <td className="library-content-cell">
                            {paper._count.pages} 页 / {paper._count.sections} 节 / {paper._count.blocks} 个学习单元
                          </td>
                          <td className="library-time-cell">
                            <span>{paper.createdAt.toLocaleDateString("zh-CN")}</span>
                            <span>{paper.createdAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
