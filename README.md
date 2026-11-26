# Agent Spartan Protocol Relay

Run an [Agent Spartan Protocol](https://github.com/angelopublio/agent-spartan-protocol) task across Claude Code, Codex, Cursor and Grok without carrying handoffs between them by hand. The relay reads each task's next handoff, opens the bound agent in a terminal-multiplexer pane, sends the prompt, and carries every read-only review back to the producer that records it. You watch every session and answer any of them.

The relay replaces the [Agent Spartan Protocol Bridge](https://github.com/angelopublio/agent-spartan-protocol-bridge), which is retired. A repository's `## Agent hosts` table carries over unchanged; see [Coming from the Bridge](#coming-from-the-bridge).

Supported backend: [herdr](https://herdr.dev).

## What is in this repository

| Path | What it is |
| --- | --- |
| `bin/spartan-relay.mjs` | The `spartan-relay` command. |
| `src/core/` | Protocol logic: task envelopes, `AGENTS.md` bindings, review cycles, arbitration, persistence prompts. |
| `src/adapters/herdr/` | Every herdr call: panes, agents, prompts, waits, output. |
| `adapters/herdr/` | The herdr plugin: actions to open a repository's workspace, run the relay, open a cockpit pane, and install the Cursor detection fix. |
| `skills/spartan-relay-cockpit/` | An agent skill for the cockpit: the assistant session that conducts tasks with the relay and calls you only for decisions. |
| `examples/hosts.example.json` | Optional launch flags and Spartan invocation token per host. |
| `examples/agent-profiles/` | Optional wrappers that pick a different account per repository. |

The relay is a separate tool, not something an agent calls. Spartan forbids a round from invoking another agent, so the hand that moves work between hosts sits outside every agent.

## Install

Requirements: Node.js 20 or newer, Git, [herdr](https://herdr.dev) 0.9 or newer, and the coding-agent CLIs you bind, each already signed in through its own supported flow.

```sh
npx github:angelopublio/agent-spartan-protocol-relay setup
```

Or ask your coding agent: *"Install agent-spartan-protocol-relay following https://github.com/angelopublio/agent-spartan-protocol-relay/blob/main/docs/agent-install.md"*

`setup` checks the prerequisites and installs what is missing, asking before each step: the `spartan-relay` command, the [Agent Spartan Protocol](https://github.com/angelopublio/agent-spartan-protocol) skill, the herdr plugin, the cockpit skill, and, if you use Cursor, its detection fix. It never replaces something already installed. It ends with `spartan-relay doctor`, which you can run any time to see what is ready and what is missing.

### Manual installation

```sh
npm install -g github:angelopublio/agent-spartan-protocol-relay
npx skills add angelopublio/agent-spartan-protocol --skill spartan -g
herdr plugin install angelopublio/agent-spartan-protocol-relay/adapters/herdr
npx skills add angelopublio/agent-spartan-protocol-relay --skill spartan-relay-cockpit -g
spartan-relay doctor
```

If you bind Cursor, run the plugin action **Spartan: install Cursor detection fix** once per machine (see [Agent state detection](#agent-state-detection)). With nvm or another Node version manager, the command belongs to the Node version that installed it; reinstall after switching versions.

If different repositories sign in with different accounts, see the optional [account wrappers](examples/agent-profiles/README.md); the relay works with them and does not need them.

## Set up a repository

1. Add `.spartan-relay/` to `.gitignore`. Review captures and the optional repository-local `hosts.json` live there.

2. Add an `## Agent hosts` table to `AGENTS.md`. The relay reads the host, model and effort for each role from it.

   ```markdown
   ## Agent hosts

   | Binding | Host | Client context | Model | Effort |
   | --- | --- | --- | --- | --- |
   | planner | Claude Code | personal | claude-opus-5 | high |
   | reviewer.plan | Codex | personal | gpt-6.1-terra | medium |
   | implementer | Cursor | personal | cursor-grok-4.6-high-fast | none |
   | reviewer.implementation | Codex | personal | gpt-6.1-terra | high |
   | arbiter.plan | Cursor | personal | cursor-grok-4.6-high-fast | none |
   | arbiter.implementation | Claude Code | personal | claude-opus-5 | high |
   ```

   - `Binding` is one of `planner`, `reviewer.plan`, `implementer`, `reviewer.implementation`, `arbiter.plan`, `arbiter.implementation`.
   - `Host` is `Claude Code`, `Codex`, `Cursor` or `Grok`.
   - `Client context` is an account alias for wrappers that choose an account per repository. The relay does not read it.
   - `Model` is the identifier the CLI accepts. `Effort` is `low`, `medium`, `high`, `max` or `none`.

   A role without a row follows the handoff's `- Host:` line and the CLI's default model. When the table and the handoff name different hosts, the table wins and the relay says so.

3. Grant the relay its authority in `AGENTS.md`, in your own words: which runs a human starts, how many review cycles a phase may take, that reviews run in fresh read-only sessions, and that commit, push and merge stay with the human.

Model and effort become each CLI's own flags:

| Host | Arguments |
| --- | --- |
| Claude Code | `--model <model> --effort <effort>` |
| Codex | `-c model="<model>" -c model_reasoning_effort="<effort>"`, with `max` sent as `xhigh` |
| Cursor | `--model <model>[effort=<effort>]`, or the model alone when its name already ends in an effort |
| Grok | `-m <model> --reasoning-effort <effort>` |

Effort `none` sends no effort argument.

## Run a task

1. Start herdr and open the repository's workspace:

   ```sh
   cd <repository> && spartan-relay workspace
   ```

   It focuses the repository's workspace when one exists, and otherwise creates it, named after the folder (or `--label <name>`), with a `cockpit` pane above a `relay` pane. Nothing is stored in the repository: everything the work needs is in `AGENTS.md` and `spartan/tasks/`, so a closed workspace, a new machine, or a cleared herdr session is one command away. herdr also restores its workspaces when it restarts. The plugin action **Spartan: open workspace for this repository** does the same from any pane.
2. Start the planner with the model and effort its row binds, and run the first Spartan round, for example `/spartan <request>` in Claude Code. The round writes the task file and its first handoff.
3. In the `relay` pane, from the repository root:

   ```sh
   spartan-relay spartan/tasks/NNNN-slug.md --dry-run   # first time: prints the next round
   spartan-relay spartan/tasks/NNNN-slug.md
   ```

   Or use the plugin action **Spartan: run relay on the active task**, which refuses when the repository has no active task or more than one.

The relay then works on its own:

- It adopts your planner session as the producer and never closes it.
- Every review runs in a fresh read-only session with the bound model. The relay captures the verdict, closes the session, and hands the result to the producer, which records it in the task file.
- A writable round reuses the producer only for the same host, role and model; otherwise the relay opens a new session.
- A phase may take up to three review cycles (`--max-cycles`). When the last one still asks for changes and `AGENTS.md` binds an arbiter for the phase, the arbiter rules once in a fresh read-only session: `APPROVED` advances the phase, `CHANGES_REQUESTED` names one change the producer applies without another review, `BLOCKED` stops for you. Without an arbiter, the run stops at the limit.
- When an agent stops for an approval or a question, herdr notifies you. Answer in that pane and the relay continues.

When the task completes, review the diff and commit it yourself.

### With a cockpit

The `spartan-relay-cockpit` skill turns an agent session in the `cockpit` pane into your assistant for the whole task: it starts the planner, runs and watches the relay, verifies what the agents deliver, and calls you only for a blocked task, a step only you can take, or a decision. Ask it, for example: *"use spartan-relay-cockpit to take task 0005 to completion"*. One cockpit serves one workspace and one account context.

## Panes

Every agent the relay starts opens in the relay's own tab, so one view shows them all. The relay splits the widest pane, preferring panes not labelled `cockpit` or `relay`: side by side when both halves keep at least 60 columns, one above the other otherwise. Only when no pane qualifies does the agent open in a tab of its own, named `sp-NNNN`.

## Agent state detection

The relay waits on herdr's reading of each agent's state. herdr reads some hosts, Cursor among them, from the bottom lines of their pane, so the relay guards against misreadings:

- Agent panes stay at least 60 columns wide, so a host's footer does not wrap over the lines herdr reads.
- After herdr reports a stalled prompt, the relay checks whether the prompt is still sitting unsent in the agent's input box, as Cursor's collapsed `[Pasted text …]` placeholder can be, and presses Enter once. It then waits up to 120 seconds for the agent to start before stopping. It never sends a prompt twice.
- A round counts as finished only when the agent stays idle for 10 seconds, so a brief idle reading while the host redraws does not end it.
- The task file, not the multiplexer's status, decides whether a round advanced.

While Cursor waits on a background shell, it shows a `1 task` line under its input box that pushes its working hint out of the six lines herdr's Cursor manifest reads. `adapters/herdr/agent-detection/cursor.toml` is that manifest with wider regions; the plugin action installs it as a local override. A local override shadows herdr's remote manifest updates, so remove it (`~/.config/herdr/agent-detection/cursor.toml`) once herdr ships a Cursor manifest that handles the line.

## When the relay stops

The relay stops whenever a human decision is needed and leaves every pane open. Running the same command again continues from the task file.

| Message | What to do |
| --- | --- |
| `task completed` | Review the diff and commit. |
| `task is blocked` / `next role is human-operator` | Read the task file's blockers and next action, and decide. |
| `handoff identifiers disagree` / `roles disagree` / `not a Spartan handoff identifier` | The last round wrote an inconsistent envelope, or an identifier outside the protocol's `HX-NNN` format. Ask that host to regenerate the whole `## Next Handoff`. |
| `no SPARTAN-VERDICT line found` | Read the reviewer's pane. Rerun if it simply forgot the final line. |
| `the read-only reviewer changed the working tree` | Check `git status`, undo anything the reviewer wrote, then rerun. |
| `still the outstanding handoff` / `did not adopt` | The producer finished without advancing the task, or is still working. Read its pane; rerun once it settles. |
| `review limit (3) reached` | The reviews keep asking for changes and no arbiter is bound. Read the findings and decide. |
| `never started working on the prompt` | Check the agent's pane. If it is idle, the invocation token is wrong for that host: set `token` in `hosts.json`. |
| `did not finish within N min` | Look at the pane. Raise `--producer-timeout-min` or `--review-timeout-min` if the round was just long. |
| `the outstanding handoff is a review … pass --producer` | More than one agent could be the producer. Name it with `--producer <agent-name-or-pane-id>`. |

## `hosts.json`

`hosts.json` is optional. Without it, the relay uses these defaults:

| Host | herdr kind | Invocation | Producer flags | Reviewer flags |
| --- | --- | --- | --- | --- |
| Claude Code | `claude` | `/spartan` | `--permission-mode acceptEdits` | `--permission-mode dontAsk`, only `Read`, `Grep`, `Glob` and read-only `git` allowed, editing and web tools disallowed |
| Codex | `codex` | `$spartan` | `--sandbox workspace-write --ask-for-approval on-request` | `--sandbox read-only --ask-for-approval never` |
| Cursor | `cursor` | `/spartan` | `--sandbox enabled` | `--mode plan --sandbox enabled` |
| Grok | `grok` | `/spartan` | none | `--sandbox strict` |

Create `~/.config/spartan-relay/hosts.json` (all repositories) or `<repository>/.spartan-relay/hosts.json` (that repository only; it wins) to change launch flags or the invocation token. See `examples/hosts.example.json`. Each field you set replaces that host's default field, so a reviewer override must keep its read-only flags. Model and effort belong in `AGENTS.md`. Credentials belong nowhere in these files.

## Guarantees and limits

- The relay never edits a task file, never decides a verdict, and stops at every ambiguity.
- Reviewers are read-only through each CLI's own flags plus a before-and-after fingerprint of the working tree; a change stops the run.
- The verdict is read from the reviewer's terminal output (`SPARTAN-VERDICT: …` on the last line), not forced through a schema.
- Producer writes are not confined to a declared scope. Review the diff before you commit.
- There is no event log. The task file and the panes are the record; review output is kept under `.spartan-relay/`.

## Coming from the Bridge

The relay reads the same `## Agent hosts` table, including `arbiter.*` rows, so bindings need no change. In each repository:

1. Replace the `.spartan-bridge/` line in `.gitignore` with `.spartan-relay/`.
2. In `AGENTS.md`, replace the Bridge's automation-authority section with the relay authority you grant (see [Set up a repository](#set-up-a-repository)), and delete `spartan-bridge/config.yaml`.
3. Run `spartan-relay doctor` from the repository.

On each machine, run `spartan-relay setup`, then remove the Bridge runtime and its `spbridge` skill if you installed them.

## Development

```sh
npm test
```

The tests cover the protocol logic and pane placement without a multiplexer. Run `--dry-run` against a real task before a change that touches the adapter.

## License

MIT
