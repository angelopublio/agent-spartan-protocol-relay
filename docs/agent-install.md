# Installing agent-spartan-protocol-relay (for coding agents)

You are a coding agent asked to install Agent Spartan Protocol Relay for your user. Follow these steps in order. Ask your user before any step that installs software, and stop to ask if anything here does not match what you find.

## 1. Check the prerequisites

Run these and report what you find:

```sh
node --version        # 20 or newer
git --version
herdr --version       # 0.9.0 or newer
command -v claude codex cursor-agent grok
```

If Node.js, Git or herdr is missing or too old, stop and tell your user what to install: Node.js from https://nodejs.org or their version manager, herdr from https://herdr.dev. At least one agent CLI must be present. Never sign in to an agent CLI for the user and never read credential files.

## 2. Run setup

```sh
npx github:angelopublio/agent-spartan-protocol-relay setup
```

`setup` asks before each step. Relay each question to your user and answer only with their consent. If you cannot answer prompts interactively, show your user the plan below and, once they approve, run `setup --yes`.

What setup installs when it is missing, and never replaces when present:

1. the `spartan-relay` command, with `npm install -g`;
2. the `spartan` skill of the Agent Spartan Protocol, for the agents found;
3. the `spartan-relay` herdr plugin (herdr previews what it installs);
4. the `spartan-relay-cockpit` skill;
5. the Cursor detection fix, a local herdr manifest, only when Cursor is present.

## 3. Verify

```sh
spartan-relay doctor
```

Report every line marked `✖` with its suggested fix. A skill line fails when `SKILL.md` is missing, when a file it references beside itself is missing, or when the same skill is installed more than once under that host's skill folder. Run `doctor` from inside a repository to also check that repository's `AGENTS.md` bindings and `.gitignore`.

## 4. Prepare a repository, if your user asks

Follow "Set up a repository" in the README: add `.spartan-relay/` to `.gitignore`, add the `## Agent hosts` table to `AGENTS.md` with your user's choice of host, model and effort per role, and state the relay's authority in their words. Do not choose models for them.

## 5. Tell your user how to start

Explain the README's "Run a task" section: a herdr workspace per repository with a `cockpit` pane and a `relay` pane, a planner round that writes the first handoff, then `spartan-relay <task>` in the `relay` pane, or the cockpit skill to conduct it.
