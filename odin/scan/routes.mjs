/** Endpoints a file serves, calls it makes to them, and screens it renders. Text in, small records out. */

const METHODS = ["get", "post", "put", "patch", "delete"];
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** `/users/${id}/x?y=1` and `/users/:id/x` and `/users/{id}/x` as comparable segments; params become ":". */
export function segments(path) {
  return path
    .split("?")[0]
    .replace(/\$\{[^}]*\}/g, ":p")
    .split("/")
    .filter(Boolean)
    .map((s) => (/^[:{[*]/.test(s) ? ":" : s.toLowerCase()));
}

const norm = (p) => `/${p.split("/").filter(Boolean).map((s) => (s.startsWith("{") ? `:${s.slice(1, -1)}` : s)).join("/")}`;

/** Next.js: the route of an app or pages file, or null. */
export function nextRoute(path) {
  let m = path.match(/(?:^|\/)app\/(.*?)(?:\/)?(route|page)\.(?:[jt]sx?)$/);
  let kind = m?.[2];
  let rest = m?.[1];
  if (!m) {
    m = path.match(/(?:^|\/)pages\/(.+)\.(?:[jt]sx?)$/);
    if (!m) return null;
    rest = m[1].replace(/(^|\/)index$/, "");
    if (/(^|\/)_/.test(m[1])) return null;
    kind = rest.startsWith("api/") || rest === "api" ? "route" : "page";
  }
  const parts = (rest ?? "").split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@")).map((s) => (/^\[\.\.\./.test(s) || /^\[\[\.\.\./.test(s) ? "*" : /^\[.*\]$/.test(s) ? `:${s.slice(1, -1)}` : s));
  return { kind, route: `/${parts.join("/")}` };
}

/**
 * Endpoints found in one file: [{ method, path, line, auth }], auth true when the route clearly passes an auth-named handler.
 * Frameworks: Express/Hono/Fastify, Next.js route files, FastAPI/Flask, Axum.
 */
export function endpointsOf(path, text) {
  const out = [];
  const add = (method, p, index, extra = {}) => out.push({ method: method.toUpperCase(), path: norm(p), line: lineOf(text, index), ...extra });
  if (/\.(m?[jt]sx?|cjs)$/.test(path)) {
    const next = nextRoute(path);
    if (next?.kind === "route" && /(^|\/)route\.[jt]s$/.test(path)) {
      for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) add(m[1], next.route, m.index);
    } else if (next?.kind === "route") add("ALL", next.route, 0);
    if (/\b(express|hono|fastify|koa|Router)\b/.test(text)) {
      const re = new RegExp(`\\b(app|router|server|fastify|api|routes?|\\w+Router|\\w+App|v\\d+)\\.(${METHODS.join("|")}|all)\\(\\s*['"\`](/[^'"\`]*)['"\`]([^\\n]*)`, "g");
      for (const m of text.matchAll(re)) add(m[2], m[3], m.index, { auth: AUTH_ARG.test(m[4]) });
    }
  } else if (path.endsWith(".py")) {
    for (const m of text.matchAll(/^[ \t]*@(\w+)\.(get|post|put|patch|delete)\(\s*["'](\/[^"']*)["']/gm)) add(m[2], m[3], m.index, { pyAuth: pyAuthAt(text, m.index) });
    for (const m of text.matchAll(/^[ \t]*@(\w+)\.route\(\s*["'](\/[^"']*)["']([^)]*)\)/gm)) {
      const ms = [...m[3].matchAll(/["'](GET|POST|PUT|PATCH|DELETE)["']/gi)].map((x) => x[1]);
      for (const method of ms.length ? ms : ["GET"]) add(method, m[2], m.index);
    }
  } else if (path.endsWith(".rs")) {
    for (const m of text.matchAll(/\.route\(\s*"(\/[^"]*)"\s*,/g)) {
      const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 400).split(/\.route\(|\.nest\(|\.layer\(|;/)[0];
      for (const h of tail.matchAll(/\b(get|post|put|patch|delete)\(/g)) add(h[1], m[1], m.index);
    }
  }
  return out;
}

const AUTH_NAME = "(?:auth\\w*|require\\w*|verify\\w*|protect\\w*|isAuth\\w*|ensure\\w*|jwt\\w*|passport\\.authenticate)";
const AUTH_ARG = new RegExp(`(?:,|\\()\\s*${AUTH_NAME}\\b`, "i");

/** FastAPI: the dependency list of the function a decorator at `index` decorates carries an auth-named Depends. */
function pyAuthAt(text, index) {
  const sig = text.slice(index, index + 900).match(/^[\s\S]*?\bdef\b[\s\S]*?\)\s*(?:->[^\n:]*)?:\s*\n/)?.[0] ?? "";
  return /Depends\(\s*\w*(?:auth|user|token|verify|require|permission|security)\w*/i.test(sig);
}

/** Calls to local paths: fetch('/api/x'), axios.post('/x'). [{ method, path, line }]. Absolute URLs to other hosts are ignored. */
export function callsOf(path, text) {
  if (!/\.(m?[jt]sx?|cjs)$/.test(path)) return [];
  const out = [];
  const serverFile = /\b(express|hono|fastify|koa)\b/.test(text);
  for (const m of text.matchAll(/\bfetch\(\s*(?:`(?:\$\{[^}]*\})?(\/[^`]*)`|['"](\/[^'"]*)['"])([^)]{0,200})/g)) {
    const method = (m[3].match(/method:\s*['"](\w+)['"]/)?.[1] ?? "GET").toUpperCase();
    out.push({ method, path: m[1] ?? m[2], line: lineOf(text, m.index) });
  }
  if (!serverFile) {
    for (const m of text.matchAll(/\b(axios|ky|http|\w*[cC]lient|api)\.(get|post|put|patch|delete)\(\s*(?:`(?:\$\{[^}]*\})?(\/[^`]*)`|['"](\/[^'"]*)['"])/g)) out.push({ method: m[2].toUpperCase(), path: m[3] ?? m[4], line: lineOf(text, m.index) });
  }
  return out;
}

/** Endpoints a call can mean: same method (or an ALL endpoint) and the same segments; else one path's tail equal to the other, when the shorter has 2+ segments (a prefix such as /v1 or a base URL). */
export function matchCall(call, endpoints) {
  const cs = segments(call.path);
  const sameMethod = endpoints.filter((e) => e.method === call.method || e.method === "ALL");
  const exact = sameMethod.filter((e) => eq(segments(e.path), cs));
  if (exact.length) return exact;
  return sameMethod.filter((e) => {
    const es = segments(e.path);
    const [short, long] = es.length < cs.length ? [es, cs] : [cs, es];
    return short.length >= 2 && short.length < long.length && eq(short, long.slice(long.length - short.length));
  });
}

const eq = (a, b) => a.length === b.length && a.every((s, i) => s === b[i] || s === ":" || b[i] === ":");

/** The screen a Next.js page file is, or null. */
export function screenOf(path) {
  const n = nextRoute(path);
  return n?.kind === "page" ? n.route : null;
}
