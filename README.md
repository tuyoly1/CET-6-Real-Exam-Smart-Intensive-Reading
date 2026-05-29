# 六级真题智能精读

一个面向大学英语六级真题 PDF 的智能精读工具。用户上传六级真题后，系统会自动抽取文本、识别试卷结构，并按写作、听力、阅读、翻译组织成适合学习的阅读工作台。

## 主要功能

- PDF 上传、文本抽取与处理进度展示
- 六级试卷结构识别：写作、听力、阅读 Section A/B/C、翻译
- 中英对照、逐句对照、原文和隐藏中文模式
- 题目、选项、词库和翻译题的结构化展示
- OpenAI 兼容翻译接口配置、模型识别与翻译缓存
- 单词悬停释义、点击加入生词卡片、CSV 导出
- 搜索、章节筛选、手动修正题型
- 同 PDF 文件 hash 去重，避免重复导入

## 技术栈

- Next.js
- React
- Prisma + SQLite
- pdfjs-dist
- tesseract.js
- OpenAI compatible API

## 本地运行

```bash
npm install
npm run prisma:push
npm run dev
```

默认开发地址：

```text
http://127.0.0.1:3000
```

## 环境变量

复制 `.env.example` 为 `.env`，按需填写：

```bash
cp .env.example .env
```

常用配置：

- `DATABASE_URL`：SQLite 数据库地址
- `OPENAI_API_KEY`：OpenAI 兼容接口 Key
- `OPENAI_BASE_URL`：OpenAI 兼容中转站地址
- `OPENAI_API_MODE`：`chat` / `responses` / `auto`
- `OPENAI_TRANSLATION_MODEL`：翻译模型
- `AUTO_TRANSLATE_ON_IMPORT`：导入后是否自动翻译

注意：不要提交 `.env`、数据库文件、上传的 PDF 或本地缓存。

## 常用命令

```bash
npm test
npm run lint
npm run build
```

## 项目目标

这个项目的目标不是做普通 PDF 阅读器，而是把六级真题整理成真正可学习的精读界面：结构清楚、翻译可信、题目和选项可读，并能沉淀生词卡片，帮助备考者更高效地复盘真题。
