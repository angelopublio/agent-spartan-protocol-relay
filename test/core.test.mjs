import { test } from "node:test";
import assert from "node:assert/strict";
import { Stop } from "../src/core/errors.mjs";
import { DEFAULT_HOSTS, resolveHost, hostForKind, withToken } from "../src/core/hosts.mjs";
import { parseBindings, bindingFor, modelArgs } from "../src/core/bindings.mjs";
import { parseTask, nextAction, lastVerdict } from "../src/core/task.mjs";
import { afterReview, persistPrompt } from "../src/core/relay.mjs";
import { parseArgs } from "../src/cli.mjs";
import { choosePaneSplit, MIN_AGENT_COLS } from "../src/adapters/herdr/adapter.mjs";

const AGENTS = `# Repository

## Agent hosts

| Binding | Host | Client context | Model | Effort |
| --- | --- | --- | --- | --- |
| planner | Claude Code | personal | claude-opus-5 | high |
| reviewer.plan | Codex | personal | gpt-6.1-terra | medium |
| implementer | Cursor | personal | cursor-grok-4.6-high-fast | none |
| arbiter.implementation | Claude Code | personal | claude-opus-5 | high |

## Next section
`;

function task({ status = "active", role = "reviewer", id = "HX-003", permission = "read-only", host = "Codex", type = "implementation", promptId = id, promptRole = role } = {}) {
  return `---
status: ${status}
task_type: ${type}
next_role: ${role}
next_handoff_id: ${id}
handoff_id: HX-002
---

# Task

## Next Handoff

\`\`\`text
Recommended execution (human decides):
- Host: ${host}
- Role: ${role}
- Handoff: ${id}
- Permission: ${permission}
\`\`\`

\`\`\`text
Open \`spartan/tasks/0001-x.md\` (handoff ${promptId}).

Act as ${promptRole}. Review the implementation as a whole.
\`\`\`
`;
}

test("parseBindings reads the Agent hosts table", () => {
  const b = parseBindings(AGENTS);
  assert.equal(b.planner.host, "Claude Code");
  assert.equal(b["reviewer.plan"].effort, "medium");
  assert.equal(b.implementer.effort, "none");
});

test("parseBindings returns null without the section and rejects a bad effort", () => {
  assert.equal(parseBindings("# Nothing here\n"), null);
  assert.throws(() => parseBindings(AGENTS.replace("| medium |", "| extreme |")), Stop);
});

test("bindingFor maps roles, reviewers and arbiters", () => {
  const b = parseBindings(AGENTS);
  assert.equal(bindingFor(b, { role: "planner", readOnly: false, reviewKind: "plan" }).binding, "planner");
  assert.equal(bindingFor(b, { role: "reviewer", readOnly: true, reviewKind: "plan" }).binding, "reviewer.plan");
  assert.equal(bindingFor(b, { role: "arbiter", readOnly: true, reviewKind: "implementation" }).binding, "arbiter.implementation");
  assert.equal(bindingFor(b, { role: "reviewer", readOnly: true, reviewKind: "implementation" }), null);
});

test("modelArgs translates model and effort per client", () => {
  assert.deepEqual(modelArgs("claude", { model: "m", effort: "high" }), ["--model", "m", "--effort", "high"]);
  assert.deepEqual(modelArgs("codex", { model: "m", effort: "max" }), ["-c", 'model="m"', "-c", 'model_reasoning_effort="xhigh"']);
  assert.deepEqual(modelArgs("cursor", { model: "x-high-fast", effort: "none" }), ["--model", "x-high-fast"]);
  assert.deepEqual(modelArgs("cursor", { model: "x", effort: "low" }), ["--model", "x[effort=low]"]);
  assert.throws(() => modelArgs("cursor", { model: "x-high", effort: "low" }), Stop);
  assert.deepEqual(modelArgs("claude", null), []);
});

