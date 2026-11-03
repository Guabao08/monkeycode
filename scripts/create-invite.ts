import { createHash, randomBytes } from "node:crypto";

const id = process.argv[2];
if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || process.argv.length !== 3) {
  console.error("Usage: npm run invite:create -- seat-1\nCreates a private bearer token and its SHA-256 digest. Give the token only to that invitee; configure only the digest on the server.");
  process.exitCode = 1;
} else {
  const token = randomBytes(32).toString("base64url");
  console.log(JSON.stringify({ inviteId: id, token, sha256: createHash("sha256").update(token).digest("hex") }, null, 2));
}
