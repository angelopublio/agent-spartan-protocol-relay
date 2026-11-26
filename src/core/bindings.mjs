import fs from "node:fs";
import path from "node:path";
import { Stop } from "./errors.mjs";

// Repository bindings: the `## Agent hosts` table in the repository's AGENTS.md.
//   | Binding | Host | Client context | Model | Effort |
// Client context is read by account wrappers, not by the relay.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const EFFORTS = ["low", "medium", "high", "max", "none"];

export function parseBindings(text) {
  const normalized = `\n${text.replace(/\r\n/g, "\n")}`;
  const section = normalized.match(/\n## Agent hosts\n([\s\S]*?)(?=\n## |$)/);
  if (!section) return null;
  const rows = section[1]
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/^`|`$/g, "")));
  if (rows.length < 3) throw new Stop("AGENTS.md: the ## Agent hosts table has no rows");
  const header = rows[0].map((c) => c.toLowerCase());
  const col = (name) => header.indexOf(name);
  for (const name of ["binding", "host", "model", "effort"]) {
    if (col(name) === -1) throw new Stop(`AGENTS.md: the ## Agent hosts table needs a "${name}" column`);
  }
  const bindings = {};
  for (const row of rows.slice(2)) {
    const b = { binding: row[col("binding")], host: row[col("host")], model: row[col("model")], effort: row[col("effort")].toLowerCase() };
    if (bindings[b.binding]) throw new Stop(`AGENTS.md: binding ${b.binding} appears twice`);
    if (!MODEL_RE.test(b.model)) throw new Stop(`AGENTS.md: model "${b.model}" for ${b.binding} is not a model identifier`);
    if (!EFFORTS.includes(b.effort)) throw new Stop(`AGENTS.md: effort "${b.effort}" for ${b.binding} must be one of ${EFFORTS.join(", ")}`);
    bindings[b.binding] = b;
  }
  return bindings;
}

export function readBindings(repo) {
  const file = path.join(repo, "AGENTS.md");
  if (!fs.existsSync(file)) return null;
  return parseBindings(fs.readFileSync(file, "utf8"));
}

export function bindingFor(bindings, action) {
  if (!bindings) return null;
  const key = action.role === "arbiter" ? `arbiter.${action.reviewKind}` : action.readOnly ? `reviewer.${action.reviewKind}` : action.role;
  return bindings[key] || null;
}

// Translates a binding's model and effort into each client's own CLI flags.
export function modelArgs(kind, binding) {
  if (!binding) return [];
  const { model, effort } = binding;
  const withEffort = effort !== "none";
  switch (kind) {
    case "claude":
      return ["--model", model, ...(withEffort ? ["--effort", effort] : [])];
    case "codex":
      return ["-c", `model="${model}"`, ...(withEffort ? ["-c", `model_reasoning_effort="${effort === "max" ? "xhigh" : effort}"`] : [])];
    case "cursor": {
      const encoded = model.match(/-(low|medium|high|max)(?:-fast)?$/)?.[1];
      if (encoded && withEffort && encoded !== effort) throw new Stop(`Cursor model ${model} already encodes effort ${encoded}, but AGENTS.md says ${effort}`);
      return ["--model", encoded || !withEffort ? model : `${model}[effort=${effort}]`];
    }
    case "grok":
      return ["-m", model, ...(withEffort ? ["--reasoning-effort", effort] : [])];
    default:
      throw new Stop(`no model flag is known for kind ${kind}; remove its Model from AGENTS.md or extend modelArgs`);
  }
}
