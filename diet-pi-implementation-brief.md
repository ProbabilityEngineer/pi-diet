# diet-pi implementation brief

## Goal

Build `diet-pi`, a Pi extension that prevents runaway tool outputs from bloating model context and session JSONL files.

Core promise:

```text
Prevent oversized tool results from bloating Pi context by replacing them with compact previews and lossless spill-file references.
```

This should be a context pressure valve, not a perfect summarizer. The robust design is:

```text
lossy preview + lossless spill
```

If a result is small, pass it through unchanged. If it is too large, save the full result to disk and show the agent a transparent compact preview with the spill path.

## Why this is needed

We found a real session-bloat issue while working on Pi extensions.

In a session under:

```text
~/.pi/agent/sessions/--Users-sam-git-agents-pi-move--/
```

some tool results were huge. The original suspected source was LSP output containing repeated structures like:

```json
{
  "uri": "file:///Users/sam/git/agents/pi-move/index.ts",
  "range": {
    "start": { "line": 246, "character": 72 },
    "end": { "line": 246, "character": 78 }
  }
}
```

Programmatic inspection found the culprit tool results:

```text
lsp_symbols
lsp_references
```

The `lsp_symbols` and `lsp_references` tools returned raw LSP JSON with many `file:///...`, `range`, `line`, and `character` entries.

We patched `pi-lsp-lite` to compact those outputs, but then discovered the rescued sessions were still ~19–20 MB because other large outputs remained.

Largest remaining session entries included:

- `read` image results around 600 KB–1 MB each
- large `bash` outputs around 90–105 KB
- large documentation/session reads around 100 KB
- large AST/search outputs around 50 KB

Conclusion: fixing one tool at a time helps, but a general result-filtering layer is useful.

## Name

Preferred package/repo name:

```text
diet-pi
```

Possible npm description:

```text
Compact oversized Pi tool results with transparent previews and spill files.
```

Possible README intro:

```md
`diet-pi` keeps Pi sessions lean by compacting oversized tool results before they bloat model context and session files. Small results pass through unchanged. Large results are saved losslessly to disk and replaced with a transparent preview, tail, omitted-size count, and spill-file path so agents can inspect the full output when needed.
```

## Repository

Suggested repo path:

```text
/Users/sam/git/agents/diet-pi
```

Use jj for local VCS.

Desired final state after work:

```text
@ empty
@- completed change
main/main@origin on @-
Git HEAD attached to main
git status --short --branch clean
```

## User preferences relevant to implementation

- Prefer compact action-enum tools over many separate tools.
- Prefer low prompt overhead.
- Prefer explicit and transparent behavior.
- Do not silently discard important info.
- Preserve access to full original data via spill files.
- Avoid automatic noisy prompt injection.
- Use positive guidance phrased as desired behavior.
- Use code-intelligence tools first where appropriate.
- Use jj for local VCS; Git only for remote interoperability.

## Key design principle

Do not try to perfectly decide what matters. That will always be heuristic.

Instead:

1. Preserve full original output losslessly in a spill file.
2. Replace oversized result content with a compact preview.
3. Tell the agent exactly what was omitted and where to read the full output.

Example replacement text:

```text
[diet-pi: compacted oversized bash result]
Original size: 931,718 chars
Preview: first 8,000 chars + last 8,000 chars shown
Full output: /Users/sam/.pi/agent/diet-pi/spills/2026-06-01T20-31-00Z-bash-call_abc123.txt

--- head ---
...

--- tail ---
...
```

## Desired behavior

### Pass-through

If total textual result content is below threshold, leave it unchanged.

Default threshold:

```text
64 KB / 64,000 chars
```

### Spill and compact

If over threshold:

- save full result to:

```text
~/.pi/agent/diet-pi/spills/<timestamp>-<toolName>-<toolCallId>.txt
```

- replace tool result with:
  - tool name
  - original size
  - omitted count
  - spill path
  - head preview
  - tail preview

Suggested defaults:

```text
threshold: 64_000 chars
head: 8_000 chars
tail: 8_000 chars
```

### Special compaction strategies

The generic head/tail strategy is enough for v1, but special recognizers improve usefulness.

#### LSP URI/range JSON

Detect output containing repeated:

```text
"uri": "file://
"range"
"line"
"character"
```

For these, show:

- approximate number of locations/symbols if easy to count
- first N compact locations if easy
- spill path

Do not preserve megabytes of raw JSON in context.

#### Image read results

Large `read` image tool results can be huge. If content starts with or contains something like:

```text
Read image file [image/png]
[Image: original ...]
```

keep:

- file path if present
- image type
- dimensions/metadata text
- any human-visible short description already present
- spill path

Strip embedded/bulky image payload if present.

#### Bash outputs

For huge bash outputs:

- preserve exit/error status if present
- show first lines and last lines
- tail is especially important because errors often appear at the end
- spill full output

#### Search/AST outputs

For huge search outputs:

- show first N matches or head/tail
- recommend refining query
- spill full output

## Pi extension implementation questions

Before coding, read Pi docs and examples:

```text
/Users/sam/.nvm/versions/node/v25.9.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
/Users/sam/.nvm/versions/node/v25.9.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/
```

Specifically verify whether Pi extension event handlers can modify tool results.

Look for `tool_result` interception behavior. Current known extensions use events like:

