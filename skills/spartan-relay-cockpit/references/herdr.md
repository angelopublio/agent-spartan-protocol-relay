# herdr reference for the cockpit

The commands below are herdr CLI calls the cockpit runs through its shell. Every call prints JSON; read `result`.

## Layout

One workspace per repository, with two panes the human keeps:

- `cockpit`: this session.
- `relay`: a plain shell where `spartan-relay` runs. The human also runs credential commands there.

The relay opens agent panes in the same tab, at least 60 columns wide, and never splits panes labelled `cockpit` or `relay`. The herdr plugin's actions *Spartan: open cockpit pane* and *Spartan: run relay on the active task* set this up.

## Starting the planner

```sh
P=$(herdr pane split <relay-pane> --direction right --ratio 0.6 --cwd <repo> --no-focus | jq -r .result.pane.pane_id)
herdr pane rename "$P" planner
herdr agent start sp-NNNN-owner --kind claude --pane "$P" --timeout 60000 -- --model <model> --effort <effort>
herdr agent prompt sp-NNNN-owner "/spartan Act as planner. Create spartan/tasks/NNNN-slug.md …"
```

Name it `sp-NNNN-owner`: the relay adopts that session as the task's producer.

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

Close the agent panes of a finished task (`herdr pane close <pane>`), keeping `cockpit` and `relay`. The relay closes reviewers itself and leaves producers open.
