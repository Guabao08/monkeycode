import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createStaticHandler } from "./static";

const shell = "<!doctype html><html><head><title>Built site</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/assets/app-AbCd1234.js\"></script></body></html>";
const script = "document.getElementById('root').textContent = 'Built application';\n";
const stylesheet = ":root { color: rebeccapurple; }\n";
const font = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]);
const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

async function builtSite(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "monkeycode-static-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "dist");
  await mkdir(join(root, "assets"), { recursive: true });
  await mkdir(join(root, ".private"));
  await mkdir(join(root, "licenses"));
  const files: Record<string, string | Buffer> = {
    "index.html": shell,
    "assets/app-AbCd1234.js": script,
    "assets/app-AbCd1234.css": stylesheet,
    "assets/font-XyZ98765.woff2": font,
    "assets/unhashed.js": "export const publicValue = 1;\n",
    "assets/app-AbCd1234.js.map": "SOURCE_MAP_SECRET",
    "assets/app-AbCd1234.js.MAP": "UPPERCASE_SOURCE_MAP_SECRET",
    "assets/.env": "NESTED_ENV_SECRET",
    ".env": "ENV_SECRET",
    ".env.production": "PRODUCTION_ENV_SECRET",
    ".private/secret.txt": "DOT_DIRECTORY_SECRET",
    "config.env": "ENV_EXTENSION_SECRET",
    "other.html": "UNEXPECTED_HTML_ENTRY",
    "licenses/index.html": "NESTED_HTML_ENTRY",
    "THIRD_PARTY_NOTICES.txt": "Public notices: café\n",
    "icon.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    "empty.txt": "",
  };
  await Promise.all(Object.entries(files).map(([name, value]) => writeFile(join(root, name), value)));
  await writeFile(join(directory, "outside.txt"), "OUTSIDE_ROOT_SECRET");
  return { directory, root };
}

