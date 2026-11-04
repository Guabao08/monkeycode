import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { references, linearAlternatives, strictGreaterMistakes } from "../server/learning/first-at-least";
import type { ExecutionResult, Submission } from "../src/learning/execution";

// Explicit operator command: uses the REAL running backend and hosted provider.
// Up to 29 provider runs, using only the repository-authored programs below.
async function main(): Promise<void> {
  const token = process.env.MONKEYCODE_SMOKE_TOKEN;
  if (!token || token.length < 32) throw new Error("Set MONKEYCODE_SMOKE_TOKEN to an existing invite's private token. No requests were sent.");
  if (process.env.ONLINECOMPILER_RETENTION_ACCEPTED !== "true") throw new Error("Explicit ONLINECOMPILER_RETENTION_ACCEPTED=true is required. No requests were sent.");
  const base = new URL(process.env.MONKEYCODE_SMOKE_URL ?? `http://127.0.0.1:${process.env.MONKEYCODE_PORT ?? "3001"}`);
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/" || (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))) {
    throw new Error("MONKEYCODE_SMOKE_URL must be an HTTPS API origin, or HTTP loopback origin.");
  }
  async function request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(new URL(path, base), {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}; no submission is automatically retried.`);
    return await response.json() as Record<string, unknown>;
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
    let job = await request("/api/jobs", {
      exerciseId: "first-at-least", exerciseVersion: 1,
      language: scenario.language, action: scenario.action, code: scenario.code,
    } satisfies Submission);
    assert.equal(typeof job.id, "string");
    const id = job.id as string;
    const deadline = Date.now() + 180000;
    while (job.status !== "completed") {
      if (Date.now() > deadline) throw new Error("Job did not finish within three minutes. It was not cancelled or resubmitted; inspect its status before another run.");
      await delay(500);
      job = await request(`/api/jobs/${encodeURIComponent(id)}`);
    }
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
