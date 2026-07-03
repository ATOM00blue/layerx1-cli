// `layerx1` — point your coding agent at the Layer X1 gateway in one command.
//   npx layerx1                      interactive setup
//   npx layerx1 setup --tool claude-code --key lx1_... [--url ...] [--model ...]
//   npx layerx1 status | models | test | unset --tool <id>
"use strict";
const U = require("./util");
const { TARGETS, byId } = require("./targets");
const pkg = require("../package.json");

const DEFAULT_URL = "https://layerx1-gateway.orbitweb00.workers.dev";
// Catalog defaults — MUST be canonical lx1-* ids from GET /v1/models (the gateway serves
// its own default for an unknown id, silently — a typo here would misconfigure every user).
const DEFAULT_MODEL = "lx1-gpt-oss-120b"; // the gateway default — fast, tool-capable
const DEFAULT_SMALL = "lx1-glm-4.7-flash"; // quick background/small-task model

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { cmd: positional[0], rest: positional.slice(1), flags };
}

function ctxFrom(flags, { url, key, model, smallModel } = {}) {
  const origin = U.normalizeOrigin(url || flags.url || DEFAULT_URL);
  return {
    origin,
    v1: U.withV1(origin),
    key: key || flags.key || flags.token || "",
    model: model || flags.model || DEFAULT_MODEL,
    smallModel: smallModel || flags["small-model"] || DEFAULT_SMALL,
    print: !!flags.print,
    // Where tool configs live. Overridable (--home / LAYERX1_HOME) so tests and sandboxes
    // can exercise every writer against a scratch dir instead of the real home directory.
    home: (typeof flags.home === "string" && flags.home) || process.env.LAYERX1_HOME || U.HOME,
  };
}

function banner() {
  U.log(U.c.bold(`\n  Layer X1 ${U.c.dim("· configure your coding agent")}`));
}

function printResult(t, res) {
  if (res.error) return U.err(`${t.label}: ${res.error}`);
  if (res.noop) {
    U.info(`${t.label}: nothing to remove`);
  } else if (res.wrote) {
    U.ok(`${t.label} → wrote ${U.c.cyan(res.wrote)}`);
    if (res.backup) U.info(`backed up previous file to ${U.c.dim(res.backup)}`);
  } else if (res.printed) {
    U.warn(`${t.label}: manual step —`);
    U.log("\n" + res.printed.split("\n").map((l) => "    " + l).join("\n") + "\n");
  }
  for (const n of res.notes || []) U.info(n);
}

function resolveTools(sel) {
  if (!sel || sel === "all") return TARGETS;
  const ids = String(sel).split(",").map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const id of ids) {
    if (byId[id]) out.push(byId[id]);
    else U.warn(`unknown tool "${id}" (known: ${TARGETS.map((t) => t.id).join(", ")})`);
  }
  return out;
}