```ts
pi.on("tool_result", async (event, ctx) => { ... })
```

Need to determine whether returning a modified result from that event changes what the model/session receives. If `tool_result` is notification-only, investigate:

- tool-call interception hooks
- custom rendering hooks
- session append interception hooks
- wrapping built-in tools may not be desirable, but can be considered if no result filter hook exists

## API surface

Keep command/tool surface compact.

Suggested slash command:

```text
/result-diet-status
```

or one command:

```text
/diet-pi status
/diet-pi on
/diet-pi off
```

Suggested model-visible tool only if useful:

```text
result_diet action: status/rescue
```

But do not add model tools unless needed. The main behavior should be automatic filtering once installed.

## Configuration

Config file candidates:

```text
~/.pi/agent/diet-pi/config.json
.pi/diet-pi.json
```

Defaults:

```json
{
  "enabled": true,
  "thresholdChars": 64000,
  "headChars": 8000,
  "tailChars": 8000,
  "spillDir": "~/.pi/agent/diet-pi/spills",
  "tools": {
    "read": { "enabled": true },
    "bash": { "enabled": true },
    "lsp_symbols": { "enabled": true },
    "lsp_references": { "enabled": true },
    "ast_grep_search": { "enabled": true }
  }
}
```

For v1, hardcoded defaults are acceptable if configuration adds too much complexity.

## Existing rescue script prototype

A prototype sanitizer was written at:

```text
/Users/sam/git/agents/pi-lsp-lite/scripts/strip-noisy-session-results.mjs
```

It currently:

- reads `.jsonl` session files line-by-line
- strips huge/noisy LSP tool results from:
  - `lsp_symbols`
  - `lsp_references`
  - `lsp_definition`
- replaces them with compact placeholders
- preserves message IDs, timestamps, parent links, tool names
- writes rescued copies by default

Example run:

```bash
node /Users/sam/git/agents/pi-lsp-lite/scripts/strip-noisy-session-results.mjs \
  /Users/sam/.pi/agent/sessions/--Users-sam-git-agents-pi-move-- \
  --out /tmp/pi-session-rescue \
  --max-chars 64000
```

Results from one run:

```text
file 1: stripped 3 lsp_symbols results, removed 362,126 chars
file 2: stripped 4 lsp_symbols + 1 lsp_references, removed 1,565,006 chars
parseErrors: 0
```

The script can be adapted into `diet-pi` as:

```text
scripts/rescue-session.mjs
```

or exposed via a tool/command later.

## Important limitation discovered

Even after stripping LSP bloat, rescued files remained large because of image reads and other large tool results.

Programmatic inspection of rescued files showed top remaining huge entries:

```text
read image file [image/png] entries around 619 KB–1.03 MB
bash outputs around 90–105 KB
read docs/session outputs around 100 KB
ast_grep_search output around 51 KB
```

So v1 should not only strip LSP. It should have a generic oversized-result threshold.

## Safety considerations

- Never silently discard data.
- Always write full content to a spill file first.
- Make replacement text explicit.
- Include spill path in model-visible output.
- Preserve error status and tool identity.
- Avoid storing secrets in extra places if possible; however, if the original session would contain the secret, spilling does not create a new class of exposure but does create another copy. Consider warning in README.
- Spill directory should be under user-controlled Pi agent data.

## Validation plan

1. Unit-test compaction functions with synthetic results:
   - small result passes unchanged
   - large text spills and compacts
   - LSP JSON recognized
   - image read recognized
   - bash output head/tail preserved

2. Manual test with a local fake extension event if possible.

3. If event modification works:
   - run Pi with `diet-pi`
   - trigger a large bash result
   - verify agent sees compact result and spill path
   - verify session JSONL stores compact result, not full huge output

4. Test rescue script on copies of real session files:
   - never mutate canonical session files by default
   - output `*.rescued.jsonl`
   - report stripped counts and bytes

## Possible README positioning

```md
# diet-pi

Compact oversized Pi tool results with transparent previews and spill files.

`diet-pi` keeps Pi sessions lean by filtering runaway tool outputs before they bloat model context and session JSONL files. Small results pass through unchanged. Large results are saved losslessly under `~/.pi/agent/diet-pi/spills/` and replaced with a compact preview, tail, omitted-size count, and spill path.

It is intentionally not a magic summarizer. It preserves access to full output while keeping routine context small.
```

## Related packages/context

- `pi-jj-git-align` has been published and used as the reference publishing workflow.
- `pi-lsp-lite` was patched to compact `lsp_symbols`/`lsp_references`, but `diet-pi` should solve the broader class of large tool results.
- User is considering publishing multiple Pi extensions and values low prompt overhead as a differentiator.

## Publishing workflow reminder

For npm/Pi packages:

- include `pi-package` keyword
- include `pi` manifest:

```json
{
  "pi": { "extensions": ["./index.ts"] }
}
```

- initial publish may need manual passkey:

```bash
npm publish --access public --auth-type=web
```

- trusted publishing setup requires current npm and allowed action:

```bash
npm trust github <pkg> \
  --repo ProbabilityEngineer/<repo> \
  --file publish.yml \
  --allow-publish \
  --yes
```

- verify trusted publishing with a patch tag and look for provenance output.

Saved memory exists for this npm trusted-publishing lesson.
