# Security Policy

## Supported versions

Agent Spartan Protocol Relay is experimental, currently version 0.1.0. There is no long-term support commitment yet. Report issues against the current default branch and include the affected commit or version.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/angelopublio/agent-spartan-protocol-relay/security/advisories/new). Do not include credentials, auth files, private prompts, private repository content, or live exploit data in a public issue.

Please include, when safe: the affected version or commit, the affected component (core, herdr adapter, plugin action, or skill), a concise impact description, redacted reproduction steps, and whether credentials, working-tree writes, or cross-repository data are involved.

## What the relay does and does not touch

- It never authenticates a user or provider and never invokes login, logout, or account selection. Each coding-agent CLI owns its own sign-in.
- It reads no credential store and passes no credential to an agent. `hosts.json` holds launch flags and an invocation token such as `/spartan`, never a secret.
- It starts reviewers with each CLI's read-only flags and stops the run if the working tree changes during a review.
- It never writes the task file; producer sessions do, under the Spartan protocol.
- The herdr plugin actions run local commands with your user's permissions, like any herdr plugin. herdr does not review or sandbox plugin code; read the actions in `adapters/herdr/actions/` before installing.

## Sensitive data

Never submit real API keys, tokens, cookies, auth files, keychain records, or account identifiers. Replace them with obvious placeholders and remove private filesystem paths from diagnostics.
