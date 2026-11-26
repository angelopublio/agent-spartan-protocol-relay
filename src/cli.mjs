import { Stop, log } from "./core/errors.mjs";
import { run } from "./core/relay.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { herdrAdapter, openWorkspace } from "./adapters/herdr/adapter.mjs";
import { doctor } from "./setup/doctor.mjs";
import { setup } from "./setup/setup.mjs";

export const USAGE = `spartan-relay — relays Agent Spartan Protocol handoffs between coding agents
running in terminal-multiplexer panes, so the human stops carrying prompts between hosts.

Usage (inside a herdr pane, from the target repository):
  spartan-relay <spartan/tasks/NNNN-slug.md> [--producer <agent-or-pane>]
                [--max-cycles 3] [--producer-timeout-min 60]
                [--review-timeout-min 30] [--dry-run]
  spartan-relay setup [--yes]   install what is missing, asking before each step
  spartan-relay doctor          report what is ready and what is missing
  spartan-relay workspace [<dir>] [--label <name>]
                                focus the repository's herdr workspace, or create it
                                with a cockpit pane above a relay pane

It reads the Next Handoff a Spartan round wrote into the task file, opens the bound host,
sends the prompt, waits, and carries a read-only reviewer's result back to the producer
that persists it. It never edits the task file, never decides a verdict, and stops at every
ambiguity. Host, model and effort per role come from the ## Agent hosts table in AGENTS.md.

Supported backend: herdr.`;

function positiveInt(flag, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Stop(`${flag} must be a positive integer`);
  return n;
}

export function parseArgs(argv) {
  const opts = {
    task: null,
    producer: null,
    maxCycles: 3,
    producerTimeoutMs: 60 * 60_000,
    reviewTimeoutMs: 30 * 60_000,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Stop(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--producer") opts.producer = next();
    else if (a === "--max-cycles") opts.maxCycles = positiveInt(a, next());
    else if (a === "--producer-timeout-min") opts.producerTimeoutMs = positiveInt(a, next()) * 60_000;
    else if (a === "--review-timeout-min") opts.reviewTimeoutMs = positiveInt(a, next()) * 60_000;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a.startsWith("-")) throw new Stop(`unknown option ${a}`);
    else if (opts.task) throw new Stop("give exactly one task file");
    else opts.task = a;
  }
  if (!opts.task && !opts.help) throw new Stop("usage: spartan-relay <spartan/tasks/NNNN-slug.md> [--producer <agent-or-pane>] [--dry-run]");
  return opts;
}

export function parseWorkspaceArgs(argv, cwd = process.cwd()) {
  let dir = null;
  let label = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--label") {
      if (i + 1 >= argv.length) throw new Stop("--label needs a value");
      label = argv[++i];
    } else if (a.startsWith("-")) throw new Stop(`unknown option ${a}`);
    else if (dir) throw new Stop("give at most one directory");
    else dir = a;
  }
  return { dir: path.resolve(cwd, dir || "."), label };
}

function workspace(argv) {
  const { dir, label } = parseWorkspaceArgs(argv);
  if (!fs.existsSync(dir)) throw new Stop(`${dir} does not exist`);
  let root = fs.realpathSync(dir);
  try {
    root = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    /* not a Git repository: use the folder itself */
  }
  openWorkspace(root, label || path.basename(root));
}

export function main(argv) {
  process.stdout.on("error", (e) => {
    if (e.code === "EPIPE") process.exit(0);
    throw e;
  });
  try {
    if (argv[0] === "doctor") process.exit(doctor() ? 0 : 1);
    if (argv[0] === "workspace") return workspace(argv.slice(1));
    if (argv[0] === "setup") process.exit(setup({ yes: argv.includes("--yes") }) ? 0 : 1);
    const opts = parseArgs(argv);
    if (opts.help) {
      process.stdout.write(`${USAGE}\n`);
      return;
    }
    run(opts, herdrAdapter);
  } catch (e) {
    if (e instanceof Stop) {
      log(`${e.ok ? "■" : "✋"} ${e.message}`);
      process.exit(e.ok ? 0 : 2);
    }
    throw e;
  }
}
