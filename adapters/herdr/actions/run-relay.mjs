// Runs spartan-relay on the single active Spartan task of the focused pane's repository,
// in the tab's `relay` pane. It refuses when there is no active task or more than one,
// rather than guessing which task the human meant.
import fs from "node:fs";
import path from "node:path";
import { PLUGIN_ROOT, context, fail, herdr, labelledPane, notify, onPath, repoRoot, shellQuote } from "./lib.mjs";

const ctx = context();
const repo = repoRoot(ctx.focused_pane_cwd || ctx.workspace_cwd || process.cwd());
if (!repo) fail("the focused pane is not inside a Git repository");

const dir = path.join(repo, "spartan", "tasks");
const active = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  .filter((f) => /^\d{4}-.+\.md$/.test(f))
  .filter((f) => {
    const fm = fs.readFileSync(path.join(dir, f), "utf8").match(/^---\n([\s\S]*?)\n---/);
    const field = (k) => fm?.[1].match(new RegExp(`^${k}:\\s*(\\S+)`, "m"))?.[1];
    return field("status") === "active" && !["human-operator", "none"].includes(field("next_role"));
  });
if (active.length === 0) fail(`no active task with an outstanding agent handoff in ${path.join(path.basename(repo), "spartan/tasks")}`);
if (active.length > 1) fail(`more than one active task (${active.join(", ")}); run spartan-relay with an explicit task path`);

const task = path.join("spartan", "tasks", active[0]);
const bundled = path.resolve(PLUGIN_ROOT, "..", "..", "bin", "spartan-relay.mjs");
const command = onPath("spartan-relay") ? "spartan-relay" : fs.existsSync(bundled) ? `node ${shellQuote(bundled)}` : null;
if (!command) fail("spartan-relay is not on PATH; install it with npm (see the README)");

const { pane } = labelledPane(ctx, "relay", repo);
herdr(["pane", "run", pane, `cd ${shellQuote(repo)} && ${command} ${shellQuote(task)}`]);
notify("Spartan relay", `started on ${task} in pane ${pane}`);
