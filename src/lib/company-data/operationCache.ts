import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

export const EXTERNAL_DATA_TTL_DAYS = 180;

export type CachedOperationResult<T> = {
  value: T;
  cacheHit: boolean;
  requests: number;
  credits: number;
};

export async function cachedExternalOperation<T>(input: {
  prisma: PrismaClient;
  provider: string;
  operation: string;
  params: unknown;
  execute: () => Promise<T>;
  usage?: (value: T) => { requests?: number; credits?: number } | undefined;
  now?: Date;
}): Promise<CachedOperationResult<T>> {
  const now = input.now ?? new Date();
  const normalized = stableJson(input.params);
  const operationKey = `${input.provider}:${input.operation}:${createHash("sha256").update(normalized).digest("hex")}`;
  const cached = await input.prisma.externalDataOperation.findUnique({ where: { operationKey } });
  if (cached && cached.expiresAt > now && cached.status === "SUCCESS") {
    return { value: cached.result as T, cacheHit: true, requests: 0, credits: 0 };
  }

  const value = await input.execute();
  const usage = input.usage?.(value);
  const expiresAt = new Date(now.getTime() + EXTERNAL_DATA_TTL_DAYS * 86_400_000);
  await input.prisma.externalDataOperation.upsert({
    where: { operationKey },
    create: {
      operationKey, provider: input.provider, operation: input.operation,
      input: JSON.parse(normalized) as Prisma.InputJsonValue,
      result: JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue,
      requests: usage?.requests ?? 1, credits: usage?.credits ?? 0, executedAt: now, expiresAt,
    },
    update: {
      result: JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue,
      status: "SUCCESS", requests: usage?.requests ?? 1, credits: usage?.credits ?? 0,
      executedAt: now, expiresAt,
    },
  });
  return { value, cacheHit: false, requests: usage?.requests ?? 1, credits: usage?.credits ?? 0 };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]));
}
