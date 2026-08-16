import { CheckoProvider } from "./checko";
import { DataNewtonProvider, type DataNewtonAuthMode } from "./datanewton";
import { HunterProvider } from "./hunter";

export function checkoFromEnv() { return new CheckoProvider(process.env.CHECKO_API_KEY ?? ""); }
export function hunterFromEnv() { return new HunterProvider(process.env.HUNTER_API_KEY ?? ""); }
export function dataNewtonFromEnv() {
  return new DataNewtonProvider({
    apiKey: process.env.DATANEWTON_API_KEY ?? "",
    baseUrl: process.env.DATANEWTON_BASE_URL ?? "",
    searchPath: process.env.DATANEWTON_SEARCH_PATH ?? "",
    authMode: (process.env.DATANEWTON_AUTH_MODE as DataNewtonAuthMode | undefined) ?? "bearer",
  });
}
