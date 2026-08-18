import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyFirecrawlWebhookToken, type WebsiteDocument } from "@/lib/services/websiteCrawler";
import { failWebsiteCrawl, ingestWebsiteDocuments } from "@/server/businessProfileEngine";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  success: z.boolean().optional(),
  type: z.string(),
  id: z.string(),
  webhookId: z.string().optional(),
  data: z.array(z.unknown()).default([]),
  error: z.string().optional(),
  metadata: z.object({ crawlId: z.string().optional(), organizationId: z.string().optional() }).passthrough().optional(),
});

export async function POST(request: Request) {
  if (!verifyFirecrawlWebhookToken(request.headers.get("x-smailee-firecrawl-token"))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const crawl = await prisma.websiteCrawl.findFirst({
    where: {
      OR: [
        { providerJobId: payload.id },
        ...(payload.metadata?.crawlId ? [{ id: payload.metadata.crawlId }] : []),
      ],
    },
  });
  if (!crawl) return Response.json({ ok: true });

  const eventId = payload.webhookId || `${payload.id}:${payload.type}:${Date.now()}`;
  try {
    await prisma.websiteCrawlWebhookEvent.create({ data: { id: eventId, crawlId: crawl.id, type: payload.type } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ ok: true, duplicate: true });
    }
    throw error;
  }

  try {
    if (payload.type === "crawl.started") {
      await prisma.websiteCrawl.update({
        where: { id: crawl.id },
        data: { providerJobId: crawl.providerJobId ?? payload.id, startedAt: crawl.startedAt ?? new Date() },
      });
      await prisma.websiteCrawl.updateMany({ where: { id: crawl.id, status: "PENDING" }, data: { status: "CRAWLING" } });
    } else if (payload.type === "crawl.page") {
      await ingestWebsiteDocuments(crawl.id, payload.data as WebsiteDocument[]);
    } else if (payload.type === "crawl.completed") {
      await prisma.websiteCrawl.update({
        where: { id: crawl.id },
        // A completed webhook is only a signal. Firecrawl may omit page data here,
        // so keep the crawl pollable and let the worker fetch every result page.
        data: { providerJobId: crawl.providerJobId ?? payload.id, status: "CRAWLING", completedAt: new Date(), nextPollAt: new Date() },
      });
    } else if (payload.type === "crawl.failed" || payload.success === false) {
      await failWebsiteCrawl(crawl.id, new Error(payload.error || "Сервис анализа сайта завершил обход с ошибкой"));
    }
  } catch (error) {
    // Firecrawl повторит доставку. Удаляем claim, чтобы retry не был ошибочно
    // принят за уже полностью обработанное событие.
    await prisma.websiteCrawlWebhookEvent.delete({ where: { id: eventId } }).catch(() => {});
    throw error;
  }

  return Response.json({ ok: true });
}
