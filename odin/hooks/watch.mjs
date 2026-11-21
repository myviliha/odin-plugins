#!/usr/bin/env node
/**
 * The Viliha plugin's watch (T-MON-01): after each tool call, did it just damage the repository? A file the call touched or named
 * that is now empty, or a tracked file that lost nearly all its lines since the last commit, is a miss: the gate let through
 * something it should have stopped. The miss goes to Viliha's server as an event (paths and line counts, never content), where the
 * loop turns misses into gate rules. Personal folders are dropped by the server like every event (D-37). Writes nothing on this
 * machine, never blocks, always exits 0. Standard library only.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { placeOf } from "./gate.mjs";
import { remoteOf, send } from "./stream.mjs";

const WATCHED = new Set(["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** A tracked file "lost nearly all its lines": at least this many removed, and nine in ten of what it had. */
const MIN_LOST = 20;
const FILE_WORD = /[\w@~.\/-]+\.[A-Za-z0-9]{1,8}\b/g;

const git = (cwd, args) => {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500 });
  } catch {
    return null;
  }
};

const size = (p) => {
  try {
    return statSync(p).isFile() ? statSync(p).size : null;
  } catch {
    return null;
  }
};

/** The files a call touched or named: its file_path, else the words of its command that are files in its folder. */
export function named(input, dir) {
  const t = input.tool_input ?? {};
  const file = t.file_path ?? t.notebook_path;
  if (typeof file === "string" && file) return [resolve(input.cwd ?? dir, file)];
  if (typeof t.command !== "string") return [];
  const words = [...new Set(t.command.match(FILE_WORD) ?? [])];
  return words.map((w) => (isAbsolute(w) ? w : join(dir, w))).filter((p) => existsSync(p));
}

/** The damage a call left, as `{ path, signal, lost?, had? }` with paths relative to the repository; empty when none. */
export function damage(input, { dir = placeOf(input), run = git, sizeOf = size } = {}) {
  if (!WATCHED.has(input.tool_name)) return [];
  const root = (run(dir, ["rev-parse", "--show-toplevel"]) ?? "").trim();
  if (!root) return [];
  const found = new Map();
  for (const p of named(input, dir)) {
    if (p.startsWith(root + "/") && sizeOf(p) === 0) found.set(relative(root, p), { path: relative(root, p), signal: "emptied" });
  }
  for (const line of (run(root, ["diff", "--numstat", "HEAD"]) ?? "").split("\n")) {
    const [added, deleted, path] = line.split("\t");
    const lost = Number(deleted);
    if (!path || found.has(path) || !(lost >= MIN_LOST)) continue;
    const had = Number((run(root, ["show", `HEAD:${path}`]) ?? "").split("\n").length);
    if (lost >= 0.9 * had && Number(added) < 0.1 * had) found.set(path, { path, signal: "lost_lines", lost, had });
  }
  return [...found.values()];
}

/** The miss event for a call that damaged files, or null. */
export function toMiss(input, files, project = process.env.VILIHA_PROJECT || null, remote = null) {
  if (!files.length) return null;
  const t = input.tool_input ?? {};
  return {
    source: "claude-code",
    session: input.session_id ?? null,
    project,
    remote,
    kind: "miss",
    summary: `${input.tool_name} ${files.map((f) => `${f.signal === "emptied" ? "emptied" : "cut"} ${f.path}`).join(", ")}`.slice(0, 300),
    detail: { tool: input.tool_name, command: typeof t.command === "string" ? t.command.slice(0, 4000) : null, files },
  };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    return;
  }
  if (input.hook_event_name !== "PostToolUse") return;
  const dir = placeOf(input);
  await send(toMiss(input, damage(input, { dir }), process.env.VILIHA_PROJECT || null, remoteOf(dir)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(() => process.exit(0));
}
