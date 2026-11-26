// herdr adapter: every call the relay makes to the terminal multiplexer lives here.
// The core asks for panes, agents, prompts and output; this file answers in herdr terms.
import { execFileSync } from "node:child_process";
import { Stop, log } from "../../core/errors.mjs";
import { hostForKind } from "../../core/hosts.mjs";
import { modelArgs } from "../../core/bindings.mjs";

export const NAME_PREFIX = "sp";

// herdr reads a screen-detected host such as Cursor from the bottom lines of its pane,
// and in a narrow pane the host's footer wraps over them, so every agent pane keeps at
// least MIN_AGENT_COLS columns.
export const MIN_AGENT_COLS = 60;
const MIN_AGENT_ROWS = 12;

// Panes the human keeps for themselves; the relay never splits them.
const RESERVED_LABELS = new Set(["cockpit", "relay"]);

// herdr gives a prompted agent a few seconds to show activity, and a cold host can take
// longer. After a stalled prompt the relay waits this long for the agent to start.
export const STALL_GRACE_MS = 120_000;

// herdr can read a working agent as idle for a moment, for example while the host redraws
// its footer. A finish counts only once the state holds this long.
export const SETTLE_MS = 10_000;

class HerdrError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

function herdr(args, { raw = false } = {}) {
  try {
    const out = execFileSync("herdr", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    if (raw) return out;
    return out.trim() ? JSON.parse(out) : {};
  } catch (e) {
    if (e.code === "ENOENT") throw new Stop("herdr is not on PATH");
    const raw = String(e.stderr || e.stdout || e.message).trim();
    let parsed;
    try {
      parsed = JSON.parse(raw.split("\n").find((l) => l.startsWith("{")) || "");
    } catch {
      /* not JSON */
    }
    if (parsed?.error) throw new HerdrError(parsed.error.code, parsed.error.message);
    throw new HerdrError("herdr_failed", raw || `exit ${e.status}`);
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function notify(title, body) {
  log(`⏸  ${title}: ${body}`);
  try {
    herdr(["notification", "show", title, "--body", body, "--sound", "request"]);
  } catch {
    /* a notification is a courtesy */
  }
}

function agentStatus(name) {
  return herdr(["agent", "get", name])?.result?.agent?.agent_status;
}

// Waits while the human answers an approval or question in the agent's pane.
function waitForHuman(agent) {
  notify("spartan-relay", `${agent.name} (${agent.host}, pane ${agent.pane}) is waiting for your answer`);
  herdr(["agent", "wait", agent.name, "--until", "done", "--until", "idle"]);
  log(`▶  ${agent.name} settled; continuing`);
}

function liveAgents() {
  return herdr(["agent", "list"])?.result?.agents || [];
}

// The relay splits the widest pane of its own tab, preferring panes the human has not
// reserved: side by side when both halves stay wide enough, otherwise one above the other.
// Only when no pane qualifies does the agent open in a tab of its own per task.
function splitOf(panes) {
  const widest = panes.slice().sort((x, y) => y.rect.width - x.rect.width || y.rect.height - x.rect.height)[0];
  if (!widest) return null;
  if (widest.rect.width >= 2 * MIN_AGENT_COLS) return { pane: widest.pane_id, direction: "right" };
  if (widest.rect.width >= MIN_AGENT_COLS && widest.rect.height >= 2 * MIN_AGENT_ROWS) return { pane: widest.pane_id, direction: "down" };
  return null;
}

// Reserved panes are split only when no other pane in the tab is wide enough.
export function choosePaneSplit(panes, reserved = new Set()) {
  return splitOf(panes.filter((p) => !reserved.has(p.pane_id))) || splitOf(panes);
}

function agentPane(state, env) {
  const here = process.env.HERDR_PANE_ID;
  if (here) {
    const panes = herdr(["pane", "layout", "--pane", here])?.result?.layout?.panes || [];
    const labels = new Map((herdr(["pane", "list"])?.result?.panes || []).map((p) => [p.pane_id, (p.label || "").toLowerCase()]));
    const reserved = new Set(panes.map((p) => p.pane_id).filter((id) => RESERVED_LABELS.has(labels.get(id)) || id === here));
    const split = choosePaneSplit(panes, reserved);
    if (split) {
      const pane = herdr(["pane", "split", split.pane, "--direction", split.direction, "--cwd", state.repo, "--no-focus", ...env])?.result?.pane?.pane_id;
      if (pane) return pane;
    }
  }
  const ws = process.env.HERDR_WORKSPACE_ID;
  const label = `${NAME_PREFIX}-${state.taskNo}`;
  const tab = (herdr(["tab", "list", ...(ws ? ["--workspace", ws] : [])])?.result?.tabs || []).find((t) => t.label === label);
  let pane;
  if (tab) {
    const inTab = (herdr(["pane", "list"])?.result?.panes || []).filter((p) => p.tab_id === tab.tab_id);
    if (!inTab.length) throw new Stop(`tab ${label} has no pane to split`);
    pane = herdr(["pane", "split", inTab[inTab.length - 1].pane_id, "--direction", "down", "--cwd", state.repo, "--no-focus", ...env])?.result?.pane?.pane_id;
  } else {
    pane = herdr(["tab", "create", ...(ws ? ["--workspace", ws] : []), "--label", label, "--cwd", state.repo, "--no-focus", ...env])?.result?.root_pane?.pane_id;
  }
  if (!pane) throw new Stop(`could not open a pane for the agent in tab ${label}`);
  log(`   no free pane in this tab is ${MIN_AGENT_COLS} columns wide, so the agent opens in tab ${label}`);
  return pane;
}

function release(agent) {
  if (!agent?.owned) return;
  try {
    herdr(["pane", "close", agent.pane]);
  } catch {
    /* already gone */
  }
}

function startAgent(state, host, mode, name, binding) {
  const h = state.hosts[host];
  const stale = liveAgents().find((a) => a.name === name);
  if (stale) {
    if (mode !== "reviewer") throw new Stop(`an agent named ${name} is still live in pane ${stale.pane_id}; close it or pass --producer ${name}`);
    log(`   closing the reviewer left open by an earlier run (pane ${stale.pane_id})`);
    release({ pane: stale.pane_id, owned: true });
  }
  const pane = agentPane(state, Object.entries(h.env || {}).flatMap(([k, v]) => ["--env", `${k}=${v}`]));
  const agent = { name, pane, host, owned: true };
  const args = ["agent", "start", name, "--kind", h.kind, "--pane", pane, "--timeout", "60000", "--", ...h[mode], ...modelArgs(h.kind, binding)];
  for (let attempt = 1; ; attempt++) {
    try {
      herdr(args);
      break;
    } catch (e) {
      if (e.code === "agent_not_ready") {
        waitForHuman(agent); // e.g. a trust-folder or update prompt at startup
        break;
      }
      if (attempt < 5 && e.code !== "agent_name_taken") {
        sleep(500); // the new pane's shell may still be starting
        continue;
      }
      release(agent);
      throw new Stop(`could not start ${h.kind} as ${name}: ${e.message}`);
    }
  }
  const model = binding ? `, ${binding.model}${binding.effort === "none" ? "" : ` ${binding.effort}`}` : "";
  log(`●  started ${host}${model} as ${name} (${mode}) in pane ${pane}`);
  agent.model = binding ? `${binding.model}/${binding.effort}` : null;
  return agent;
}

// Some hosts collapse a long pasted prompt into a placeholder such as Cursor's
// "[Pasted text #3 +6 lines]" and can drop the Enter that should submit it, leaving the
// prompt sitting in the input box.
export function hasPendingPaste(screen) {
  return /\[Pasted text #\d+[^\]]*\]/.test(screen || "");
}

// Sends Enter once when the agent's input box still holds an unsent pasted prompt.
function submitPendingPaste(agent) {
  if (agent.pasteSubmitted) return false;
  let screen = "";
  try {
    screen = herdr(["agent", "read", agent.name, "--source", "recent", "--lines", "15"], { raw: true });
  } catch {
    return false;
  }
  if (!hasPendingPaste(screen)) return false;
  agent.pasteSubmitted = true;
  herdr(["agent", "send-keys", agent.name, "enter"]);
  log(`…  ${agent.name} still held the prompt unsent in its input box; pressed Enter once`);
  return true;
}

// True once the agent starts working (or asks for approval) within the grace period.
function waitStarted(agent) {
  log(`…  ${agent.name} has not started yet; waiting up to ${STALL_GRACE_MS / 1000} s`);
  try {
    herdr(["agent", "wait", agent.name, "--until", "working", "--until", "blocked", "--timeout", String(STALL_GRACE_MS)]);
    return true;
  } catch (e) {
    if (e.code === "timeout") return false;
    throw e;
  }
}

function settle(agent, timeoutMs, status) {
  const deadline = Date.now() + timeoutMs;
  while (status === "done" || status === "idle") {
    sleep(SETTLE_MS);
    const now = agentStatus(agent.name);
    if (now !== "working") return now;
    log(`…  ${agent.name} is working again; waiting`);
    const left = deadline - Date.now();
    if (left <= 0) throw new Stop(`${agent.name} did not finish within ${timeoutMs / 60_000} min; its pane ${agent.pane} is left open`);
    status = herdr(["agent", "wait", agent.name, "--timeout", String(left)])?.result?.agent?.agent_status ?? agentStatus(agent.name);
  }
  return status;
}

// Sends one prompt and returns once the agent is done. Stops on anything else.
function runPrompt(agent, text, timeoutMs) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      agent.pasteSubmitted = false;
      res = herdr(["agent", "prompt", agent.name, text, "--wait", "--timeout", String(timeoutMs)]);
    } catch (e) {
      if (e.code === "agent_blocked" && attempt === 0) {
        waitForHuman(agent); // nothing was sent; send again once it is free
        continue;
      }
      if (e.code === "timeout") throw new Stop(`${agent.name} did not finish within ${timeoutMs / 60_000} min; its pane ${agent.pane} is left open`);
      if (e.code === "agent_prompt_stalled") {
        // The prompt was delivered, so never send it again. Submit it if it is still sitting in
        // the input box, then wait for the agent to start.
        submitPendingPaste(agent);
        if (!waitStarted(agent) && !(submitPendingPaste(agent) && waitStarted(agent))) throw new Stop(`${agent.name} never started working on the prompt within ${STALL_GRACE_MS / 1000} s (pane ${agent.pane}); check that "${text.split(/\s/)[0]}" is how this host invokes Spartan`);
        res = herdr(["agent", "wait", agent.name, "--timeout", String(timeoutMs)]);
      } else {
        throw new Stop(`prompting ${agent.name} failed: ${e.message}`);
      }
    }
    const status = settle(agent, timeoutMs, res?.result?.agent?.agent_status ?? agentStatus(agent.name));
    if (status === "blocked") waitForHuman(agent);
    else if (status !== "done" && status !== "idle") throw new Stop(`${agent.name} ended in state "${status}"; pane ${agent.pane} is left open`);
    return;
  }
}

function readOutput(agent) {
  return herdr(["agent", "read", agent.name, "--source", "recent-unwrapped", "--lines", "4000"], { raw: true });
}

// Finds the live producer session to continue with, in this order: --producer, the relay's
// own producer from an earlier run, a session adopted earlier, and, only when a review
// result needs a home, the single other agent in this workspace.
function findProducer(state, target, { required }) {
  const list = liveAgents();
  const own = `${NAME_PREFIX}-${state.taskNo}-producer`;
  const adopted = `${NAME_PREFIX}-${state.taskNo}-owner`;
  let a;
  if (target) {
    a = list.find((x) => x.name === target || x.pane_id === target);
    if (!a) throw new Stop(`--producer ${target} is not a live agent`);
  } else {
    a = list.find((x) => x.name === own) || list.find((x) => x.name === adopted);
  }
  if (!a && required) {
    const ws = process.env.HERDR_WORKSPACE_ID;
    const others = list.filter((x) => x.workspace_id === ws && x.pane_id !== process.env.HERDR_PANE_ID && !/-(reviewer|arbiter)$/.test(x.name || ""));
    if (others.length !== 1) {
      const seen = list.map((x) => `${x.name || "(unnamed)"} ${x.pane_id} ${x.agent}`).join("; ") || "none";
      throw new Stop(`the outstanding handoff is a review, so its result must go back to a live producer session; pass --producer <name|pane> (agents: ${seen})`);
    }
    a = others[0];
  }
  if (!a) return null;
  const host = hostForKind(state.hosts, a.agent);
  if (!host) throw new Stop(`producer ${a.pane_id} runs "${a.agent}", which is not in the host table`);
  let name = a.name;
  if (!name) {
    name = adopted;
    herdr(["agent", "rename", a.pane_id, name]);
  }
  const owned = name === own;
  log(`●  continuing with ${owned ? "the relay's" : "your"} ${host} session ${name} (pane ${a.pane_id}) as the producer${owned ? "" : "; it keeps the model you started it with and will not be closed"}`);
  return { name, pane: a.pane_id, host, owned, role: state.task.meta.current_role };
}

function requireEnvironment() {
  if (process.env.HERDR_ENV !== "1") throw new Stop("run this inside a herdr pane (HERDR_ENV=1)");
}

function describeLaunch(name, kind, args) {
  return `herdr agent start ${name} --kind ${kind} --pane <new> -- ${args.join(" ")}`;
}

// A workspace belongs to a repository when one of its `cockpit` or `relay` panes was opened
// there, or, failing that, when its label is the one asked for.
export function findWorkspace({ panes, workspaces, root, label }) {
  const inRoot = (p) => [p.cwd, p.foreground_cwd].some((c) => c === root || (c || "").startsWith(`${root}/`));
  const owned = panes.find((p) => RESERVED_LABELS.has((p.label || "").toLowerCase()) && inRoot(p));
  if (owned) return workspaces.find((w) => w.workspace_id === owned.workspace_id) || null;
  return workspaces.find((w) => w.label === label) || null;
}

// Focuses the repository's workspace, or creates it with a `cockpit` pane above a `relay`
// pane. Nothing is stored in the repository: the workspace is rebuilt from its folder.
export function openWorkspace(root, label) {
  const workspaces = herdr(["workspace", "list"])?.result?.workspaces || [];
  const panes = herdr(["pane", "list"])?.result?.panes || [];
  const found = findWorkspace({ panes, workspaces, root, label });
  if (found) {
    herdr(["workspace", "focus", found.workspace_id]);
    log(`●  workspace ${found.label} (${found.workspace_id}) already exists for ${root}; focused it`);
    return found.workspace_id;
  }
  const created = herdr(["workspace", "create", "--cwd", root, "--label", label, "--focus"])?.result || {};
  const ws = created.workspace?.workspace_id || created.root_pane?.workspace_id;
  const first = created.root_pane?.pane_id || (herdr(["pane", "list"])?.result?.panes || []).find((p) => p.workspace_id === ws)?.pane_id;
  if (!ws || !first) throw new Stop("herdr did not return the new workspace and its first pane");
  herdr(["pane", "rename", first, "cockpit"]);
  const relay = herdr(["pane", "split", first, "--direction", "down", "--ratio", "0.65", "--cwd", root, "--no-focus"])?.result?.pane?.pane_id;
  if (!relay) throw new Stop("could not open the relay pane");
  herdr(["pane", "rename", relay, "relay"]);
  log(`●  created workspace ${label} (${ws}) for ${root}: cockpit ${first}, relay ${relay}`);
  return ws;
}

export const herdrAdapter = {
  name: "herdr",
  namePrefix: NAME_PREFIX,
  requireEnvironment,
  describeLaunch,
  findProducer,
  startAgent,
  runPrompt,
  readOutput,
  release,
};
