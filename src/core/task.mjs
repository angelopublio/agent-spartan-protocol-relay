import fs from "node:fs";
import { Stop } from "./errors.mjs";

export const VERDICT_RE = /SPARTAN-VERDICT:\s*(APPROVED|CHANGES_REQUESTED|BLOCKED)\b/g;

// Spartan's canonical handoff identifier: the literal prefix `HX-` and either exactly three
// digits (HX-001 to HX-999) or four or more digits without a leading zero (HX-1000 onward).
export const HANDOFF_ID_RE = /^HX-(?!000$)(?:\d{3}|[1-9]\d{3,})$/;

// Reads a Spartan task artifact. The relay never writes it.
export function parseTask(text, file = "task") {
  const normalized = text.replace(/\r\n/g, "\n");
  const fm = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) throw new Stop(`${file} has no frontmatter`);
  const meta = {};
  for (const line of fm[1].split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.*?)\s*(?:#.*)?$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const task = { file, meta, envelope: null };
  const section = normalized.match(/\n## Next Handoff\n([\s\S]*?)(?=\n## |\s*$)/);
  if (!section) return task;
  const blocks = [...section[1].matchAll(/```text\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const advisoryIndex = blocks.findIndex((b) => b.startsWith("Recommended execution"));
  if (advisoryIndex === -1 || !blocks[advisoryIndex + 1]) return task;
  const advisory = blocks[advisoryIndex];
  const field = (label) => {
    const m = advisory.match(new RegExp(`^- ${label}:\\s*(.+)$`, "m"));
    return m ? m[1].trim() : null;
  };
  task.envelope = {
    host: field("Host"),
    role: field("Role"),
    handoff: field("Handoff"),
    permission: field("Permission"),
    prompt: blocks[advisoryIndex + 1],
  };
  return task;
}

export function readTask(file) {
  return parseTask(fs.readFileSync(file, "utf8"), file);
}

// Returns the next action, or throws Stop when the task needs the human.
export function nextAction(task) {
  const { meta, envelope } = task;
  const status = meta.status;
  if (status === "completed" || status === "complete") throw new Stop(`task completed (handoff_id ${meta.handoff_id || "none"})`, { ok: true });
  if (status === "blocked") throw new Stop("task is blocked; it needs a human decision");
  if (status !== "active") throw new Stop(`task status is "${status}"`);
  if (!meta.next_handoff_id || meta.next_handoff_id === "none") throw new Stop("no outstanding handoff (next_handoff_id is none); this relay only runs identified Spartan tasks");
  if (["human-operator", "none"].includes(meta.next_role)) throw new Stop(`next role is ${meta.next_role}`);
  if (!envelope) throw new Stop("## Next Handoff has no advisory block followed by a prompt block");

  const promptHandoff = envelope.prompt.match(/\(handoff ([^)\s]+)\)/)?.[1];
  const promptRole = envelope.prompt.match(/\bAct as ([a-z-]+)/)?.[1];
  if (!promptHandoff) throw new Stop(`the prompt block names no "(handoff HX-NNN)"; it must name the same identifier as next_handoff_id (${meta.next_handoff_id})`);
  for (const [where, id] of [["frontmatter next_handoff_id", meta.next_handoff_id], ['advisory "- Handoff:"', envelope.handoff], ['prompt "(handoff …)"', promptHandoff]]) {
    if (!HANDOFF_ID_RE.test(id || "")) throw new Stop(`${where} is "${id}", which is not a Spartan handoff identifier (HX-001 to HX-999, then HX-1000 onward): ask the producer to regenerate the whole ## Next Handoff`);
  }
  const ids = [meta.next_handoff_id, envelope.handoff, promptHandoff];
  const roles = [meta.next_role, envelope.role, promptRole];
  if (new Set(ids).size !== 1) throw new Stop(`handoff identifiers disagree (frontmatter, advisory, prompt): ${ids.join(", ")}`);
  if (new Set(roles).size !== 1) throw new Stop(`roles disagree (frontmatter, advisory, prompt): ${roles.join(", ")}`);
  if (!["writable", "read-only"].includes(envelope.permission)) throw new Stop(`advisory block has no valid "- Permission:" line (found "${envelope.permission}")`);
  if (!envelope.host) throw new Stop('advisory block has no "- Host:" line');
  return {
    id: meta.next_handoff_id,
    role: meta.next_role,
    readOnly: envelope.permission === "read-only",
    hostWritten: envelope.host,
    prompt: envelope.prompt,
    reviewKind: meta.task_type === "implementation" ? "implementation" : "plan",
  };
}

export function lastVerdict(output) {
  return [...output.matchAll(VERDICT_RE)].at(-1)?.[1] || null;
}

// A reviewer's answer is read off its pane, and that read can come back holding the host's
// collapsed rendering instead of the round's transcript: the echoed prompt, the verdict line
// and the host's footer, and nothing of the response. herdr reads a host that draws on the
// alternate screen out of application-owned history rather than scrollback, and that recovery
// is best-effort, so the loss is silent. Such a capture must not be taken for a result: the
// verdict it carries has no findings behind it, and the captures are the review budget, so
// counting it spends a cycle on a round that reported nothing.
//
// What separates the two is volume, not wording; the relay never judges findings. In captures
// from real runs the lost ones held a single non-empty line before the verdict, and the
// thinnest genuine one held ten.
export const MIN_CAPTURE_BODY_LINES = 5;

// How much the capture holds before its verdict line: the reviewer's response, plus whatever
// the host echoed of the prompt. Counted in non-empty lines, because a host pads with blanks.
// Without a verdict line the whole capture is the body, so a read that returned nothing at all
// is as recognisable as one that returned only a verdict.
export function captureBodyLines(output) {
  const verdict = [...output.matchAll(VERDICT_RE)].at(-1);
  const before = verdict ? output.slice(0, verdict.index) : output;
  return before.split("\n").filter((line) => line.trim()).length;
}

export function capturedTheResponse(output) {
  return captureBodyLines(output) >= MIN_CAPTURE_BODY_LINES;
}
