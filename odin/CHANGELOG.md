# ODIN plugin changelog

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
