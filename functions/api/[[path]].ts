interface Context {
  request: Request;
  env: { EXECUTION_API_URL?: string };
}

const jobPath = /^\/api\/jobs\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const error = (status: number, message: string) => new Response(JSON.stringify({ error: message }), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

/** Fixed upstream only. Never log bodies, invites, diagnostics or provider credentials. */
export async function onRequest({ request, env }: Context): Promise<Response> {
  const incoming = new URL(request.url);
  const path = incoming.pathname;
  if (incoming.search || !(path === "/api/jobs" || path === "/api/exercises/first-at-least" || jobPath.test(path))) {
    return error(404, "Not found.");
  }
  if (request.method !== "GET" && !(request.method === "POST" && path === "/api/jobs")) return error(405, "Method not allowed.");
  let upstream: URL;
  try {
    upstream = new URL(env.EXECUTION_API_URL ?? "");
    if (upstream.protocol !== "https:" || upstream.username || upstream.password || upstream.search || upstream.hash ||
        upstream.pathname !== "/functions/v1/execution") throw new Error("Invalid endpoint");
  } catch {
    return error(503, "Execution is not configured.");
  }
  const headers = new Headers();
  for (const name of ["Authorization", "Content-Type", "Origin"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (request.method === "POST") {
    const reader = request.body?.getReader();
    if (!reader) return error(400, "A submission body is required.");
    const buffer = new Uint8Array(40 * 1024);
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (size + chunk.value.byteLength > buffer.byteLength) {
          await reader.cancel();
          return error(413, "Submission body is too large.");
        }
        buffer.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
      body = buffer.subarray(0, size);
    } catch {
      return error(400, "Submission body was interrupted.");
    } finally {
      reader.releaseLock();
    }
  }
  try {
    const response = await fetch(`${upstream.href}${path}`, {
      method: request.method, headers, body, redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(130_000),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("Upstream redirects are not permitted.");
    }
    // Pass the body through without buffering: admission must arrive before execution completes.
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    // A failed upstream read may follow admission. Never report this as a definite rejection.
    return error(502, "Execution connection was interrupted. Check an existing job before resubmitting.");
  }
}
