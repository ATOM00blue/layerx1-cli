// Target writers, exercised against a THROWAWAY home dir (ctx.home) — the suite must never
// read or write this machine's real ~/.claude, ~/.codex, etc.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { byId } = require("../src/targets");
const U = require("../src/util");

function freshCtx() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lx1-cli-test-"));
  return {
    origin: "https://gw.example.com",
    v1: "https://gw.example.com/v1",
    key: "lx1_test_key",
    model: "lx1-gpt-oss-120b",
    smallModel: "lx1-glm-4.7-flash",
    print: false,
    home,
  };
}

// --- Claude Code: settings.json deep-merge ----------------------------------

test("claude-code: fresh install writes env block", () => {
  const ctx = freshCtx();
  const res = byId["claude-code"].apply(ctx);
  assert.ok(res.wrote);
  const cfg = JSON.parse(fs.readFileSync(res.wrote, "utf8"));
  assert.equal(cfg.env.ANTHROPIC_BASE_URL, "https://gw.example.com"); // origin, never /v1
  assert.equal(cfg.env.ANTHROPIC_AUTH_TOKEN, "lx1_test_key");
  assert.equal(cfg.env.ANTHROPIC_MODEL, "lx1-gpt-oss-120b");
  assert.equal(cfg.env.ANTHROPIC_SMALL_FAST_MODEL, "lx1-glm-4.7-flash");
});

test("claude-code: merge preserves the user's other settings and env vars", () => {
  const ctx = freshCtx();
  const p = path.join(ctx.home, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({
      permissions: { allow: ["Bash(ls:*)"] },
      env: { MY_VAR: "keep-me", ANTHROPIC_MODEL: "stale-old-value" },
    }),
  );
  byId["claude-code"].apply(ctx);
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.deepEqual(cfg.permissions, { allow: ["Bash(ls:*)"] }); // untouched
  assert.equal(cfg.env.MY_VAR, "keep-me"); // untouched
  assert.equal(cfg.env.ANTHROPIC_MODEL, "lx1-gpt-oss-120b"); // ours, updated
});

