import fs from "node:fs";
import path from "node:path";
import { Stop } from "./errors.mjs";

// Where a phase stands in its review loop: how many reviews it has spent and whether it was
// arbitrated. Both are derived from the capture files the relay writes, one per read-only round,
// so they survive a restart of the relay. Process memory does not, and the two guarantees that
// depend on them — a bounded review budget and a phase arbitrated once — must hold across the
// operational restarts a real run takes.
//
// A capture is named after the handoff identifier its round consumed and the phase it belongs to.
// Keying on the identifier makes the record idempotent: re-running a handoff because the persist
// round after it failed is the same round again, not another cycle.
const CAPTURE_RE = /^(HX-\d+)-(plan|implementation)-(review|arbitration)\.txt$/;

// Captures written before the phase was part of the name. Nothing in such a name says which
// phase it belongs to, so `reviewHistory` attributes it to the phase it is asked about.
const LEGACY_RE = /^(HX-\d+)-(review|arbitration)\.txt$/;

export function captureName(id, reviewKind, arbiter) {
  return `${id}-${reviewKind}-${arbiter ? "arbitration" : "review"}.txt`;
}

// Where the relay keeps a read that did not bring the round's response back. It is written for
// the human to read, not as the round's record, so the name is deliberately outside both
// patterns above: the review budget and the arbitration record never see it, and the round it
// belongs to can be run again.
export function lostCaptureName(id, reviewKind, arbiter) {
  return captureName(id, reviewKind, arbiter).replace(/\.txt$/, ".not-captured.txt");
}

const idValue = (id) => Number(id.slice(3));
const byId = (a, b) => idValue(a) - idValue(b);

// One phase's durable state, read from capture names. `legacy` holds the phase-less names that
// were counted into it, so the caller can say out loud that it charged them to this phase.
export function reviewHistory(names, reviewKind) {
  const reviews = [];
  const arbitrations = [];
  const legacy = [];
  for (const name of names) {
    const current = CAPTURE_RE.exec(name);
    const old = current ? null : LEGACY_RE.exec(name);
    if (!current && !old) continue;
    if (current && current[2] !== reviewKind) continue;
    if (old) legacy.push(name);
    const into = (current ? current[3] : old[2]) === "arbitration" ? arbitrations : reviews;
    const id = current ? current[1] : old[1];
    if (!into.includes(id)) into.push(id);
  }
  reviews.sort(byId);
  arbitrations.sort(byId);
  legacy.sort(byId);
  return { reviews, arbitration: arbitrations[0] || null, legacy };
}

export function readHistory(repo, dir, reviewKind) {
  let names = [];
  try {
    names = fs.readdirSync(path.join(repo, dir));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return reviewHistory(names, reviewKind);
}

// The number this round takes in its phase. The captures are the record, so correcting the
// record means removing or renaming a file in that folder; every stop here says where it is.
export function reviewCycle(history, { reviewKind, id, maxCycles, arbiter = false, dir }) {
  const legacy = history.legacy.length
    ? ` ${history.legacy.join(", ")} name no phase and were counted against the ${reviewKind} phase.`
    : "";
  const record = `the record is ${dir}; remove or rename a capture there if it should not count.${legacy}`;
  if (arbiter) {
    if (history.arbitration && history.arbitration !== id) {
      throw new Stop(`the ${reviewKind} phase was already arbitrated (${history.arbitration}); ${record}`);
    }
    return history.reviews.length;
  }
  if (history.arbitration) {
    throw new Stop(`the ${reviewKind} phase was arbitrated (${history.arbitration}); another review of it is not allowed. ${record}`);
  }
  const seen = history.reviews.indexOf(id);
  const cycle = seen === -1 ? history.reviews.length + 1 : seen + 1;
  if (cycle > maxCycles) {
    throw new Stop(`${reviewKind} review limit (${maxCycles}) reached: ${history.reviews.join(", ")} are captured for the phase. ${record}`);
  }
  return cycle;
}
