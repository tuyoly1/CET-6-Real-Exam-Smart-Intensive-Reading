"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Upload } from "lucide-react";

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

function formatSeconds(ms: number) {
  return `${Math.max(0, Math.floor(ms / 1000))} 秒`;
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
          percent: 100,
          label: data.duplicate ? "发现已有试卷" : "已创建解析任务",
          detail: data.duplicate ? "这份 PDF 已导入过，可以直接打开原试卷" : "即将打开试卷页查看解析进度"
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
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicatePaper, setDuplicatePaper] = useState<ExistingPaper | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!isUploading) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isUploading]);

  async function upload(forceDuplicate = false) {
    if (!file) return;
    const startedAt = Date.now();
    setIsUploading(true);
    setError(null);
    setDuplicatePaper(null);
    setUploadProgress({
      percent: 3,
      label: "准备上传",
      detail: "正在读取文件并建立上传请求",
      startedAt,
      updatedAt: startedAt
    });
    setNow(startedAt);

    const formData = new FormData();
    formData.append("file", file);
    if (forceDuplicate) formData.append("forceDuplicate", "true");

    let data: UploadResponse;
    try {
      data = await postPaper(formData, (progress) => {
        setUploadProgress((current) => ({
          percent: progress.percent ?? current?.percent ?? 0,
          label: progress.label ?? current?.label ?? "上传中",
          detail: progress.detail ?? current?.detail ?? "正在处理",
          startedAt: current?.startedAt ?? startedAt,
          updatedAt: Date.now()
        }));
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
      setIsUploading(false);
      return;
    }

    if (data.duplicate && data.existingPaper) {
      setDuplicatePaper(data.existingPaper);
      setIsUploading(false);
      return;
    }

    if (data.paper) {
      router.push(`/papers/${data.paper.id}`);
    } else {
      setError("上传响应异常，请重试。");
      setIsUploading(false);
    }
  }

  const elapsed = uploadProgress ? now - uploadProgress.startedAt : 0;
  const idleFor = uploadProgress ? now - uploadProgress.updatedAt : 0;

  return (
    <section className="panel upload-panel">
      <label
        className="upload-target"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const droppedFile = event.dataTransfer.files?.[0];
          if (droppedFile) {
            setFile(droppedFile);
            setDuplicatePaper(null);
            setUploadProgress(null);
          }
        }}
      >
        <span className="upload-icon">
          <FileUp size={28} aria-hidden />
        </span>
        <strong>{file ? file.name : "拖入 PDF 或选择文件"}</strong>
        <span className="muted">PDF</span>
        <input
          ref={inputRef}
          type="file"
        accept="application/pdf,.pdf"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setDuplicatePaper(null);
            setUploadProgress(null);
          }}
        />
      </label>
      {error ? <p className="muted">{error}</p> : null}
      {uploadProgress ? (
        <div className="upload-progress" role="status" aria-live="polite">
          <div className="upload-progress-head">
            <strong>{uploadProgress.label}</strong>
            <span>{uploadProgress.percent}%</span>
          </div>
          <div className="upload-progress-track" aria-label="上传进度">
            <div className="upload-progress-bar" style={{ width: `${uploadProgress.percent}%` }} />
          </div>
          <p>{uploadProgress.detail}</p>
          <span className="upload-progress-meta">
            已用时 {formatSeconds(elapsed)} · 最近进度 {formatSeconds(idleFor)} 前
          </span>
        </div>
      ) : null}
      {duplicatePaper ? (
        <div className="duplicate-panel">
          <strong>这份 PDF 已存在</strong>
          <span className="muted">{duplicatePaper.title}</span>
          <div className="button-row">
            <button
              className="secondary-button"
              type="button"
              onClick={() => router.push(`/papers/${duplicatePaper.id}`)}
            >
              打开原试卷
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={isUploading}
              onClick={() => void upload(true)}
            >
              仍然导入副本
            </button>
          </div>
        </div>
      ) : null}
      <button className="primary-button" type="button" disabled={!file || isUploading} onClick={() => void upload()}>
        {isUploading ? <Loader2 size={18} aria-hidden /> : <Upload size={18} aria-hidden />}
        {isUploading ? "上传中" : "上传并解析"}
      </button>
    </section>
  );
}
