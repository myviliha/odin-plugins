---
description: Write this project's ODIN rules and decisions into AGENTS.md, CLAUDE.md and Cursor's rules
argument-hint: [agents|claude|cursor|all]
---

Write the project's accepted rules and decisions from ODIN into the files agents read by themselves ($ARGUMENTS, or all three when empty). For each format, call odin_export_rules with this project and the format. It returns a path and a block marked `<!-- ODIN:BEGIN ... -->` to `<!-- ODIN:END -->`. At that path in the repository's root: if the file has an ODIN block, replace that block whole; otherwise add the block at the end, keeping everything else in the file as it is. Create `.cursor/rules/` for the Cursor file if needed. Show me what changed and do not commit. If a rule is wrong, it is changed in ODIN, not in the file.