// --- key persistence ---------------------------------------------------------
// Codex (and anything else reading LAYERX1_API_KEY) needs the key in the ENVIRONMENT, not
// a file we write — so after setup we OFFER to persist it, per-OS, and never force it:
//   win32  → the User environment via PowerShell (survives new terminals, no profile edit)
//   POSIX  → a managed block appended to the detected shell profile (unset removes it)
// Explicit --persist-key / --no-persist-key decide non-interactively; otherwise we only
// prompt on a real TTY (CI/pipes get the printed guidance from the codex notes instead).
function escapePwshSingle(s) {
  return String(s).replace(/'/g, "''");
}
function escapeShDouble(s) {
  return String(s).replace(/(["\\$`])/g, "\\$1");
}
async function offerPersistKey(ctx, tools, flags) {
  if (ctx.print || !ctx.key) return;
  if (!tools.some((t) => t.id === "codex")) return; // only codex consumes LAYERX1_API_KEY
  const declined = flags["no-persist-key"] === true || flags["persist-key"] === "false";
  if (declined) return;
  const forced = flags["persist-key"] === true || flags["persist-key"] === "true";
  if (!forced) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return; // guidance already printed
    const where =
      process.platform === "win32" ? "your User environment" : U.shellProfile(ctx.home);
    const a = await U.prompt(`Persist LAYERX1_API_KEY to ${where} now? (Y/n)`, "Y");
    if (!/^y/i.test(a)) return;
  }
  if (process.platform === "win32") {
    // Array-args spawn (no shell string interpolation) + single-quote escaping: the key
    // never passes through a shell parser.
    const { spawnSync } = require("child_process");
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `[Environment]::SetEnvironmentVariable('LAYERX1_API_KEY','${escapePwshSingle(ctx.key)}','User')`,
      ],
      { stdio: "ignore" },
    );
    if (r.status === 0) U.ok("LAYERX1_API_KEY saved to your User environment — open a NEW terminal to pick it up.");
    else U.err("could not set the User environment variable — run the PowerShell command above manually.");
    return;
  }
  const profile = U.shellProfile(ctx.home);
  const line = /config\.fish$/.test(profile)
    ? `set -gx LAYERX1_API_KEY "${escapeShDouble(ctx.key)}"`
    : `export LAYERX1_API_KEY="${escapeShDouble(ctx.key)}"`;
  const next = U.upsertManagedBlock(U.readFileSafe(profile) || "", line, { label: "env", position: "end" });
  U.writeFileSafe(profile, next);
  U.ok(`LAYERX1_API_KEY added to ${U.c.cyan(profile)} — restart your shell (or source it) to pick it up.`);
}

/** Undo of offerPersistKey, run by `unset`: our profile block is marker-identified so it is
 *  safe to remove automatically; the win32 User-env var may predate us, so only print how. */
function unsetPersistedKey(ctx) {
  if (process.platform === "win32") {
    U.info(
      `If you persisted LAYERX1_API_KEY, clear it with:  [Environment]::SetEnvironmentVariable('LAYERX1_API_KEY',$null,'User')`,
    );
    return;
  }
  const profile = U.shellProfile(ctx.home);
  const content = U.readFileSafe(profile);
  if (content && U.hasManagedBlock(content, "env")) {
    U.writeFileSafe(profile, U.removeManagedBlock(content));
    U.ok(`removed LAYERX1_API_KEY from ${U.c.cyan(profile)}`);
  }
}

/** The key `test` should use, in trust order: explicit --key → LAYERX1_API_KEY env → the key
 *  setup already wrote into Claude Code's settings. The settings token is reused ONLY when
 *  its base URL matches the gateway being tested — never send a token for one host to another. */
function resolveKey(ctx) {
  if (ctx.key) return { key: ctx.key, source: "--key" };
  if (process.env.LAYERX1_API_KEY) return { key: process.env.LAYERX1_API_KEY, source: "LAYERX1_API_KEY" };
  const cfg = U.readJsonSafe(U.path.join(ctx.home, ".claude", "settings.json"));
  const env = cfg && cfg.env;
  if (env && env.ANTHROPIC_AUTH_TOKEN && U.normalizeOrigin(env.ANTHROPIC_BASE_URL) === ctx.origin) {
    return { key: env.ANTHROPIC_AUTH_TOKEN, source: "~/.claude/settings.json" };
  }
  return null;
}

async function cmdSetup(flags, toolsSel) {
  const ctx = ctxFrom(flags);
  if (!ctx.key) return U.err("missing --key (your lx1_ gateway key). Get one from the dashboard.");
  const tools = resolveTools(toolsSel || flags.tool);
  if (!tools.length) return U.err("no tools selected (use --tool claude-code,codex,aider,continue,cline,cursor,windsurf or all)");
  U.head(`Configuring ${tools.length} tool(s) → ${U.c.cyan(ctx.origin)}  model=${U.c.cyan(ctx.model)}`);
  for (const t of tools) printResult(t, t.apply(ctx));
  await offerPersistKey(ctx, tools, flags);
  U.log("");
}

async function cmdInit(flags) {
  banner();
  U.log(U.c.dim("  Press enter to accept the [default].\n"));
  const url = await U.prompt("Gateway URL:", U.normalizeOrigin(flags.url || DEFAULT_URL));
  let key = flags.key || "";
  while (!key) key = await U.prompt("API key (lx1_…):", "");
  const model = await U.prompt("Default model:", flags.model || DEFAULT_MODEL);
  U.head("Which tools? (comma-separated numbers, or 'all')");
  TARGETS.forEach((t, i) => U.log(`    ${i + 1}. ${t.label} ${U.c.dim("· " + t.protocol)}`));
  const pick = await U.prompt("Selection:", "all");
  let tools;
  if (pick.trim() === "all" || !pick.trim()) tools = TARGETS;
  else
    tools = pick
      .split(",")
      .map((s) => TARGETS[parseInt(s.trim(), 10) - 1])
      .filter(Boolean);
  if (!tools.length) return U.err("nothing selected.");
  const ctx = ctxFrom(flags, { url, key, model });
  U.head(`Configuring → ${U.c.cyan(ctx.origin)}  model=${U.c.cyan(ctx.model)}`);
  for (const t of tools) printResult(t, t.apply(ctx));
  await offerPersistKey(ctx, tools, flags);
  U.log("\n  " + U.c.green("Done.") + " Run `npx layerx1 test` to verify the gateway.\n");
}

async function cmdStatus(flags) {
  const ctx = ctxFrom(flags);
  U.head(`Layer X1 config status  ${U.c.dim("(gateway " + ctx.origin + ")")}`);
  for (const t of TARGETS) {
    const s = t.status(ctx);
    const mark = s.configured === true ? U.c.green("✓") : s.configured === null ? U.c.yellow("?") : U.c.dim("·");
    U.log(`  ${mark} ${t.label.padEnd(30)} ${U.c.dim(s.detail)}`);
  }
  U.log("");
}

async function cmdModels(flags) {
  const ctx = ctxFrom(flags);
  const url = ctx.v1 + "/models";
  U.head(`Models @ ${U.c.cyan(url)}`);
  try {
    const r = await fetch(url);
    if (!r.ok) return U.err(`GET /v1/models → ${r.status}`);
    const data = (await r.json()).data || [];
    U.ok(`${data.length} models`);
    for (const m of data) {
      // Pad the RAW strings, then colorize: ANSI escapes count toward .length, so padding
      // a colored string under-pads it and the columns drift.
      const name = String(m.id || "").padEnd(28);
      const extras = m.aliases && m.aliases.length ? `(${m.aliases.join(", ")}) ` : "";
      const tier = String(m.tier || "").padEnd(16);
      const price = m.pricing_usd_per_mtok || {};
      const priceStr =
        price.input != null ? `$${price.input}/$${price.output} per Mtok` : "";
      U.log(`    ${U.c.cyan(name)} ${U.c.dim(tier)} ${U.c.dim(extras + priceStr)}`);
    }
    U.log("");
  } catch (e) {
    U.err(`could not reach ${url}: ${e.message}`);
  }
}

async function cmdTest(flags) {
  const ctx = ctxFrom(flags);
  const found = resolveKey(ctx);
  if (!found) return U.err("no key found — pass --key, set LAYERX1_API_KEY, or run `npx layerx1 setup` first.");
  if (found.source !== "--key") U.info(`using the key from ${found.source}`);
  const url = ctx.v1 + "/messages";
  U.head(`Test → ${U.c.cyan(url)}  model=${U.c.cyan(ctx.model)}`);
  try {
    const t0 = Date.now();
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": found.key },
      body: JSON.stringify({
        // 512, not less: reasoning models spend output budget on hidden thinking before any
        // visible text — a smaller cap can come back 200-with-empty-content and look broken.
        model: ctx.model,
        max_tokens: 512,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      }),
    });
    const served = r.headers.get("x1-model");
    const body = await r.json();
    if (!r.ok) return U.err(`${r.status} ${JSON.stringify(body).slice(0, 200)}`);
    const text = (body.content || []).map((b) => b.text || "").join("").trim();
    U.ok(`200 OK  model=${U.c.cyan(served || body.model || "?")}  ${Date.now() - t0}ms`);
    U.info(`reply: ${JSON.stringify(text).slice(0, 80)}`);
    U.log("");
  } catch (e) {
    U.err(`request failed: ${e.message}`);
  }
}

