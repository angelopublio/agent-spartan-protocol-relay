// Shared helpers for the herdr plugin actions. herdr runs each action with the plugin
// folder as its working directory and passes the invocation context as JSON.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = process.env.HERDR_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function context() {
  try {
    return JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || "{}");
  } catch {
    return {};
  }
}

export function herdr(args) {
  const bin = process.env.HERDR_BIN_PATH || "herdr";
  const out = execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.trim() ? JSON.parse(out) : {};
}

export function notify(title, body) {
  try {
    herdr(["notification", "show", title, "--body", body]);
  } catch {
    /* a notification is a courtesy */
  }
  process.stdout.write(`${title}: ${body}\n`);
}

export function fail(message) {
  notify("Spartan relay", message);
  process.exit(1);
}

export function repoRoot(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// A pane with this label in the focused tab, or a new one split from the focused pane.
export function labelledPane(ctx, label, cwd) {
  const panes = herdr(["pane", "list"])?.result?.panes || [];
  const found = panes.find((p) => p.tab_id === ctx.tab_id && (p.label || "").toLowerCase() === label);
  if (found) return { pane: found.pane_id, created: false };
  const split = herdr(["pane", "split", ctx.focused_pane_id, "--direction", "down", "--cwd", cwd, "--no-focus"]);
  const pane = split?.result?.pane?.pane_id;
  if (!pane) fail(`could not open a ${label} pane`);
  herdr(["pane", "rename", pane, label]);
  return { pane, created: true };
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function onPath(command) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, command))) return true;
  }
  return false;
}
