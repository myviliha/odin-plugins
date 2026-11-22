/**
 * The scanner's file layer: find the repositories under a folder, list each one's files the way git sees them, classify them,
 * and read the ones worth reading. Structure only leaves this machine, never a file's text. Standard library only.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

export const MAX_BYTES = 1_000_000;

const CODE = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".rb", ".php", ".kt", ".swift", ".cs"]);
const CONFIG = new Set([".json", ".yaml", ".yml", ".toml", ".env", ".ini", ".cfg"]);
const DOC = new Set([".md", ".mdx", ".rst", ".txt"]);
const LOCKS = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "poetry.lock", "composer.lock", "Gemfile.lock", "go.sum", "bun.lockb"]);

/** "code", "config", "doc", or null for a file the scanner does not look at (binary, lock file, minified). */
export function classify(path) {
  const name = basename(path);
  if (LOCKS.has(name) || /\.min\.(js|css)$/.test(name) || /\.d\.ts$/.test(name)) return null;
  if (name === ".env" || name.startsWith(".env.")) return "config";
  const ext = extname(name).toLowerCase();
  if (CODE.has(ext)) return "code";
  if (CONFIG.has(ext)) return "config";
  if (DOC.has(ext)) return "doc";
  return null;
}

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export const isTestPath = (p) => /(^|\/)(tests?|__tests__|spec|e2e|fixtures?)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/.test(p);

/** Repository folders at or under `root` (depth-limited; node_modules and dot folders skipped; a repository is not searched inside). */
export function discoverRepos(root, depth = 3) {
  const out = [];
  const walk = (dir, d) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === ".git")) return void out.push(dir);
    if (d >= depth) return;
    for (const e of entries) if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) walk(join(dir, e.name), d + 1);
  };
  walk(resolve(root), 0);
  return out;
}

/** The repository's files (tracked and untracked, ignores honoured), as sorted forward-slash paths. Empty when git fails. */
export function listFiles(repo, run = execFileSync) {
  try {
    const raw = run("git", ["-C", repo, "ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: 30000 });
    return [...new Set(raw.split("\0").filter((p) => p && !/(^|\/)(node_modules|\.odin|\.next)\//.test(p)))].sort();
  } catch {
    return [];
  }
}

/** One file's facts: { size, mtime, text } or null when it is not a regular file or is over the cap. Text is kept in memory only. */
export function readFact(repo, path) {
  try {
    const abs = join(repo, path);
    const st = lstatSync(abs);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const buf = readFileSync(abs);
    if (buf.includes(0)) return null;
    return { size: st.size, mtime: st.mtime.toISOString(), hash: sha256(buf), text: buf.toString("utf8") };
  } catch {
    return null;
  }
}
