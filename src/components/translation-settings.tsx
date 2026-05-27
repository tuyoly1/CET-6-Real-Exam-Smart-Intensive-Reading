"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Save } from "lucide-react";

type TranslationConfig = {
  apiKeyConfigured: boolean;
  maskedApiKey: string;
  baseUrl: string;
  apiMode: "auto" | "chat" | "responses";
  translationModel: string;
};

type TranslationStatus = {
  configured: boolean;
  message: string;
};

export function TranslationSettings({
  initialConfig,
  initialStatus
}: {
  initialConfig: TranslationConfig;
  initialStatus: TranslationStatus;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialConfig.baseUrl);
  const [apiMode, setApiMode] = useState(initialConfig.apiMode);
  const [translationModel, setTranslationModel] = useState(initialConfig.translationModel);
  const [status, setStatus] = useState(initialStatus);
  const [maskedApiKey, setMaskedApiKey] = useState(initialConfig.maskedApiKey);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setIsSaving(true);
    setMessage(null);
    setError(null);

    const response = await fetch("/api/settings/translation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        baseUrl,
        apiMode,
        translationModel
      })
    });
    const data = (await response.json()) as {
      error?: string;
      config?: TranslationConfig;
      translation?: TranslationStatus;
    };

    setIsSaving(false);
    if (!response.ok || !data.config || !data.translation) {
      setError(data.error ?? "保存失败");
      return;
    }

    setApiKey("");
    setMaskedApiKey(data.config.maskedApiKey);
    setStatus(data.translation);
    setMessage("已保存，后续翻译会使用这套 OpenAI 兼容配置。");
  }

  return (
    <section className="panel translation-config-panel">
      <div className="section-header">
        <h2>翻译接口</h2>
        <span className={`config-state ${status.configured ? "ready" : "missing"}`}>
          {status.configured ? <CheckCircle2 size={14} aria-hidden /> : <KeyRound size={14} aria-hidden />}
          {status.message}
        </span>
      </div>
      <div className="settings-form">
        <label className="settings-field">
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            placeholder={maskedApiKey ? `已保存：${maskedApiKey}` : "sk-..."}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>Base URL</span>
          <input
            value={baseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <div className="settings-row">
          <label className="settings-field">
            <span>模式</span>
            <select value={apiMode} onChange={(event) => setApiMode(event.target.value as TranslationConfig["apiMode"])}>
              <option value="chat">Chat 兼容</option>
              <option value="responses">Responses</option>
              <option value="auto">自动判断</option>
            </select>
          </label>
          <label className="settings-field">
            <span>模型</span>
            <input
              value={translationModel}
              placeholder="gpt-4.1-mini"
              onChange={(event) => setTranslationModel(event.target.value)}
            />
          </label>
        </div>
        {message ? <p className="config-message">{message}</p> : null}
        {error ? <p className="config-message error">{error}</p> : null}
        <button className="secondary-button settings-save" type="button" disabled={isSaving} onClick={() => void save()}>
          {isSaving ? <Loader2 size={16} aria-hidden /> : <Save size={16} aria-hidden />}
          保存翻译配置
        </button>
        <p className="settings-hint">
          兼容 OpenAI 的中转接口一般选择 Chat 兼容；API Key 留空保存时会保留已有密钥。
        </p>
      </div>
    </section>
  );
}
