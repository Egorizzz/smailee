import { readFile } from "node:fs/promises";

const bundlePath = new URL("../dist/worker.js", import.meta.url);
const bundle = await readFile(bundlePath, "utf8");
const serverOnlyRuntimeError = "This module cannot be imported from a Client Component module";

if (bundle.includes(serverOnlyRuntimeError)) {
  throw new Error(
    "Worker bundle contains the throwing server-only browser guard. Build it with the react-server condition.",
  );
}

console.log("[build:worker] OK: server-only guard is not present in the worker bundle");
