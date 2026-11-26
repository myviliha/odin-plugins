---
description: Which ODIN plugin version this machine has, the one ODIN serves, and how to update
allowed-tools: Bash(node:*), Bash(curl:*)
---

Installed on this machine: !`node -e "process.stdout.write(require(process.env.CLAUDE_PLUGIN_ROOT + '/.claude-plugin/plugin.json').version)"`

Served by ODIN for install: !`curl -fsS -m 5 "${VILIHA_API:-https://api.viliha.com}/v1/plugin/files/odin/.claude-plugin/plugin.json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).version)}catch{process.stdout.write('unknown (ODIN did not answer)')}})"`

Tell me in two short lines: the version installed here and the one ODIN serves. If the installed one is older, say so plainly and give the update, which keeps my token: run `curl -fsSL https://api.viliha.com/install | sh` in a terminal, then start a new session. If they match, say ODIN is up to date. Nothing else.
