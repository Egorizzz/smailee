type JsonSchema = Record<string, unknown>;

export type DeepseekStrictTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

const stringArray = (): JsonSchema => ({ type: "array", items: { type: "string" } });
const nullableString = (): JsonSchema => ({ anyOf: [{ type: "string" }, { type: "null" }] });

const pageFactSchema: JsonSchema = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: [
        "identity",
        "offer",
        "product",
        "pricing",
        "audience",
        "pain",
        "differentiator",
        "proof",
        "geography",
        "sales_process",
        "restriction",
        "tone",
      ],
    },
    value: { type: "string" },
    evidence: { type: "string" },
    confidence: { type: "number" },
    sensitive: { type: "boolean" },
  },
  required: ["category", "value", "evidence", "confidence", "sensitive"],
  additionalProperties: false,
};

export const PAGE_ANALYSIS_TOOL: DeepseekStrictTool = {
  name: "submit_page_analysis",
  description: "Return the structured business facts extracted from one website page",
  parameters: {
    type: "object",
    properties: {
      relevant: { type: "boolean" },
      summary: { type: "string" },
      facts: { type: "array", items: pageFactSchema },
    },
    required: ["relevant", "summary", "facts"],
    additionalProperties: false,
  },
};

const businessProductSchema: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    pricing: { type: "string" },
    pricingConfirmed: { type: "boolean" },
    sourceUrl: { type: "string" },
  },
  required: ["name", "description", "pricing", "pricingConfirmed", "sourceUrl"],
  additionalProperties: false,
};

const profileSourceSchema: JsonSchema = {
  type: "object",
  properties: {
    url: { type: "string" },
    title: { type: "string" },
  },
  required: ["url", "title"],
  additionalProperties: false,
};

const generatedQuestionSchema: JsonSchema = {
  type: "object",
  properties: {
    category: { type: "string" },
    question: { type: "string" },
    reason: { type: "string" },
    critical: { type: "boolean" },
  },
  required: ["category", "question", "reason", "critical"],
  additionalProperties: false,
};

const manualOverrideKeys = [
  "companyName",
  "websiteUrl",
  "summary",
  "offers",
  "products",
  "targetAudiences",
  "painPoints",
  "differentiators",
  "proof",
  "geography",
  "salesProcess",
  "restrictions",
  "tone",
  "manualNotes",
];

export const BUSINESS_PROFILE_TOOL: DeepseekStrictTool = {
  name: "submit_business_profile",
  description: "Return the complete B2B company profile and clarification questions",
  parameters: {
    type: "object",
    properties: {
      profile: {
        type: "object",
        properties: {
          schemaVersion: { type: "integer", enum: [1] },
          companyName: nullableString(),
          websiteUrl: nullableString(),
          summary: { type: "string" },
          offers: stringArray(),
          products: { type: "array", items: businessProductSchema },
          targetAudiences: stringArray(),
          painPoints: stringArray(),
          differentiators: stringArray(),
          proof: stringArray(),
          geography: stringArray(),
          salesProcess: stringArray(),
          restrictions: stringArray(),
          tone: { type: "string" },
          manualNotes: { type: "string" },
          unknowns: stringArray(),
          sources: { type: "array", items: profileSourceSchema },
          manualOverrides: { type: "array", items: { type: "string", enum: manualOverrideKeys } },
        },
        required: [
          "schemaVersion",
          "companyName",
          "websiteUrl",
          "summary",
          "offers",
          "products",
          "targetAudiences",
          "painPoints",
          "differentiators",
          "proof",
          "geography",
          "salesProcess",
          "restrictions",
          "tone",
          "manualNotes",
          "unknowns",
          "sources",
          "manualOverrides",
        ],
        additionalProperties: false,
      },
      questions: { type: "array", items: generatedQuestionSchema },
    },
    required: ["profile", "questions"],
    additionalProperties: false,
  },
};

/** DeepSeek strict mode requires every object field to be required and forbids extras. */
export function strictSchemaContractIssues(schema: unknown, path = "$"): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const value = schema as Record<string, unknown>;
  const issues: string[] = [];

  if (value.type === "object") {
    const properties = value.properties && typeof value.properties === "object" && !Array.isArray(value.properties)
      ? value.properties as Record<string, unknown>
      : {};
    const required = Array.isArray(value.required) ? new Set(value.required.filter((item): item is string => typeof item === "string")) : new Set<string>();
    if (value.additionalProperties !== false) issues.push(`${path}: additionalProperties must be false`);
    for (const [key, child] of Object.entries(properties)) {
      if (!required.has(key)) issues.push(`${path}.${key}: property must be required`);
      issues.push(...strictSchemaContractIssues(child, `${path}.${key}`));
    }
  }

  if (value.type === "array") issues.push(...strictSchemaContractIssues(value.items, `${path}[]`));
  if (Array.isArray(value.anyOf)) {
    value.anyOf.forEach((child, index) => issues.push(...strictSchemaContractIssues(child, `${path}.anyOf[${index}]`)));
  }
  return issues;
}
