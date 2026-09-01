# ok

One command. Any agent.

`ok` is a small CLI that routes questions to coding agents on your machine — [fx](https://fx.sh), [Codex](https://github.com/openai/codex), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenCode](https://opencode.ai), or [Pi](https://pi.dev). One interface, saved sessions, and named personas you can invoke from the prompt.

## Install

Requires Node.js 18+ and at least one coding agent CLI on your `PATH` (fx, Codex, Claude Code, OpenCode, or Pi).

**npm (recommended)**

```bash
npm install -g ok-agent
ok
```

Try without installing:

```bash
npx ok-agent explain what this repo does
```

After a global install the command is `ok`. `ok-agent` is also available as an alias.

**From source**

```bash
git clone https://github.com/farnabaz/ok.git
cd ok
pnpm install
pnpm run build
pnpm link --global
```

## Quick start

First run walks you through picking a default harness and model:

```bash
ok
```

Ask a one-off question:

```bash
ok explain what this repo does
```

Continue where you left off in the current directory:

```bash
ok -c
```

## Usage

```
ok [QUESTION...]
ok @agent [QUESTION...]
ok agent [QUESTION...]
ok -c [QUESTION...]
ok --sessions
ok --agents [new]
ok --settings
```

With no question, `ok` starts an interactive session.

| Flag | Description |
|------|-------------|
| `-c`, `--continue` | Continue the latest session in this directory |
| `-s`, `--sessions` | Pick a saved session (↑/↓, Enter to continue, `d` to delete) |
| `--agents` | List agents (↑/↓, Enter to use, `n` new, `d` delete) |
| `--agents new` | Create a named agent interactively |
| `--settings` | Re-run setup (harness + model) |
| `-h`, `--help` | Print help |
| `-V`, `--version` | Print version |

## Named agents

Define personas in settings and invoke them from the prompt:

```bash
ok @reviewer is this function safe?
ok reviewer is this function safe?   # when bare invoke is enabled
```

Create agents interactively:

```bash
ok --agents new
# or
ok --agents        # then press n
```

Each agent can override harness, model, reasoning, and carries its own instruction (system prompt).

Agent names use lowercase letters only (`a`–`z`).

## Harnesses

`ok` detects which agent CLIs are on your `PATH` and lets you pick one as the default backend.

| Harness | Binary | Override env |
|---------|--------|--------------|
| fx | `fx` | `OK_FX_BIN` |
| Codex | `codex` | `OK_CODEX_BIN` |
| Claude Code | `claude` | `OK_CLAUDE_BIN` |
| OpenCode | `opencode` | `OK_OPENCODE_BIN` |
| Pi | `pi` | `OK_PI_BIN` |

## Configuration

All app data lives in `~/.ok/`:

```
~/.ok/
  setting.json    settings and named agents
  sessions/       saved conversations
```

Delete `~/.ok` to reset ok completely.

Override paths:

| Variable | Purpose |
|----------|---------|
| `OK_DATA` | Data directory (default `~/.ok`) |
| `OK_CONFIG` | Settings file path (default `~/.ok/setting.json`) |

Example settings shape:

```json
{
  "version": 1,
  "harness": "fx",
  "instructions": "concise",
  "harnesses": {
    "fx": { "model": "provider/model", "reasoning": null }
  },
  "agents": {
    "reviewer": {
      "instruction": "You review code for security issues. Be direct.",
      "harness": "claude",
      "model": "sonnet"
    }
  },
  "invoke": { "bare": true, "at": true }
}
```

## Development

```bash
pnpm install
pnpm run typecheck   # type-check only
pnpm run build       # bundle dist/ok.js
pnpm start           # run bundled CLI
```

## Release

Requires `main` branch, clean git state, and auth for npm + GitHub (`GITHUB_TOKEN` for GitHub releases).

```bash
pnpm install
pnpm run release          # interactive: patch / minor / major
pnpm run release -- patch # non-interactive
```

release-it will typecheck, build, bump `package.json`, commit, tag, push, create a GitHub release, and publish to npm.

Dry run:

```bash
pnpm run release -- --dry-run
```

Install for users:

```bash
npm install -g ok-agent
ok
```

## License

MIT
