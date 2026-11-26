// `spartan-relay doctor`: reports what is ready and what is missing, and changes nothing.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readBindings } from "../core/bindings.mjs";
import { loadHosts, resolveHost } from "../core/hosts.mjs";
import {
  AGENTS, MIN_HERDR, MIN_NODE_MAJOR, PLUGIN_ID, cursorOverride, herdrPlugin, herdrVersion, output, skillDirs, skillInstalled, versionAtLeast, which,
} from "./environment.mjs";

function repoRoot(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// Returns a list of { ok, label, hint } checks. `ok` is true, false, or null for information.
export function checks({ cwd = process.cwd() } = {}) {
  const out = [];
  const add = (ok, label, hint = "") => out.push({ ok, label, hint });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add(nodeMajor >= MIN_NODE_MAJOR, `Node.js ${process.versions.node}`, `Node.js ${MIN_NODE_MAJOR} or newer is required`);
  add(Boolean(which("git")), "Git", "install Git");
  const hv = herdrVersion();
  add(Boolean(hv) && versionAtLeast(hv, MIN_HERDR), hv ? `herdr ${hv}` : "herdr", `install herdr ${MIN_HERDR} or newer: https://herdr.dev`);
  add(Boolean(which("spartan-relay")), "spartan-relay command on PATH", "run setup, or npm install -g github:angelopublio/agent-spartan-protocol-relay");
  const plugin = hv ? herdrPlugin() : null;
  add(Boolean(plugin), `herdr plugin ${PLUGIN_ID}${plugin ? ` ${plugin.version} (${plugin.source?.kind || "installed"})` : ""}`, "run setup, or herdr plugin install angelopublio/agent-spartan-protocol-relay/adapters/herdr");

  const agents = AGENTS.filter((a) => which(a.command));
  add(agents.length ? true : false, `Agent CLIs: ${agents.map((a) => a.host).join(", ") || "none found"}`, "install at least one of claude, codex, cursor-agent, grok");
  for (const { dir, hosts } of skillDirs(agents)) {
    for (const skill of ["spartan", "spartan-relay-cockpit"]) {
      add(skillInstalled(dir, skill), `skill ${skill} in ${dir} (${hosts.join(", ")})`, skill === "spartan" ? "run setup, or install the Agent Spartan Protocol skill" : "run setup, or npx skills add angelopublio/agent-spartan-protocol-relay --skill spartan-relay-cockpit -g");
    }
  }
  if (agents.some((a) => a.host === "Cursor")) {
    const c = cursorOverride();
    add(c.state === "current" ? true : c.state === "missing" ? false : null, `Cursor detection fix: ${c.state}`, c.state === "missing" ? "run setup, or the herdr plugin action Spartan: install Cursor detection fix" : c.state === "different" ? `${c.target} differs from the shipped fix; review it` : "");
  }

  const repo = repoRoot(cwd);
  if (repo) {
    add(null, `Repository ${path.basename(repo)}`);
    let bindings = null;
    try {
      bindings = readBindings(repo);
      add(Boolean(bindings), "AGENTS.md has an ## Agent hosts table", "add one; see the README");
    } catch (e) {
      add(false, "AGENTS.md ## Agent hosts table", e.message);
    }
    if (bindings) {
      const hosts = loadHosts(repo);
      for (const b of Object.values(bindings)) {
        let host = null;
        try {
          host = resolveHost(hosts, b.host);
        } catch {
          /* reported below */
        }
        const cli = AGENTS.find((a) => a.host === host)?.command;
        add(Boolean(cli && which(cli)), `${b.binding}: ${b.host}, ${b.model} ${b.effort}`, host ? `${cli} is not on PATH` : `unknown host ${b.host}`);
      }
    }
    const ignored = output("git", ["-C", repo, "check-ignore", "-q", ".spartan-relay/x"]) !== null;
    add(ignored, ".spartan-relay/ is git-ignored", "add .spartan-relay/ to .gitignore");
    add(fs.existsSync(path.join(repo, "spartan", "tasks")) ? true : null, "spartan/tasks/ exists", "created by the first Spartan round");
  }
  if (process.env.HERDR_ENV !== "1") add(null, "Not inside a herdr pane: run the relay from one");
  return out;
}

export function doctor(opts) {
  const results = checks(opts);
  for (const r of results) {
    const mark = r.ok === true ? "✔" : r.ok === false ? "✖" : "•";
    process.stdout.write(`${mark} ${r.label}${r.ok === false && r.hint ? `\n    → ${r.hint}` : r.ok === null && r.hint ? ` (${r.hint})` : ""}\n`);
  }
  const failed = results.filter((r) => r.ok === false).length;
  process.stdout.write(failed ? `\n${failed} item(s) need attention.\n` : "\nReady.\n");
  return failed === 0;
}
