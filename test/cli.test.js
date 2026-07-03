// CLI surface: arg parsing, catalog-pinned defaults, and end-to-end smoke runs of the bin
// (spawned with LAYERX1_HOME pointing at a scratch dir so no real config is ever touched).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseArgs, ctxFrom, DEFAULT_MODEL, DEFAULT_SMALL, DEFAULT_URL } = require("../src/cli");
const pkg = require("../package.json");

const BIN = path.join(__dirname, "..", "bin", "layerx1.js");

// The gateway's public catalog (GET /v1/models), pinned by hand. If a default here ever
// drifts off this list the gateway would SILENTLY serve its own default model instead —
// that exact bug shipped once (bare "glm-5.2"), so the ids are asserted, not assumed.
const CATALOG = [
  "lx1-gpt-oss-120b",
  "lx1-gpt-oss-20b",
  "lx1-glm-4.7-flash",
  "lx1-gemma-4-26b",
  "lx1-nemotron-3-120b",
  "lx1-glm-5.2",
  "lx1-kimi-k2.7-code",
  "lx1-glm-5",
  "lx1-deepseek-v3.2",
  "lx1-sonnet-4.6",
  "lx1-qwen3-coder-480b",
  "lx1-qwen3-coder-30b",
  "lx1-qwen3-coder-next",
  "lx1-qwen3-235b",
  "lx1-qwen3-next-80b",
  "lx1-nemotron-nano-3-30b",
  "lx1-nemotron-super-3-120b",
  "lx1-kimi-k2.5",
  "lx1-kimi-k2-thinking",
  "lx1-devstral-2-123b",
  "lx1-minimax-m2.5",
  "lx1-mistral-large-3-675b",
];

test("default model ids are canonical catalog ids", () => {
  assert.equal(DEFAULT_MODEL, "lx1-gpt-oss-120b"); // the gateway default — fast
  assert.equal(DEFAULT_SMALL, "lx1-glm-4.7-flash");
  assert.ok(CATALOG.includes(DEFAULT_MODEL));
  assert.ok(CATALOG.includes(DEFAULT_SMALL));
});

test("parseArgs: bare flags, valued flags, = form, positionals", () => {
  const a = parseArgs(["setup", "--print", "--key", "lx1_k", "--model=lx1-glm-5.2"]);
  assert.equal(a.cmd, "setup");
  assert.equal(a.flags.print, true);
  assert.equal(a.flags.key, "lx1_k");
  assert.equal(a.flags.model, "lx1-glm-5.2");
  const b = parseArgs(["--version"]);
  assert.equal(b.flags.version, true);
  assert.equal(b.cmd, undefined);
  const c = parseArgs(["unset", "codex", "--no-persist-key"]);
  assert.equal(c.cmd, "unset");
  assert.deepEqual(c.rest, ["codex"]);
  assert.equal(c.flags["no-persist-key"], true);
});

test("ctxFrom: origin/v1 derivation and defaults", () => {
  const { flags } = parseArgs(["--url", "https://gw.example.com/v1/", "--key", "k"]);
  const ctx = ctxFrom(flags);
  assert.equal(ctx.origin, "https://gw.example.com"); // /v1 stripped — Claude Code wants the root
  assert.equal(ctx.v1, "https://gw.example.com/v1");
  assert.equal(ctx.model, DEFAULT_MODEL);
  assert.equal(ctxFrom({}).origin, DEFAULT_URL);
});

// --- bin smoke runs -----------------------------------------------------------

function runBin(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
}

test("bin --version prints the package version", () => {
  const r = runBin(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test("bin --help lists every command and target", () => {
  const r = runBin(["--help"]);
  assert.equal(r.status, 0);
  for (const word of ["setup", "status", "models", "test", "unset", "claude-code", "codex", "aider", "continue", "cline", "cursor", "windsurf"]) {
    assert.ok(r.stdout.includes(word), `help mentions ${word}`);
  }
});

test("bin setup --print writes nothing and shows the would-be configs", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lx1-cli-smoke-"));
  const r = runBin(["setup", "--key", "lx1_smoke", "--tool", "claude-code,codex", "--print"], {
    LAYERX1_HOME: home,
  });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("[model_providers.layerx1]"));
  assert.ok(r.stdout.includes("ANTHROPIC_BASE_URL"));
  assert.ok(r.stdout.includes(DEFAULT_MODEL));
  assert.equal(fs.readdirSync(home).length, 0, "print mode must not write");
});

test("bin setup + status + unset round-trip against a scratch home", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lx1-cli-smoke-"));
  const env = { LAYERX1_HOME: home };
  const s = runBin(["setup", "--key", "lx1_smoke", "--tool", "claude-code,codex", "--no-persist-key"], env);
  assert.equal(s.status, 0);
  assert.ok(fs.existsSync(path.join(home, ".claude", "settings.json")));
  assert.ok(fs.existsSync(path.join(home, ".codex", "config.toml")));
  const st = runBin(["status"], env);
  assert.ok(st.stdout.includes("ANTHROPIC_BASE_URL="));
  assert.ok(st.stdout.includes("model_providers.layerx1 present"));
  const u = runBin(["unset", "--tool", "claude-code,codex"], env);
  assert.equal(u.status, 0);
  const st2 = runBin(["status"], env);
  assert.ok(!st2.stdout.includes("model_providers.layerx1 present"));
});
