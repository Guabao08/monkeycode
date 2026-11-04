import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ApiConfig } from "./config";
import { executionCost } from "./execution/types";
import type { ExecutionResult, Submission, JobView } from "../src/learning/execution";

export const QUARANTINE_MS = 120_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
export type JobState = "queued" | "running" | "finished";
interface JobRow { id: string; state: JobState; created_at: number; result: string | null }
export class AdmissionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export const unavailableResult: ExecutionResult = {
  status: "service-error", message: "Execution unavailable. This job will not be retried; reserved quota is not refunded.", implementationComplexityVerified: false,
};

/** Only whitelisted feedback is durable; compiler diagnostics and arbitrary outputs can contain learner source. */
function durableResult(result: ExecutionResult): ExecutionResult {
  const safe: ExecutionResult = { status: result.status, implementationComplexityVerified: false };
  if (result.status === "service-error") return unavailableResult;
  if (result.feedback && "failureCategories" in result.feedback) safe.feedback = result.feedback;
  else if (result.feedback && "cases" in result.feedback) {
    safe.feedback = { status: result.feedback.status, cases: result.feedback.cases.map(item => ({
      ...item, actual: typeof item.actual === "number" || typeof item.actual === "boolean" ? item.actual : null,
    })) };
  }
  return safe;
}

export class JobStore {
  private readonly db: DatabaseSync;
  private readonly owner = randomUUID();
  private closed = false;
  constructor(private readonly config: ApiConfig) {
    mkdirSync(dirname(config.dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(config.dbPath);
    chmodSync(config.dbPath, 0o600);
    try {
      this.db.exec(`PRAGMA busy_timeout=5000;
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS ownership (singleton INTEGER PRIMARY KEY CHECK(singleton=1), pid INTEGER NOT NULL, token TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS occupancy (singleton INTEGER PRIMARY KEY CHECK(singleton=1), occupied_until INTEGER NOT NULL);
        INSERT OR IGNORE INTO occupancy VALUES (1,0);
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, invite_id TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, result TEXT);
        CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created_at);
        CREATE TABLE IF NOT EXISTS counters (scope TEXT NOT NULL, subject TEXT NOT NULL, period TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(scope,subject,period));
        CREATE TABLE IF NOT EXISTS minute_reservations (created_at INTEGER NOT NULL, cost INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS reservations_created ON minute_reservations(created_at);`);
      this.transaction(() => {
        const prior = this.db.prepare("SELECT pid FROM ownership WHERE singleton=1").get() as { pid: number } | undefined;
        if (prior) {
          let alive = true;
          try { process.kill(prior.pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
          if (alive) throw new Error("Execution database is already owned by another API process");
        }
        this.db.prepare("INSERT OR REPLACE INTO ownership VALUES (1,?,?)").run(process.pid, this.owner);
        const unfinished = this.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE state != 'finished'").get() as { count: number };
        if (prior || unfinished.count > 0) this.quarantine(Date.now());
        this.db.prepare("UPDATE jobs SET state='finished', result=? WHERE state != 'finished'").run(JSON.stringify(unavailableResult));
        this.prune(Date.now());
      });
    } catch (error) { this.db.close(); throw error; }
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private quarantine(now: number): void {
    this.db.prepare("UPDATE occupancy SET occupied_until=MAX(occupied_until,?) WHERE singleton=1").run(now + QUARANTINE_MS);
  }
  prune(now = Date.now()): void {
    this.db.prepare("DELETE FROM jobs WHERE state='finished' AND created_at < ?").run(now - RETENTION_MS);
    this.db.prepare("DELETE FROM minute_reservations WHERE created_at <= ?").run(now - 60_000);
    this.db.prepare("DELETE FROM counters WHERE (scope != 'month' AND period < ?) OR (scope='month' AND period < ?)")
      .run(new Date(now).toISOString().slice(0, 10), new Date(now).toISOString().slice(0, 7));
  }
  private count(scope: string, subject: string, period: string): number {
    const row = this.db.prepare("SELECT count FROM counters WHERE scope=? AND subject=? AND period=?").get(scope, subject, period) as { count: number } | undefined;
    return row?.count ?? 0;
  }
  private increment(scope: string, subject: string, period: string, amount: number): void {
    this.db.prepare("INSERT INTO counters VALUES (?,?,?,?) ON CONFLICT(scope,subject,period) DO UPDATE SET count=count+excluded.count")
      .run(scope, subject, period, amount);
  }
  admit(inviteId: string, action: Submission["action"]): JobView {
    if (this.closed) throw new AdmissionError(503, "Execution unavailable");
    return this.transaction(() => {
      const now = Date.now();
      this.prune(now);
      const active = this.db.prepare("SELECT id FROM jobs WHERE state != 'finished' LIMIT 1").get();
      const occupied = this.db.prepare("SELECT occupied_until FROM occupancy WHERE singleton=1").get() as { occupied_until: number };
      if (active || occupied.occupied_until > now) throw new AdmissionError(429, "Execution capacity is occupied; no quota was reserved");
      const day = new Date(now).toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const cost = executionCost(action);
      const minute = this.db.prepare("SELECT COALESCE(SUM(cost),0) AS count FROM minute_reservations").get() as { count: number };
      if (this.count("invite-day", inviteId, day) >= this.config.inviteDailyLimit ||
          this.count("global-day", "all", day) >= this.config.globalDailyLimit ||
          this.count("month", "all", month) + cost > this.config.monthlyRunLimit || minute.count + cost > 30) {
        throw new AdmissionError(429, "Execution quota exhausted; no quota was reserved");
      }
      const id = randomUUID();
      this.increment("invite-day", inviteId, day, 1);
      this.increment("global-day", "all", day, 1);
      this.increment("month", "all", month, cost);
      this.db.prepare("INSERT INTO minute_reservations VALUES (?,?)").run(now, cost);
      this.db.prepare("INSERT INTO jobs VALUES (?,?,'queued',?,NULL)").run(id, inviteId, now);
      this.quarantine(now);
      return { id, status: "queued", createdAt: new Date(now).toISOString() };
    });
  }
  running(id: string): void { this.db.prepare("UPDATE jobs SET state='running' WHERE id=? AND state='queued'").run(id); }
  finish(id: string, result: ExecutionResult): void {
    if (this.closed) return;
    this.transaction(() => {
      this.db.prepare("UPDATE jobs SET state='finished',result=? WHERE id=?").run(JSON.stringify(durableResult(result)), id);
      if (result.status === "service-error") this.quarantine(Date.now());
      else this.db.prepare("UPDATE occupancy SET occupied_until=0 WHERE singleton=1").run();
    });
  }
  get(id: string, inviteId: string): JobView | undefined {
    this.prune();
    const row = this.db.prepare("SELECT id,state,created_at,result FROM jobs WHERE id=? AND invite_id=?").get(id, inviteId) as unknown as JobRow | undefined;
    if (!row) return undefined;
    return { id: row.id, status: row.state === "finished" ? "completed" : row.state, createdAt: new Date(row.created_at).toISOString(), ...(row.result ? { result: JSON.parse(row.result) as ExecutionResult } : {}) };
  }
  close(): void {
    if (this.closed) return;
    this.transaction(() => {
      const active = this.db.prepare("SELECT id FROM jobs WHERE state != 'finished' LIMIT 1").get();
      if (active) this.quarantine(Date.now());
      this.db.prepare("UPDATE jobs SET state='finished',result=? WHERE state != 'finished'").run(JSON.stringify(unavailableResult));
      this.db.prepare("DELETE FROM ownership WHERE token=?").run(this.owner);
    });
    this.closed = true;
    this.db.close();
  }
}
