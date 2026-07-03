// One configurator per coding tool. Each returns a result describing what it did:
//   { wrote, backup, notes }  — a config file was written (backup path if it replaced one)
//   { printed, notes }        — manual step (GUI tool, or an existing config we won't clobber)
//   { error }                 — couldn't proceed safely
//
// ctx = { origin, v1, key, model, smallModel, print, home }
//   origin = gateway root WITHOUT /v1  (Claude Code's ANTHROPIC_BASE_URL — SDK adds /v1/messages)
//   v1     = origin + "/v1"            (OpenAI-style tools)
//   home   = directory the tool configs live under — os.homedir() in real use; tests point it
//            at a scratch dir so the suite never touches this machine's actual configs.
"use strict";
const U = require("./util");
const path = U.path;

// Codex reads its key from the environment, so setup must also get LAYERX1_API_KEY to
// persist across shells. The exact incantation is per-OS; setup OFFERS to run it (cli.js),
// these strings are the always-printed fallback guidance.
function keyPersistNotes(key) {
  if (process.platform === "win32") {
    return [
      `Persist your key for new shells (PowerShell):  ${U.c.bold(
        `[Environment]::SetEnvironmentVariable('LAYERX1_API_KEY','${key}','User')`,
      )}`,
      `Current shell only:  ${U.c.dim(`$env:LAYERX1_API_KEY = '${key}'`)}`,
    ];
  }
  return [
    `Persist your key: add  ${U.c.bold(`export LAYERX1_API_KEY="${key}"`)}  to your shell profile (setup offers to do this for you).`,
  ];
}

const MANAGED_KC = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
];

const claudeCode = {
  id: "claude-code",
  label: "Claude Code",
  protocol: "Anthropic /v1/messages",
  apply(ctx) {
    const p = path.join(ctx.home, ".claude", "settings.json");
    let cfg = U.readJsonSafe(p);
    if (cfg === undefined) return { error: `${p} exists but is not valid JSON — fix/remove it first` };
    cfg = cfg || {};
    // Deep-merge into the existing settings: only OUR env keys are touched — the user's
    // permissions/hooks/other env entries pass through untouched.
    const env = (cfg.env = cfg.env || {});
    env.ANTHROPIC_BASE_URL = ctx.origin; // root, no /v1
    env.ANTHROPIC_AUTH_TOKEN = ctx.key; // Bearer (avoids the "custom API key?" prompt)
    env.ANTHROPIC_MODEL = ctx.model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = ctx.model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = ctx.model;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = ctx.smallModel;
    env.ANTHROPIC_SMALL_FAST_MODEL = ctx.smallModel;
    const notes = [];
    if (env.CLAUDE_CODE_USE_BEDROCK === "1" || env.CLAUDE_CODE_USE_VERTEX === "1") {
      notes.push("Unset CLAUDE_CODE_USE_BEDROCK / CLAUDE_CODE_USE_VERTEX — they override the base URL.");
    }
    notes.push("If you previously logged in to Claude, run `/logout` once so the gateway key is used.");
    notes.push("Then just run `claude`.");
    if (ctx.print) return { printed: `# ${p}\n${JSON.stringify(cfg, null, 2)}`, notes };
    return { wrote: p, backup: U.writeFileSafe(p, JSON.stringify(cfg, null, 2) + "\n"), notes };
  },
  status(ctx) {
    const cfg = U.readJsonSafe(path.join(ctx.home, ".claude", "settings.json"));
    const base = cfg && cfg.env && cfg.env.ANTHROPIC_BASE_URL;
    return { configured: !!base, detail: base ? `ANTHROPIC_BASE_URL=${base}` : "not configured" };
  },
  unset(ctx) {
    const p = path.join(ctx.home, ".claude", "settings.json");
    const cfg = U.readJsonSafe(p);
    if (!cfg || !cfg.env) return { noop: true };
    for (const k of MANAGED_KC) delete cfg.env[k];
    return { wrote: p, backup: U.writeFileSafe(p, JSON.stringify(cfg, null, 2) + "\n") };
  },
};

/** The slice of a TOML document BEFORE its first [table] header — the only region where a
 *  bare `key = value` is top-level. Conflict checks run on this slice, not the whole file:
 *  a `model =` inside someone's [profiles.x] table is a DIFFERENT key and must not stop us
 *  from writing the real top-level one. */
