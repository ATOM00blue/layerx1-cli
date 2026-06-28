// Shared helpers for the Layer X1 installer. Zero runtime dependencies — pure Node, so
// `npx layerx1` works with nothing installed.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const HOME = os.homedir();

// --- colors (disabled when not a TTY or NO_COLOR is set) --------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  cyan: wrap("36"),
  gray: wrap("90"),
};

const log = (s = "") => process.stdout.write(s + "\n");
const ok = (s) => log(`  ${c.green("✓")} ${s}`);
const info = (s) => log(`  ${c.cyan("•")} ${s}`);
const warn = (s) => log(`  ${c.yellow("!")} ${s}`);
const err = (s) => log(`  ${c.red("✗")} ${s}`);
const head = (s) => log(`\n${c.bold(s)}`);

// --- URL handling -----------------------------------------------------------
// Accept a gateway URL in any form and produce both the ORIGIN (no /v1, for the
// Anthropic SDK which appends /v1/messages) and the /v1 base (for OpenAI-style tools).
function normalizeOrigin(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  u = u.replace(/\/+$/, ""); // trailing slashes
  u = u.replace(/\/v1$/i, ""); // a trailing /v1
  return u;
}
const withV1 = (origin) => origin + "/v1";

// --- files ------------------------------------------------------------------
function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
function readJsonSafe(p) {
  const raw = readFileSafe(p);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined; // exists but unparseable — caller must decide
  }
}
function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}
/** Back up an existing file to <path>.layerx1.bak-<ts>; returns the backup path or null. */
function backup(p) {
  if (!fs.existsSync(p)) return null;
  const bak = `${p}.layerx1.bak-${Date.now()}`;
  fs.copyFileSync(p, bak);
  return bak;
}
/** Write content, backing up any existing file first. Best-effort 0600 perms. */
function writeFileSafe(p, content) {
  ensureDir(p);
  const bak = backup(p);
  fs.writeFileSync(p, content);
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* windows / no-op */
  }
  return bak;
}

// --- managed-block (for TOML/YAML text configs) -----------------------------
const MARK_START = "# >>> layerx1 (managed block — do not edit between markers) >>>";
const MARK_END = "# <<< layerx1 <<<";
const BLOCK_RE = new RegExp(
  `${escapeRe(MARK_START)}[\\s\\S]*?${escapeRe(MARK_END)}\\n?`,
  "g",
);
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function hasManagedBlock(content) {
  return content != null && content.includes(MARK_START);
}
/** Insert/replace our managed block. New configs get it prepended; existing ones keep
 *  their content and we swap just our block (idempotent re-runs). */
function upsertManagedBlock(existing, body) {
  const block = `${MARK_START}\n${body.trimEnd()}\n${MARK_END}\n`;
  if (existing && hasManagedBlock(existing)) {
    return existing.replace(BLOCK_RE, block);
  }
  return existing && existing.trim() ? `${block}\n${existing}` : block;
}
function removeManagedBlock(existing) {
  if (!existing) return existing;
  return existing.replace(BLOCK_RE, "").replace(/^\n+/, "");
}

// --- interactive prompt -----------------------------------------------------
async function prompt(question, def) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = def ? c.dim(` [${def}]`) : "";
  const answer = await new Promise((res) => rl.question(`  ${question}${suffix} `, res));
  rl.close();
  const v = answer.trim();
  return v || def || "";
}

module.exports = {
  fs,
  path,
  HOME,
  c,
  log,
  ok,
  info,
  warn,
  err,
  head,
  normalizeOrigin,
  withV1,
  readFileSafe,
  readJsonSafe,
  ensureDir,
  backup,
  writeFileSafe,
  MARK_START,
  MARK_END,
  hasManagedBlock,
  upsertManagedBlock,
  removeManagedBlock,
  prompt,
  homePath: (...parts) => path.join(HOME, ...parts),
};
