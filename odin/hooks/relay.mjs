#!/usr/bin/env node
/**
 * The ODIN plugin's relay (design research/LOCAL-EDGE-2026-11-21.md, step 1): one small process per person that keeps the
 * connection to ODIN's server open, so a hook's call costs one round trip instead of a new connection's three. The hooks reach it
 * on a socket only this user can open; the first hook that finds no relay starts one and calls the server directly that once.
 *   - It forwards only the gate and event calls, only to the server it was started for, with the token it read once.
 *   - It keeps no rule, no record and no answer (D-27): nothing is written on the machine but its socket.
 *   - It exits after IDLE_MS without a call; the hooks work without it, as before.
 * Standard library only.
 */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { token } from "./stream.mjs";

/** The only calls the relay forwards. */
export const PATHS = new Set(["/v1/gate", "/v1/gate/session", "/v1/events"]);
const IDLE_MS = 30 * 60 * 1000;
/** The relay's own refusal (not its server, not its path): the hook then calls the server itself. */
const REFUSED = { status: -1, body: {} };
const DEFAULT_API = "https://api.viliha.com";

export const apiOf = (env = process.env) => (env.VILIHA_API ?? DEFAULT_API).replace(/\/+$/, "");

/** The relay's address: a named pipe on Windows, else a socket in this user's temporary folder. */
export function socketPath(platform = process.platform, user = userInfo().username, dir = tmpdir()) {
  return platform === "win32" ? `\\\\.\\pipe\\viliha-relay-${user}` : join(dir, `viliha-relay-${user}.sock`);
}

/** One call to the server: `{ status, body }`, status 0 when it could not be reached in time. Never throws. */
async function forward(api, auth, fetchImpl, path, body, ms) {
  try {
    const res = await fetchImpl(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${auth}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: {} };
  }
}

/**
 * The relay for one server and one token. A request is one JSON line `{ api, path, body, wait, ms }`; the answer is one JSON line.
 * `wait: false` answers 202 at once and sends after. `onIdle` runs when no call came for `idleMs`.
 */
export function serve({ api, auth, fetchImpl = fetch, idleMs = IDLE_MS, onIdle = () => {} }) {
  let timer;
  const idle = () => {
    clearTimeout(timer);
    timer = setTimeout(onIdle, idleMs);
    timer.unref?.();
  };
  const server = createServer((conn) => {
    let raw = "";
    conn.setEncoding("utf8");
    conn.on("data", async (chunk) => {
      raw += chunk;
      if (!raw.includes("\n")) return;
      idle();
      let req;
      try {
        req = JSON.parse(raw.slice(0, raw.indexOf("\n")));
      } catch {
        return conn.end(`${JSON.stringify(REFUSED)}\n`);
      }
      if (req.api !== api || !PATHS.has(req.path)) return conn.end(`${JSON.stringify(REFUSED)}\n`);
      const call = forward(api, auth, fetchImpl, req.path, req.body ?? {}, req.ms ?? 3000);
      if (req.wait === false) return conn.end(`${JSON.stringify({ status: 202, body: {} })}\n`);
      conn.end(`${JSON.stringify(await call)}\n`);
    });
    conn.on("error", () => {});
  });
  idle();
  return server;
}

/** Ask the relay: `{ status, body }` (status 0 when the server did not answer the relay), or null when there is no relay, it refused,
 *  or it did not answer in time: the caller then calls the server itself. */
export function viaRelay(path, body, { api = apiOf(), wait = true, ms = 3000, socket = socketPath() } = {}) {
  return new Promise((done) => {
    let raw = "";
    const conn = createConnection(socket);
    const give = (v) => (conn.destroy(), done(v));
    conn.setTimeout(ms + 500, () => give(null));
    conn.setEncoding("utf8");
    conn.on("connect", () => conn.write(`${JSON.stringify({ api, path, body, wait, ms })}\n`));
    conn.on("data", (c) => {
      raw += c;
      if (!raw.includes("\n")) return;
      try {
        const r = JSON.parse(raw.slice(0, raw.indexOf("\n")));
        give(r.status === REFUSED.status ? null : r);
      } catch {
        give(null);
      }
    });
    conn.on("error", () => give(null));
  });
}

/** Start a relay in the background for the next calls; this hook does not wait for it. */
export function startRelay(env = process.env) {
  try {
    spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, stdio: "ignore", env }).unref();
  } catch {
    // the hooks work without it
  }
}

/** Through the relay when it answers, else directly, starting a relay for next time. */
export async function relayed(path, body, { direct, wait = true, ms = 3000, env = process.env, socket = socketPath(), start = startRelay } = {}) {
  const r = await viaRelay(path, body, { api: apiOf(env), wait, ms, socket });
  if (r) return r;
  start(env);
  return direct();
}

function main() {
  const auth = token();
  if (!auth) return process.exit(0);
  const socket = socketPath();
  const server = serve({ api: apiOf(), auth, onIdle: () => server.close(() => process.exit(0)) });
  const listen = () =>
    server.listen(socket, () => {
      if (process.platform !== "win32") chmodSync(socket, 0o600);
    });
  server.on("error", (e) => {
    if (e.code !== "EADDRINUSE") return process.exit(0);
    // Another relay answers there: leave. A socket left by a relay that died: remove it and listen once more.
    const probe = createConnection(socket);
    probe.on("connect", () => (probe.destroy(), process.exit(0)));
    probe.on("error", () => {
      if (process.platform !== "win32" && existsSync(socket)) unlinkSync(socket);
      server.removeAllListeners("error");
      server.on("error", () => process.exit(0));
      listen();
    });
  });
  listen();
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
