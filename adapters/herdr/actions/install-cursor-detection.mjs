// Installs the Cursor detection override as a local herdr agent-detection manifest.
// A local override shadows herdr's remote manifest updates, so it refuses to replace a
// different local file and tells the human when to remove it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PLUGIN_ROOT, fail, herdr, notify } from "./lib.mjs";

const source = path.join(PLUGIN_ROOT, "agent-detection", "cursor.toml");
const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
const target = path.join(base, "herdr", "agent-detection", "cursor.toml");

const wanted = fs.readFileSync(source, "utf8");
if (fs.existsSync(target)) {
  if (fs.readFileSync(target, "utf8") === wanted) {
    notify("Spartan relay", "the Cursor detection fix is already installed");
    process.exit(0);
  }
  fail(`${target} exists and differs; review or remove it, then run this action again`);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, wanted);
herdr(["server", "reload-agent-manifests"]);
notify("Spartan relay", "Cursor detection fix installed; remove it once herdr ships a Cursor manifest that handles background-task lines");
