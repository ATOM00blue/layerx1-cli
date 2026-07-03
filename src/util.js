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
// Blocks are LABELED (e.g. "head", "provider") because one file may need two of them at
// different positions. Concretely: TOML comments do NOT reset table scope, so a
// `[model_providers.layerx1]` table prepended above a user's config would capture their
// pre-existing TOP-LEVEL keys into our table (silent config corruption). The fix is
// structural: top-level keys go in a "head" block at the FILE HEAD (a block of bare
// `key = value` lines captures nothing), and table blocks go at EOF (nothing follows
// them, so nothing can be captured).
const MARK_PREFIX = "# >>> layerx1";
const MARK_END = "# <<< layerx1 <<<";
const markStart = (label) =>
  `${MARK_PREFIX}${label ? ":" + label : ""} (managed block — do not edit between markers) >>>`;
const MARK_START = markStart(""); // unlabeled form — kept for pre-0.2.0 files in the wild
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Matches EVERY layerx1 block regardless of label — including pre-0.2.0 unlabeled ones. */
const ANY_BLOCK_RE = () =>
  new RegExp(`${escapeRe(MARK_PREFIX)}[^\\n]*>>>\\n[\\s\\S]*?${escapeRe(MARK_END)}\\n?`, "g");
const blockRe = (label) =>
  new RegExp(`${escapeRe(markStart(label))}\\n[\\s\\S]*?${escapeRe(MARK_END)}\\n?`, "g");
function hasManagedBlock(content, label = "") {
  return content != null && content.includes(markStart(label));
}
/** Insert/replace the block with this label. If it already exists it is swapped in place
 *  (idempotent re-runs); otherwise it is placed per `position` — "end" (default, safe for
 *  TOML tables) or "head" (top-level keys that must precede any table header). */
function upsertManagedBlock(existing, body, { label = "", position = "end" } = {}) {
  const block = `${markStart(label)}\n${body.trimEnd()}\n${MARK_END}\n`;
  if (hasManagedBlock(existing, label)) return existing.replace(blockRe(label), block);
  if (!existing || !existing.trim()) return block;
  return position === "head"
    ? `${block}\n${existing}`
    : `${existing.replace(/\n*$/, "")}\n\n${block}`;
}
/** Strip ALL our blocks (any label, any vintage), leaving only the user's own content. */
function removeManagedBlock(existing) {
  if (!existing) return existing;
  return existing
    .replace(ANY_BLOCK_RE(), "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}

// --- shell profile detection (POSIX key persistence) --------------------------
/** The interactive-shell profile we offer to append LAYERX1_API_KEY to. Detection is by
 *  $SHELL basename only — good enough for an OFFERED (never forced) edit, and the managed
 *  block makes a wrong guess harmless + removable. */
function shellProfile(home, shellEnv = process.env.SHELL) {
  const sh = String(shellEnv || "").split("/").pop();
  if (sh === "zsh") return path.join(home, ".zshrc");
  if (sh === "fish") return path.join(home, ".config", "fish", "config.fish");
  return path.join(home, ".bashrc"); // bash and anything unrecognized
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
  markStart,
  hasManagedBlock,
  upsertManagedBlock,
  removeManagedBlock,
  shellProfile,
  prompt,
  homePath: (...parts) => path.join(HOME, ...parts),
};