test("resolveHost matches names and aliases, longest first", () => {
  assert.equal(resolveHost(DEFAULT_HOSTS, "Codex (bound by AGENTS.md)"), "Codex");
  assert.equal(resolveHost(DEFAULT_HOSTS, "Grok Build"), "Grok");
  assert.throws(() => resolveHost(DEFAULT_HOSTS, "Unknown"), Stop);
  assert.equal(hostForKind(DEFAULT_HOSTS, "cursor"), "Cursor");
});

test("withToken prefixes the host's Spartan invocation", () => {
  assert.match(withToken(DEFAULT_HOSTS, "Codex", "Open x"), /^\$spartan Open x/);
  assert.match(withToken({ H: { token: "" } }, "H", "Open x"), /^Use the spartan skill/);
});

test("nextAction returns a consistent read-only review", () => {
  const a = nextAction(parseTask(task()));
  assert.equal(a.id, "HX-003");
  assert.equal(a.readOnly, true);
  assert.equal(a.reviewKind, "implementation");
});

test("nextAction stops on completion, human-operator and disagreements", () => {
  assert.throws(() => nextAction(parseTask(task({ status: "completed" }))), (e) => e instanceof Stop && e.ok);
  assert.throws(() => nextAction(parseTask(task({ role: "human-operator", promptRole: "human-operator" }))), /human-operator/);
  assert.throws(() => nextAction(parseTask(task({ promptId: "HX-009" }))), /disagree/);
  assert.throws(() => nextAction(parseTask(task({ id: "H1-001" }))), /not a Spartan handoff identifier/);
  for (const bad of ["HX-000", "HX-1", "HX-01", "HX-0001", "HX-0999"]) assert.throws(() => nextAction(parseTask(task({ id: bad }))), /not a Spartan handoff identifier/);
  for (const good of ["HX-001", "HX-999", "HX-1000", "HX-1234"]) assert.equal(nextAction(parseTask(task({ id: good }))).id, good);
  assert.throws(() => nextAction(parseTask(task({ promptRole: "implementer" }))), /roles disagree/);
  assert.throws(() => nextAction(parseTask(task({ permission: "maybe" }))), /Permission/);
});

test("lastVerdict takes the final verdict line", () => {
  assert.equal(lastVerdict("SPARTAN-VERDICT: APPROVED\nlater\nSPARTAN-VERDICT: CHANGES_REQUESTED"), "CHANGES_REQUESTED");
  assert.equal(lastVerdict("no verdict"), null);
});

test("afterReview routes to the arbiter at the cycle limit", () => {
  const r = afterReview({ verdict: "CHANGES_REQUESTED", arbiter: false, reviewKind: "plan", cycle: 3, maxCycles: 3, arbiterBound: true });
  assert.equal(r.toArbiter, true);
  assert.equal(r.authorization, "persist only");
  const early = afterReview({ verdict: "CHANGES_REQUESTED", arbiter: false, reviewKind: "implementation", cycle: 1, maxCycles: 3, arbiterBound: true });
  assert.equal(early.toArbiter, false);
  assert.equal(early.authorization, "persist and correct");
  const ruling = afterReview({ verdict: "CHANGES_REQUESTED", arbiter: true, reviewKind: "plan", cycle: 3, maxCycles: 3, arbiterBound: true });
  assert.match(ruling.next, /one required change/);
});

test("persistPrompt names the handoff and the capture", () => {
  const p = persistPrompt({ rel: "spartan/tasks/0001-x.md", action: { id: "HX-003", role: "reviewer" }, verdict: "APPROVED", capture: ".spartan-relay/0001/HX-003-review.txt", authorization: "persist only", next: "", arbiter: false });
  assert.match(p, /\(handoff HX-003\)/);
  assert.match(p, /\.spartan-relay\/0001\/HX-003-review\.txt/);
});

test("parseArgs reads options and rejects unknown ones", () => {
  const o = parseArgs(["spartan/tasks/0001-x.md", "--max-cycles", "2", "--dry-run"]);
  assert.equal(o.maxCycles, 2);
  assert.equal(o.dryRun, true);
  assert.throws(() => parseArgs(["--nope"]), Stop);
  assert.throws(() => parseArgs([]), Stop);
});