test("claude-code: unset removes only the managed env keys", () => {
  const ctx = freshCtx();
  byId["claude-code"].apply(ctx);
  const p = path.join(ctx.home, ".claude", "settings.json");
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  cfg.env.MY_VAR = "keep-me";
  fs.writeFileSync(p, JSON.stringify(cfg));
  byId["claude-code"].unset(ctx);
  const after = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(after.env.MY_VAR, "keep-me");
  assert.equal(after.env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(after.env.ANTHROPIC_AUTH_TOKEN, undefined);
});

test("claude-code: --print writes nothing", () => {
  const ctx = freshCtx();
  ctx.print = true;
  const res = byId["claude-code"].apply(ctx);
  assert.ok(res.printed);
  assert.ok(!fs.existsSync(path.join(ctx.home, ".claude", "settings.json")));
});

// --- Codex: the TOML capture regression --------------------------------------

test("codex: user's top-level keys are NEVER captured into our provider table", () => {
  const ctx = freshCtx();
  const p = path.join(ctx.home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Top-level keys + a table of their own — the v0.1.0 prepend bug swallowed these
  // top-level keys into [model_providers.layerx1].
  fs.writeFileSync(p, 'approval_policy = "never"\nsandbox_mode = "workspace-write"\n\n[profiles.fast]\nmodel = "other"\n');
  byId.codex.apply(ctx);
  const out = fs.readFileSync(p, "utf8");
  const tableAt = out.indexOf("[model_providers.layerx1]");
  assert.ok(tableAt !== -1);
  // every user top-level key sits BEFORE our table header → still top-level
  assert.ok(out.indexOf("approval_policy") < tableAt);
  assert.ok(out.indexOf("sandbox_mode") < tableAt);
  // and NOTHING follows our table except its own keys — nothing left to capture
  const afterTable = out.slice(tableAt);
  assert.ok(!/^\s*\[/m.test(afterTable.slice(1)), "no user table below ours");
  assert.ok(afterTable.includes('wire_api = "responses"'));
  // our top-level keys precede the user's first table header
  assert.ok(out.indexOf('model = "lx1-gpt-oss-120b"') < out.indexOf("[profiles.fast]"));
  assert.ok(out.includes("model_context_window = 200000"));
  assert.ok(out.includes("model_auto_compact_token_limit = 160000"));
});

test("codex: re-running apply is byte-identical (idempotent)", () => {
  const ctx = freshCtx();
  const p = path.join(ctx.home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "notify = true\n");
  byId.codex.apply(ctx);
  const first = fs.readFileSync(p, "utf8");
  byId.codex.apply(ctx);
  const second = fs.readFileSync(p, "utf8");
  assert.equal(second, first);
});

test("codex: existing top-level model/model_provider are respected, not duplicated", () => {
  const ctx = freshCtx();
  const p = path.join(ctx.home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'model = "mine"\nmodel_provider = "someone"\n');
  const res = byId.codex.apply(ctx);
  const out = fs.readFileSync(p, "utf8");
  // duplicate top-level keys are a hard TOML parse error — we must not add a second one
  assert.equal(out.match(/^model\s*=/gm).length, 1);
  assert.equal(out.match(/^model_provider\s*=/gm).length, 1);
  assert.ok(out.includes('model = "mine"'));
  // but the parity keys the user did NOT set still land
  assert.ok(out.includes("model_context_window = 200000"));
  assert.ok(res.notes.some((n) => n.includes("model_provider")));
});

test("codex: a model key inside the user's own [table] does not block the top-level one", () => {
  const ctx = freshCtx();
  const p = path.join(ctx.home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '[profiles.gpt]\nmodel = "other"\n');
  byId.codex.apply(ctx);
  const out = fs.readFileSync(p, "utf8");
  // scoped `model` is a different key — the real top-level `model` must still be written
  assert.ok(/^model = "lx1-gpt-oss-120b"$/m.test(out));
});

test("codex: upgrades a v0.1.0-layout file (legacy prepended block) cleanly", () => {
  const ctx = freshCtx();
  const p = path.join(ctx.home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // exactly the corrupting v0.1.0 layout: unlabeled block ending inside our table, ABOVE
  // the user's top-level key
  const legacy = [
    U.MARK_START,
    'model = "glm-5.2"',
    'model_provider = "layerx1"',
    "",
    "[model_providers.layerx1]",
    'name = "Layer X1"',
    'base_url = "https://old.example/v1"',
    'env_key = "LAYERX1_API_KEY"',
    'wire_api = "responses"',
    U.MARK_END,
    "",
    'approval_policy = "never"', // ← was being captured into the table
    "",
  ].join("\n");
  fs.writeFileSync(p, legacy);
  byId.codex.apply(ctx);
  const out = fs.readFileSync(p, "utf8");
  assert.ok(!out.includes("old.example"), "legacy block fully replaced");
  assert.ok(!out.includes('"glm-5.2"'), "stale non-catalog model id gone");
  assert.ok(out.indexOf("approval_policy") < out.indexOf("[model_providers.layerx1]"));
});

test("codex: unset strips both managed blocks and leaves user content", () => {
  const ctx = freshCtx();
  const p = path.join(ctx.home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "notify = true\n");
  byId.codex.apply(ctx);
  byId.codex.unset(ctx);
  const out = fs.readFileSync(p, "utf8");
  assert.ok(out.includes("notify = true"));
  assert.ok(!out.includes("layerx1"));
  assert.ok(!out.includes(">>>"));
});

// --- Aider --------------------------------------------------------------------

test("aider: fresh config gets a managed block; unset removes it", () => {
  const ctx = freshCtx();
  const res = byId.aider.apply(ctx);
  assert.ok(res.wrote);
  const out = fs.readFileSync(res.wrote, "utf8");
  assert.ok(out.includes("model: openai/lx1-gpt-oss-120b"));
  assert.ok(out.includes("openai-api-base: https://gw.example.com/v1"));
  byId.aider.unset(ctx);
  assert.equal(fs.readFileSync(res.wrote, "utf8").trim(), "");
});

test("aider: pre-existing model keys → manual merge, file untouched", () => {
  const ctx = freshCtx();
  const p = path.join(ctx.home, ".aider.conf.yml");
  fs.writeFileSync(p, "model: gpt-4o\n");
  const res = byId.aider.apply(ctx);
  assert.ok(res.printed);
  assert.equal(fs.readFileSync(p, "utf8"), "model: gpt-4o\n");
});

// --- GUI targets never write files ---------------------------------------------

for (const id of ["cline", "cursor", "windsurf"]) {
  test(`${id}: print-only — steps include base URL, key and model; nothing written`, () => {
    const ctx = freshCtx();
    const res = byId[id].apply(ctx);
    assert.ok(res.printed);
    assert.ok(!res.wrote);
    assert.ok(res.printed.includes("https://gw.example.com/v1"));
    assert.ok(res.printed.includes("lx1_test_key"));
    assert.ok(res.printed.includes("lx1-gpt-oss-120b"));
    assert.equal(fs.readdirSync(ctx.home).length, 0, "home dir untouched");
  });
}
