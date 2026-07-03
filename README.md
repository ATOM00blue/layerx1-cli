# layerx1

Point your coding agent at **Layer X1** in one command. Configures
[Claude Code](https://claude.com/claude-code), [OpenAI Codex CLI](https://developers.openai.com/codex),
[Aider](https://aider.chat), [Continue](https://continue.dev), [Cline](https://cline.bot),
[Cursor](https://cursor.com), and [Windsurf](https://windsurf.com) to send their requests
to the Layer X1 API — one endpoint, one key, one model catalog.

Zero dependencies. Needs Node ≥ 18.

## Quick start

```bash
# interactive — asks for your key, model, and which tools to set up
npx layerx1

# or non-interactive
npx layerx1 setup --key lx1_your_key --tool all
npx layerx1 setup --key lx1_your_key --tool claude-code,codex --model lx1-glm-5.2

# verify (reuses the key you just configured — no flag needed)
npx layerx1 test
```

Get an `lx1_` key from your Layer X1 dashboard.

## Commands

| Command | What it does |
|---|---|
| `npx layerx1` / `npx layerx1 init` | Interactive setup. |
| `npx layerx1 setup --key <k> [--tool <ids>]` | Configure one or more tools non-interactively. |
| `npx layerx1 status` | Show which tools are pointed at Layer X1. |
| `npx layerx1 models [--url <u>]` | List the model catalog with pricing. |
| `npx layerx1 test [--key <k>]` | Send one request to verify everything works. Without `--key` it reuses `LAYERX1_API_KEY` or the key already written to Claude Code's settings. |
| `npx layerx1 unset [--tool <ids>]` | Remove Layer X1 config (previous files are kept as timestamped backups). |
| `npx layerx1 --version` | Print the CLI version. |

### Flags

| Flag | Default |
|---|---|
| `--key <k>` | — (required for `setup`) |
| `--url <u>` | `https://layerx1-gateway.orbitweb00.workers.dev` |
| `--model <m>` | `lx1-gpt-oss-120b` |
| `--small-model <m>` | `lx1-glm-4.7-flash` |
| `--tool <ids>` | comma-separated: `claude-code,codex,aider,continue,cline,cursor,windsurf` or `all` |
| `--print` | Print the config instead of writing files. |
| `--persist-key` / `--no-persist-key` | Save `LAYERX1_API_KEY` for new shells without asking / never touch env or shell profile. |
| `--home <dir>` | Write configs under `<dir>` instead of your home directory (sandboxes, tests). Also settable via `LAYERX1_HOME`. |

Model ids are always `lx1-*` — run `npx layerx1 models` for the full catalog.

## What it writes

| Tool | File / step | Notes |
|---|---|---|
| **Claude Code** | `~/.claude/settings.json` (`env` block) | `ANTHROPIC_BASE_URL` (origin, no `/v1`), `ANTHROPIC_AUTH_TOKEN`, model tiers. Run `/logout` first if you were logged in. |
| **Codex CLI** | `~/.codex/config.toml` | Top-level keys (`model`, `model_provider`, context window) at the head of the file, the `[model_providers.layerx1]` table at the end — your own keys are never disturbed. `wire_api="responses"` → Layer X1's `/v1/responses`. Key via `LAYERX1_API_KEY` (see below). |
| **Aider** | `~/.aider.conf.yml` | OpenAI-compatible route (`model: openai/<m>`, `openai-api-base`, key). |
| **Continue** | `~/.continue/config.yaml` | Adds an `openai`-provider model with your `apiBase`. (Prints the entry to merge if a config already exists.) |
| **Cline** | prints values | GUI-only — paste Base URL / API Key / Model into its settings panel. |
| **Cursor** | prints steps | GUI-only — Settings → Models: paste your key as the OpenAI API key, enable *Override OpenAI Base URL* → `<gateway>/v1`, add `lx1-*` model ids. |
| **Windsurf** | prints steps | GUI-only — add an OpenAI-compatible provider with the same Base URL / key / model. |

Existing files are backed up to `<file>.layerx1.bak-<timestamp>` before any change. File
configs use managed blocks (`# >>> layerx1 … <<<`) so re-running is idempotent and
`unset` cleanly removes only our additions.

## Your key for Codex (`LAYERX1_API_KEY`)

Codex reads its API key from the environment. After `setup`, the CLI offers to persist it
for you (skip with `--no-persist-key`, force with `--persist-key`):

- **Windows (PowerShell)** — saved to your User environment, so every new terminal has it:

  ```powershell
  [Environment]::SetEnvironmentVariable('LAYERX1_API_KEY','lx1_your_key','User')
  ```

- **macOS / Linux** — appended to your shell profile (`~/.zshrc`, `~/.bashrc`, or
  `~/.config/fish/config.fish`, detected from `$SHELL`) inside a managed block that
  `npx layerx1 unset` removes again:

  ```bash
  export LAYERX1_API_KEY="lx1_your_key"
  ```

Open a new terminal (or `source` your profile) afterwards.

## Notes

- **Claude Code** uses the host root for `ANTHROPIC_BASE_URL` (the SDK appends `/v1/messages`); every other tool uses the `/v1` base. The installer derives both from `--url` automatically.
- **Codex** requires the OpenAI **Responses** API — Layer X1 serves `/v1/responses`, so it works out of the box.
- `npx layerx1 test` uses `max_tokens: 512` so models that think before they answer still return visible text.

## License

MIT
