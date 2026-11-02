import type { Language, Length, Scope } from "./types";
export interface Preferences {
  language: Language;
  mode: "generated" | "solution" | "custom";
  length: Length;
  scope: Scope;
}
export interface Run {
  id: string;
  title: string;
  language: Language;
  origin: string;
  completedAt: number;
  cpm: number;
  accuracy: number;
  elapsed: number;
  errors: number;
  code: string;
}
const defaults: Preferences = {
  language: "python",
  mode: "generated",
  length: "short",
  scope: "method",
};
export function loadPreferences(): Preferences {
  try {
    const p = JSON.parse(
      localStorage.getItem("monkeycode.preferences.v1") || "{}",
    );
    return {
      language: p.language === "java" ? "java" : "python",
      mode: ["generated", "solution", "custom"].includes(p.mode)
        ? p.mode
        : "generated",
      length: ["short", "standard", "long", "any"].includes(p.length)
        ? p.length
        : "short",
      scope: p.scope === "full" ? "full" : "method",
    };
  } catch {
    return defaults;
  }
}
export function savePreferences(p: Preferences) {
  try {
    localStorage.setItem("monkeycode.preferences.v1", JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}
let database: Promise<IDBDatabase> | undefined;
function db() {
  if (database) return database;
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  database = promise;
  const request = indexedDB.open("monkeycode", 1);
  request.onupgradeneeded = () =>
    request.result.createObjectStore("runs", { keyPath: "id" });
  request.onsuccess = () => {
    request.result.onversionchange = () => {
      request.result.close();
      database = undefined;
    };
    resolve(request.result);
  };
  request.onerror = () => {
    database = undefined;
    reject(request.error);
  };
  request.onblocked = () => {
    database = undefined;
    reject(new Error("Close other Monkeycode tabs to update history storage."));
  };
  return promise;
}
export async function getRuns(): Promise<Run[]> {
  const database = await db();
  const { promise, resolve, reject } = Promise.withResolvers<Run[]>();
  const request = database.transaction("runs").objectStore("runs").getAll();
  request.onsuccess = () =>
    resolve(
      (request.result as Run[]).sort((a, b) => b.completedAt - a.completedAt),
    );
  request.onerror = () => reject(request.error);
  return promise;
}
export async function saveRun(run: Run) {
  const database = await db();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const tx = database.transaction("runs", "readwrite");
  tx.objectStore("runs").put(run);
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
  return promise;
}
