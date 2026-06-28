// `layerx1` — point your coding agent at the Layer X1 gateway in one command.
//   npx layerx1                      interactive setup
//   npx layerx1 setup --tool claude-code --key lx1_... [--url ...] [--model ...]
//   npx layerx1 status | models | test | unset --tool <id>
"use strict";
const U = require("./util");
const { TARGETS, byId } = require("./targets");

const DEFAULT_URL = "https://layerx1-gateway.orbitweb00.workers.dev";
const DEFAULT_MODEL = "glm-5.2"; // works today (Cloudflare, credit-covered)
const DEFAULT_SMALL = "glm-4.7-flash"; // cheap/fast background model

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

async function cmdSetup(flags, toolsSel) {
  const ctx = ctxFrom(flags);
  if (!ctx.key) return U.err("missing --key (your lx1_ gateway key). Get one from the dashboard.");
  const tools = resolveTools(toolsSel || flags.tool);
  if (!tools.length) return U.err("no tools selected (use --tool claude-code,codex,aider,continue,cline or all)");
  U.head(`Configuring ${tools.length} tool(s) → ${U.c.cyan(ctx.origin)}  model=${U.c.cyan(ctx.model)}`);
  for (const t of tools) printResult(t, t.apply(ctx));
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
  U.log("\n  " + U.c.green("Done.") + " Run `layerx1 test --key <key>` to verify the gateway.\n");
}

async function cmdStatus(flags) {
  const ctx = ctxFrom(flags);
  U.head(`Layer X1 config status  ${U.c.dim("(gateway " + ctx.origin + ")")}`);
  for (const t of TARGETS) {
    const s = t.status(ctx);
    const mark = s.configured === true ? U.c.green("✓") : s.configured === null ? U.c.yellow("?") : U.c.dim("·");
    U.log(`  ${mark} ${t.label.padEnd(28)} ${U.c.dim(s.detail)}`);
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
      const al = m.aliases && m.aliases.length ? U.c.cyan(m.aliases.join(", ")) : U.c.dim(m.id);
      const price = m.pricing_usd_per_mtok;
      U.log(
        `    ${al.padEnd(34)} ${U.c.dim((m.tier || "").padEnd(16))} ` +
          `${U.c.dim(`$${price.input}/$${price.output} per Mtok`)}`,
      );
    }
    U.log("");
  } catch (e) {
    U.err(`could not reach ${url}: ${e.message}`);
  }
}

async function cmdTest(flags) {
  const ctx = ctxFrom(flags);
  if (!ctx.key) return U.err("missing --key");
  const url = ctx.v1 + "/messages";
  U.head(`Test → ${U.c.cyan(url)}  model=${U.c.cyan(ctx.model)}`);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ctx.key },
      body: JSON.stringify({
        // generous cap so reasoning models (which spend tokens on hidden CoT) still
        // return visible content rather than an empty completion.
        model: ctx.model,
        max_tokens: 256,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      }),
    });
    const served = r.headers.get("x1-model");
    const cache = r.headers.get("x1-cache");
    const body = await r.json();
    if (!r.ok) return U.err(`${r.status} ${JSON.stringify(body).slice(0, 200)}`);
    const text = (body.content || []).map((b) => b.text || "").join("").trim();
    U.ok(`200 OK  served=${U.c.cyan(served || "?")}  cache=${cache || "?"}`);
    U.info(`reply: ${JSON.stringify(text).slice(0, 80)}`);
    U.log("");
  } catch (e) {
    U.err(`request failed: ${e.message}`);
  }
}

async function cmdUnset(flags, toolsSel) {
  const tools = resolveTools(toolsSel || flags.tool || "all");
  U.head(`Removing Layer X1 config from ${tools.length} tool(s)`);
  for (const t of tools) printResult(t, t.unset(ctxFrom(flags)));
  U.log("");
}

function help() {
  banner();
  U.log(`
  ${U.c.bold("Usage")}
    npx layerx1                     interactive setup
    npx layerx1 setup --key <lx1_…> [--tool <ids>] [--url <u>] [--model <m>]
    npx layerx1 status              show which tools are configured
    npx layerx1 models [--url <u>]  list the gateway's models
    npx layerx1 test --key <lx1_…>  send one request to verify
    npx layerx1 unset [--tool <ids>]

  ${U.c.bold("Tools")}  (--tool, comma-separated, or "all")
${TARGETS.map((t) => `    ${t.id.padEnd(12)} ${U.c.dim(t.label + " — " + t.protocol)}`).join("\n")}

  ${U.c.bold("Flags")}
    --key <k>          your lx1_ gateway API key (required for setup/test)
    --url <u>          gateway URL            ${U.c.dim("(default " + DEFAULT_URL + ")")}
    --model <m>        default model          ${U.c.dim("(default " + DEFAULT_MODEL + ")")}
    --small-model <m>  background model       ${U.c.dim("(default " + DEFAULT_SMALL + ")")}
    --print            show config instead of writing files
`);
}

async function main(argv) {
  const { cmd, rest, flags } = parseArgs(argv);
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

module.exports = { main };
