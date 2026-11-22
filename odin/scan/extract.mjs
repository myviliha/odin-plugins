/** Imports: what each file pulls in, resolved to other files of the same repository. Pure functions over text and a path set. */
import { posix } from "node:path";

const JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

/** Import specifiers of a JS or TS file. */
export function jsImports(text) {
  const out = new Set();
  const res = [/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"\n]+)['"]/g, /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g, /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g];
  for (const re of res) for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out];
}

function jsCandidates(base) {
  const c = [base, ...JS_EXT.map((e) => base + e), ...JS_EXT.map((e) => `${base}/index${e}`)];
  const m = base.match(/^(.*)\.(js|mjs|jsx)$/);
  if (m) c.push(`${m[1]}.ts`, `${m[1]}.tsx`);
  return c;
}

/** The repository file a JS specifier points at, or null (packages and unknown aliases are not links). */
export function resolveJs(spec, from, files) {
  const bases = [];
  if (spec.startsWith(".")) bases.push(posix.join(posix.dirname(from), spec));
  else if (spec.startsWith("@/") || spec.startsWith("~/")) bases.push(`src/${spec.slice(2)}`, spec.slice(2));
  for (const b of bases) for (const c of jsCandidates(b)) if (files.has(c)) return c;
  return null;
}

/** Python imports as { dots, mod, names }. */
export function pyImports(text) {
  const out = [];
  for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+\(?([\w, \t*]+)/gm)) out.push({ dots: m[1].length, mod: m[2], names: m[3].split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean) });
  for (const m of text.matchAll(/^[ \t]*import[ \t]+([\w., \t]+)$/gm)) for (const part of m[1].split(",")) out.push({ dots: 0, mod: part.trim().split(/\s+/)[0], names: [] });
  return out;
}

/** Repository files a Python import points at. */
export function resolvePy(imp, from, files) {
  const hit = new Set();
  const tryMod = (dir, parts) => {
    const base = posix.join(dir, ...parts);
    for (const c of [`${base}.py`, `${base}/__init__.py`]) if (files.has(c)) return hit.add(c) && true;
    return false;
  };
  const parts = imp.mod ? imp.mod.split(".") : [];
  if (imp.dots > 0) {
    let dir = posix.dirname(from);
    for (let i = 1; i < imp.dots; i++) dir = posix.dirname(dir);
    if (parts.length) tryMod(dir, parts);
    for (const n of imp.names) tryMod(dir, [...parts, n]);
  } else if (parts.length) {
    for (const dir of ["", "src", posix.dirname(from)]) if (tryMod(dir, parts)) break;
    for (const dir of ["", "src", posix.dirname(from)]) if (imp.names.some((n) => tryMod(dir, [...parts, n]))) break;
  }
  return [...hit].filter((p) => p !== from);
}

/** Go: the module's own import paths, resolved to the first non-test file of the package folder. */
export function goImports(text) {
  const out = new Set();
  for (const m of text.matchAll(/^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm)) out.add(m[1]);
  for (const blk of text.matchAll(/^\s*import\s*\(([\s\S]*?)\)/gm)) for (const m of blk[1].matchAll(/"([^"]+)"/g)) out.add(m[1]);
  return [...out];
}

export function goModule(text) {
  return text?.match(/^module\s+(\S+)/m)?.[1] ?? null;
}

export function resolveGo(spec, module, files) {
  if (!module || !spec.startsWith(`${module}/`)) return null;
  const dir = spec.slice(module.length + 1);
  const hit = [...files].filter((f) => posix.dirname(f) === dir && f.endsWith(".go") && !f.endsWith("_test.go")).sort()[0];
  return hit ?? null;
}

/** Rust: `mod x;` declarations and `use crate::a::b` paths, resolved inside the repository. */
export function rustImports(text) {
  const mods = [...text.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)].map((m) => ({ kind: "mod", name: m[1] }));
  const uses = [...text.matchAll(/^\s*(?:pub\s+)?use\s+crate::([\w:]+)/gm)].map((m) => ({ kind: "crate", path: m[1].split("::") }));
  return [...mods, ...uses];
}

export function resolveRust(imp, from, files) {
  if (imp.kind === "mod") {
    const dir = posix.dirname(from);
    const stem = posix.basename(from, ".rs");
    const base = ["mod", "lib", "main"].includes(stem) ? dir : posix.join(dir, stem);
    return [`${base}/${imp.name}.rs`, `${base}/${imp.name}/mod.rs`].find((c) => files.has(c)) ?? null;
  }
  const crateRoot = posix.join(from.split("/src/")[0] === from ? "" : `${from.split("/src/")[0]}/`, "src");
  for (let n = imp.path.length; n > 0; n--) {
    const base = posix.join(crateRoot, ...imp.path.slice(0, n));
    const c = [`${base}.rs`, `${base}/mod.rs`].find((x) => files.has(x));
    if (c) return c;
  }
  return null;
}

/** Resolved import targets of one code file (repository-relative paths). */
export function importsOf(path, text, files, goMod = null) {
  const out = new Set();
  if (/\.(m?[jt]sx?|cjs)$/.test(path)) for (const s of jsImports(text)) { const r = resolveJs(s, path, files); if (r) out.add(r); }
  else if (path.endsWith(".py")) for (const i of pyImports(text)) for (const r of resolvePy(i, path, files)) out.add(r);
  else if (path.endsWith(".go")) for (const s of goImports(text)) { const r = resolveGo(s, goMod, files); if (r) out.add(r); }
  else if (path.endsWith(".rs")) for (const i of rustImports(text)) { const r = resolveRust(i, path, files); if (r) out.add(r); }
  out.delete(path);
  return [...out].sort();
}
