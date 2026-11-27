---
description: Every ODIN command and what it does
allowed-tools: Bash(node:*)
---

ODIN's commands, read from this plugin: !`node -e "const f=require('fs'),h=require('os').homedir();for(const r of [process.argv[1],h+'/.viliha/plugin/odin']){try{const d=r+'/commands',v=JSON.parse(f.readFileSync(r+'/.claude-plugin/plugin.json','utf8')).version;const rows=f.readdirSync(d).filter(n=>n.endsWith('.md')).sort().map(n=>{const m=f.readFileSync(d+'/'+n,'utf8').match(/^description:\s*(.+)$/m);return '/odin:'+n.slice(0,-3)+' | '+(m?m[1].trim():'')});process.stdout.write('plugin '+v+'\n'+rows.join('\n'));process.exit(0)}catch{}}process.stdout.write('unknown: the plugin folder was not found')" "${CLAUDE_PLUGIN_ROOT}"`

Show me these commands as a two-column table (command, what it does), in the order given, nothing added or left out. Under it, in two short lines: the plugin version above, and that I can also just say what I want in plain words ("Hey Odin, ..."), with the full guide at https://app.viliha.com/docs. Nothing else.
