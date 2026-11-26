#!/usr/bin/env node
/**
 * The ODIN plugin's one hook (ODIN-61, D-33): each step of a Claude Code session (its start, a prompt, a tool used, files edited,
 * its end) is sent to ODIN's server as an event. Nothing is written on this machine: no file, no cache, no log. It never blocks
 * or breaks the session: two seconds at most, silent, and it always exits 0. Metadata by default: a prompt's text is sent so the
 * server can apply the company's setting, and the server drops it unless the company keeps prompts. Only company work is kept
 * (D-37): each event carries its repository's remote, and the server drops it unless that repository is one of the person's
 * projects (or VILIHA_PROJECT names one); a personal folder is never recorded.
 *   VILIHA_TOKEN    an ODIN API token (else, on macOS, the Keychain item service "viliha", account "token")
 *   VILIHA_API      the server (default https://api.viliha.com)
 *   VILIHA_PROJECT  the project these sessions belong to (optional)
 *   VILIHA_RECORD   "off" pauses recording (the gate still asks)
 * At a prompt it also asks ODIN who and where the person is (ODIN-197, GET /v1/me/context) and adds that line, the prompt's local time and the
 * instruction to open and close the reply with them; at Stop it tells the person how long the turn took (read from the transcript).
 * Standard library only.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { relayed } from "./relay.mjs";

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
    case "Stop": {
      // What the agent concluded (ODIN-340), so the next session continues from it; the server keeps the text only when the company
      // keeps prompts, like a prompt's.
      const said = input.transcript_path ? lastAnswer(input.transcript_path) : null;
      return { ...base, kind: "finish", summary: "session turn finished", ...(said ? { text: said } : {}), detail: {} };
    }
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

/** A time as the server writes it in the reply line: `23 Nov 14:03 (UTC+05:30)`, on this machine's clock. */
export function clock(at = new Date()) {
  const off = -at.getTimezoneOffset();
  const pad = (n) => String(Math.trunc(n)).padStart(2, "0");
  const zone = `${off < 0 ? "-" : "+"}${pad(Math.abs(off) / 60)}:${pad(Math.abs(off) % 60)}`;
  const month = at.toLocaleString("en-GB", { month: "short" });
  return { text: `${pad(at.getDate())} ${month} ${pad(at.getHours())}:${pad(at.getMinutes())} (UTC${zone})`, offset: zone };
}

