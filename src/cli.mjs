import { Stop, log } from "./core/errors.mjs";
import { run } from "./core/relay.mjs";
import { herdrAdapter } from "./adapters/herdr/adapter.mjs";
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

export function main(argv) {
  process.stdout.on("error", (e) => {
    if (e.code === "EPIPE") process.exit(0);
    throw e;
  });
  try {
    if (argv[0] === "doctor") process.exit(doctor() ? 0 : 1);
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