test("choosePaneSplit keeps agents at least MIN_AGENT_COLS wide and skips reserved panes", () => {
  const pane = (id, width, height) => ({ pane_id: id, rect: { width, height } });
  assert.deepEqual(choosePaneSplit([pane("a", 123, 69)]), { pane: "a", direction: "right" });
  assert.deepEqual(choosePaneSplit([pane("a", 80, 69)]), { pane: "a", direction: "down" });
  assert.equal(choosePaneSplit([pane("a", MIN_AGENT_COLS - 1, 69)]), null);
  assert.deepEqual(choosePaneSplit([pane("cockpit", 200, 69), pane("b", 70, 40)], new Set(["cockpit"])), { pane: "b", direction: "down" });
  assert.deepEqual(choosePaneSplit([pane("cockpit", 200, 40), pane("relay", 200, 20)], new Set(["cockpit", "relay"])), { pane: "cockpit", direction: "right" });
});

test("versionAtLeast compares dotted versions", async () => {
  const { versionAtLeast } = await import("../src/setup/environment.mjs");
  assert.equal(versionAtLeast("herdr 0.9.3", "0.9.0"), true);
  assert.equal(versionAtLeast("0.8.12", "0.9.0"), false);
  assert.equal(versionAtLeast("1.0.0", "0.9.0"), true);
  assert.equal(versionAtLeast("none", "0.9.0"), false);
});

test("findWorkspace matches a cockpit or relay pane opened in the repository, then the label", async () => {
  const { findWorkspace } = await import("../src/adapters/herdr/adapter.mjs");
  const workspaces = [{ workspace_id: "w1", label: "other" }, { workspace_id: "w2", label: "repo" }, { workspace_id: "w3", label: "named" }];
  const panes = [
    { workspace_id: "w1", label: "cockpit", cwd: "/x/other" },
    { workspace_id: "w2", label: "relay", cwd: "/x/repo/sub", foreground_cwd: "/x/repo/sub" },
    { workspace_id: "w3", cwd: "/x/repo" },
  ];
  assert.equal(findWorkspace({ panes, workspaces, root: "/x/repo", label: "anything" }).workspace_id, "w2");
  assert.equal(findWorkspace({ panes: [], workspaces, root: "/x/repo", label: "named" }).workspace_id, "w3");
  assert.equal(findWorkspace({ panes, workspaces, root: "/x/repository", label: "none" }), null);
});

test("parseWorkspaceArgs resolves the directory and the label", async () => {
  const { parseWorkspaceArgs } = await import("../src/cli.mjs");
  assert.deepEqual(parseWorkspaceArgs(["--label", "demo"], "/x/repo"), { dir: "/x/repo", label: "demo" });
  assert.deepEqual(parseWorkspaceArgs(["../other"], "/x/repo"), { dir: "/x/other", label: null });
  assert.throws(() => parseWorkspaceArgs(["--nope"], "/x"), Stop);
});

test("hasPendingPaste recognises a collapsed, unsent pasted prompt", async () => {
  const { hasPendingPaste } = await import("../src/adapters/herdr/adapter.mjs");
  const box = (inner) => ` ${"▄".repeat(40)}\n${inner}\n ${"▀".repeat(40)}\n  Grok 4.6 High Fast   Run Everything`;
  assert.equal(hasPendingPaste(box("  → [Pasted text #3 +6 lines]")), true);
  assert.equal(hasPendingPaste(box("  Open `spartan/tasks/0001-x.md` (handoff HX-009).\n\n  Return only the next handoff.")), true);
  assert.equal(hasPendingPaste(box("  → Add a follow-up                ctrl+c to stop")), false);
  assert.equal(hasPendingPaste(box("  → Plan, search, build anything")), false);
  assert.equal(hasPendingPaste(box("")), false);
  assert.equal(hasPendingPaste("no input box here"), false);
});