function tomlTopLevel(content) {
  return String(content).split(/^\s*\[/m)[0];
}

const codex = {
  id: "codex",
  label: "OpenAI Codex CLI",
  protocol: "OpenAI Responses /v1/responses",
  apply(ctx) {
    const p = path.join(ctx.home, ".codex", "config.toml");
    const existing = U.readFileSafe(p) || "";
    // Rebuild from the user's own content (all our blocks stripped, whatever version wrote
    // them) so re-runs are deterministic: head block → user content → provider table at EOF.
    const user = U.removeManagedBlock(existing);
    const top = tomlTopLevel(user);
    const hasModel = /^\s*model\s*=/m.test(top);
    const hasProvider = /^\s*model_provider\s*=/m.test(top);
    const hasCtxWindow = /^\s*model_context_window\s*=/m.test(top);
    const hasCompact = /^\s*model_auto_compact_token_limit\s*=/m.test(top);
    // Top-level keys — MUST precede any [table] header or TOML scopes them into that table.
    // Only keys the user hasn't set themselves (a TOML duplicate key is a hard parse error).
    const head = [];
    if (!hasModel) head.push(`model = "${ctx.model}"`);
    if (!hasProvider) head.push(`model_provider = "layerx1"`);
    // Window/compact parity so Codex compacts before the context limit instead of erroring.
    if (!hasCtxWindow) head.push(`model_context_window = 200000`);
    if (!hasCompact) head.push(`model_auto_compact_token_limit = 160000`);
    const table = [
      `[model_providers.layerx1]`,
      `name = "Layer X1"`,
      `base_url = "${ctx.v1}"`, // Codex base_url INCLUDES /v1
      `env_key = "LAYERX1_API_KEY"`,
      `wire_api = "responses"`, // the only value Codex accepts as of 2026
    ].join("\n");
    let next = user;
    if (head.length) next = U.upsertManagedBlock(next, head.join("\n"), { label: "head", position: "head" });
    // The table goes at EOF: comments don't reset TOML table scope, so anywhere else it
    // would capture whatever top-level keys follow it into [model_providers.layerx1].
    next = U.upsertManagedBlock(next, table, { label: "provider", position: "end" });
    const notes = [...keyPersistNotes(ctx.key)];
    if (hasProvider) {
      notes.push(`Your config already sets model_provider — switch it to "layerx1" (or run \`codex -c model_provider=layerx1\`).`);
    }
    notes.push("Codex requires the Responses API — Layer X1 serves /v1/responses.");
    notes.push("Then run `codex`.");
    if (ctx.print) return { printed: `# ${p}\n${next}`, notes };
    return { wrote: p, backup: U.writeFileSafe(p, next), notes };
  },
  status(ctx) {
    const content = U.readFileSafe(path.join(ctx.home, ".codex", "config.toml")) || "";
    const has = content.includes("[model_providers.layerx1]");
    return { configured: has, detail: has ? "model_providers.layerx1 present" : "not configured" };
  },
  unset(ctx) {
    const p = path.join(ctx.home, ".codex", "config.toml");
    const content = U.readFileSafe(p);
    if (!content) return { noop: true };
    return {
      wrote: p,
      backup: U.writeFileSafe(p, U.removeManagedBlock(content)),
      notes: ['If you set model_provider="layerx1" manually, revert it.'],
    };
  },
};

const aider = {
  id: "aider",
  label: "Aider",
  protocol: "OpenAI /v1/chat/completions (via LiteLLM)",
  apply(ctx) {
    const p = path.join(ctx.home, ".aider.conf.yml");
    const existing = U.readFileSafe(p) || "";
    const userContent = U.removeManagedBlock(existing);
    const conflict = /^\s*(model|openai-api-base|openai-api-key)\s*:/m.test(userContent);
    const body = [
      `model: openai/${ctx.model}`, // openai/ prefix → LiteLLM OpenAI-compatible route
      `openai-api-base: ${ctx.v1}`,
      `openai-api-key: ${ctx.key}`,
    ].join("\n");
    const notes = ["Run `aider` in your repo (add --no-show-model-warnings to silence unknown-model notices)."];
    if (conflict && !U.hasManagedBlock(existing)) {
      return {
        printed: `# merge into ${p}:\n${body}`,
        notes: ["Your ~/.aider.conf.yml already sets model/openai-api-base — merge the above manually to avoid duplicate keys.", ...notes],
      };
    }
    const next = U.upsertManagedBlock(existing, body);
    if (ctx.print) return { printed: `# ${p}\n${next}`, notes };
    return { wrote: p, backup: U.writeFileSafe(p, next), notes };
  },
  status(ctx) {
    const content = U.readFileSafe(path.join(ctx.home, ".aider.conf.yml")) || "";
    const has = U.hasManagedBlock(content);
    return { configured: has, detail: has ? "managed block present" : "not configured" };
  },
  unset(ctx) {
    const p = path.join(ctx.home, ".aider.conf.yml");
    const content = U.readFileSafe(p);
    if (!content) return { noop: true };
    return { wrote: p, backup: U.writeFileSafe(p, U.removeManagedBlock(content)) };
  },
};

const continueDev = {
  id: "continue",
  label: "Continue (VS Code / JetBrains)",
  protocol: "OpenAI /v1/chat/completions",
  apply(ctx) {
    const p = path.join(ctx.home, ".continue", "config.yaml");
    const existing = U.readFileSafe(p);
    const entry = [
      `  - name: Layer X1 (${ctx.model})`,
      `    provider: openai`,
      `    model: ${ctx.model}`,
      `    apiBase: ${ctx.v1}`,
      `    apiKey: ${ctx.key}`,
      `    roles: [chat, edit, apply]`,
    ].join("\n");
    const fresh = `name: Layer X1\nversion: 0.0.1\nschema: v1\nmodels:\n${entry}\n`;
    const notes = ["Reload VS Code (or the Continue extension) to pick up the model."];
    if (existing == null) {
      if (ctx.print) return { printed: `# ${p}\n${fresh}`, notes };
      return { wrote: p, backup: U.writeFileSafe(p, fresh), notes };
    }
    // A config already exists — merging into a YAML list without a parser risks corruption,
    // so print the entry for the user to add under their existing `models:` list.
    return {
      printed: `# add under the existing 'models:' list in ${p}:\n${entry}`,
      notes: ["You already have a Continue config — add the entry above under its `models:` list.", ...notes],
    };
  },
  status(ctx) {
    const content = U.readFileSafe(path.join(ctx.home, ".continue", "config.yaml")) || "";
    const has = content.includes("Layer X1");
    return { configured: has, detail: has ? "Layer X1 model present" : "not configured" };
  },
  unset() {
    return { noop: true, notes: ["Remove the 'Layer X1' entry from ~/.continue/config.yaml manually."] };
  },
};

const cline = {
  id: "cline",
  label: "Cline (VS Code)",
  protocol: "OpenAI /v1/chat/completions",
  apply(ctx) {
    const printed = [
      `Cline is configured in its UI. Open the Cline panel → gear (Settings) →`,
      `API Provider: "OpenAI Compatible", then set:`,
      ``,
      `    Base URL:  ${ctx.v1}`,
      `    API Key:   ${ctx.key}`,
      `    Model ID:  ${ctx.model}`,
    ].join("\n");
    return { printed, notes: ["Cline is GUI-configured — paste the values above into its settings panel."] };
  },
  status() {
    return { configured: null, detail: "GUI-configured (cannot be auto-detected)" };
  },
  unset() {
    return { noop: true, notes: ['Remove the "OpenAI Compatible" provider in Cline’s settings panel.'] };
  },
};

// Cursor stores model settings inside the app (encrypted database, no config file we could
// safely write) — so this target is print-only: exact clicks + the values to paste.
const cursor = {
  id: "cursor",
  label: "Cursor",
  protocol: "OpenAI /v1/chat/completions",
  apply(ctx) {
    const printed = [
      `Cursor is configured in its UI (its settings store is encrypted — no file to write):`,
      ``,
      `  1. Cursor Settings (Ctrl/Cmd+Shift+J) → Models`,
      `  2. In the OpenAI API Key section, paste your key:  ${ctx.key}`,
      `  3. Enable "Override OpenAI Base URL" and set it to:  ${ctx.v1}`,
      `  4. Click "+ Add model" and add:  ${ctx.model}`,
      `     (add any other lx1-* ids you want — see \`npx layerx1 models\`)`,
      `  5. Click "Verify", then pick ${ctx.model} in the model list.`,
    ].join("\n");
    return { printed, notes: ["Cursor is GUI-configured — follow the steps above inside Cursor."] };
  },
  status() {
    return { configured: null, detail: "GUI-configured (cannot be auto-detected)" };
  },
  unset() {
    return { noop: true, notes: ['In Cursor Settings → Models, disable "Override OpenAI Base URL" and remove the key.'] };
  },
};

// Windsurf likewise keeps provider settings in the app — print-only.
const windsurf = {
  id: "windsurf",
  label: "Windsurf",
  protocol: "OpenAI /v1/chat/completions",
  apply(ctx) {
    const printed = [
      `Windsurf is configured in its UI:`,
      ``,
      `  1. Windsurf Settings → Advanced Settings (or the settings panel in Cascade)`,
      `  2. Add an "OpenAI-compatible" provider / enable the OpenAI base-URL override:`,
      ``,
      `       Base URL:  ${ctx.v1}`,
      `       API Key:   ${ctx.key}`,
      `       Model ID:  ${ctx.model}`,
      ``,
      `  (Menu names vary by Windsurf version — look for "custom provider" or "base URL".)`,
    ].join("\n");
    return { printed, notes: ["Windsurf is GUI-configured — paste the values above into its settings."] };
  },
  status() {
    return { configured: null, detail: "GUI-configured (cannot be auto-detected)" };
  },
  unset() {
    return { noop: true, notes: ["Remove the custom provider entry in Windsurf's settings."] };
  },
};

const TARGETS = [claudeCode, codex, aider, continueDev, cline, cursor, windsurf];
const byId = Object.fromEntries(TARGETS.map((t) => [t.id, t]));

module.exports = { TARGETS, byId };
