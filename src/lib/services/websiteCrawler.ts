import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

export type WebsiteDocument = {
  markdown: string;
  metadata?: Record<string, unknown>;
};

export type CrawlOptions = {
  crawlId: string;
  organizationId: string;
  url: string;
  limit: number;
  maxDepth: number;
  includePaths: string[];
  excludePaths: string[];
  allowSubdomains: boolean;
};

export type CrawlSnapshot = {
  status: "scraping" | "completed" | "failed" | string;
  total: number;
  completed: number;
  creditsUsed?: number;
  documents: WebsiteDocument[];
};

export interface WebsiteCrawler {
  map(url: string, limit: number, includeSubdomains: boolean): Promise<WebsiteDocument[]>;
  start(options: CrawlOptions): Promise<{ jobId: string }>;
  status(jobId: string): Promise<CrawlSnapshot>;
  cancel(jobId: string): Promise<void>;
}

function apiKey() {
  if (!config.firecrawl.apiKey) throw new Error("FIRECRAWL_API_KEY не настроен");
  return config.firecrawl.apiKey;
}

async function firecrawlFetch(pathOrUrl: string, init?: RequestInit) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${config.firecrawl.baseUrl}${pathOrUrl}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(65_000),
  });
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!response.ok) {
    const error = typeof body === "object" && body && "error" in body ? String(body.error) : `HTTP ${response.status}`;
    throw new Error(`Firecrawl: ${error}`);
  }
  return body as Record<string, unknown>;
}

export function firecrawlWebhookToken() {
  return createHash("sha256").update(`smailee-firecrawl-webhook:${apiKey()}`).digest("hex");
}

export function verifyFirecrawlWebhookToken(value: string | null) {
  if (!value || !config.firecrawl.apiKey) return false;
  const expected = Buffer.from(firecrawlWebhookToken());
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

class FirecrawlCrawler implements WebsiteCrawler {
  async map(url: string, limit: number, includeSubdomains: boolean) {
    const body = await firecrawlFetch("/v2/map", {
      method: "POST",
      body: JSON.stringify({
        url,
        sitemap: "include",
        includeSubdomains,
        ignoreQueryParameters: true,
        limit,
        timeout: 60_000,
      }),
    });
    const links = Array.isArray(body.links) ? body.links : [];
    return links.map((link) => {
      if (typeof link === "string") return { markdown: "", metadata: { url: link } };
      const item = link as Record<string, unknown>;
      return { markdown: "", metadata: item };
    });
  }

  async start(options: CrawlOptions) {
    const isPublicWebhook = config.appUrl.startsWith("https://");
    const body = await firecrawlFetch("/v2/crawl", {
      method: "POST",
      body: JSON.stringify({
        url: options.url,
        includePaths: options.includePaths,
        excludePaths: options.excludePaths,
        maxDiscoveryDepth: options.maxDepth,
        sitemap: "include",
        ignoreQueryParameters: true,
        limit: options.limit,
        crawlEntireDomain: true,
        allowExternalLinks: false,
        allowSubdomains: options.allowSubdomains,
        maxConcurrency: 5,
        scrapeOptions: {
          formats: ["markdown"],
          onlyMainContent: true,
          parsers: [{ type: "pdf", maxPages: 20 }],
          removeBase64Images: true,
          blockAds: true,
        },
        ...(isPublicWebhook ? {
          webhook: {
            url: `${config.appUrl.replace(/\/$/, "")}/api/integrations/firecrawl/webhook`,
            headers: { "x-smailee-firecrawl-token": firecrawlWebhookToken() },
            metadata: { crawlId: options.crawlId, organizationId: options.organizationId },
            events: ["started", "page", "completed", "failed"],
          },
        } : {}),
      }),
    });
    if (typeof body.id !== "string") throw new Error("Firecrawl не вернул ID задания");
    return { jobId: body.id };
  }

  async status(jobId: string) {
    let next: string | null = `/v2/crawl/${encodeURIComponent(jobId)}`;
    const documents: WebsiteDocument[] = [];
    let latest: Record<string, unknown> = {};
    for (let page = 0; next && page < 25; page++) {
      latest = await firecrawlFetch(next);
      if (Array.isArray(latest.data)) documents.push(...latest.data as WebsiteDocument[]);
      next = typeof latest.next === "string" ? latest.next : null;
    }
    return {
      status: String(latest.status ?? "scraping"),
      total: Number(latest.total ?? documents.length),
      completed: Number(latest.completed ?? documents.length),
      creditsUsed: latest.creditsUsed == null ? undefined : Number(latest.creditsUsed),
      documents,
    };
  }

  async cancel(jobId: string) {
    await firecrawlFetch(`/v2/crawl/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  }
}

export const websiteCrawler: WebsiteCrawler = new FirecrawlCrawler();
