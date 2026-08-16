import type { CompanyDataProvider } from "./types";

const providers = new Map<string, CompanyDataProvider<unknown>>();

export function registerCompanyProvider(provider: CompanyDataProvider<unknown>) {
  if (providers.has(provider.key)) throw new Error(`Company provider already registered: ${provider.key}`);
  providers.set(provider.key, provider);
}

export function getCompanyProvider(key: string): CompanyDataProvider<unknown> {
  const provider = providers.get(key);
  if (!provider) throw new Error(`Unknown company provider: ${key}`);
  return provider;
}

export function listCompanyProviders(): CompanyDataProvider<unknown>[] {
  return [...providers.values()];
}

export function clearCompanyProvidersForTests() { providers.clear(); }
