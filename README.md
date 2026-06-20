# pi-diet

> One of my diet context engineering and workflow extensions. Add pi-diet-LSP, pi-diet-Ripgrep, pi-repo-move and others from [npm](https://www.npmjs.com/~probabilityengineer).

Compact oversized Pi tool results with transparent previews and spill files.

`pi-diet` keeps Pi sessions lean by filtering runaway tool outputs before they bloat model context and session JSONL files. Small results pass through unchanged. Large results are saved losslessly under `~/.pi/agent/pi-diet/spills/` and replaced with a compact preview, tail, omitted-size count, and spill path.

## Install

From npm:

```bash
pi install npm:pi-diet
```

From GitHub:

```bash
pi install git:github.com/ProbabilityEngineer/pi-diet
```

For local development without installing:

```bash
pi -e ./index.ts
```

## Status

Early MVP, but validated against a real Pi session for oversized bash output.

## Behavior

- pass through small tool results unchanged
- compact oversized tool results automatically via the Pi `tool_result` hook
- spill full original output to disk before replacing model-visible content
- preserve transparent access to the full output via a spill-file path
- provide specialized previews for bash, read-image, noisy LSP JSON, and generic search-style output

## Default thresholds

- `thresholdChars`: 64000
- `headChars`: 8000
- `tailChars`: 8000

## Commands

- `/diet` toggles on/off
- `/diet status`
- `/diet on`
- `/diet off`

## Example

Ask Pi to run a command with very large output. Instead of storing the whole result in model context, `pi-diet` will replace it with a compact marker and a spill path like:

```text
[pi-diet: compacted oversized bash result]
Original size: 102955 chars
Full output: ~/.pi/agent/pi-diet/spills/...
```

## Rescue script

Rescue a single session file:

```bash
node scripts/rescue-session.mjs ~/.pi/agent/sessions/.../session.jsonl --out /tmp/pi-diet-rescue
```

Rescue every session file under a directory:

```bash
node scripts/rescue-session.mjs ~/.pi/agent/sessions/some-project --out /tmp/pi-diet-rescue
```

## Development

```bash
npm test
```

## Safety

`pi-diet` does not silently discard oversized tool results. It writes the full original result to a spill file first, then replaces the model-visible content with a compact preview.
