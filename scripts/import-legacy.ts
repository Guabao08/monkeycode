import { closeSync, existsSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** One-time offline import, not a second application backend. Never writes a snapshot file. */
async function main(): Promise<void> {
  if (process.env.MONKEYCODE_LEGACY_STOPPED !== "true") throw new Error("Stop every legacy API process and explicitly acknowledge the offline cutover first.");
  const endpoint = new URL(process.env.SUPABASE_URL ?? "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/" ||
      !(endpoint.protocol === "https:" || endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))) {
    throw new Error("Configure a server-only Supabase URL and service-role key.");
  }
  const path = resolve(process.argv[2] ?? ".data/execution.sqlite");
  const ownershipPath = `${path}.ownership`;
  if (!existsSync(path)) throw new Error("The existing database is required; no new SQLite database will be created.");
  // Older installations predate the sidecar. Create it without replacing any existing lock inode.
  closeSync(openSync(ownershipPath, "a", 0o600));
  const ownership = new DatabaseSync(ownershipPath);
  let database: DatabaseSync | undefined;
  try {
    ownership.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
    database = new DatabaseSync(path, { readOnly: true });
    database.exec("BEGIN");
    const jobs = database.prepare("SELECT id,invite_id,state,created_at,result FROM jobs").all().map(row => ({
      ...row, result: row.result === null ? null : JSON.parse(String(row.result)) as unknown,
    }));
    const counters = database.prepare("SELECT scope,subject,period,count FROM counters").all();
    const minute_reservations = database.prepare("SELECT created_at,cost FROM minute_reservations").all();
    const occupancy = database.prepare("SELECT occupied_until FROM occupancy WHERE singleton=1").get();
    if (!occupancy) throw new Error("Legacy occupancy is missing.");
    const body = JSON.stringify({ version: 1, jobs, counters, minute_reservations, occupied_until: occupancy.occupied_until });
    if (Buffer.byteLength(body, "utf8") > 4 * 1024 * 1024) throw new Error("Snapshot exceeds the bounded administrative import size.");
    database.close();
    database = undefined;
    const response = await fetch(new URL("/rest/v1/rpc/mc_import_legacy", endpoint), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: `{"p_snapshot":${body}}`,
    });
    if (!response.ok) throw new Error("Destination rejected the import. Inspect its state; never reset quotas or blindly retry an ambiguous import.");
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("imported" in result) || result.imported !== true) throw new Error("Import outcome is uncertain; inspect the destination before continuing.");
    console.log("Source-free legacy jobs and current budget reservations imported. Keep the old API stopped; do not clear either database to regain quota.");
  } finally {
    database?.close();
    ownership.close();
  }
}

main().catch(() => {
  // Raw SQLite/HTTP errors can contain configuration or result data.
  console.error("Legacy cutover did not complete. Confirm all old API processes are stopped, destination is empty and server-only credentials are configured. Inspect the destination before any retry; never reset budget counters.");
  process.exitCode = 1;
});
