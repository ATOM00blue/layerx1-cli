// One configurator per coding tool. Each returns a result describing what it did:
//   { wrote, backup, notes }  — a config file was written (backup path if it replaced one)
//   { printed, notes }        — manual step (GUI tool, or an existing config we won't clobber)
//   { error }                 — couldn't proceed safely
//
// ctx = { origin, v1, key, model, smallModel, print }
//   origin = gateway root WITHOUT /v1  (Claude Code's ANTHROPIC_BASE_URL — SDK adds /v1/messages)
//   v1     = origin + "/v1"            (OpenAI-style tools)
"use strict";
const U = require("./util");

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
    const p = U.homePath(".claude", "settings.json");
    let cfg = U.readJsonSafe(p);
    if (cfg === undefined) return { error: `${p} exists but is not valid JSON — fix/remove it first` };
    cfg = cfg || {};
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
  status() {
    const cfg = U.readJsonSafe(U.homePath(".claude", "settings.json"));
    const base = cfg && cfg.env && cfg.env.ANTHROPIC_BASE_URL;
    return { configured: !!base, detail: base ? `ANTHROPIC_BASE_URL=${base}` : "not configured" };
  },
  unset() {
    const p = U.homePath(".claude", "settings.json");
    const cfg = U.readJsonSafe(p);
    if (!cfg || !cfg.env) return { noop: true };
    for (const k of MANAGED_KC) delete cfg.env[k];
    return { wrote: p, backup: U.writeFileSafe(p, JSON.stringify(cfg, null, 2) + "\n") };
  },
};

const codex = {
  id: "codex",
  label: "OpenAI Codex CLI",
  protocol: "OpenAI Responses /v1/responses",
  apply(ctx) {
    const p = U.homePath(".codex", "config.toml");
    const existing = U.readFileSafe(p) || "";
    const userContent = U.removeManagedBlock(existing);
    const hasModelProvider = /^\s*model_provider\s*=/m.test(userContent);
    const hasModel = /^\s*model\s*=/m.test(userContent);
    const top = [];
    if (!hasModel) top.push(`model = "${ctx.model}"`);
    if (!hasModelProvider) top.push(`model_provider = "layerx1"`);
    if (top.length) top.push("");
    const body = [
      ...top,
      `[model_providers.layerx1]`,
      `name = "Layer X1"`,
      `base_url = "${ctx.v1}"`, // Codex base_url INCLUDES /v1
      `env_key = "LAYERX1_API_KEY"`,
      `wire_api = "responses"`, // the only value Codex accepts as of 2026
    ].join("\n");
    const next = U.upsertManagedBlock(existing, body);
    const notes = [`Export your key:  ${U.c.bold(`export LAYERX1_API_KEY="${ctx.key}"`)}`];
    if (hasModelProvider) {
      notes.push(`Your config already sets model_provider — switch it to "layerx1" (or run \`codex -c model_provider=layerx1\`).`);
    }
    notes.push("Codex requires the Responses API — Layer X1 serves /v1/responses.");
    notes.push("Then run `codex`.");
    if (ctx.print) return { printed: `# ${p}\n${next}`, notes };
    return { wrote: p, backup: U.writeFileSafe(p, next), notes };
  },
  status() {
    const content = U.readFileSafe(U.homePath(".codex", "config.toml")) || "";
    const has = content.includes("[model_providers.layerx1]");
    return { configured: has, detail: has ? "model_providers.layerx1 present" : "not configured" };
  },
  unset() {
    const p = U.homePath(".codex", "config.toml");
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
    const p = U.homePath(".aider.conf.yml");
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
  status() {
    const content = U.readFileSafe(U.homePath(".aider.conf.yml")) || "";
    const has = U.hasManagedBlock(content);
    return { configured: has, detail: has ? "managed block present" : "not configured" };
  },
  unset() {
    const p = U.homePath(".aider.conf.yml");
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
    const p = U.homePath(".continue", "config.yaml");
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
  status() {
    const content = U.readFileSafe(U.homePath(".continue", "config.yaml")) || "";
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

const TARGETS = [claudeCode, codex, aider, continueDev, cline];
const byId = Object.fromEntries(TARGETS.map((t) => [t.id, t]));

module.exports = { TARGETS, byId };
