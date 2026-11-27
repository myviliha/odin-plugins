---
description: Which ODIN plugin version this machine has, the one ODIN serves, and how to update
allowed-tools: Bash(node:*)
---

Installed on this machine: !`node -e "const f=require('fs'),h=require('os').homedir();for(const r of [process.argv[1],h+'/.viliha/plugin/odin']){try{process.stdout.write(JSON.parse(f.readFileSync(r+'/.claude-plugin/plugin.json','utf8')).version);process.exit(0)}catch{}}process.stdout.write('unknown')" "${CLAUDE_PLUGIN_ROOT}"`

Served by ODIN for install: !`node -e "fetch((process.env.VILIHA_API||'https://api.viliha.com')+'/v1/plugin/files/odin/.claude-plugin/plugin.json',{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).then(j=>process.stdout.write(j.version)).catch(()=>process.stdout.write('unknown (ODIN did not answer)'))"`

Tell me in two short lines: the version installed here and the one ODIN serves. If the installed one is older, say so plainly and give the update, which keeps my token: run `curl -fsSL https://api.viliha.com/install | sh` in a terminal, then start a new session. If they match, say ODIN is up to date. Nothing else.
