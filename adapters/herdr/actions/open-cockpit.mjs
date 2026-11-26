// Opens the tab's `cockpit` pane in the focused pane's repository and starts Claude Code in
// it when available. The cockpit is the human's assistant that conducts relay runs; the
// spartan-relay-cockpit skill describes its job.
import { context, fail, herdr, labelledPane, notify, onPath, repoRoot, shellQuote } from "./lib.mjs";

const ctx = context();
const cwd = ctx.focused_pane_cwd || ctx.workspace_cwd || process.cwd();
const repo = repoRoot(cwd) || cwd;

const { pane, created } = labelledPane(ctx, "cockpit", repo);
if (!created) {
  herdr(["pane", "focus", pane]);
  notify("Spartan cockpit", `pane ${pane} is already the cockpit`);
  process.exit(0);
}
if (!onPath("claude")) fail(`opened pane ${pane}; start your cockpit agent there (claude is not on PATH)`);
herdr(["pane", "run", pane, `cd ${shellQuote(repo)} && claude`]);
notify("Spartan cockpit", `Claude Code started in pane ${pane}; ask it to use spartan-relay-cockpit`);
