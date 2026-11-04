import { createRuntimeHandler } from "./handler.ts";
import type { ExecutionHandler } from "./handler.ts";

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void };

let handler: Promise<ExecutionHandler> | undefined;
Deno.serve(async request => {
  try {
    handler ??= createRuntimeHandler(name => Deno.env.get(name), work => EdgeRuntime.waitUntil(work));
    return await (await handler)(request);
  } catch {
    // Do not serialize environment/configuration errors or provider credentials.
    return new Response(JSON.stringify({ error: "Execution service is not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
});
