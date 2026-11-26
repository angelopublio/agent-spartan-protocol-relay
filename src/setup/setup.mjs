// `spartan-relay setup`: installs what is missing, asking before each step.
// It never replaces something already installed, so a development checkout linked into
// place stays as it is.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { doctor } from "./doctor.mjs";
import {
  AGENTS, MIN_HERDR, MIN_NODE_MAJOR, PROTOCOL_SLUG, REPO_SLUG, cursorOverride, herdrPlugin, herdrVersion, skillDirs, skillInstalled, versionAtLeast, which,
} from "./environment.mjs";

function ask(question, { yes }) {
  if (yes) {
    process.stdout.write(`${question} yes\n`);
    return true;
  }
  if (!process.stdin.isTTY) {
    process.stdout.write(`${question} skipped (no terminal; rerun with --yes to accept every step)\n`);
    return false;
  }
  const buf = Buffer.alloc(16);
  process.stdout.write(`${question} [Y/n] `);
  let answer = "";
  try {
    const n = fs.readSync(0, buf, 0, buf.length, null);
    answer = buf.subarray(0, n).toString().trim().toLowerCase();
  } catch {
    answer = "n";
  }
  return answer === "" || answer === "y" || answer === "yes";
}

function run(command, args) {
  process.stdout.write(`  $ ${[command, ...args].join(" ")}\n`);
  const r = spawnSync(command, args, { stdio: "inherit" });
  return r.status === 0;
}

function step(title) {
  process.stdout.write(`\n▸ ${title}\n`);
}

export function setup(opts = {}) {
  process.stdout.write("Agent Spartan Protocol Relay setup. Each step says what it will do and asks first.\n");

  step("Prerequisites");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const hv = herdrVersion();
  const problems = [];
  if (nodeMajor < MIN_NODE_MAJOR) problems.push(`Node.js ${MIN_NODE_MAJOR} or newer (found ${process.versions.node})`);
  if (!which("git")) problems.push("Git");
  if (!hv || !versionAtLeast(hv, MIN_HERDR)) problems.push(`herdr ${MIN_HERDR} or newer (https://herdr.dev)`);
  const agents = AGENTS.filter((a) => which(a.command));
  if (!agents.length) problems.push("at least one agent CLI: claude, codex, cursor-agent or grok");
  if (problems.length) {
    process.stdout.write(`Install these first, then run setup again:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
    return false;
  }
  process.stdout.write(`  Node.js ${process.versions.node}, herdr ${hv}, agents: ${agents.map((a) => a.host).join(", ")}\n`);

  step("spartan-relay command");
  if (which("spartan-relay")) process.stdout.write("  already on PATH; left as it is\n");
  else if (ask("  Install it with npm install -g?", opts)) run("npm", ["install", "-g", `github:${REPO_SLUG}`]);

  const skillStep = (name, slug, what) => {
    step(`${what} (skill ${name})`);
    const dirs = skillDirs(agents);
    const have = dirs.filter((d) => skillInstalled(d.dir, name));
    const missing = dirs.filter((d) => !skillInstalled(d.dir, name));
    if (!missing.length) {
      process.stdout.write("  already installed for every agent found; left as it is\n");
      return;
    }
    if (have.length) {
      process.stdout.write(`  installed in ${have.map((d) => d.dir).join(", ")} but missing in ${missing.map((d) => d.dir).join(", ")}.\n  Setup does not touch an existing install; add it with: npx skills add ${slug} --skill ${name} -g\n`);
      return;
    }
    if (ask(`  Install ${name} for ${missing.flatMap((d) => d.hosts).join(", ")}?`, opts)) run("npx", ["--yes", "skills", "add", slug, "--skill", name, "-g"]);
  };
  skillStep("spartan", PROTOCOL_SLUG, "Agent Spartan Protocol");

  step("herdr plugin");
  if (herdrPlugin()) process.stdout.write("  already installed or linked; left as it is\n");
  else if (ask("  Install the spartan-relay herdr plugin? herdr shows what it installs before it does.", opts)) run("herdr", ["plugin", "install", `${REPO_SLUG}/adapters/herdr`]);

  skillStep("spartan-relay-cockpit", REPO_SLUG, "Cockpit");

  if (agents.some((a) => a.host === "Cursor")) {
    step("Cursor detection fix");
    const c = cursorOverride();
    if (c.state === "current") process.stdout.write("  already installed\n");
    else if (c.state === "different") process.stdout.write(`  ${c.target} exists and differs; review it yourself\n`);
    else if (ask("  Install the local herdr manifest that keeps Cursor's working state readable?", opts)) {
      fs.mkdirSync(path.dirname(c.target), { recursive: true });
      fs.copyFileSync(c.source, c.target);
      run("herdr", ["server", "reload-agent-manifests"]);
    }
  }

  step("Check");
  return doctor();
}
