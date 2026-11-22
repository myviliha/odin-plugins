<p align="center"><img src="odin/assets/odin-icon.png" width="96" alt="ODIN"></p>

<h1 align="center">ODIN plugins</h1>

<p align="center">Your company's rules and decisions in every AI agent. By <a href="https://viliha.com">RESOLVE LABS</a>.</p>

ODIN gives your AI agents your company's projects, rules and decisions, checks each action against them before it runs, and
records the work for your team. Every agent connects to the same hosted service, `https://api.viliha.com/mcp`, and signs in with
your ODIN account.

## Claude Code

```
/plugin marketplace add myviliha/odin-plugins
/plugin install odin@viliha
```

Then sign the hooks in once, so ODIN's gate runs in every session:

```
curl -fsSL https://api.viliha.com/install | sh
```

It asks for your personal token (ODIN console, Settings, API tokens) and keeps it in the macOS Keychain, or in
`~/.config/viliha/token` readable only by you. Until it is signed in, each session tells you so at its start.

## Codex and ChatGPT

```
codex plugin marketplace add myviliha/odin-plugins
```

Then install **ODIN** from the plugin list and sign in with your ODIN account when asked. The ChatGPT and Codex plugin
directory listing is on the way; until then, in ChatGPT add a connector with the address `https://api.viliha.com/mcp`.

## Gemini CLI

```
gemini extensions install https://github.com/myviliha/odin-plugins
```

Gemini CLI opens your browser to sign in to ODIN the first time an ODIN tool runs.

## Any agent that reads Agent Plugins 1.0

`odin/` is also a portable [Agent Plugins 1.0](https://github.com/agentplugins/agent-plugins-spec) package (`plugin.json` and
`mcp.json`): a tool that supports the standard installs it from this repository the way it installs any plugin.

## Claude (web and desktop) and other agents

Add a connector with the address `https://api.viliha.com/mcp` and sign in when asked. The Claude directory listing is on the
way.

## Quick commands

ODIN's quick commands (status, pause, project, who, assign, handoff, updates and the rest) come with the connection itself, so
every agent that shows a server's prompts offers them; Claude Code also has them as `/odin:` commands.

## What ODIN does in Claude Code

- **The gate:** before each tool call it asks ODIN whether the action may run; a refusal names what to read first.
- **The record:** each step of a session is sent to ODIN for your team; nothing is written on your machine, and a prompt's text is
  kept only if your company turns that on.
- **The watch:** a file emptied or a tracked file cut to almost nothing is reported as a miss (paths and line counts, never content).

Only work in a repository of one of your company's projects is recorded. `VILIHA_RECORD=off` pauses recording. The plugin's
details are in [odin/README.md](odin/README.md).

---

ODIN is made by RESOLVE LABS PTE. LTD., Singapore. [viliha.com](https://viliha.com) ·
[Privacy](https://viliha.com/privacy/) · [Terms](https://viliha.com/terms/)
