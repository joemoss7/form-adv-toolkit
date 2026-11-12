// Downloading from the SEC. The SEC asks automated clients to identify themselves
// (https://www.sec.gov/os/accessing-edgar-data): set SEC_USER_AGENT to something like
// "Your Name or Org your@email.com". Requests are made one at a time.
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { rename } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const userAgent = () => (process.env.SEC_USER_AGENT || "").trim() || "form-adv-toolkit (https://github.com/joemoss7/form-adv-toolkit)";

export async function get(url, { timeout = 60_000 } = {}) {
  return fetch(url, { headers: { "User-Agent": userAgent(), Accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
}

// Saves url to path (skipped if the file is already there, so reruns reuse the cache).
export async function download(url, path, { log = () => {} } = {}) {
  if (existsSync(path)) { log(`cached ${path}`); return path; }
  mkdirSync(dirname(path), { recursive: true });
  const res = await get(url, { timeout: 60 * 60_000 });
  if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);
  log(`downloading ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${path}.part`));
  await rename(`${path}.part`, path);
  return path;
}
