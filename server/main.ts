import { resolve } from "node:path";
import { createApi } from "./api";
import { loadConfig } from "./config";
import { OnlineCompilerExecutor } from "./execution/onlinecompiler";

try {
  const config = loadConfig();
  if (process.argv.includes("--serve-web")) config.webRoot = resolve("dist");
  const server = createApi(config, new OnlineCompilerExecutor(config.apiKey));
  let stopping = false;
  const stop = async (exitCode: number) => {
    if (stopping) return;
    stopping = true;
    try {
      await server.shutdown();
    } catch {
      console.error("Execution API shutdown failed; check the persistent job database before restarting.");
      exitCode = 1;
    }
    process.exitCode = exitCode;
  };
  server.on("error", () => {
    console.error("Execution API could not listen. Check the configured host, port and database permissions.");
    void stop(1);
  });
  process.once("SIGINT", () => void stop(0));
  process.once("SIGTERM", () => void stop(0));
  server.listen(config.port, config.host, () => {
    console.log(JSON.stringify({ service: "monkeycode-execution", host: config.host, port: config.port, executionEnabled: config.executionEnabled }));
  });
} catch (error) {
  // Configuration errors describe field names, never their secret values.
  console.error(error instanceof Error ? error.message : "Unable to initialize execution API.");
  process.exitCode = 1;
}
