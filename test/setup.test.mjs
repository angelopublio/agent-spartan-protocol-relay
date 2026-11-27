import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { skillFileRefs, skillPresent, skillInstalled } from "../src/setup/environment.mjs";
import { skillCheck } from "../src/setup/doctor.mjs";

const SKILL = [
  "---",
  "name: spartan",
  "---",
  "",
  "Read [references/protocol.md](references/protocol.md) before acting.",
  "Copy [assets/readme.md](assets/readme.md).",
  "See [review-persistence.md](references/routing.md).",
  "The site is [docs](https://example.com/skill) and [section](#local).",
  "Read `references/extra.md` too.",
  "A repository path `spartan/README.md` is not part of the skill.",
  "",
  "```text",
  "Read [references/fenced.md](references/fenced.md).",
  "```",
  "",
].join("\n");

const REQUIRED = ["assets/readme.md", "references/extra.md", "references/protocol.md", "references/routing.md"];

function writeSkill(dir, { text = SKILL, files = REQUIRED } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), text);
  for (const rel of files) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "example\n");
  }
}

test("skillFileRefs reads relative links and skill-local backtick paths", () => {
  assert.deepEqual(skillFileRefs(SKILL), REQUIRED);
  const more = [
    "[a](references/protocol.md#section)",
    "[b](<assets/readme.md>)",
    "[c](https://example.com/x)",
    "[d](#local)",
    "[e](../outside.md)",
    "[f](references/protocol.md \"title\")",
    "See `agents/openai.yaml` and `~/.agents/skills/spartan`.",
    "[g]: assets/note.md",
  ].join("\n");
  assert.deepEqual(skillFileRefs(more), ["agents/openai.yaml", "assets/note.md", "assets/readme.md", "references/protocol.md"]);
});

test("a skill whose referenced files are missing is not usable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spartan-relay-skill-"));
  try {
    const skills = path.join(root, "skills");
    writeSkill(path.join(skills, "spartan"), { files: [] });
    assert.equal(skillPresent(skills, "spartan"), true);
    const report = skillInstalled(skills, "spartan");
    assert.equal(report.usable, false);
    assert.deepEqual(report.installations[0].missing, REQUIRED);
    const row = skillCheck(skills, "spartan", ["Codex"]);
    assert.equal(row.ok, false);
    assert.match(row.label, /is not usable$/);
    assert.match(row.hint, /missing assets\/readme.md, references\/extra.md, references\/protocol.md, references\/routing.md/);
    assert.doesNotMatch(row.hint, /example\.com/);
    assert.doesNotMatch(row.hint, /fenced\.md/);
    assert.doesNotMatch(row.hint, /spartan\/README\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a complete skill passes, and a nested incomplete copy of the same name is reported", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spartan-relay-skill-"));
  try {
    const real = path.join(root, "real-spartan");
    writeSkill(real);
    // A copy inside the linked skill must not be walked into: the link is the installation.
    writeSkill(path.join(real, "nested", "spartan"), { files: [] });
    const skills = path.join(root, "skills");
    fs.mkdirSync(path.join(skills, "synced", "bucket"), { recursive: true });
    fs.symlinkSync(real, path.join(skills, "spartan"), "dir");
    writeSkill(path.join(skills, "synced", "bucket", "spartan"), { files: [] });

    const alone = skillCheck(skills, "spartan", ["Claude Code"]);
    assert.equal(alone.ok, false);
    assert.match(alone.label, /installed 2 times/);
    assert.match(alone.hint, new RegExp(`${path.join("synced", "bucket", "spartan")} is incomplete, missing`));
    assert.match(alone.hint, new RegExp(`${path.join(skills, "spartan")} is usable`));
    assert.match(alone.hint, /does not follow symlinks/);
    assert.match(alone.hint, /Remove the incomplete installation/);

    const report = skillInstalled(skills, "spartan");
    assert.equal(report.installations.length, 2);
    assert.equal(report.installations.find((i) => i.symlink).usable, true);
    assert.equal(report.installations.find((i) => !i.symlink).usable, false);

    fs.rmSync(path.join(skills, "synced"), { recursive: true, force: true });
    const one = skillCheck(skills, "spartan", ["Codex", "Cursor"]);
    assert.equal(one.ok, true);
    assert.match(one.label, /skill spartan in/);
    assert.match(one.label, /Codex, Cursor/);
    assert.equal(skillPresent(skills, "spartan"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a skill directory is also found by its frontmatter name", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spartan-relay-skill-"));
  try {
    const skills = path.join(root, "skills");
    const text = SKILL.replace("name: spartan", "name: spartan-relay-cockpit");
    writeSkill(path.join(skills, "synced", "bucket", "other"), { text, files: ["references/herdr.md"] });
    const report = skillInstalled(skills, "spartan-relay-cockpit");
    assert.equal(report.installations.length, 1);
    assert.equal(report.usable, false);
    assert.deepEqual(report.installations[0].missing, ["assets/readme.md", "references/extra.md", "references/protocol.md", "references/routing.md"]);
    assert.equal(skillPresent(skills, "spartan-relay-cockpit"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
