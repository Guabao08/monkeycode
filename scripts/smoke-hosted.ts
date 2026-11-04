import assert from "node:assert/strict";
import { references, linearAlternatives, strictGreaterMistakes } from "../server/learning/first-at-least";
import type { ExecutionResult, Submission } from "../src/learning/execution";

// Explicit operator command: uses the REAL running backend and hosted provider.
// Up to 29 provider runs, using only the repository-authored programs below.
async function main(): Promise<void> {
  const token = process.env.MONKEYCODE_SMOKE_TOKEN;
  if (!token || token.length < 32) throw new Error("Set MONKEYCODE_SMOKE_TOKEN to an existing invite's private token. No requests were sent.");
  if (process.env.ONLINECOMPILER_RETENTION_ACCEPTED !== "true") throw new Error("Explicit ONLINECOMPILER_RETENTION_ACCEPTED=true is required. No requests were sent.");
  const base = new URL(process.env.MONKEYCODE_SMOKE_URL ?? "http://127.0.0.1:5173");
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/" || (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))) {
    throw new Error("MONKEYCODE_SMOKE_URL must be an HTTPS API origin, or HTTP loopback origin.");
  }
  async function request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(new URL(path, base), {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(body ? 125_000 : 5000),
    });
    if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}; no submission is automatically retried.`);
    if (!body) return await response.json() as Record<string, unknown>;
    assert.match(response.headers.get("content-type") ?? "", /^application\/x-ndjson/);
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    let bytes = 0;
    let admitted: Record<string, unknown> | undefined;
    let completed: Record<string, unknown> | undefined;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { buffer += decoder.decode(); break; }
        bytes += chunk.value.byteLength;
        assert.ok(bytes <= 64 * 1024);
        buffer += decoder.decode(chunk.value, { stream: true });
        while (buffer.includes("\n")) {
          const newline = buffer.indexOf("\n");
          const event = JSON.parse(buffer.slice(0, newline)) as { type: string; job: Record<string, unknown> };
          buffer = buffer.slice(newline + 1);
          if (!admitted) {
            assert.equal(event.type, "admitted");
            assert.match(String(event.job.id), /^[a-f0-9-]{36}$/);
            admitted = event.job;
            console.log(`Admitted job ${admitted.id}; recover this ID, never replay its POST.`);
          } else {
            assert.equal(completed, undefined);
            assert.equal(event.type, "completed");
            assert.equal(event.job.id, admitted.id);
            assert.equal(event.job.status, "completed");
            completed = event.job;
          }
        }
      }
      assert.equal(buffer.trim(), "");
      assert.ok(completed);
      return completed;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  await request("/api/exercises/first-at-least");
  console.log("Real hosted smoke: five sequential jobs, up to 29 provider runs; no automatic resubmission.");
  const scenarios: { language: Submission["language"]; action: Submission["action"]; code: string; expected: ExecutionResult["status"] }[] = [
    { language: "python", action: "submit", code: references.python, expected: "passed" },
    { language: "java", action: "submit", code: references.java, expected: "passed" },
    { language: "python", action: "submit", code: linearAlternatives.python, expected: "passed" },
    { language: "python", action: "run", code: strictGreaterMistakes.python, expected: "wrong-answer" },
    // Java uses source-launcher mode: compilation happens inside the timed run,
    // so native runtime_error carries its compilation diagnostics. Preserve the
    // provider verdict rather than classifying learner-controlled stderr.
    { language: "java", action: "run", code: "public int firstAtLeast(int[] values, int target) { return; }", expected: "runtime-error" },
  ];
  for (const scenario of scenarios) {
    const job = await request("/api/jobs", {
      exerciseId: "first-at-least", exerciseVersion: 1,
      language: scenario.language, action: scenario.action, code: scenario.code,
    } satisfies Submission);
    assert.equal(typeof job.id, "string");
    const id = job.id as string;
    const durable = await request(`/api/jobs/${encodeURIComponent(id)}`);
    assert.equal((durable.result as ExecutionResult).status, (job.result as ExecutionResult).status);
    const result = job.result as ExecutionResult;
    assert.equal(result.status, scenario.expected, `${scenario.language} ${scenario.action}`);
    assert.equal(result.implementationComplexityVerified, false);
    console.log(`${scenario.language} ${scenario.action}: ${result.status}`);
  }
}

main().catch(() => {
  // Do not print raw fetch errors or provider diagnostics; they can contain data.
  console.error("Hosted smoke did not complete. Check invite/retention configuration, API availability, quotas and job status before retrying. No failed or ambiguous submission was automatically resubmitted.");
  process.exitCode = 1;
});
