---
description: Scan this project's code and send its structure to ODIN's Company Map
argument-hint: [project id] [--dry-run]
---

First check odin_state. If ODIN is paused or off for me, say so in one line and stop: nothing is scanned or sent.

Otherwise run the scanner for the current project from the folder that holds its repositories:

`node ${CLAUDE_PLUGIN_ROOT}/scan/map.mjs --project <project id> --json $ARGUMENTS`

Use the project from odin_focus when I gave none. Add `--dry-run` first when I ask what would be sent. The scanner sends structure only (file paths, sizes, hashes, imports, endpoints, screens, and masked health findings), never source text or secret values. Report in a few short lines what was sent (items, links, findings, removed) and the server's report from the output. If it printed an error, say what it was and what to do.
