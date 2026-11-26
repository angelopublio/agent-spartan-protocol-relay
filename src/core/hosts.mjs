import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Stop } from "./errors.mjs";

// Host table. The key is the host name Spartan writes in "- Host:".
// `producer` and `reviewer` are the client's own CLI arguments. Reviewer arguments must
// make the session read-only; the relay also checks the working tree after every review.
export const DEFAULT_HOSTS = {
  "Claude Code": {
    kind: "claude",
    token: "/spartan",
    producer: ["--permission-mode", "acceptEdits"],
    reviewer: [
      "--permission-mode", "dontAsk",
      "--allowed-tools", "Read,Grep,Glob,Bash(git diff:*),Bash(git status:*),Bash(git log:*),Bash(git show:*)",
      "--disallowed-tools", "Write,Edit,NotebookEdit,WebFetch,WebSearch",
    ],
    env: {},
  },
  Codex: {
    kind: "codex",
    token: "$spartan",
    producer: ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"],
    reviewer: ["--sandbox", "read-only", "--ask-for-approval", "never"],
    env: {},
  },
  Cursor: {
    kind: "cursor",
    token: "/spartan",
    producer: ["--sandbox", "enabled"],
    reviewer: ["--mode", "plan", "--sandbox", "enabled"],
    env: {},
  },
  Grok: {
    kind: "grok",
    token: "/spartan",
    aliases: ["Grok Build"],
    producer: [],
    reviewer: ["--sandbox", "strict"],
    env: {},
  },
};

export const CONFIG_NAME = "spartan-relay";

// Defaults, then the user's hosts.json, then the repository's own git-ignored hosts.json.
// Each listed field replaces the default field of that host.
export function loadHosts(repo, { env = process.env, home = os.homedir() } = {}) {
  const hosts = structuredClone(DEFAULT_HOSTS);
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const files = [path.join(base, CONFIG_NAME, "hosts.json"), path.join(repo, `.${CONFIG_NAME}`, "hosts.json")];
  for (const file of files.filter((f) => fs.existsSync(f))) {
    let overrides;
    try {
      overrides = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      throw new Stop(`cannot parse ${file}: ${e.message}`);
    }
    for (const [name, override] of Object.entries(overrides)) {
      if (name.startsWith("_")) continue; // comments
      hosts[name] = { ...(hosts[name] || { producer: [], reviewer: [], env: {}, token: "" }), ...override };
      if (!hosts[name].kind) throw new Stop(`${file}: host "${name}" needs "kind"`);
    }
  }
  return hosts;
}

export function resolveHost(hosts, written) {
  const value = written.trim().toLowerCase();
  const names = [];
  for (const [name, h] of Object.entries(hosts)) {
    names.push([name, name]);
    for (const alias of h.aliases || []) names.push([alias, name]);
  }
  names.sort((a, b) => b[0].length - a[0].length);
  for (const [label, name] of names) {
    if (value.startsWith(label.toLowerCase())) return name;
  }
  throw new Stop(`handoff names host "${written}", which is not in the host table; add it to hosts.json`);
}

export function hostForKind(hosts, kind) {
  return Object.keys(hosts).find((name) => hosts[name].kind === kind) || null;
}

export function withToken(hosts, host, prompt) {
  const token = hosts[host].token;
  return token ? `${token} ${prompt}` : `Use the spartan skill.\n\n${prompt}`;
}
