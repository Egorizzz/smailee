import { CheckoProvider } from "./checko";
import { DataNewtonProvider, type DataNewtonAuthMode } from "./datanewton";
import { HunterProvider } from "./hunter";
import { ReoonProvider } from "./reoon";

export function checkoFromEnv() { return new CheckoProvider(process.env.CHECKO_API_KEY ?? ""); }
export function hunterFromEnv() { return new HunterProvider(process.env.HUNTER_API_KEY ?? ""); }
export function reoonFromEnv() { return new ReoonProvider(process.env.REOON_API_KEY ?? ""); }
export function dataNewtonFromEnv() {
  return new DataNewtonProvider({
    apiKey: process.env.DATANEWTON_API_KEY ?? "",
    baseUrl: process.env.DATANEWTON_BASE_URL ?? "",
    searchPath: process.env.DATANEWTON_SEARCH_PATH ?? "",
    counterpartyPath: process.env.DATANEWTON_COUNTERPARTY_PATH ?? "/v1/counterparty",
    authMode: (process.env.DATANEWTON_AUTH_MODE as DataNewtonAuthMode | undefined) ?? "bearer",
  });
}
