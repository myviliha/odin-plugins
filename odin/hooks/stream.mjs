#!/usr/bin/env node
/**
 * The Viliha plugin's one hook (ODIN-61, D-33): each step of a Claude Code session (its start, a prompt, a tool used, files edited,
 * its end) is sent to Viliha's server as an event. Nothing is written on this machine: no file, no cache, no log. It never blocks
 * or breaks the session: two seconds at most, silent, and it always exits 0. Metadata by default: a prompt's text is sent so the
 * server can apply the company's setting, and the server drops it unless the company keeps prompts. Only company work is kept
 * (D-37): each event carries its repository's remote, and the server drops it unless that repository is one of the person's
 * projects (or VILIHA_PROJECT names one); a personal folder is never recorded.
 *   VILIHA_TOKEN    a Viliha API token (else, on macOS, the Keychain item service "viliha", account "token")
 *   VILIHA_API      the server (default https://api.viliha.com)
 *   VILIHA_PROJECT  the project these sessions belong to (optional)
 *   VILIHA_RECORD   "off" pauses recording (the gate still asks)
 * Standard library only.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** The event for one hook's input, or null when the hook is not one this plugin records. */
export function toEvent(input, project = process.env.VILIHA_PROJECT || null, remote = null) {
  const base = { source: "claude-code", session: input.session_id ?? null, project, remote };
  switch (input.hook_event_name) {
    case "SessionStart":
      return { ...base, kind: "session_start", summary: `session started (${input.source ?? "startup"}) in ${basename(input.cwd ?? "")}`, detail: { folder: basename(input.cwd ?? "") } };
    case "UserPromptSubmit": {
      const prompt = String(input.prompt ?? "");
      return { ...base, kind: "prompt", summary: `prompt of ${prompt.length} characters`, text: prompt, detail: { length: prompt.length } };
    }
    case "PostToolUse": {
      const tool = String(input.tool_name ?? "tool");
      const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? null;
      if (EDITS.has(tool)) return { ...base, kind: "edit", summary: `${tool} ${file ? basename(file) : ""}`.trim(), detail: { tool, file: file ? basename(file) : null } };
      return { ...base, kind: "tool", summary: tool, detail: { tool } };
    }
    case "Stop":
      return { ...base, kind: "finish", summary: "session turn finished", detail: {} };
    default:
      return null;
  }
}

/** The repository's remote, or null outside a repository: how the server tells company work from personal. */
export function remoteOf(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The token: from the environment, else the macOS Keychain, else ~/.config/viliha/token (where the installer keeps it off macOS);
 * null when there is none (the hook then does nothing).
 */
export function token(
  env = process.env,
  read = () => execFileSync("security", ["find-generic-password", "-s", "viliha", "-a", "token", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).trim(),
  file = () => readFileSync(join(homedir(), ".config", "viliha", "token"), "utf8").trim(),
) {
  if (env.VILIHA_TOKEN) return env.VILIHA_TOKEN;
  for (const from of [read, file]) {
    try {
      const t = from();
      if (t) return t;
    } catch {
      // not kept there
    }
  }
  return null;
}

/** Send one event; resolves to the HTTP status, or 0 when the server could not be reached in time. Never throws. */
export async function send(event, { api = process.env.VILIHA_API ?? "https://api.viliha.com", auth = token(), fetchImpl = fetch, ms = 2000 } = {}) {
  if (!event || !auth) return 0;
  const base = api.replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${base}/v1/events`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${auth}` }, body: JSON.stringify({ events: [event] }), signal: AbortSignal.timeout(ms) });
    return res.status;
  } catch {
    return 0;
  }
}

/** Send one event and read ODIN's answer: { status, body }, status 0 when the server could not be reached. Never throws. */
export async function sendRead(event, { api = process.env.VILIHA_API ?? "https://api.viliha.com", auth = token(), fetchImpl = fetch, ms = 2000 } = {}) {
  if (!event || !auth) return { status: 0, body: {} };
  const base = api.replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${base}/v1/events`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${auth}` }, body: JSON.stringify({ events: [event] }), signal: AbortSignal.timeout(ms) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: {} };
  }
}

/** ODIN's routing question (D-76) for the agent to ask the person, as the prompt hook's added context; null when there is none. */
export function askOut(hook, body) {
  if (hook !== "UserPromptSubmit") return null;
  const ask = body?.ask;
  const parts = [];
  if (ask?.question && ask?.id) parts.push(`ODIN asks the person, before you go on: ${ask.question} Ask them in one short line, then call odin_route_answer with id ${ask.id} and the project they choose (or personal if it is not company work).`);
  // What colleagues noted or handed over since this person's last turn (ODIN-137).
  if (typeof body?.updates === "string" && body.updates) parts.push(body.updates);
  if (!parts.length) return null;
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: parts.join("\n\n") } };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    return;
  }
  if (process.env.VILIHA_RECORD === "off") return;
  const { body } = await sendRead(toEvent(input, process.env.VILIHA_PROJECT || null, remoteOf(input.cwd ?? process.cwd())));
  const out = askOut(input.hook_event_name, body);
  if (out) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(() => process.exit(0));
}
