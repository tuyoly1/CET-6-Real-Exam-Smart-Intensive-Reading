"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, ExternalLink, FileStack, FileUp, Loader2, Upload } from "lucide-react";

type ExistingPaper = {
  id: string;
  title: string;
};

type UploadResponse = {
  error?: string;
  duplicate?: boolean;
  existingPaper?: ExistingPaper;
  paper?: ExistingPaper;
};

type UploadProgress = {
  percent: number;
  label: string;
  detail: string;
  startedAt: number;
  updatedAt: number;
};

type UploadJobStatus = "pending" | "uploading" | "queued" | "processing" | "duplicate" | "ready" | "failed";

type UploadJob = UploadProgress & {
  id: string;
  file: File;
  status: UploadJobStatus;
  paper?: ExistingPaper;
  duplicatePaper?: ExistingPaper;
  error?: string;
};

type ProcessingStatusEvent = {
  status: "QUEUED" | "PROCESSING" | "READY" | "FAILED";
  progress: number;
  stage?: string;
  error?: string;
};

const UPLOAD_PARALLELISM = 3;

function formatSeconds(ms: number) {
  return `${Math.max(0, Math.floor(ms / 1000))} 秒`;
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

function statusLabel(status: UploadJobStatus) {
  if (status === "ready") return "完成";
  if (status === "failed") return "失败";
  if (status === "duplicate") return "已存在";
  if (status === "processing") return "解析中";
  if (status === "queued") return "排队中";
  if (status === "uploading") return "上传中";
  return "待上传";
}

function createJobId(file: File, index: number) {
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${index}`;
  return `${file.name}-${file.size}-${file.lastModified}-${randomId}`;
}

function createUploadJob(file: File, index: number): UploadJob {
  const now = Date.now();
  return {
    id: createJobId(file, index),
    file,
    status: "pending",
    percent: 0,
    label: "待上传",
    detail: "已加入批量导入队列",
    startedAt: now,
    updatedAt: now
  };
}

function postPaper(formData: FormData, onProgress: (progress: Partial<UploadProgress>) => void) {
  return new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/papers");
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        onProgress({
          percent: 20,
          label: "正在上传 PDF",
          detail: "浏览器正在把文件发送到本机服务"
        });
        return;
      }

      const uploadPercent = Math.min(82, Math.round((event.loaded / event.total) * 82));
      onProgress({
        percent: uploadPercent,
        label: "正在上传 PDF",
        detail: `已发送 ${Math.round((event.loaded / event.total) * 100)}%`
      });
    };

    xhr.upload.onload = () => {
      onProgress({
        percent: 86,
        label: "正在校验文件",
        detail: "文件已发送，正在计算指纹并检查是否重复导入"
      });
    };

    xhr.onload = () => {
      const data = (xhr.response ?? JSON.parse(xhr.responseText || "{}")) as UploadResponse;
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress({
          percent: data.duplicate ? 100 : 90,
          label: data.duplicate ? "发现已有试卷" : "已创建解析任务",
          detail: data.duplicate ? "这份 PDF 已导入过，可以直接打开原试卷" : "正在等待解析进度"
        });
        resolve(data);
        return;
      }
      reject(new Error(data.error ?? "上传失败"));
    };

    xhr.onerror = () => reject(new Error("网络连接异常，上传失败"));
    xhr.ontimeout = () => reject(new Error("上传超时，请稍后重试"));
    xhr.send(formData);
  });
}

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const eventSources = useRef(new Map<string, EventSource>());
  const jobsRef = useRef<UploadJob[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const hasActiveJob = jobs.some((job) => job.status === "uploading" || job.status === "queued" || job.status === "processing");

  useEffect(() => {
    if (!isSubmitting && !hasActiveJob) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, isSubmitting]);

  useEffect(() => {
    const sources = eventSources.current;
    return () => {
      for (const source of sources.values()) source.close();
      sources.clear();
    };
  }, []);

  function setJob(jobId: string, update: Partial<UploadJob> | ((job: UploadJob) => Partial<UploadJob>)) {
    setJobs((current) =>
      current.map((job) => {
        if (job.id !== jobId) return job;
        const patch = typeof update === "function" ? update(job) : update;
        return {
          ...job,
          ...patch,
          updatedAt: patch.updatedAt ?? Date.now()
        };
      })
    );
  }

  function addFiles(fileList: FileList | File[]) {
    const existingKeys = new Set(jobsRef.current.map((job) => `${job.file.name}-${job.file.size}-${job.file.lastModified}`));
    const incoming = Array.from(fileList).filter((item) => item.name.toLowerCase().endsWith(".pdf") || item.type === "application/pdf");
    const uniqueIncoming = incoming.filter((item) => {
      const key = `${item.name}-${item.size}-${item.lastModified}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

    if (incoming.length === 0) {
      setError("请选择 PDF 文件。");
      return;
    }

    if (uniqueIncoming.length === 0) {
      setError("这些 PDF 已经在导入队列里了。");
      return;
    }

    setError(null);
    setJobs((current) => [...current, ...uniqueIncoming.map((file, index) => createUploadJob(file, current.length + index))]);
  }

  function monitorPaper(jobId: string, paper: ExistingPaper) {
    eventSources.current.get(jobId)?.close();
    const source = new EventSource(`/api/papers/${paper.id}/events`);
    eventSources.current.set(jobId, source);

    source.addEventListener("status", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as ProcessingStatusEvent;
      const nextStatus: UploadJobStatus =
        data.status === "READY" ? "ready" : data.status === "FAILED" ? "failed" : data.status === "QUEUED" ? "queued" : "processing";
      setJob(jobId, {
        status: nextStatus,
        paper,
        percent: data.progress,
        label: data.status === "FAILED" ? "解析失败" : stageLabel(data.stage),
        detail: data.error ?? (data.status === "READY" ? "解析完成，可以打开阅读页" : "后端正在解析 PDF 结构")
      });

      if (data.status === "READY" || data.status === "FAILED") {
        source.close();
        eventSources.current.delete(jobId);
        router.refresh();
      }
    });

    source.addEventListener("error", () => {
      source.close();
      eventSources.current.delete(jobId);
      setJob(jobId, {
        status: "failed",
        error: "进度连接断开，请刷新列表查看实际状态。",
        label: "进度连接断开",
        detail: "解析任务可能仍在后台继续运行"
      });
      router.refresh();
    });
  }

  async function uploadJob(jobId: string, forceDuplicate = false) {
    const job = jobsRef.current.find((item) => item.id === jobId);
    if (!job) return;

    const startedAt = new Date().getTime();
    setError(null);
    setJob(jobId, {
      status: "uploading",
      percent: 3,
      label: "准备上传",
      detail: "正在读取文件并建立上传请求",
      startedAt,
      updatedAt: startedAt,
      duplicatePaper: undefined,
      error: undefined
    });
    setNow(startedAt);

    const formData = new FormData();
    formData.append("file", job.file);
    if (forceDuplicate) formData.append("forceDuplicate", "true");

    let data: UploadResponse;
    try {
      data = await postPaper(formData, (progress) => {
        setJob(jobId, (current) => ({
          percent: progress.percent ?? current.percent,
          label: progress.label ?? current.label,
          detail: progress.detail ?? current.detail
        }));
      });
    } catch (uploadError) {
      setJob(jobId, {
        status: "failed",
        percent: 100,
        label: "上传失败",
        detail: uploadError instanceof Error ? uploadError.message : "上传失败",
        error: uploadError instanceof Error ? uploadError.message : "上传失败"
      });
      return;
    }

    if (data.duplicate && data.existingPaper) {
      setJob(jobId, {
        status: "duplicate",
        percent: 100,
        label: "发现已有试卷",
        detail: "这份 PDF 已导入过，可以打开原试卷或导入副本",
        duplicatePaper: data.existingPaper
      });
      router.refresh();
      return;
    }

    if (data.paper) {
      setJob(jobId, {
        status: "queued",
        paper: data.paper,
        percent: 0,
        label: "排队解析",
        detail: "已提交到导入队列，等待后端解析"
      });
      monitorPaper(jobId, data.paper);
      return;
    }

    setJob(jobId, {
      status: "failed",
      percent: 100,
      label: "上传响应异常",
      detail: "服务端没有返回试卷信息，请重试。"
    });
  }

  async function uploadAll() {
    const runnable = jobsRef.current.filter((job) => job.status === "pending" || job.status === "failed");
    if (runnable.length === 0) return;
    setIsSubmitting(true);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < runnable.length) {
        const job = runnable[nextIndex];
        nextIndex += 1;
        await uploadJob(job.id);
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLELISM, runnable.length) }, () => worker()));
    } finally {
      setIsSubmitting(false);
    }
  }

  function clearFinished() {
    setJobs((current) => current.filter((job) => !["ready", "duplicate"].includes(job.status)));
  }

  const overallPercent = useMemo(() => {
    if (jobs.length === 0) return 0;
    return Math.round(jobs.reduce((sum, job) => sum + job.percent, 0) / jobs.length);
  }, [jobs]);
  const pendingCount = jobs.filter((job) => job.status === "pending" || job.status === "failed").length;
  const finishedCount = jobs.filter((job) => job.status === "ready" || job.status === "duplicate").length;

  return (
    <section className="panel upload-panel">
      <label
        className="upload-target"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }}
      >
        <span className="upload-icon">
          <FileUp size={28} aria-hidden />
        </span>
        <strong>拖入多个 PDF 或选择文件</strong>
        <span className="muted">支持批量导入真题和答案解析，队列会依次上传并显示处理进度</span>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {error ? <p className="muted">{error}</p> : null}
      {jobs.length > 0 ? (
        <div className="batch-upload-panel" role="status" aria-live="polite">
          <div className="upload-progress-head">
            <strong>批量导入进度</strong>
            <span>
              {finishedCount}/{jobs.length} 完成 · {overallPercent}%
            </span>
          </div>
          <div className="upload-progress-track" aria-label="批量导入总进度">
            <div className="upload-progress-bar" style={{ width: `${overallPercent}%` }} />
          </div>
          <div className="upload-job-list">
            {jobs.map((job) => {
              const elapsed = now ? now - job.startedAt : 0;
              const idleFor = now ? now - job.updatedAt : 0;
              const targetPaper = job.paper ?? job.duplicatePaper;
              return (
                <div className={`upload-job ${job.status}`} key={job.id}>
                  <div className="upload-job-main">
                    <div className="upload-job-title">
                      <FileStack size={16} aria-hidden />
                      <span>{job.file.name}</span>
                    </div>
                    <span className={`upload-job-status ${job.status}`}>
                      {job.status === "ready" ? <CheckCircle2 size={14} aria-hidden /> : null}
                      {job.status === "failed" ? <AlertCircle size={14} aria-hidden /> : null}
                      {job.status === "uploading" || job.status === "processing" ? <Loader2 size={14} aria-hidden /> : null}
                      {statusLabel(job.status)}
                    </span>
                  </div>
                  <div className="upload-progress-track" aria-label={`${job.file.name} 导入进度`}>
                    <div className="upload-progress-bar" style={{ width: `${job.percent}%` }} />
                  </div>
                  <p>{job.detail}</p>
                  <span className="upload-progress-meta">
                    {job.label} · {job.percent}% · 已用时 {formatSeconds(elapsed)} · 最近进度 {formatSeconds(idleFor)} 前
                  </span>
                  {targetPaper ? (
                    <div className="button-row">
                      <button className="secondary-button" type="button" onClick={() => router.push(`/papers/${targetPaper.id}`)}>
                        <ExternalLink size={15} aria-hidden />
                        打开
                      </button>
                      {job.status === "duplicate" ? (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => void uploadJob(job.id, true)}
                        >
                          仍然导入副本
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="button-row upload-actions">
        <button className="primary-button" type="button" disabled={pendingCount === 0 || isSubmitting} onClick={() => void uploadAll()}>
          {isSubmitting ? <Loader2 size={18} aria-hidden /> : <Upload size={18} aria-hidden />}
          {pendingCount === 0 ? "等待选择 PDF" : isSubmitting ? "导入中" : `导入 ${pendingCount} 个 PDF`}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isSubmitting}
        >
          <FileStack size={15} aria-hidden />
          继续添加
        </button>
        {jobs.length > 0 && pendingCount > 0 ? (
          <button className="secondary-button" type="button" disabled={isSubmitting} onClick={() => setJobs([])}>
            清空队列
          </button>
        ) : null}
        {jobs.some((job) => job.status === "ready" || job.status === "duplicate") ? (
          <button className="secondary-button" type="button" onClick={clearFinished}>
            清理已完成
          </button>
        ) : null}
      </div>
    </section>
  );
}
