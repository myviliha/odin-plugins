# ODIN for Claude Code

**Install:** `/plugin marketplace add myviliha/odin-plugins` and `/plugin install odin@viliha`, then sign the hooks in once with the command below. **Or in one command, for every session of this user:** `curl -fsSL https://api.viliha.com/install | sh`. It asks for your
personal token (Viliha console, Settings, API tokens), keeps it in the macOS Keychain (else `~/.config/viliha/token`, readable
only by you), fetches this plugin from Viliha and installs it with `claude plugin install odin@viliha --scope user`. Run it
again to update.

Your company's projects, rules and decisions in Claude Code through Viliha's hosted MCP, the gate that checks each action, and
every session recorded on Viliha's server. Nothing of the framework or of a project's record is on this machine (ODIN-35, ODIN-61).

- **MCP:** `https://api.viliha.com/mcp`; Claude Code opens the browser to sign in the first time.
- **The gate:** before each tool call the plugin asks Viliha whether it may run (the rule cards read, no forbidden command, nothing
  sent outside the project); a refusal names what to read, which the agent reads with `odin_read`. At a session's start it loads the
  project's context. The project is found from the repository's remote; it sends the command or the file path, never a file's
  content. If Viliha cannot be reached, the call goes ahead and you are told it was not checked.
- **Personal stays personal:** only work in a repository of one of your projects (or the project `VILIHA_PROJECT` names) is
  recorded; anything else on this machine is not. `VILIHA_RECORD=off` pauses recording.
- **The watch:** after each action it checks whether a file was emptied or a tracked file lost nearly all its lines, and reports
  that as a miss (paths and line counts, never content); Viliha alerts your administrators and learns a gate rule from it.
- **Recording:** the hooks send each step (session start, prompt, tool, edited file, finish) to Viliha. Nothing is written locally.
  A prompt's text is kept only if your company turns that on; otherwise only its length.
- **Token for the hooks:** a personal token (Settings, API tokens, Create personal token: read-only, acting as you) in
  `VILIHA_TOKEN`, or on macOS in the Keychain:
  `security add-generic-password -s viliha -a token -w "$(pbpaste)"`. Optional: `VILIHA_PROJECT` names the project.
