import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Stop, log } from "./errors.mjs";
import { loadHosts, resolveHost, withToken, CONFIG_NAME } from "./hosts.mjs";
import { readBindings, bindingFor, modelArgs } from "./bindings.mjs";
import { readTask, nextAction, lastVerdict } from "./task.mjs";
import { readHistory, reviewCycle, captureName } from "./history.mjs";

// Tripwire: a read-only reviewer must leave the working tree untouched.
function treeFingerprint(repo) {
  const git = (args) => execFileSync("git", ["-C", repo, ...args], { maxBuffer: 256 * 1024 * 1024 });
  const h = crypto.createHash("sha256");
  h.update(git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  h.update(git(["diff", "--binary"]));
  h.update(git(["diff", "--binary", "--cached"]));
  for (const f of git(["ls-files", "-z", "--others", "--exclude-standard"]).toString().split("\0").filter(Boolean)) {
    const st = fs.statSync(path.join(repo, f), { throwIfNoEntry: false });
    h.update(`${f}\0${st?.size}\0${st?.mtimeMs}\0`);
  }
  return h.digest("hex");
}

function isIgnored(repo, dir) {
  try {
    execFileSync("git", ["-C", repo, "check-ignore", "-q", `${dir}/x`]);
    return true;
  } catch {
    return false;
  }
}

export const CAPTURES = `.${CONFIG_NAME}`;

// Review captures go to a git-ignored folder, so they never enter the tree a reviewer is
// checked against. They are also the relay's durable convergence record; see history.mjs.
export function captureDir(repo) {
  if (!isIgnored(repo, CAPTURES)) throw new Stop(`add ${CAPTURES}/ to .gitignore first; review captures must not enter the tree the reviewer is checked against`);
  return CAPTURES;
}

export function persistPrompt({ rel, action, verdict, capture, authorization, next, arbiter }) {
  return [
    `Open \`${rel}\` (handoff ${action.id}).`,
    "",
    `A technically read-only ${action.role} round consumed ${action.id} and returned ${verdict}. Its full terminal output is in \`${capture}\`; that file is the returned result. Authorization: ${authorization}.`,
    `Persist it as the next writable round: transcribe the verdict unchanged and the findings faithful in substance, name the ${arbiter ? "arbitrating" : "reviewing"} host, model, effort and vendor it reported, mark the entry adopted, set handoff_id to ${action.id}, and advance the envelope once.` + next,
    "",
    "Return only the next handoff, or a completion notice if no work remains.",
  ].join("\n");
}

// What the producer does after a review or arbitration, under Spartan's review-persistence
// and convergence rules. After the last allowed review without APPROVED, an arbiter bound
// for the phase takes the next round.
export function afterReview({ verdict, arbiter, reviewKind, cycle, maxCycles, arbiterBound }) {
  const toArbiter = !arbiter && verdict === "CHANGES_REQUESTED" && cycle >= maxCycles && arbiterBound;
  const correct = verdict === "CHANGES_REQUESTED" && (arbiter || (reviewKind === "implementation" && !toArbiter));
  const authorization = correct ? "persist and correct" : "persist only";
  let next;
  if (toArbiter) {
    next = ` This was review ${cycle} of ${maxCycles} for the ${reviewKind} phase and it did not approve. Do not correct. Under Spartan's convergence and arbitration rules, issue the next envelope for \`arbiter\` with \`Permission: read-only\`, using the shipped arbiter prompt; the repository binds arbiter.${reviewKind}.`;
  } else if (arbiter && correct) {
    next = " Then apply the arbiter's one required change, run the relevant checks, and advance the phase without another review of it: hand off to the next phase's role, or complete the task. If the change cannot be applied or a check fails, set the task blocked with human-operator next.";
  } else if (arbiter) {
    next = verdict === "APPROVED" ? " Record the arbiter's notes with the adopted verdict and advance the phase as after a reviewer's APPROVED." : "";
  } else {
    next = correct ? " Then apply the named findings to product files and run the relevant checks before issuing the next review handoff." : "";
  }
  return { toArbiter: Boolean(toArbiter), authorization, next };
}

// What happens to the producer's pane when a run ends. A completed task leaves nothing to
// read, so the relay closes the pane it opened for it; any other end keeps the pane open for
// the human, and a session the human started is never closed.
export function releasePolicy({ completed, producer }) {
  if (!producer) return { close: false, reason: null };
  if (!producer.owned) return { close: false, reason: `your ${producer.host} session ${producer.name} stays open in pane ${producer.pane}` };
  if (!completed) return { close: false, reason: `producer ${producer.name} stays open in pane ${producer.pane}` };
  return { close: true, reason: `the task is complete, so producer ${producer.name}'s pane ${producer.pane} is closed` };
}

export function run(opts, adapter) {
  const taskPath = path.resolve(opts.task);
  if (!fs.existsSync(taskPath)) throw new Stop(`${opts.task} does not exist`);
  const repo = execFileSync("git", ["-C", path.dirname(taskPath), "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const hosts = loadHosts(repo);
  const rel = path.relative(repo, taskPath);
  const taskNo = path.basename(taskPath).match(/^(\d{4})-/)?.[1];
  if (!taskNo) throw new Stop("task file name must start with its four-digit number");
  const prefix = adapter.namePrefix;
  const state = { hosts, repo, rel, taskNo, task: readTask(taskPath), producer: null, bindings: readBindings(repo) };
  // Where this task's captures live. They carry the review budget and the arbitration record,
  // so both are read from disk per round rather than held in this process.
  const taskCaptures = path.join(CAPTURES, taskNo);
  const phaseState = (action) => {
    const history = readHistory(repo, taskCaptures, action.reviewKind);
    const cycle = reviewCycle(history, {
      reviewKind: action.reviewKind,
      id: action.id,
      maxCycles: opts.maxCycles,
      arbiter: action.role === "arbiter",
      dir: taskCaptures,
    });
    return { history, cycle };
  };
  const logPhase = (action, { history, cycle }) => {
    const spent = history.reviews.length ? history.reviews.join(", ") : "none";
    log(`${action.reviewKind} phase: ${action.role === "arbiter" ? "arbitration" : `review ${cycle} of ${opts.maxCycles}`}; captured so far: ${spent}`);
    if (history.legacy.length) log(`!  ${history.legacy.join(", ")} in ${taskCaptures} name no phase; counted against the ${action.reviewKind} phase`);
  };

  // AGENTS.md binds host, model and effort per role. Without a binding row, the
  // handoff's "- Host:" line and the client's default model apply.
  const route = (action) => {
    const binding = bindingFor(state.bindings, action);
    const advised = resolveHost(hosts, action.hostWritten);
    if (!binding) return { host: advised, binding: null };
    const host = resolveHost(hosts, binding.host);
    if (host !== advised) log(`!  the handoff recommends ${advised}, AGENTS.md binds ${host}; using ${host}`);
    return { host, binding };
  };

  if (opts.dryRun) {
    const action = nextAction(state.task);
    const { host, binding } = route(action);
    const h = hosts[host];
    const mode = action.readOnly ? "reviewer" : "producer";
    if (action.role !== "arbiter") {
      const arb = state.bindings?.[`arbiter.${action.reviewKind}`];
      log(`arbiter.${action.reviewKind}: ${arb ? `${arb.host}, ${arb.model} ${arb.effort}, after review ${opts.maxCycles} without APPROVED` : "not bound; the run stops at the cycle limit"}`);
    }
    if (action.readOnly) logPhase(action, phaseState(action));
    log(`next: ${action.id} ${action.role} (${action.readOnly ? "read-only" : "writable"}) on ${host}${binding ? ` via AGENTS.md ${binding.binding}` : " via the handoff"}`);
    log(`launch: ${adapter.describeLaunch(`${prefix}-${taskNo}-${action.role === "arbiter" ? "arbiter" : mode}`, h.kind, [...h[mode], ...modelArgs(h.kind, binding)])}`);
    if (Object.keys(h.env || {}).length) log(`pane env: ${Object.keys(h.env).join(", ")}`);
    log(`prompt:\n${withToken(hosts, host, action.prompt)}`);
    return;
  }
  adapter.requireEnvironment();
  captureDir(repo); // the captures are the relay's record: refuse to write them into the tree
  nextAction(state.task); // validate before touching any pane
  state.producer = adapter.findProducer(state, opts.producer, { required: false });

  let completed = false;
  try {
    for (;;) {
      state.task = readTask(taskPath);
      const action = nextAction(state.task);
      const { host, binding } = route(action);

      if (!action.readOnly) {
        // Writable producer round: reuse the live producer only for the same host, role and model.
        const wanted = binding ? `${binding.model}/${binding.effort}` : null;
        const p = state.producer;
        if (p && (p.host !== host || p.role !== action.role || (p.model && wanted && p.model !== wanted))) {
          adapter.release(p);
          if (!p.owned) log(`   your ${p.host} session ${p.name} is not the ${action.role} ${action.id} needs; it stays open in pane ${p.pane}`);
          state.producer = null;
        }
        if (!state.producer) {
          state.producer = adapter.startAgent(state, host, "producer", `${prefix}-${taskNo}-producer`, binding);
          state.producer.role = action.role;
        }
        log(`→  ${action.id} ${action.role} on ${host}`);
        adapter.runPrompt(state.producer, withToken(hosts, host, action.prompt), opts.producerTimeoutMs);
        const after = readTask(taskPath).meta;
        if (after.next_handoff_id === action.id && after.status === "active") {
          throw new Stop(`${action.role} finished but ${action.id} is still the outstanding handoff; read its pane ${state.producer.pane}`);
        }
        continue;
      }

      // Read-only review or arbitration round in a fresh session. Its place in the phase comes
      // from the captures on disk, so a restart resumes the budget and keeps an arbitrated phase
      // closed instead of starting the loop over.
      const arbiter = action.role === "arbiter";
      if (arbiter && !binding) throw new Stop(`next role is arbiter but AGENTS.md binds no arbiter.${action.reviewKind}`);
      const phase = phaseState(action);
      logPhase(action, phase);
      if (!state.producer) state.producer = adapter.findProducer(state, opts.producer, { required: true });
      if (state.producer.host === host) log(`!  ${host} ${arbiter ? "arbitrates" : "reviews"} work produced on ${host}: separate session, same vendor`);
      const reviewer = adapter.startAgent(state, host, "reviewer", `${prefix}-${taskNo}-${arbiter ? "arbiter" : "reviewer"}`, binding);
      const before = treeFingerprint(repo);
      log(`→  ${action.id} ${action.role} (${arbiter ? `${action.reviewKind} arbitration` : `${action.reviewKind} review ${phase.cycle}/${opts.maxCycles}`}) on ${host}`);
      adapter.runPrompt(
        reviewer,
        withToken(hosts, host, `${action.prompt}\n\nEnd your response with one final line that reads SPARTAN-VERDICT: followed by that verdict.`),
        opts.reviewTimeoutMs,
      );
      const output = adapter.readOutput(reviewer);
      if (treeFingerprint(repo) !== before) throw new Stop(`the read-only ${action.role} changed the working tree; inspect pane ${reviewer.pane} and git status`);
      const verdict = lastVerdict(output);
      if (!verdict) throw new Stop(`no SPARTAN-VERDICT line found in ${reviewer.name}'s output; read pane ${reviewer.pane}`);
      const capture = path.join(taskCaptures, captureName(action.id, action.reviewKind, arbiter));
      fs.mkdirSync(path.join(repo, path.dirname(capture)), { recursive: true });
      fs.writeFileSync(path.join(repo, capture), output);
      adapter.release(reviewer);
      log(`←  ${verdict} (captured in ${capture})`);

      const { authorization, next } = afterReview({
        verdict,
        arbiter,
        reviewKind: action.reviewKind,
        cycle: phase.cycle,
        maxCycles: opts.maxCycles,
        arbiterBound: Boolean(state.bindings?.[`arbiter.${action.reviewKind}`]),
      });
      log(`→  persist ${action.id} (${authorization}) on ${state.producer.host}`);
      adapter.runPrompt(state.producer, withToken(hosts, state.producer.host, persistPrompt({ rel, action, verdict, capture, authorization, next, arbiter })), opts.producerTimeoutMs);
      const after = readTask(taskPath).meta;
      if (after.handoff_id !== action.id) throw new Stop(`the persist round did not adopt ${action.id} (handoff_id is ${after.handoff_id}); read pane ${state.producer.pane}`);
    }
  } catch (e) {
    completed = e instanceof Stop && e.ok;
    throw e;
  } finally {
    const { close, reason } = releasePolicy({ completed, producer: state.producer });
    if (close) adapter.release(state.producer);
    if (reason) log(`   ${reason}`);
  }
}
