import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processPaper } from "@/lib/processor";
import { ensureStorage, uploadPathFor } from "@/lib/storage";

export const runtime = "nodejs";

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function backfillMissingFileHashes() {
  const papers = await prisma.paper.findMany({
    where: {
      ownerId: "local",
      fileHash: null
    },
    select: {
      id: true,
      filePath: true
    }
  });

  for (const paper of papers) {
    try {
      const bytes = await readFile(paper.filePath);
      await prisma.paper.update({
        where: { id: paper.id },
        data: { fileHash: sha256(bytes) }
      });
    } catch {
      // Missing old upload files should not block new uploads.
    }
  }
}

export async function GET() {
  const papers = await prisma.paper.findMany({
    where: { ownerId: "local" },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          pages: true,
          blocks: true
        }
      }
    }
  });

  return NextResponse.json({ papers });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const forceDuplicate = formData.get("forceDuplicate") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传 PDF 文件。" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return NextResponse.json({ error: "只支持 PDF 文件。" }, { status: 400 });
  }

  await ensureStorage();

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileHash = sha256(bytes);
  await backfillMissingFileHashes();
  const existingPaper = await prisma.paper.findFirst({
    where: {
      ownerId: "local",
      fileHash
    },
    orderBy: { createdAt: "desc" }
  });

  if (existingPaper && !forceDuplicate) {
    return NextResponse.json({
      duplicate: true,
      existingPaper
    });
  }

  const paperId = randomUUID();
  const filePath = uploadPathFor(paperId, file.name);
  await writeFile(filePath, bytes);

  const paper = await prisma.paper.create({
    data: {
      id: paperId,
      title: file.name.replace(/\.pdf$/i, ""),
      originalFileName: file.name,
      filePath,
      fileHash,
      ownerId: "local",
      status: "QUEUED",
      progress: 0,
      job: {
        create: {
          stage: "QUEUED",
          progress: 0
        }
      }
    }
  });

  setImmediate(() => {
    processPaper(paper.id).catch((error) => {
      console.error("Paper processing failed", error);
    });
  });

  return NextResponse.json({ paper, duplicate: false }, { status: 201 });
}