async function cmdUnset(flags, toolsSel) {
  const ctx = ctxFrom(flags);
  const tools = resolveTools(toolsSel || flags.tool || "all");
  U.head(`Removing Layer X1 config from ${tools.length} tool(s)`);
  for (const t of tools) printResult(t, t.unset(ctx));
  if (tools.some((t) => t.id === "codex")) unsetPersistedKey(ctx);
  U.log("");
}

function help() {
  banner();
  U.log(`
  ${U.c.bold("Usage")}
    npx layerx1                     interactive setup
    npx layerx1 setup --key <lx1_…> [--tool <ids>] [--url <u>] [--model <m>]
    npx layerx1 status              show which tools are configured
    npx layerx1 models [--url <u>]  list the model catalog
    npx layerx1 test [--key <k>]    send one request to verify (reuses your configured key)
    npx layerx1 unset [--tool <ids>]
    npx layerx1 --version

  ${U.c.bold("Tools")}  (--tool, comma-separated, or "all")
${TARGETS.map((t) => `    ${t.id.padEnd(12)} ${U.c.dim(t.label + " — " + t.protocol)}`).join("\n")}

  ${U.c.bold("Flags")}
    --key <k>            your lx1_ gateway API key (required for setup)
    --url <u>            gateway URL            ${U.c.dim("(default " + DEFAULT_URL + ")")}
    --model <m>          default model          ${U.c.dim("(default " + DEFAULT_MODEL + ")")}
    --small-model <m>    background model       ${U.c.dim("(default " + DEFAULT_SMALL + ")")}
    --print              show config instead of writing files
    --persist-key        save LAYERX1_API_KEY for new shells without asking
    --no-persist-key     never touch env/shell profile
    --home <dir>         write configs under <dir> instead of your home ${U.c.dim("(sandboxes/tests)")}
`);
}

async function main(argv) {
  const { cmd, rest, flags } = parseArgs(argv);
  if (flags.version || flags.V || cmd === "version") return U.log(pkg.version);
  if (flags.help || flags.h || cmd === "help") return help();
  try {
    switch (cmd) {
      case undefined:
      case "init":
        return await cmdInit(flags);
      case "setup":
      case "configure":
        return await cmdSetup(flags, rest[0]);
      case "status":
        return await cmdStatus(flags);
      case "models":
        return await cmdModels(flags);
      case "test":
        return await cmdTest(flags);
      case "unset":
      case "remove":
        return await cmdUnset(flags, rest[0]);
      default:
        U.err(`unknown command "${cmd}"`);
        return help();
    }
  } catch (e) {
    U.err(e && e.stack ? e.stack : String(e));
    process.exitCode = 1;
  }
}

// parseArgs/defaults exported for the test suite — bin/layerx1.js only calls main().
module.exports = { main, parseArgs, ctxFrom, DEFAULT_URL, DEFAULT_MODEL, DEFAULT_SMALL };
