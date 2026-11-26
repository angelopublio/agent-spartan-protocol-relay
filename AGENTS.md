# Repository Instructions

Agent Spartan Protocol Relay moves Agent Spartan Protocol handoffs between coding agents running in a terminal multiplexer. It is a runtime that sits outside every agent; the protocol itself lives in [agent-spartan-protocol](https://github.com/angelopublio/agent-spartan-protocol).

## Layout

- `src/core/` holds protocol logic and must not call a multiplexer.
- `src/adapters/<backend>/` holds every call to one multiplexer. herdr is the only backend. Extract a shared adapter interface only when a second backend exists.
- `adapters/<backend>/` holds that backend's plugin or integration files.
- `skills/spartan-relay-cockpit/` is one skill for every backend; backend specifics go in `references/<backend>.md`.

## Rules

- Write in English: code, comments, documentation, commit messages, and log output.
- Node.js 20 or newer, ES modules, no runtime dependencies.
- Run `npm test` before every commit. Add or update a test for any change to `src/core/` or to pane placement.
- The relay never writes a task file, never decides a verdict, and stops on ambiguity. Keep it that way.
- Never add credential handling: no token, cookie, auth file, keychain, or account identifier in code, configuration, fixtures, tests, or logs.
- Keep examples generic. No real client, company, person, or private path in code, docs, or tests.
- Document behaviour as it is. The README describes features, not the history of how they changed.

## Releases

release-please opens a release pull request from Conventional Commit messages on `main`. Merging it tags the release and updates `CHANGELOG.md`, `package.json`, and the plugin manifest version.
