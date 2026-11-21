#!/usr/bin/env node
/**
 * The Viliha plugin's gate (ODIN-35, D-27): no rule and no record on this machine. Before each tool call it asks Viliha's server
 * "may I?" and acts on the answer; when a session starts it loads the project's context from the server. The project is found from
 * the repository's remote (or VILIHA_PROJECT). What is sent: the tool's name, the command or the file path, never a file's content.
 *   PreToolUse    POST /v1/gate: deny or ask with the server's reason; allow says nothing, so Claude Code's own permissions apply
 *   SessionStart  POST /v1/gate/session: the project's context for the session
 * When the server cannot be reached the call goes ahead and the person is told the gate did not check it; a repository that is no
 * project of theirs, or no token, and the plugin stays out of the way. Nothing is written on this machine. Standard library only.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { relayed } from "./relay.mjs";
import { token } from "./stream.mjs";

/** The tool input the gate needs: what runs and where, without content (an edit's text, a file's body). */
export function slim(input = {}) {
  const keep = ["command", "file_path", "notebook_path", "path", "url"];
  return Object.fromEntries(Object.entries(input).filter(([k, v]) => keep.includes(k) && typeof v === "string"));
}

const git = (cwd, args) => {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).trim() || null;
  } catch {
    return null;
  }
};

/** Where the session runs: the repository's remote and root, and the machine's home and temporary folders. */
export function where(cwd, run = git) {
  return { remote: run(cwd, ["remote", "get-url", "origin"]), root: run(cwd, ["rev-parse", "--show-toplevel"]), home: homedir(), tmp: tmpdir() };
}

/**
 * The folder a tool call acts in: the file's own folder (or its nearest existing parent, for a new file), the folder a command
 * starts with `cd` into, else the session's. A session started above the repositories is checked like one started inside them.
 */
export function placeOf(input, exists = existsSync) {
  const cwd = input.cwd ?? process.cwd();
  const t = input.tool_input ?? {};
  let dir = cwd;
  const file = t.file_path ?? t.notebook_path;
  if (typeof file === "string" && file) dir = dirname(resolve(cwd, file));
  else if (typeof t.command === "string") {
    const cd = t.command.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;)/);
    if (cd) dir = resolve(cwd, (cd[1] ?? cd[2] ?? cd[3]).replace(/^~(?=\/|$)/, homedir()));
  }
  while (!exists(dir) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

/** POST to the server: `{ status, body }`, status 0 when it could not be reached in time. Never throws. */
export async function post(path, body, { api = process.env.VILIHA_API ?? "https://api.viliha.com", auth = token(), fetchImpl = fetch, ms = 3000 } = {}) {
  try {
    const res = await fetchImpl(`${api.replace(/\/+$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${auth}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: {} };
  }
}

/** What the hook prints for one input, or null to say nothing. */
export async function answer(input, { env = process.env, place = where, send = post } = {}) {
  const project = env.VILIHA_PROJECT || null;
  const at = place(placeOf(input));
  if (input.hook_event_name === "SessionStart") {
    const r = await send("/v1/gate/session", { project, remote: at.remote });
    if (r.status !== 200) return r.status === 0 ? { systemMessage: "Viliha could not be reached: this session starts without the project's context, and the gate cannot check its actions." } : null;
    // Setup not finished (ODIN-136): the person sees it too, at every session's start until it is done or snoozed.
    const notice = r.body.notice?.say;
    return { ...(notice ? { systemMessage: notice } : {}), hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: r.body.context } };
  }
  if (input.hook_event_name !== "PreToolUse") return null;
  const r = await send("/v1/gate", { project, ...at, session: input.session_id ?? null, source: "claude-code", tool_name: input.tool_name, tool_input: slim(input.tool_input) });
  if (r.status === 0) return { systemMessage: `Viliha could not be reached: ${input.tool_name} ran without the gate's check.` };
  if (r.status !== 200 || r.body.decision === "allow") return null;
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: r.body.decision === "ask" ? "ask" : "deny", permissionDecisionReason: r.body.reason } };
}

/** Installed but not signed in (a GitHub marketplace install skips the installer's token step): say so once, at the session's start,
 *  to the person and to the agent, instead of staying silent (2026-11-21: a whole night of work went past the gate unnoticed). */
export function signedOut(input, env = process.env) {
  if (input.hook_event_name !== "SessionStart") return null;
  const api = (env.VILIHA_API ?? "https://api.viliha.com").replace(/\/+$/, "");
  const say = `Viliha is installed but not signed in, so the gate is off: nothing checks this session's edits or records its work. Sign in with: curl -fsSL ${api}/install | sh (it asks for your Viliha token), then start a new session.`;
  return { systemMessage: say, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `${say} Until then, call odin_recall and odin_ask yourself before working, and tell the person once.` } };
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
  const auth = token();
  if (!auth) {
    const out = signedOut(input);
    if (out) process.stdout.write(JSON.stringify(out));
    return;
  }
  // Through the relay's open connection when it answers, else directly (research/LOCAL-EDGE-2026-11-21.md).
  const out = await answer(input, { send: (path, body) => relayed(path, body, { direct: () => post(path, body, { auth }) }) });
  if (out) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(() => process.exit(0));
}
