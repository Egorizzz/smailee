import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  checkoFromEnv, companySearchLimit, dataNewtonFromEnv, hunterFromEnv,
  runProspectingPipeline, type DataNewtonQuery,
} from "@/lib/company-data";
import { prisma } from "@/lib/prisma";
import { productErrorResponse } from "@/lib/productErrors";

export const maxDuration = 900;

const schema = z.object({
  query: z.record(z.string(), z.unknown()),
  target: z.number().int().min(1).max(250).default(250),
  maxCandidates: z.number().int().min(1).max(1_000).default(500),
  confirmed: z.literal(true),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return Response.json({ error: "Только для администратора" }, { status: 403 });
  try {
    const body = schema.parse(await request.json());
    const maxCandidates = companySearchLimit(body.maxCandidates);
    const result = await runProspectingPipeline({
      prisma, selector: dataNewtonFromEnv(), verifier: checkoFromEnv(), hunter: hunterFromEnv(),
      query: { ...body.query, limit: maxCandidates } as DataNewtonQuery,
      target: Math.min(body.target, maxCandidates), maxCandidates,
    });
    return Response.json({ generatedAt: new Date().toISOString(), result });
  } catch (error) {
    return productErrorResponse(error, "SRC-2001");
  }
}
