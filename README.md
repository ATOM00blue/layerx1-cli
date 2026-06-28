# layerx1

Point your coding agent at the **Layer X1** gateway in one command. Configures
[Claude Code](https://claude.com/claude-code), [OpenAI Codex CLI](https://developers.openai.com/codex),
[Aider](https://aider.chat), [Continue](https://continue.dev), and [Cline](https://cline.bot)
to send their requests through Layer X1 — so every model goes through one endpoint with
caching, routing, and savings metering.

Zero dependencies. Needs Node ≥ 18.

## Quick start

```bash
# interactive — asks for your key, model, and which tools to set up
npx layerx1

# or non-interactive
npx layerx1 setup --key lx1_your_key --tool all
npx layerx1 setup --key lx1_your_key --tool claude-code,codex --model glm-5.2
```

Get an `lx1_` key from your Layer X1 dashboard.

## Commands

| Command | What it does |
|---|---|
| `layerx1` / `layerx1 init` | Interactive setup. |
| `layerx1 setup --key <k> [--tool <ids>]` | Configure one or more tools non-interactively. |
| `layerx1 status` | Show which tools are pointed at Layer X1. |
| `layerx1 models [--url <u>]` | List the gateway's model catalog. |
| `layerx1 test --key <k>` | Send one request through the gateway to verify it works. |
| `layerx1 unset [--tool <ids>]` | Remove Layer X1 config (restores from a timestamped backup). |

### Flags

| Flag | Default |
|---|---|
| `--key <k>` | — (required for `setup`/`test`) |
| `--url <u>` | `https://layerx1-gateway.orbitweb00.workers.dev` |
| `--model <m>` | `glm-5.2` |
| `--small-model <m>` | `glm-4.7-flash` |
| `--tool <ids>` | comma-separated: `claude-code,codex,aider,continue,cline` or `all` |
| `--print` | Print the config instead of writing files. |

## What it writes

| Tool | File / step | Notes |
|---|---|---|
| **Claude Code** | `~/.claude/settings.json` (`env` block) | `ANTHROPIC_BASE_URL` (origin, no `/v1`), `ANTHROPIC_AUTH_TOKEN`, model tiers. Run `/logout` first if you were logged in. |
| **Codex CLI** | `~/.codex/config.toml` (`[model_providers.layerx1]`) | `wire_api="responses"` (Codex dropped chat in 2026) → uses the gateway's `/v1/responses`. Key via `export LAYERX1_API_KEY=…`. |
| **Aider** | `~/.aider.conf.yml` | OpenAI-compatible route (`model: openai/<m>`, `openai-api-base`, key). |
| **Continue** | `~/.continue/config.yaml` | Adds an `openai`-provider model with your `apiBase`. (Prints the entry to merge if a config already exists.) |
| **Cline** | prints values | GUI-only — paste Base URL / API Key / Model into its settings panel. |

Existing files are backed up to `<file>.layerx1.bak-<timestamp>` before any change. File
configs use a managed block (`# >>> layerx1 … <<<`) so re-running is idempotent and
`unset` cleanly removes only our additions.

## Notes

- **Claude Code** uses the host root for `ANTHROPIC_BASE_URL` (the SDK appends `/v1/messages`); every other tool uses the `/v1` base. The installer derives both from `--url` automatically.
- **Codex** requires the OpenAI **Responses** API — Layer X1 serves `/v1/responses`, so it works.
- Models like `opus` / `gpt-5.x` resolve but need their provider key on the gateway; `glm-5.2` and `sonnet` work out of the box.
