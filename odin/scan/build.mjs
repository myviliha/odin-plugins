/** Turn a folder of repositories into a map delta: parts, items (with links and findings), and what was deleted since last time. */
import { basename, posix } from "node:path";
import { classify, discoverRepos, isTestPath, listFiles, readFact, sha256 } from "./files.mjs";
import { goModule, importsOf } from "./extract.mjs";
import { findingsFor } from "./health.mjs";
import { callsOf, endpointsOf, matchCall, screenOf } from "./routes.mjs";

export const CHUNK = 5000;

/** Scan one repository: { parts, items }. `name` is the repo's id segment. */
export function scanRepo(repo, name = basename(repo), { list = listFiles, read = readFact } = {}) {
  const paths = list(repo).filter((p) => classify(p));
  const fileSet = new Set(paths);
  const facts = new Map();
  for (const p of paths) {
    const f = read(repo, p);
    if (f) facts.set(p, f);
  }
  const goMod = facts.has("go.mod") ? goModule(facts.get("go.mod").text) : goModule(read(repo, "go.mod")?.text);
  const tops = new Set([...facts.keys()].filter((p) => p.includes("/")).map((p) => p.split("/")[0]));
  const split = facts.size > 30 && tops.size > 1;
  const parts = [{ id: name, label: name, summary: `${facts.size} files scanned` }];
  const partOf = (p) => (split && p.includes("/") ? `${name}/${p.split("/")[0]}` : name);
  if (split) for (const t of [...tops].sort()) parts.push({ id: `${name}/${t}`, label: t, parent: name, summary: `${[...facts.keys()].filter((p) => p.startsWith(`${t}/`)).length} files` });

  const items = new Map();
  const idOf = (p) => `code:${name}/${p}`;
  const endpoints = [];
  const fileEndpoints = new Map();
  for (const [p, f] of facts) {
    const kind = classify(p);
    const test = isTestPath(p);
    const links = [];
    if (kind === "code") for (const t of importsOf(p, f.text, fileSet, goMod)) if (facts.has(t)) links.push({ to: idOf(t), kind: "imports" });
    items.set(idOf(p), { id: idOf(p), kind, title: p, path: p, size: f.size, hash: f.hash, modified_at: f.mtime, part: partOf(p), links, findings: findingsFor(p, f.text, { kind, test }) });
    if (kind !== "code" || test) continue;
    const screen = screenOf(p);
    if (screen) {
      const sid = `code:${name}/screen:${screen}`;
      if (!items.has(sid)) items.set(sid, { id: sid, kind: "screen", title: screen, path: p, size: 0, hash: sha256(`screen ${screen} ${p}`), part: partOf(p), links: [], findings: [] });
      links.push({ to: sid, kind: "contains" });
    }
    for (const e of endpointsOf(p, f.text)) {
      const eid = `code:${name}/route:${e.method} ${e.path}`;
      if (!items.has(eid)) {
        items.set(eid, { id: eid, kind: "endpoint", title: `${e.method} ${e.path}`, path: p, size: 0, hash: sha256(`route ${e.method} ${e.path} ${p}`), part: partOf(p), links: [], findings: [] });
        endpoints.push({ ...e, id: eid });
      }
      if (!links.some((l) => l.to === eid)) links.push({ to: eid, kind: "contains" });
    }
    fileEndpoints.set(p, true);
  }
  for (const [p, f] of facts) {
    if (classify(p) !== "code" || isTestPath(p)) continue;
    const item = items.get(idOf(p));
    for (const c of callsOf(p, f.text)) for (const e of matchCall(c, endpoints)) if (!item.links.some((l) => l.to === e.id && l.kind === "calls")) item.links.push({ to: e.id, kind: "calls" });
  }
  return { parts, items: [...items.values()] };
}

/** Scan every repository under root: { parts, items, repos }. A repository's name is its folder name (suffixed if two share one). */
export function scanRoot(root, { depth = 3, ...deps } = {}) {
  const repos = discoverRepos(root, depth);
  const used = new Map();
  const all = { parts: [], items: [], repos: [] };
  for (const repo of repos) {
    let name = basename(repo);
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    if (n) name = `${name}-${n + 1}`;
    const r = scanRepo(repo, name, deps);
    all.parts.push(...r.parts);
    all.items.push(...r.items);
    all.repos.push(name);
  }
  return all;
}

/** Split a scan into deltas of at most `size` items; parts and deleted ids travel with the first. */
export function toDeltas(scan, previous = {}, { request, size = CHUNK } = {}) {
  const current = new Set(scan.items.map((i) => i.id));
  const deleted = Object.keys(previous).filter((id) => !current.has(id));
  const deltas = [];
  for (let i = 0; i < Math.max(scan.items.length, 1); i += size) {
    const first = i === 0;
    deltas.push({ source: "code", ...(request ? { request } : {}), parts: first ? scan.parts : [], items: scan.items.slice(i, i + size), deleted: first ? deleted : [] });
  }
  return deltas;
}

export const hashes = (scan) => Object.fromEntries(scan.items.map((i) => [i.id, i.hash]));
export const summary = (scan, deltas) => ({
  repos: scan.repos,
  parts: scan.parts.length,
  items: scan.items.length,
  byKind: scan.items.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {}),
  links: scan.items.reduce((n, i) => n + i.links.length, 0),
  findings: scan.items.reduce((n, i) => n + i.findings.length, 0),
  deleted: deltas.reduce((n, d) => n + d.deleted.length, 0),
  deltas: deltas.length,
});