/** Who and where for the reply (ODIN-197): the line ODIN gives, or null when it cannot be had in time. Never throws. */
export async function fetchContext({ api = process.env.VILIHA_API ?? "https://api.viliha.com", auth = token(), fetchImpl = fetch, ms = 1500, offset = clock().offset } = {}) {
  if (!auth) return null;
  const base = api.replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${base}/v1/me/context?utc_offset=${encodeURIComponent(offset)}`, { headers: { authorization: `Bearer ${auth}` }, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const line = (await res.json().catch(() => null))?.line;
    return typeof line === "string" && line ? line : null;
  } catch {
    return null;
  }
}

/** "1m 12s", "45s" or "2h 3m": how long a turn took. */
export function took(ms) {
  const secs = Math.max(0, Math.round(ms / 1000));
  const [h, m, s] = [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60];
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

/** When the person's last prompt was sent, read from the session transcript (read only: nothing is kept here); null if unreadable. */
export function turnStart(transcriptPath, read = (p) => readFileSync(p, "utf8")) {
  try {
    const lines = read(transcriptPath).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      const e = JSON.parse(lines[i]);
      const c = e?.message?.content;
      const typed = typeof c === "string" || (Array.isArray(c) && c.some((b) => b?.type === "text"));
      if (e?.type === "user" && !e.isMeta && typed && e.timestamp) return new Date(e.timestamp);
    }
  } catch {
    // no transcript to read
  }
  return null;
}

/** The agent's last answer in the session transcript, at most 2,000 characters (read only); null if unreadable (ODIN-340). */
export function lastAnswer(transcriptPath, read = (p) => readFileSync(p, "utf8"), max = 2000) {
  try {
    const lines = read(transcriptPath).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      const e = JSON.parse(lines[i]);
      if (e?.type !== "assistant") continue;
      const c = e?.message?.content;
      const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";
      if (t.trim()) return t.trim().slice(0, max);
    }
  } catch {
    // no transcript to read
  }
  return null;
}

/** What the Stop hook tells the person: how long the turn took, shown by Claude Code beside the reply. Null when it cannot be told. */
export function stopOut(hook, started, now = new Date()) {
  if (hook !== "Stop" || !(started instanceof Date) || Number.isNaN(started.getTime())) return null;
  return { systemMessage: `ODIN · took ${took(now - started)}` };
}

/**
 * Whether this turn changed the work without keeping the working state (ODIN-343): it edited files or committed, pushed, merged or
 * released, and never called odin_update_working_state. Read from the transcript since the person's last prompt (read only).
 */
export function stateOwed(transcriptPath, read = (p) => readFileSync(p, "utf8")) {
  try {
    const lines = read(transcriptPath).split("\n").filter((l) => l.trim());
    let changed = false;
    let kept = false;
    for (let i = lines.length - 1; i >= 0; i--) {
      const e = JSON.parse(lines[i]);
      const c = e?.message?.content;
      if (e?.type === "user" && !e.isMeta && (typeof c === "string" || (Array.isArray(c) && c.some((b) => b?.type === "text")))) break;
      if (e?.type !== "assistant" || !Array.isArray(c)) continue;
      for (const b of c) {
        if (b?.type !== "tool_use") continue;
        const name = String(b.name ?? "");
        if (name.endsWith("odin_update_working_state")) kept = true;
        if (EDITS.has(name)) changed = true;
        if (name === "Bash" && /\bgit\s+(commit|push|merge)\b|\bglab\s+mr\s+(create|merge)\b|\bgh\s+pr\s+(create|merge)\b/.test(String(b.input?.command ?? ""))) changed = true;
      }
    }
    return changed && !kept;
  } catch {
    return false;
  }
}

/** The Stop hook's answer when the working state is owed: the turn continues once, to update it (never twice in a row). */
export function stateOut(hook, owed, again) {
  if (hook !== "Stop" || !owed || again) return null;
  return { decision: "block", reason: "ODIN: this turn changed the work. Before finishing, call odin_update_working_state with the sections that moved (in_flight, decided, waiting, next_step, how_to, avoid), so the next session in any agent continues without rethinking. Then finish." };
}

/** ODIN's routing question (D-76) for the agent to ask the person, as the prompt hook's added context; null when there is none. */
export function askOut(hook, body, reply = null) {
  if (hook !== "UserPromptSubmit") return null;
  const ask = body?.ask;
  const parts = [];
  // Who and where, and when this prompt was sent (ODIN-197): the reply opens with the line and closes with the time taken.
  if (reply) {
    const sent = `Prompt sent ${reply.sent}.`;
    const close = `end the reply with "Finished HH:MM · took Xm Ys", counted from the time the prompt was sent to when you finish.`;
    parts.push(reply.line ? `ODIN context: ${reply.line}\n${sent} Open your reply with the ODIN context line exactly as given, then ${close}` : `${sent} ODIN could not be reached for the context line; ${close}`);
  }
  // What to do through ODIN on this prompt, without the person having to mention it (ODIN-240); the server leaves it out while paused.
  if (typeof body?.lead === "string" && body.lead) parts.push(body.lead);
  if (ask?.question && ask?.id) parts.push(`ODIN asks the person, before you go on: ${ask.question} Ask them in one short line, then call odin_route_answer with id ${ask.id} and the project they choose (or personal if it is not company work).`);
  // Another company's work was kept out (security fix 2026-11-21): the agent asks the person whose work it is.
  if (typeof body?.foreign?.say === "string" && body.foreign.say) parts.push(body.foreign.say);
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
  // The time a turn took, said to the person when it ends: told even when recording is off, since nothing is sent for it.
  const done = stopOut(input.hook_event_name, input.transcript_path ? turnStart(input.transcript_path) : null);
  // The working state is kept before a turn that changed the work ends (ODIN-343), unless recording is off.
  const owed = process.env.VILIHA_RECORD !== "off" && input.hook_event_name === "Stop" && input.transcript_path ? stateOwed(input.transcript_path) : false;
  const hold = stateOut(input.hook_event_name, owed, input.stop_hook_active === true);
  if (done || hold) process.stdout.write(JSON.stringify({ ...(done ?? {}), ...(hold ?? {}) }));
  const prompt = input.hook_event_name === "UserPromptSubmit";
  const now = clock();
  if (process.env.VILIHA_RECORD === "off") {
    // Recording paused: the prompt still hears who and where it is.
    const out = prompt ? askOut(input.hook_event_name, {}, { line: await fetchContext({ offset: now.offset }), sent: now.text }) : null;
    if (out) process.stdout.write(JSON.stringify(out));
    return;
  }
  const event = toEvent(input, process.env.VILIHA_PROJECT || null, remoteOf(input.cwd ?? process.cwd()));
  if (!event) return;
  // Only the prompt's answer is read (ODIN's routing question, colleagues' updates); every other event is handed to the relay,
  // which sends it after this hook has returned, so the session never waits for it (research/LOCAL-EDGE-2026-11-21.md).
  const wait = prompt;
  // The reply line is asked for beside the event, so the prompt waits for neither twice.
  const [{ body }, line] = await Promise.all([relayed("/v1/events", { events: [event] }, { wait, ms: 2000, direct: () => sendRead(event) }), wait ? fetchContext({ offset: now.offset }) : null]);
  const out = askOut(input.hook_event_name, body, wait ? { line, sent: now.text } : null);
  if (out) process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(() => process.exit(0));
}
