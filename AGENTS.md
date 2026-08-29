# Agent Instructions

Derived from `/Users/sam/git/agents/agents-source-of-truth/AGENTS.md`. Keep this file compact; shared guidance belongs in that source of truth unless pi-diet needs a local override.

## Discovery and edits

- Start with the most specific code-intelligence tool: AST/LSP for syntax-shaped work, Semble for behavior or intent, then ripgrep for exact verification.
- Use diagnostics before broad builds when available.
- Prefer ast-grep for simple structural edits and precise text edits for complex multi-line changes.
- Use explicit repo-relative paths and non-interactive shell commands. Ask before deleting files or directories.

## Tickets and provenance

- Use tk tickets for non-trivial feature/fix work; avoid ticket overhead for tiny direct tasks.
- For meaningful repository work, record turnlog provenance; initialize turnlog rather than abandoning a record when it is missing.
- Keep `.turnlog/` out of GitHub unless this repository explicitly opts into tracking it.

## VCS

- Use jj for local content changes; do not use Git staged-index workflows.
- Treat a dirty working copy as pre-existing user work unless explicitly asked to continue it.
- Before publishing, verify `@` is empty, `@-` is the completed change, `main`, `main@git`, and `main@origin` point to `@-`, and Git HEAD is attached to `main`.
- If `jj new --no-edit` leaves `@` on the completed change, switch to the empty child before moving `main`.
- Prefer `/jj-align-push [branch]` for publishing after the working copy is empty.

## pi-diet

- Validate code changes with `npm test`.
- Package publication is tag-triggered: publish a tested version by pushing a matching `v*` tag only after `main` is pushed.
- Preserve pi-diet's transparent-preview and lossless spill-file behavior when changing tool-result compaction.
