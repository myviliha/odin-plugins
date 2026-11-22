#!/usr/bin/env node
/**
 * /odin:map: scan the code under a folder and send its structure (never source text) to ODIN's Company Map.
 *   node map.mjs --project <id> [--root <dir>] [--request <text>] [--depth n] [--dry-run] [--json]
 *   VILIHA_API / VILIHA_TOKEN as the hooks. VILIHA_RECORD=off or VILIHA_MAP=off: nothing is sent.
 * The last sent ids and hashes are kept in <root>/.odin/map-cache.json (that folder ignores itself) so removed files are reported.
 * Standard library only.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { token } from "../hooks/stream.mjs";
import { hashes, scanRoot, summary, toDeltas } from "./build.mjs";

export function parseArgs(argv) {
  const o = { json: false, dry: false, depth: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.json = true;
    else if (a === "--dry-run") o.dry = true;
    else if (["--project", "--root", "--request", "--depth"].includes(a)) o[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  o.depth = Number(o.depth) || 3;
  return o;
}

export const paused = (env = process.env) => env.VILIHA_RECORD === "off" || env.VILIHA_MAP === "off";

const cachePath = (root) => join(root, ".odin", "map-cache.json");
export function readCache(root, project) {
  try {
    return JSON.parse(readFileSync(cachePath(root), "utf8"))[project] ?? {};
  } catch {
    return {};
  }
}
export function writeCache(root, project, ids) {
  let all = {};
  try {
    all = JSON.parse(readFileSync(cachePath(root), "utf8"));
  } catch {
    // first run
  }
  mkdirSync(join(root, ".odin"), { recursive: true });
  writeFileSync(join(root, ".odin", ".gitignore"), "*\n");
  writeFileSync(cachePath(root), JSON.stringify({ ...all, [project]: ids }));
}

/** Run one scan: returns { summary, sent, reports, error }. Never sends when dry, paused, or without a token. */
export async function run(opts, { env = process.env, fetchImpl = fetch, auth = token(env) } = {}) {
  const root = resolve(opts.root ?? process.cwd());
  const project = opts.project ?? env.VILIHA_PROJECT;
  if (!project) return { error: "no project: pass --project <id>" };
  const scan = scanRoot(root, { depth: opts.depth });
  const deltas = toDeltas(scan, readCache(root, project), { request: opts.request });
  const out = { summary: summary(scan, deltas), sent: false, reports: [] };
  if (opts.dry) return out;
  if (paused(env)) return { ...out, error: "ODIN recording is off for you: nothing was sent" };
  if (!auth) return { ...out, error: "not signed in: no ODIN token" };
  const api = (env.VILIHA_API ?? "https://api.viliha.com").replace(/\/+$/, "");
  for (const d of deltas) {
    let res;
    try {
      res = await fetchImpl(`${api}/v1/projects/${encodeURIComponent(project)}/map/delta`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${auth}` }, body: JSON.stringify(d), signal: AbortSignal.timeout(60000) });
    } catch {
      return { ...out, error: "the ODIN server could not be reached" };
    }
    const body = await res.json().catch(() => ({}));
    if (res.status < 200 || res.status >= 300) return { ...out, error: `the server answered ${res.status}`, reports: [...out.reports, body] };
    out.reports.push(body);
  }
  writeCache(root, project, hashes(scan));
  return { ...out, sent: true };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const r = await run(opts);
  if (opts.json) console.log(JSON.stringify(r, null, 2));
  else {
    const s = r.summary;
    if (s) console.log(`${opts.dry ? "Would send" : r.sent ? "Sent" : "Scanned"}: ${s.items} items in ${s.parts} parts from ${s.repos.length} repos (${s.links} links, ${s.findings} findings, ${s.deleted} removed, ${s.deltas} requests).`);
    for (const rep of r.reports ?? []) console.log(JSON.stringify(rep));
    if (r.error) console.error(r.error);
  }
  process.exit(r.error ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
