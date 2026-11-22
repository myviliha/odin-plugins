/**
 * The code health pack: findings from what is in the files, masked. A finding says where (file and line) and what kind, never the
 * value found. Rules favour precision: each has a near-miss in the tests that must not fire.
 */
import { createHash } from "node:crypto";
import { endpointsOf } from "./routes.mjs";

const KEYS = [
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
  ["private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/],
];
const NAMED = /\b\w*(?:secret|passw(?:or)?d|token|api[_-]?key|private[_-]?key|access[_-]?key)\w*["']?\s*[:=]\s*["']([A-Za-z0-9+/=_-]{20,})["']/i;
const PLACEHOLDER = /example|your|xxxx|changeme|placeholder|dummy|sample|test|fake|redacted|0000/i;
const PUBLIC_ENV = /\b((?:NEXT_PUBLIC|VITE|REACT_APP|NUXT_PUBLIC|PUBLIC)_\w*(?:SECRET|PRIVATE_KEY|PASSWORD|PASSWD|SERVICE_ROLE|CLIENT_SECRET)\w*)\b/;
const CORS = [/\borigin\s*:\s*["'`]\*["'`]/, /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']/i, /allow_origins\s*=\s*\[\s*["']\*["']/, /\bapp\.use\(\s*cors\(\s*\)\s*\)/, /CorsLayer::permissive\(\)|\.allow_origin\(\s*(?:tower_http::cors::)?Any\s*\)/];
const PUBLIC_PATH = /login|logout|register|signup|sign-up|signin|health|status|ping|webhook|public|callback|oauth|auth|token|reset|verify|docs|openapi/i;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const fp = (...parts) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);

const entropyOk = (v) => /[A-Za-z]/.test(v) && /\d/.test(v) && !PLACEHOLDER.test(v) && new Set(v).size >= 8;

/**
 * Findings for one file. `test` marks a test or fixture path: secrets there are reported low. Docs are not scanned.
 * [{ check, severity, title, hint, fix, fingerprint }]
 */
export function findingsFor(path, text, { kind, test = false } = {}) {
  if (kind === "doc") return [];
  const out = [];
  const seen = new Map();
  const push = (check, severity, title, line, tag, fix) => {
    const n = seen.get(`${check}${tag}`) ?? 0;
    seen.set(`${check}${tag}`, n + 1);
    out.push({ check, severity: test && check === "hardcoded-secret" ? "low" : severity, title, hint: `${path}:${line}`, fix, fingerprint: fp(check, path, tag, n) });
  };
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    if (raw.length > 2000) return;
    const line = i + 1;
    const hit = KEYS.find(([, re]) => re.test(raw));
    if (hit) push("hardcoded-secret", "high", `A ${hit[0]} is written into the file`, line, hit[0], "Rotate it, then load it from the environment or a secret manager.");
    else {
      const m = raw.match(NAMED);
      if (m && entropyOk(m[1])) push("hardcoded-secret", "high", "A secret-looking value is assigned in the file", line, "named", "Rotate it, then load it from the environment or a secret manager.");
    }
    const env = raw.match(PUBLIC_ENV);
    if (env) push("public-env-secret", "high", `${env[1]} is exposed to the browser by its name`, line, env[1], "Keep secrets server side; a browser-exposed variable is readable by every visitor.");
    if (kind === "code" && CORS.some((re) => re.test(raw))) push("cors-allow-all", "medium", "CORS allows every origin", line, "cors", "Allow the specific origins that need access.");
  });
  if (kind === "code" && !test) authFindings(path, text, push);
  return out;
}

/** Express and FastAPI only, and only when the file shows its own auth convention: a mutating route lacking it is the odd one out. */
function authFindings(path, text, push) {
  const eps = endpointsOf(path, text);
  const found = [];
  const collect = (e, why) => push("endpoint-no-auth", "medium", `${e.method} ${e.path} has no auth where its neighbours do`, e.line, `${e.method} ${e.path}`, why);
  if (/\.(m?[jt]s|cjs|jsx|tsx)$/.test(path) && /\bexpress\b/.test(text)) {
    const routes = eps.filter((e) => e.auth !== undefined);
    const blanket = /\b(?:app|router)\.use\(\s*(?:auth\w*|require\w*|verify\w*|protect\w*|jwt\w*|passport\.authenticate)/i.test(text);
    if (!blanket && routes.some((e) => e.auth)) for (const e of routes) if (!e.auth && MUTATING.has(e.method) && !PUBLIC_PATH.test(e.path)) found.push(e);
  } else if (path.endsWith(".py") && /\bfastapi\b/i.test(text)) {
    const routes = eps.filter((e) => e.pyAuth !== undefined);
    const blanket = /(?:APIRouter|FastAPI)\([^)]*dependencies\s*=/.test(text) || /include_router\([^)]*dependencies\s*=/.test(text);
    if (!blanket && routes.some((e) => e.pyAuth)) for (const e of routes) if (!e.pyAuth && MUTATING.has(e.method) && !PUBLIC_PATH.test(e.path)) found.push(e);
  }
  for (const e of found) collect(e, "Add the same auth middleware or dependency the other routes use, or document why this one is public.");
}
