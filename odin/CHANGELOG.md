# ODIN plugin changelog

## 0.7.3 (2026-11-26)

- The same context in every folder (ODIN-338): a session started in a folder that is not a repository (such as ~/Documents/projects) sends the remotes of the repositories in its subfolders, so ODIN starts it in their company and project. Only the remotes are read.

## 0.7.2 (2026-11-24)

- Your rules travel with you (ODIN-254): `/odin:export` writes the project's accepted rules and decisions from ODIN into AGENTS.md, CLAUDE.md and Cursor's rules as one marked block, and `/odin:import` proposes the instructions already in those files to ODIN as drafts for a person to accept.

## 0.7.1 (2026-11-24)

- You never have to say "use ODIN" (ODIN-240): every prompt now carries ODIN's short lead for the agent: on a new task, recall what is known and ask the project's rules before planning, think a recommendation through, and get the brief before building a screen. ODIN's server writes the lead and leaves it out while ODIN is paused.

## 0.7.0 (2026-11-23)

- Every reply shows who and where (ODIN-197): at each prompt the plugin asks ODIN for the context line (company, project, space, your name, email and role, the time ODIN received the prompt) and hands it to the agent with the prompt's local time, to open the reply with. The agent closes the reply with "Finished HH:MM · took Xm Ys". If ODIN cannot be reached in time the prompt carries only its time and the closing instruction.
- When a turn ends, Claude Code shows "ODIN · took Xm Ys", read from the session transcript (read only; nothing is written on your machine).
- What the line shows is yours to change in plain words ("hide my email in the header", "show login time", "I am in +05:30"); ODIN keeps it in your persona.

## 0.6.1 (2026-11-23)

- The product is named ODIN everywhere the plugin shows text: its messages, README and manifest say ODIN, not Viliha. Settings that installs depend on are unchanged (VILIHA_TOKEN, VILIHA_API, the Keychain service, the marketplace id and `odin@viliha`).

## 0.6.0

- Company Map code scanner: `/odin:map` scans the repositories under the current folder and sends their structure to ODIN's Company Map: files with sizes and hashes, imports between files, HTTP endpoints, the frontend calls that reach them, and Next.js screens. Source text and secret values are never sent.
- Code health findings, masked: hard-coded credentials, secret-named browser-exposed variables, CORS that allows every origin, and mutating routes missing the auth their neighbours use.
- `--dry-run --json` prints what would be sent. Nothing is sent when recording is off.
- Trust: CHECKSUMS.txt lists the sha256 of every plugin file (`node tools/checksums.mjs check`), and tests pin the plugin's network and process use.

## 0.5.2

- Earlier releases; see the repository history.
