// Focuses the workspace of the focused pane's repository, or creates it with a `cockpit`
// pane above a `relay` pane, through `spartan-relay workspace`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PLUGIN_ROOT, context, fail, notify, onPath } from "./lib.mjs";

const ctx = context();
const dir = ctx.focused_pane_cwd || ctx.workspace_cwd || process.cwd();
const bundled = path.resolve(PLUGIN_ROOT, "..", "..", "bin", "spartan-relay.mjs");
const [cmd, args] = onPath("spartan-relay") ? ["spartan-relay", []] : fs.existsSync(bundled) ? [process.execPath, [bundled]] : [null, []];
if (!cmd) fail("spartan-relay is not on PATH; install it with npm (see the README)");
try {
  const out = execFileSync(cmd, [...args, "workspace", dir], { encoding: "utf8" });
  notify("Spartan workspace", out.trim().replace(/^\d\d:\d\d:\d\d\s+●\s+/, ""));
} catch (e) {
  fail(String(e.stdout || e.message).trim());
}
