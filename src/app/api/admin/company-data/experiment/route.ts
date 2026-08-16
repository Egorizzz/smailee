import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  checkoFromEnv, dataNewtonFromEnv, hunterFromEnv, runProviderExperiment,
  type CheckoQuery, type DataNewtonQuery,
} from "@/lib/company-data";
import { z } from "zod";

const bodySchema = z.object({
  checko: z.record(z.string(), z.unknown()).optional(),
  datanewton: z.record(z.string(), z.unknown()).optional(),
  hunterLimitPerDomain: z.number().int().min(1).max(100).default(10),
}).refine((value) => value.checko || value.datanewton, "Specify checko and/or datanewton query");

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return Response.json({ error: "Только для администратора" }, { status: 403 });
  try {
    const body = bodySchema.parse(await request.json());
    const hunter = hunterFromEnv();
    const results = [];
    if (body.checko) results.push(await runProviderExperiment({
      prisma, companyProvider: checkoFromEnv(), hunterProvider: hunter,
      query: body.checko as CheckoQuery, hunterLimitPerDomain: body.hunterLimitPerDomain,
    }));
    if (body.datanewton) results.push(await runProviderExperiment({
      prisma, companyProvider: dataNewtonFromEnv(), hunterProvider: hunter,
      query: body.datanewton as DataNewtonQuery, hunterLimitPerDomain: body.hunterLimitPerDomain,
    }));
    return Response.json({ generatedAt: new Date().toISOString(), results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выполнить тестовую выгрузку";
    return Response.json({ error: message }, { status: 400 });
  }
}
