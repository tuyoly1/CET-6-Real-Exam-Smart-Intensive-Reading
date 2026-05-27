"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Upload } from "lucide-react";

type ExistingPaper = {
  id: string;
  title: string;
};

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicatePaper, setDuplicatePaper] = useState<ExistingPaper | null>(null);

  async function upload(forceDuplicate = false) {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    setDuplicatePaper(null);

    const formData = new FormData();
    formData.append("file", file);
    if (forceDuplicate) formData.append("forceDuplicate", "true");

    const response = await fetch("/api/papers", {
      method: "POST",
      body: formData
    });

    const data = (await response.json()) as {
      error?: string;
      duplicate?: boolean;
      existingPaper?: ExistingPaper;
      paper?: ExistingPaper;
    };
    if (!response.ok) {
      setError(data.error ?? "上传失败");
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
          }}
        />
      </label>
      {error ? <p className="muted">{error}</p> : null}
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