async function serve(t: TestContext, root: string) {
  const handle = createStaticHandler(root);
  const server = createServer((request, response) => {
    void handle(request, response).catch(error => response.destroy(error as Error));
  });
  t.after(async () => {
    server.closeAllConnections();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close(error => error ? reject(error) : resolve());
    await promise;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  function request(path: string, method = "GET"): Promise<HttpResult> {
    const { promise, resolve, reject } = Promise.withResolvers<HttpResult>();
    const outgoing = httpRequest({ hostname: "127.0.0.1", port, path, method, agent: false }, response => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    outgoing.on("error", reject);
    outgoing.end();
    return promise;
  }
  return { request, port };
}

function securityHeaders(result: HttpResult): void {
  assert.equal(result.headers["x-content-type-options"], "nosniff");
  assert.equal(result.headers["x-frame-options"], "DENY");
  assert.equal(result.headers["referrer-policy"], "no-referrer");
  assert.equal(result.headers["content-security-policy"], policy);
  assert.equal(result.headers["strict-transport-security"], undefined);
}

function lengthMatches(result: HttpResult): void {
  assert.equal(result.headers["content-length"], String(result.body.length));
}

test("serves only the built shell and exact public paths with security headers", async t => {
  const { root } = await builtSite(t);
  const site = await serve(t, root);
  for (const path of ["/", "/index.html", "/?ignored=query", "/index.html?cache=bust"]) {
    const result = await site.request(path);
    assert.equal(result.status, 200);
    assert.equal(result.body.toString(), shell);
    assert.equal(result.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(result.headers["cache-control"], "no-cache");
    lengthMatches(result);
    securityHeaders(result);
  }
  const icon = await site.request("/icon.svg");
  assert.equal(icon.status, 200);
  assert.equal(icon.headers["content-type"], "image/svg+xml");
  assert.equal(icon.headers["cache-control"], "public, max-age=0, must-revalidate");
  lengthMatches(icon);
  const notices = await site.request("/THIRD_PARTY_NOTICES.txt");
  assert.equal(notices.status, 200);
  assert.equal(notices.body.toString(), "Public notices: café\n");
  assert.equal(notices.headers["content-type"], "text/plain; charset=utf-8");
  lengthMatches(notices);
  for (const path of ["/other.html", "/licenses/index.html", "/solve", "/index.html/", "/assets", "/does-not-exist"]) {
    const result = await site.request(path);
    assert.equal(result.status, 404, path);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.doesNotMatch(result.body.toString(), /Built site|HTML_ENTRY/);
    securityHeaders(result);
    lengthMatches(result);
  }
});

test("serves hashed scripts, styles and fonts with immutable caching, not unhashed public files", async t => {
  const { root } = await builtSite(t);
  const site = await serve(t, root);
  const cases: [string, string, string | Buffer][] = [
    ["/assets/app-AbCd1234.js", "text/javascript; charset=utf-8", script],
    ["/assets/app-AbCd1234.css", "text/css; charset=utf-8", stylesheet],
    ["/assets/font-XyZ98765.woff2", "font/woff2", font],
  ];
  for (const [path, mime, body] of cases) {
    const result = await site.request(path);
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], mime);
    assert.equal(result.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.deepEqual(result.body, Buffer.from(body));
    lengthMatches(result);
    securityHeaders(result);
  }
  assert.equal((await site.request("/assets/unhashed.js")).headers["cache-control"], "public, max-age=0, must-revalidate");
  const missing = await site.request("/assets/missing-AbCd1234.js");
  assert.equal(missing.status, 404);
  assert.equal(missing.headers["content-type"], "text/plain; charset=utf-8");
  assert.doesNotMatch(missing.body.toString(), /doctype/);
});

test("HEAD preserves GET metadata without a response body, including errors and empty files", async t => {
  const { root } = await builtSite(t);
  const site = await serve(t, root);
  for (const path of ["/", "/assets/app-AbCd1234.js", "/assets/font-XyZ98765.woff2", "/missing", "/%ZZ", "/empty.txt"]) {
    const get = await site.request(path);
    const head = await site.request(path, "HEAD");
    assert.equal(head.status, get.status, path);
    assert.equal(head.body.length, 0);
    for (const header of ["content-type", "content-length", "cache-control", "content-security-policy"]) {
      assert.equal(head.headers[header], get.headers[header], `${path}: ${header}`);
    }
    securityHeaders(head);
  }
});

test("rejects traversal, hidden files, source maps and malformed request paths without filesystem resolution", async t => {
  const { root } = await builtSite(t);
  const site = await serve(t, root);
  for (const path of [
    "/../outside.txt", "/%2e%2e/outside.txt", "/assets/../../outside.txt", "/assets/%2e%2e/%2e%2e/outside.txt",
    "/.env", "/%2eenv", "/.env.production", "/.private/secret.txt", "/assets/.env", "/config.env",
    "/assets/app-AbCd1234.js.map", "/assets/app-AbCd1234.js.MAP", "/assets/app-AbCd1234.js%2emap",
    "/%252eenv", "/%252e%252e/outside.txt",
  ]) {
    const result = await site.request(path);
    assert.equal(result.status, 404, path);
    assert.doesNotMatch(result.body.toString(), /SECRET|Built site/);
    securityHeaders(result);
  }
  for (const path of ["/%", "/%ZZ", "/%E0%A4%A", "/%00", "/assets%5capp-AbCd1234.js", "//attacker.invalid/index.html", "http://attacker.invalid/index.html", "/index.html#fragment"]) {
    const result = await site.request(path);
    assert.equal(result.status, 400, path);
    securityHeaders(result);
  }
});

test("allows only GET and HEAD on all static paths", async t => {
  const { root } = await builtSite(t);
  const site = await serve(t, root);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    for (const path of ["/", "/assets/app-AbCd1234.js", "/missing"]) {
      const result = await site.request(path, method);
      assert.equal(result.status, 405, `${method} ${path}`);
      assert.equal(result.headers.allow, "GET, HEAD");
      assert.equal(result.headers["cache-control"], "no-store");
      lengthMatches(result);
      securityHeaders(result);
    }
  }
});

test("never indexes symlink files or directories, even links within the root", async t => {
  const { directory, root } = await builtSite(t);
  await symlink(join(directory, "outside.txt"), join(root, "outside.txt"));
  await symlink(directory, join(root, "linked-directory"), "dir");
  await symlink(join(root, "assets", "app-AbCd1234.js"), join(root, "linked.js"));
  await symlink(join(root, "assets"), join(root, "linked-assets"), "dir");
  const site = await serve(t, root);
  for (const path of ["/outside.txt", "/linked-directory/outside.txt", "/linked.js", "/linked-assets/app-AbCd1234.js"]) {
    const result = await site.request(path);
    assert.equal(result.status, 404, path);
    assert.doesNotMatch(result.body.toString(), /SECRET|Built application/);
  }
  assert.equal((await site.request("/assets/app-AbCd1234.js")).status, 200);
});

test("fixed manifest ignores new files and rejects file and directory symlink swaps after startup", async t => {
  const { directory, root } = await builtSite(t);
  const site = await serve(t, root);
  await writeFile(join(root, "new.txt"), "NOT_IN_BUILD_MANIFEST");
  assert.equal((await site.request("/new.txt")).status, 404);
  await rm(join(root, "icon.svg"));
  await symlink(join(directory, "outside.txt"), join(root, "icon.svg"));
  assert.equal((await site.request("/icon.svg")).status, 404);
  await mkdir(join(directory, "replacement-assets"));
  await writeFile(join(directory, "replacement-assets", "app-AbCd1234.js"), "SWAPPED_PARENT_SECRET");
  await rename(join(root, "assets"), join(root, "original-assets"));
  await symlink(join(directory, "replacement-assets"), join(root, "assets"), "dir");
  const swapped = await site.request("/assets/app-AbCd1234.js");
  assert.equal(swapped.status, 404);
  assert.doesNotMatch(swapped.body.toString(), /SECRET/);
  await rm(join(root, "assets"));
  await symlink(join(root, "original-assets"), join(root, "assets"), "dir");
  assert.equal((await site.request("/assets/app-AbCd1234.js")).status, 404);
});

test("fails startup for a missing, empty, directory or symlink index and a symlink root", async t => {
  const { directory, root } = await builtSite(t);
  await rm(join(root, "index.html"));
  assert.throws(() => createStaticHandler(root), /index\.html/);
  await writeFile(join(root, "index.html"), "");
  assert.throws(() => createStaticHandler(root), /nonempty/);
  await rm(join(root, "index.html"));
  await mkdir(join(root, "index.html"));
  assert.throws(() => createStaticHandler(root), /index\.html/);
  await rm(join(root, "index.html"), { recursive: true });
  await symlink(join(directory, "outside.txt"), join(root, "index.html"));
  assert.throws(() => createStaticHandler(root), /index\.html/);
  const linkedRoot = join(directory, "linked-root");
  await symlink(root, linkedRoot, "dir");
  assert.throws(() => createStaticHandler(linkedRoot), /symlink/);
});

test("handles a removed build file and client disconnect without preventing later requests", async t => {
  const { root } = await builtSite(t);
  await writeFile(join(root, "assets", "large-AbCd1234.bin"), Buffer.alloc(2 * 1024 * 1024, 0x61));
  const site = await serve(t, root);
  await rm(join(root, "assets", "app-AbCd1234.js"));
  assert.equal((await site.request("/assets/app-AbCd1234.js")).status, 404);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const outgoing = httpRequest({ hostname: "127.0.0.1", port: site.port, path: "/assets/large-AbCd1234.bin", agent: false }, response => {
    assert.equal(response.statusCode, 200);
    response.once("data", () => {
      response.destroy();
      resolve();
    });
    response.on("error", reject);
  });
  outgoing.on("error", reject);
  outgoing.end();
  await promise;
  assert.equal((await site.request("/")).status, 200);
});