test("atShellPrompt tells a free pane from one still running an agent", async () => {
  const { atShellPrompt } = await import("../src/adapters/herdr/adapter.mjs");
  assert.equal(atShellPrompt({ shell_pid: 1, foreground_processes: [{ pid: 1, argv0: "zsh" }] }), true);
  assert.equal(atShellPrompt({ shell_pid: 1, foreground_processes: [{ pid: 2, argv0: "cursor-agent" }] }), false);
  assert.equal(atShellPrompt({ shell_pid: 1, foreground_processes: [] }), false);
  assert.equal(atShellPrompt(null), false);
});

test("chooseAgentPane reuses a free pane of the same host before splitting another", async () => {
  const { chooseAgentPane, agentLabel, MIN_AGENT_COLS } = await import("../src/adapters/herdr/adapter.mjs");
  const pane = (id, width, height) => ({ pane_id: id, rect: { width, height } });
  const panes = [pane("cockpit", 200, 46), pane("free", 80, 30), pane("wider", 90, 30)];
  const reserved = new Set(["cockpit"]);
  assert.deepEqual(chooseAgentPane(panes, { reserved, reusable: (p) => p.pane_id === "free" }), { reuse: "free" });
  assert.deepEqual(chooseAgentPane(panes, { reserved, reusable: () => true }), { reuse: "wider" });
  // Nothing free: the split is the one choosePaneSplit would have made on its own.
  assert.deepEqual(chooseAgentPane(panes, { reserved }), { split: { pane: "wider", direction: "down" } });
  // A free pane too narrow for herdr's host detection is not reused.
  assert.deepEqual(
    chooseAgentPane([pane("cockpit", 200, 46), pane("thin", MIN_AGENT_COLS - 1, 40)], { reserved, reusable: () => true }),
    { split: { pane: "cockpit", direction: "right" } },
  );
  assert.equal(chooseAgentPane([pane("thin", 10, 10)], { reusable: () => true }), null);
  assert.equal(agentLabel("Claude Code"), "sp-claude-code");
  assert.equal(agentLabel("Grok"), "sp-grok");
});

test("awaitStart watches the input box on every step, not once per grace period", async () => {
  const { awaitStart, hasPendingPaste, STALL_GRACE_MS, STALL_POLL_MS, MAX_PASTE_SUBMITS } = await import("../src/adapters/herdr/adapter.mjs");
  const box = (inner) => ` ${"▄".repeat(40)}\n${inner}\n ${"▀".repeat(40)}\n  Grok 4.6 High Fast   Run Everything`;

  // The host dropped the Enter: the prompt sits in the box until Enter lands, and the agent
  // starts on the step right after it.
  let screen = box("  Open `spartan/tasks/0001-x.md` (handoff HX-009).\n\n  Return only the next handoff.");
  let started = false;
  const waits = [];
  const pressed = [];
  const ok = awaitStart({
    graceMs: 60,
    stepMs: 10,
    waitStep: (ms) => {
      waits.push(ms);
      return started;
    },
    submit: (attempt) => {
      if (!hasPendingPaste(screen)) return false;
      pressed.push(attempt);
      screen = box("  → Add a follow-up");
      started = true;
      return true;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(pressed, [1]);
  assert.deepEqual(waits, [10]);

  // An idle box is never touched, and the steps add up to the grace period, no more.
  const steps = [];
  assert.equal(
    awaitStart({
      graceMs: 25,
      stepMs: 10,
      waitStep: (ms) => {
        steps.push(ms);
        return false;
      },
      submit: () => false,
    }),
    false,
  );
  assert.deepEqual(steps, [10, 10, 5]);

  // Enter is pressed at most maxSubmits times, however long the box stays full.
  let presses = 0;
  assert.equal(
    awaitStart({
      graceMs: 100,
      stepMs: 10,
      maxSubmits: 2,
      waitStep: () => false,
      submit: () => {
        presses++;
        return true;
      },
    }),
    false,
  );
  assert.equal(presses, 2);

  // The shipped schedule checks the box many times inside the grace period, and retries.
  assert.ok(STALL_GRACE_MS / STALL_POLL_MS >= 10);
  assert.ok(MAX_PASTE_SUBMITS > 1);
});
