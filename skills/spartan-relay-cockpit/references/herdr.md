# herdr reference for the cockpit

The commands below are herdr CLI calls the cockpit runs through its shell. Every call prints JSON; read `result`.

## Layout

One workspace per repository, with two panes the human keeps:

- `cockpit`: this session.
- `relay`: a plain shell where `spartan-relay` runs. The human also runs credential commands there.

`spartan-relay workspace`, run from the repository, focuses this workspace or recreates it with both panes; nothing about the workspace is stored in the repository. The relay opens agent panes in the same tab, at least 60 columns wide, and never splits panes labelled `cockpit` or `relay` while another pane fits. It labels each one `sp-<host>` and reuses a pane of that label whose agent has gone and whose shell is back at its prompt, so rounds do not add panes. Leave those panes alone: closing one only makes the next round split a new one.

## Starting the planner

The workspace keeps one `planner` pane across every task. Reuse it; split a new pane only when the workspace has none.

```sh
P=$(herdr pane list | jq -r --arg w "$HERDR_WORKSPACE_ID" \
  '.result.panes[] | select(.workspace_id == $w and .label == "planner") | .pane_id' | head -1)
if [ -z "$P" ]; then
  P=$(herdr pane split <relay-pane> --direction right --ratio 0.6 --cwd <repo> --no-focus | jq -r .result.pane.pane_id)
  herdr pane rename "$P" planner
fi
herdr agent start sp-NNNN-owner --kind claude --pane "$P" --timeout 60000 -- --model <model> --effort <effort>
herdr agent prompt sp-NNNN-owner "/spartan Act as planner. Create spartan/tasks/NNNN-slug.md ..."
```

Name it `sp-NNNN-owner`: the relay adopts that session as the task's producer.

`herdr agent start` refuses a pane that is not at its interactive shell prompt, so a reused pane needs the previous task's agent ended first:

```sh
herdr pane send-keys <planner-pane> "/exit" Enter
```

Clearing the previous agent's context is not enough. The relay adopts a producer by session name, so the pane must carry a session named for the new task, not an emptied session named for the old one. A reused pane still satisfies the fresh-execution-context rule: the session is new, only the pane is not.

## Running and watching the relay

```sh
herdr pane run <relay-pane> "cd <repo> && spartan-relay spartan/tasks/NNNN-slug.md; echo RELAYNNNN-<run>-EXIT-\$?"
herdr pane wait-output <relay-pane> --regex '(RELAYNNNN-<run>-EXIT-[0-9]+|⏸)' --source recent-unwrapped --lines 300
herdr pane read <relay-pane> --source recent-unwrapped --lines 300
```

Use a fresh sentinel each run: an old one stays in the scrollback and would match at once. Run the wait in the background so the cockpit stays responsive.

Stop a running relay with `herdr pane send-keys <relay-pane> C-c`. Rerunning the same command resumes from the task file.

## Agent state

```sh
herdr agent list
herdr agent get <name>        # agent_status: working, idle, done, blocked
herdr agent explain <name>    # which detection rule matched, and why
herdr agent wait <name> --until done --until idle --until blocked --timeout <ms>
```

herdr reads some hosts, Cursor among them, from the bottom lines of their pane, so a status can flicker. Before acting on `idle` or `done`, check it again after about 15 seconds, and trust the task file over the status.

Cursor shows a `1 task` line while it waits on a background shell, which pushes its working hint out of herdr's detection region. Install the fix once per machine with the plugin action *Spartan: install Cursor detection fix*.

## Closing a task

The relay closes each reviewer when its round is captured, and the producer's pane when the task completes; it leaves the producer open on any other end, and never closes a session you started. So a completed task usually leaves nothing to tidy: check with `herdr pane list` and close what a stopped run left behind (`herdr pane close <pane>`), keeping `cockpit`, `relay`, and the `planner` pane the next task reuses.

When the host denies `herdr pane close`, report it and reuse panes rather than letting one accumulate per task. An allow rule for that command belongs in the cockpit's own permission settings, not in a repository's task.
