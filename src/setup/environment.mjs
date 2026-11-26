// Read-only probes of the machine, shared by `doctor` and `setup`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO_SLUG = "angelopublio/agent-spartan-protocol-relay";
export const PROTOCOL_SLUG = "angelopublio/agent-spartan-protocol";
export const PLUGIN_ID = "spartan-relay";
export const MIN_HERDR = "0.9.0";
export const MIN_NODE_MAJOR = 20;

// Agent CLIs the relay can bind, and the skill folder each one reads.
export const AGENTS = [
  { host: "Claude Code", command: "claude", skills: ".claude/skills" },
  { host: "Codex", command: "codex", skills: ".agents/skills" },
  { host: "Cursor", command: "cursor-agent", skills: ".agents/skills" },
  { host: "Grok", command: "grok", skills: ".agents/skills" },
];

export function home() {
  return process.env.HOME || os.homedir();
}

export function which(command) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const file = dir && path.join(dir, command);
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}

export function output(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

export function versionAtLeast(found, wanted) {
  const a = String(found).match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  const b = wanted.split(".").map(Number);
  if (!a) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

export function herdrVersion() {
  return output("herdr", ["--version"])?.match(/\d+\.\d+\.\d+/)?.[0] || null;
}

export function herdrPlugin() {
  const raw = output("herdr", ["plugin", "list", "--json"]);
  try {
    return (JSON.parse(raw || "{}")?.result?.plugins || []).find((p) => p.plugin_id === PLUGIN_ID) || null;
  } catch {
    return null;
  }
}

// Skill folders for the agents found on this machine, each with the agents that read it.
export function skillDirs(agents = AGENTS.filter((a) => which(a.command))) {
  const dirs = new Map();
  for (const a of agents) {
    const dir = path.join(home(), a.skills);
    dirs.set(dir, [...(dirs.get(dir) || []), a.host]);
  }
  return [...dirs].map(([dir, hosts]) => ({ dir, hosts }));
}

export function skillInstalled(dir, name) {
  return fs.existsSync(path.join(dir, name, "SKILL.md"));
}

export function cursorOverride() {
  const base = process.env.XDG_CONFIG_HOME || path.join(home(), ".config");
  const target = path.join(base, "herdr", "agent-detection", "cursor.toml");
  const source = path.join(PACKAGE_ROOT, "adapters", "herdr", "agent-detection", "cursor.toml");
  const state = !fs.existsSync(target) ? "missing" : fs.readFileSync(target, "utf8") === fs.readFileSync(source, "utf8") ? "current" : "different";
  return { source, target, state };
}
