import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const encoder = new TextEncoder();
  let interval: NodeJS.Timeout | undefined;

  const stream = new ReadableStream({
    start(controller) {
      async function send() {
        try {
          const paper = await prisma.paper.findUnique({
            where: { id },
            include: { job: true }
          });

          if (!paper) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "not_found" })}\n\n`));
            controller.close();
            if (interval) clearInterval(interval);
            return;
          }

          controller.enqueue(
            encoder.encode(
              `event: status\ndata: ${JSON.stringify({
                id: paper.id,
                status: paper.status,
                progress: paper.progress,
                stage: paper.job?.stage ?? "QUEUED",
                error: paper.error
              })}\n\n`
            )
          );

          if (paper.status === "READY" || paper.status === "FAILED") {
            controller.close();
            if (interval) clearInterval(interval);
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({
                error: error instanceof Error ? error.message : "unknown"
              })}\n\n`
            )
          );
          controller.close();
          if (interval) clearInterval(interval);
        }
      }

      void send();
      interval = setInterval(send, 1000);
    },
    cancel() {
      if (interval) clearInterval(interval);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
