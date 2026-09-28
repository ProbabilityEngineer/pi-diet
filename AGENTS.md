# Agent Instructions

## Project

- `pi-diet` is a TypeScript Pi extension that compacts oversized tool results using transparent previews and lossless spill files.
- Preserve transparent-preview behavior, lossless spill-file recovery, and compact model-visible output.
- The extension entry point is `index.ts`.

## Validation and release

- Run `npm test` after implementation changes.
- Publication is tag-triggered: publish a tested version by pushing a matching `v*` tag only after `main` is pushed.

## Version control

- Use normal Git workflows. Inspect `git status` and the diff before committing or pushing.
