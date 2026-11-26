# Account wrappers (optional)

Use these when different repositories must sign in to the coding agents with different accounts, for example a personal account and a company account on one Mac. The relay works without them.

The wrappers sit first on `PATH` as `claude`, `codex`, `cursor`, `cursor-agent` and `agent`. Each run resolves an account alias for the current directory and starts the real client with that alias's own configuration folder under `~/.agent-profiles/<alias>/`:

1. the single `Client context` value in the nearest `AGENTS.md` `## Agent hosts` table;
2. otherwise the longest matching prefix in `~/.agent-profiles/roots` (see `roots.example`);
3. otherwise `personal`.

## Install

```sh
examples/agent-profiles/install-agent-profiles
```

Then put the wrappers ahead of the real clients in both `~/.zprofile` and `~/.zshrc`:

```sh
export PATH="$HOME/.agent-profiles/bin:$PATH"
```

Sign in once per alias from a repository of that alias: `/login` inside `claude`, `codex login`, `cursor-agent login`. Start each client once per alias so it mirrors the skills in `~/.claude/skills` and `~/.agents/skills`.

Start herdr from a plain terminal, so the herdr server does not inherit one alias's variables.

## Rules

- Never commit `~/.agent-profiles`, and never copy `auth.json` or other login files between aliases or machines.
- The installer copies only the resolver and the wrapper. It never touches credential stores.
- Grok is not wrapped. Do not install a wrapper under the name `agent` for anything but Cursor Agent CLI.
