import { resolve } from "node:path";

export interface ApiConfig {
  apiKey: string;
  retentionAccepted: true;
  executionEnabled: boolean;
  invites: readonly { id: string; digest: Buffer }[];
  allowedOrigin: string;
  dbPath: string;
  host: string;
  port: number;
  inviteDailyLimit: number;
  globalDailyLimit: number;
  monthlyRunLimit: number;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = env[name];
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

function boolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name];
  if (value === undefined) return fallback;
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
  return value === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const apiKey = env.ONLINECOMPILER_API_KEY?.trim();
  if (!apiKey) throw new Error("ONLINECOMPILER_API_KEY is required");
  if (env.ONLINECOMPILER_RETENTION_ACCEPTED !== "true") {
    throw new Error("ONLINECOMPILER_RETENTION_ACCEPTED=true is required: the provider retains source, input and output while the account remains active");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(env.MONKEYCODE_INVITES_JSON ?? ""); }
  catch { throw new Error("MONKEYCODE_INVITES_JSON must be an invite-ID to SHA256-digest object"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid invite configuration");
  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > 10) throw new Error("Configure between one and ten invites");
  const seen = new Set<string>();
  const invites = entries.map(([id, digest]) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof digest !== "string" || !/^[a-fA-F0-9]{64}$/.test(digest)) {
      throw new Error("Invite IDs must be stable identifiers and token digests must be 32-byte hex SHA256 values");
    }
    const normalized = digest.toLowerCase();
    if (seen.has(normalized)) throw new Error("Invite token digests must be unique");
    seen.add(normalized);
    return { id, digest: Buffer.from(normalized, "hex") };
  });
  const allowedOrigin = env.MONKEYCODE_ALLOWED_ORIGIN ?? "http://127.0.0.1:5173";
  let origin: URL;
  try { origin = new URL(allowedOrigin); } catch { throw new Error("Invalid MONKEYCODE_ALLOWED_ORIGIN"); }
  if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== allowedOrigin) throw new Error("MONKEYCODE_ALLOWED_ORIGIN must be one exact HTTP(S) origin");
  const host = env.MONKEYCODE_HOST ?? "127.0.0.1";
  const dbPath = env.MONKEYCODE_DB_PATH ?? ".data/execution.sqlite";
  if (!host.trim() || !dbPath.trim() || dbPath === ":memory:") throw new Error("A host and persistent database path are required");
  return {
    apiKey, retentionAccepted: true,
    executionEnabled: boolean(env, "MONKEYCODE_EXECUTION_ENABLED", false),
    invites, allowedOrigin, dbPath: resolve(dbPath), host,
    port: integer(env, "MONKEYCODE_PORT", 3001, 65535),
    inviteDailyLimit: integer(env, "MONKEYCODE_INVITE_DAILY_LIMIT", 30),
    globalDailyLimit: integer(env, "MONKEYCODE_GLOBAL_DAILY_LIMIT", 300),
    monthlyRunLimit: integer(env, "MONKEYCODE_MONTHLY_RUN_LIMIT", 90000),
  };
}
