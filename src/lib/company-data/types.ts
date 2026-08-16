import type { CompanyFieldType } from "@prisma/client";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type CompanyFields = Record<string, JsonValue>;

export type CompanyIdentity = {
  countryCode?: string;
  inn?: string;
  ogrn?: string;
  domain?: string;
};

export type ProviderCompany = {
  externalId: string;
  identity?: CompanyIdentity;
  legalName?: string;
  displayName?: string;
  website?: string;
  status?: string;
  fields?: CompanyFields;
  raw: JsonValue;
  sourceUpdatedAt?: Date;
};

export type ProviderUsage = { requests: number; credits?: number; creditsEstimated?: boolean };
export type ProviderPage = { items: ProviderCompany[]; nextCursor?: string; usage?: ProviderUsage };

export interface CompanyDataProvider<Query = unknown> {
  readonly key: string;
  readonly name: string;
  readonly capabilities: Record<string, JsonValue>;
  readonly fieldDefinitions?: readonly ProviderFieldDefinition[];
  search(query: Query, cursor?: string): Promise<ProviderPage>;
  getByIds?(externalIds: string[]): Promise<ProviderCompany[]>;
}

export type ProviderFieldDefinition = {
  key: string;
  type: CompanyFieldType;
  label?: string;
  filterable?: boolean;
  facetable?: boolean;
};

export type FieldOperator =
  | "eq" | "neq" | "in" | "contains" | "startsWith"
  | "gt" | "gte" | "lt" | "lte" | "between" | "exists";

export type FieldFilter = {
  field: string;
  operator: FieldOperator;
  value?: JsonValue;
  valueType?: CompanyFieldType;
};

export type CompanyFilter =
  | FieldFilter
  | { and: CompanyFilter[] }
  | { or: CompanyFilter[] }
  | { not: CompanyFilter };

export type TypedFieldValue = {
  type: CompanyFieldType;
  stringValue?: string;
  numberValue?: string;
  booleanValue?: boolean;
  dateValue?: Date;
  stringList?: string[];
  jsonValue?: JsonValue;
  rawValue: JsonValue;
};
