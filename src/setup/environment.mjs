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

// How far below a host's skill folder a second copy is still that host's. A sync directory
// nests the skill two or three levels down; the cap keeps a walk from following a deep tree.
const MAX_SKILL_WALK_DEPTH = 6;

// Directories a skill keeps beside SKILL.md. A backtick path under one of these is a file of
// the installation. A backtick path into the repository (`spartan/tasks/…`) is not.
const SKILL_LOCAL = /^(?:references|assets|scripts|agents)\//;

// The files a skill tells the agent to open, read out of SKILL.md rather than declared here.
// The spartan skill is maintained in another repository and adds or renames a reference on
// its own, so the installation's own text is the list: a flattened copy keeps that text and
// drops the files, and a list of expected files written in this repository would still
// approve it, and would say nothing about any other skill. Markdown link targets that are
// relative paths are those files. So is a backtick path under references/, assets/, scripts/
// or agents/, which is the same reference written without link syntax. Absolute URLs,
// fragments, fenced examples, and paths that leave the skill directory are not files of the
// installation.
export function skillFileRefs(markdown) {
  const text = String(markdown).replace(/^```[^\n]*\n[\s\S]*?\n```/gm, "");
  const refs = new Set();
  const add = (rel) => {
    if (rel) refs.add(rel);
  };
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\n]*)\)/g)) add(relativeSkillPath(linkDestination(match[1])));
  for (const match of text.matchAll(/^\[(?:[^\]]+)\]:[ \t]+(\S+)/gm)) add(relativeSkillPath(linkDestination(match[1])));
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const rel = relativeSkillPath(match[1].trim());
    if (rel && SKILL_LOCAL.test(rel)) add(rel);
  }
  return [...refs].sort();
}

function linkDestination(raw) {
  let dest = String(raw).trim();
  if (dest.startsWith("<")) {
    const end = dest.indexOf(">");
    dest = end === -1 ? dest.slice(1) : dest.slice(1, end);
  } else {
    dest = dest.split(/\s+/)[0];
  }
  return dest;
}

// A relative path that stays inside the skill directory, or null when the reference is not
// a file beside SKILL.md.
function relativeSkillPath(raw) {
  let dest = String(raw).trim();
  if (!dest || dest.startsWith("#") || dest.startsWith("/") || dest.startsWith("~") || dest.endsWith("/")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(dest)) return null;
  dest = dest.split("#", 1)[0].split("?", 1)[0];
  if (!dest) return null;
  try {
    dest = decodeURIComponent(dest);
  } catch {
    return null;
  }
  const parts = [];
  for (const segment of dest.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.length ? parts.join("/") : null;
}

// Files SKILL.md references that are not beside it. Null when SKILL.md itself cannot be read.
export function skillMissing(skillDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  const root = path.resolve(skillDir);
  const missing = [];
  for (const rel of skillFileRefs(text)) {
    const abs = path.resolve(root, ...rel.split("/"));
    if (abs !== root && !abs.startsWith(root + path.sep)) continue;
    let file = false;
    try {
      file = fs.statSync(abs).isFile();
    } catch {
      file = false;
    }
    if (!file) missing.push(rel);
  }
  return missing;
}

function declaredSkillName(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const line = fm?.[1].match(/^name:\s*(.+)$/m);
  return line ? line[1].trim().replace(/^["']|["']$/g, "") : null;
}

function directoryEntry(full, ent) {
  if (ent.isDirectory()) return { dir: true, symlink: false };
  if (!ent.isSymbolicLink()) return { dir: false, symlink: false };
  try {
    return { dir: fs.statSync(full).isDirectory(), symlink: true };
  } catch {
    return { dir: false, symlink: true };
  }
}

// Every installation of `name` under a host's skill folder. The folder can hold the skill
// twice: the copy the host was given, often a symlink, and another copy nested further down
// as a real directory. The walk stays inside the folder. A symlinked directory counts when
// it is the skill and is not entered, so the walk cannot leave the folder through it. A real
// directory is entered, which is how the nested copy is found. A search that does not follow
// symlinks finds the real directory and misses the symlink, so both have to be visible here.
export function findSkillInstallations(root, name) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > MAX_SKILL_WALK_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      const kind = directoryEntry(full, ent);
      if (!kind.dir) continue;
      const skillMd = path.join(full, "SKILL.md");
      let hasSkill = false;
      try {
        hasSkill = fs.statSync(skillMd).isFile();
      } catch {
        hasSkill = false;
      }
      if (hasSkill) {
        let declared = null;
        try {
          declared = declaredSkillName(fs.readFileSync(skillMd, "utf8"));
        } catch {
          declared = null;
        }
        if (ent.name === name || declared === name) found.push({ dir: full, symlink: kind.symlink });
        continue;
      }
      if (kind.symlink) continue;
      walk(full, depth + 1);
    }
  };
  walk(root, 0);
  found.sort((a, b) => a.dir.localeCompare(b.dir));
  return found;
}

// Setup treats a direct child with SKILL.md as installed and leaves it in place. Whether
// that copy is usable, and whether another copy sits deeper in the same folder, is what
// `skillInstalled` reports.
export function skillPresent(dir, name) {
  try {
    return fs.statSync(path.join(dir, name, "SKILL.md")).isFile();
  } catch {
    return false;
  }
}

// Usable means one installation, and every file its SKILL.md references is beside it.
// Two installations of the same name are not usable: the host can read the wrong one.
export function skillInstalled(dir, name) {
  const installations = findSkillInstallations(dir, name).map(({ dir: skillDir, symlink }) => {
    const missing = skillMissing(skillDir);
    const gaps = missing === null ? ["SKILL.md"] : missing;
    return { dir: skillDir, missing: gaps, usable: missing !== null && gaps.length === 0, symlink };
  });
  return {
    installations,
    usable: installations.length === 1 && installations[0].usable,
  };
}

export function cursorOverride() {
  const base = process.env.XDG_CONFIG_HOME || path.join(home(), ".config");
  const target = path.join(base, "herdr", "agent-detection", "cursor.toml");
  const source = path.join(PACKAGE_ROOT, "adapters", "herdr", "agent-detection", "cursor.toml");
  const state = !fs.existsSync(target) ? "missing" : fs.readFileSync(target, "utf8") === fs.readFileSync(source, "utf8") ? "current" : "different";
  return { source, target, state };
}
