// Managed-block invariants. The one that matters most: a TOML table block must NEVER end
// up above a user's top-level keys — TOML comments do not reset table scope, so a table
// block prepended above `foo = 1` silently captures `foo` into our table.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../src/util");

/** Number of managed blocks in a string (counted by full end-marker lines). */
const blockCount = (s) => s.split(U.MARK_END).length - 1;

test("upsert on empty content emits exactly one block", () => {
  const out = U.upsertManagedBlock("", "a = 1");
  assert.ok(U.hasManagedBlock(out));
  assert.equal(blockCount(out), 1);
  assert.ok(out.includes("a = 1"));
});

test("upsert is idempotent — re-running replaces, never duplicates", () => {
  const once = U.upsertManagedBlock("user: keep\n", "a = 1");
  const twice = U.upsertManagedBlock(once, "a = 1");
  assert.equal(twice, once);
  // and updating the body swaps in place without growing the file
  const updated = U.upsertManagedBlock(once, "a = 2");
  assert.ok(updated.includes("a = 2"));
  assert.ok(!updated.includes("a = 1"));
  assert.equal(blockCount(updated), 1);
});

test("default position appends AFTER existing content (TOML capture fix)", () => {
  const existing = 'foo = 1\nbar = "baz"\n';
  const out = U.upsertManagedBlock(existing, "[tools.layerx1]\nx = 1", { label: "provider" });
  // user's top-level keys must come BEFORE our table header, or they'd be captured into it
  assert.ok(out.indexOf("foo = 1") < out.indexOf("[tools.layerx1]"));
  assert.ok(out.trimEnd().endsWith(U.MARK_END));
});

test('position "head" prepends (for top-level keys that must precede any table)', () => {
  const existing = "[sometable]\nkey = 1\n";
  const out = U.upsertManagedBlock(existing, 'model = "m"', { label: "head", position: "head" });
  assert.ok(out.indexOf('model = "m"') < out.indexOf("[sometable]"));
});

test("labeled blocks coexist and are replaced independently", () => {
  let out = U.upsertManagedBlock("user = true\n", "top = 1", { label: "head", position: "head" });
  out = U.upsertManagedBlock(out, "[t]\nk = 1", { label: "provider" });
  assert.ok(U.hasManagedBlock(out, "head"));
  assert.ok(U.hasManagedBlock(out, "provider"));
  // replacing one label leaves the other untouched
  const swapped = U.upsertManagedBlock(out, "top = 2", { label: "head", position: "head" });
  assert.ok(swapped.includes("top = 2"));
  assert.ok(swapped.includes("k = 1"));
  assert.equal(blockCount(swapped), 2);
});

test("removeManagedBlock strips every block (all labels) and keeps user content", () => {
  let out = U.upsertManagedBlock("keep_me = true\n", "top = 1", { label: "head", position: "head" });
  out = U.upsertManagedBlock(out, "[t]\nk = 1", { label: "provider" });
  const clean = U.removeManagedBlock(out);
  assert.ok(clean.includes("keep_me = true"));
  assert.ok(!clean.includes(">>>"));
  assert.ok(!clean.includes("top = 1"));
  assert.ok(!clean.includes("[t]"));
});

test("removeManagedBlock also strips pre-0.2.0 UNLABELED blocks", () => {
  // exactly what v0.1.0 wrote: an unlabeled block prepended above the user's content
  const legacy = `${U.MARK_START}\nmodel = "x"\n[model_providers.layerx1]\nname = "Layer X1"\n${U.MARK_END}\n\nuser_key = 1\n`;
  const clean = U.removeManagedBlock(legacy);
  assert.ok(clean.includes("user_key = 1"));
  assert.ok(!clean.includes("model_providers"));
  assert.ok(!clean.includes(">>>"));
});

test("normalizeOrigin strips trailing slash and /v1, adds https", () => {
  assert.equal(U.normalizeOrigin("example.com/"), "https://example.com");
  assert.equal(U.normalizeOrigin("https://example.com/v1"), "https://example.com");
  assert.equal(U.withV1(U.normalizeOrigin("http://x.dev/v1/")), "http://x.dev/v1");
});

test("shellProfile maps $SHELL to the right profile file", () => {
  const p = require("path");
  assert.equal(U.shellProfile("/home/u", "/bin/zsh"), p.join("/home/u", ".zshrc"));
  assert.equal(U.shellProfile("/home/u", "/usr/bin/fish"), p.join("/home/u", ".config", "fish", "config.fish"));
  assert.equal(U.shellProfile("/home/u", "/bin/bash"), p.join("/home/u", ".bashrc"));
  assert.equal(U.shellProfile("/home/u", ""), p.join("/home/u", ".bashrc"));
});
