import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, realpathSync } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};

interface StaticFile {
  path: string;
  dev: number;
  ino: number;
  contentType: string;
  cacheControl: string;
}

/** Index an immutable build once; request paths are never resolved against the filesystem. */
export function createStaticHandler(root: string): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const rootPath = resolve(root);
  if (!lstatSync(rootPath).isDirectory()) throw new Error("Static root must be a directory, not a symlink");
  const directory = realpathSync(rootPath);
  const manifest = new Map<string, StaticFile>();

  function index(folder: string, prefix: string): void {
    for (const name of readdirSync(folder)) {
      if (name.startsWith(".") || /(?:\.map|\.env)$/i.test(name) || /[\\?#\x00-\x1f\x7f]/.test(name)) continue;
      const path = join(folder, name);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) continue;
      const url = `${prefix}/${name}`;
      if (metadata.isDirectory()) {
        index(path, url);
      } else if (metadata.isFile() && (url === "/index.html" || !/\.(?:html?|xhtml)$/i.test(name))) {
        manifest.set(url, {
          path, dev: metadata.dev, ino: metadata.ino,
          contentType: contentTypes[extname(name).toLowerCase()] ?? "application/octet-stream",
          cacheControl: url === "/index.html" ? "no-cache" :
            url.startsWith("/assets/") && /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(name) ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
        });
      }
    }
  }
  index(directory, "");
  const entry = manifest.get("/index.html");
  if (!entry) throw new Error("Built static index.html is missing or is not a regular file");
  const descriptor = openSync(entry.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size === 0 || metadata.dev !== entry.dev || metadata.ino !== entry.ino) {
      throw new Error("Built static index.html must be a nonempty regular file");
    }
  } finally { closeSync(descriptor); }

  return async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", contentSecurityPolicy);

    function fail(status: number, message: string): void {
      if (response.destroyed) return;
      response.statusCode = status;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Length", Buffer.byteLength(message));
      response.end(request.method === "HEAD" ? undefined : message);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      fail(405, "Method not allowed\n");
      return;
    }

    const target = request.url ?? "";
    if (!target.startsWith("/") || target.startsWith("//") || /[\\#\x00-\x20\x7f]/.test(target)) {
      fail(400, "Bad request\n");
      return;
    }
    let pathname: string;
    try { pathname = decodeURIComponent(target.split("?", 1)[0]!); }
    catch { fail(400, "Bad request\n"); return; }
    if (/[\\\x00-\x1f\x7f]/.test(pathname)) {
      fail(400, "Bad request\n");
      return;
    }
    if (pathname.split("/").some(part => part.startsWith("."))) {
      fail(404, "Not found\n");
      return;
    }
    const file = manifest.get(pathname === "/" ? "/index.html" : pathname);
    if (!file) { fail(404, "Not found\n"); return; }

    let handle: FileHandle | undefined;
    try {
      if (await realpath(file.path) !== file.path) { fail(404, "Not found\n"); return; }
      // O_NOFOLLOW blocks leaf swaps; identity checks also block replaced parent directories.
      handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.dev !== file.dev || metadata.ino !== file.ino) {
        await handle.close();
        fail(404, "Not found\n");
        return;
      }
      if (request.aborted || response.destroyed) { await handle.close(); return; }
      response.statusCode = 200;
      response.setHeader("Content-Type", file.contentType);
      response.setHeader("Cache-Control", file.cacheControl);
      response.setHeader("Content-Length", metadata.size);
      if (request.method === "HEAD" || metadata.size === 0) {
        await handle.close();
        response.end();
        return;
      }
      const stream = handle.createReadStream({ autoClose: true, highWaterMark: 64 * 1024, end: metadata.size - 1 });
      // pipeline destroys the file stream on disconnect and the response on a late read error.
      await pipeline(stream, response);
    } catch {
      await handle?.close().catch(() => {});
      if (!response.headersSent && !response.destroyed) fail(404, "Not found\n");
      else if (!response.destroyed) response.destroy();
    }
  };
}
