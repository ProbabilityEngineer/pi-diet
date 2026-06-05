# pi-diet hook research and design decisions

## Research summary

Pi's extension API supports exactly the interception point `pi-diet` needs.

The `tool_result` event is fired after tool execution finishes and before `tool_execution_end` and final tool-result message events are emitted. The documentation explicitly says it **can modify result**. Handlers chain in extension load order, and each handler sees the current result after earlier handlers have patched it. A handler may return partial patches:

```ts
return { content, details, isError };
```

Omitted fields keep their current values.

The TypeScript declarations confirm this API shape:

```ts
export interface ToolResultEventResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
}

on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;
```

Relevant docs/examples reviewed:

- `docs/extensions.md`
  - lifecycle overview shows `tool_result (can modify)` before final tool result messages
  - Tool Events / `tool_result` documents middleware-style result patching
  - Output Truncation section recommends truncation plus full-output temp files
  - Overriding Built-in Tools is available, but not needed for v1
- `examples/extensions/README.md`
- `examples/extensions/truncated-tool.ts`
- `examples/extensions/tool-override.ts`
- `examples/extensions/built-in-tool-renderer.ts`
- generated declarations at `dist/core/extensions/types.d.ts`

## Decision: use `tool_result` as the primary interception hook

`pi-diet` v1 should register one low-overhead `tool_result` handler and avoid overriding built-in tools.

Rationale:

1. The hook is explicitly before final tool-result message emission, so patched content should be what reaches both the model context and session JSONL.
2. It handles built-in, extension, and SDK tools uniformly.
3. It avoids replacing built-in tool implementations or preserving exact tool-specific details shapes.
4. Middleware chaining lets pi-diet coexist with other extensions; it should patch only oversized results and pass through otherwise.

## Result handling design

For every `tool_result` event:

1. If disabled, pass through.
2. Convert model-visible content to a textual representation for size checking.
   - Text content: use `text` directly.
   - Image content: treat embedded/base64 data as oversized; preserve media type/metadata in preview when possible.
   - Mixed content: compact only when total serialized/model-visible content exceeds threshold.
3. If below `thresholdChars`, return nothing.
4. If above threshold:
   - write the full original result content/details needed for rescue to a spill file first;
   - return patched `content` with transparent compact text;
   - preserve `isError` unchanged unless a future explicit policy says otherwise;
   - add non-invasive metadata under `details.dietPi` when details are object-like, otherwise replace details with `{ originalDetailsType, dietPi }` only if needed.

Default replacement text should include:

- `[pi-diet: compacted oversized <toolName> result]`
- tool name and tool call id
- original size
- preview policy (`headChars`, `tailChars`)
- omitted character count
- spill path
- head preview
- tail preview

Spill path default:

```text
~/.pi/agent/pi-diet/spills/<timestamp>-<toolName>-<toolCallId>.txt
```

Use `getAgentDir()` from Pi if available, so the effective root follows Pi's agent-data location, with fallback to `~/.pi/agent`.

## Specialized recognizers

Specialized recognizers should be pure functions layered behind the same generic spill-first contract:

- LSP URI/range JSON: detect repeated `"uri":"file://`, `"range"`, `"line"`, `"character"`; show counts and first compact locations when cheap.
- Image read results: avoid emitting bulky image payload; show path/media type/dimensions or available metadata and spill path.
- Bash output: preserve status/error details and show head plus tail, with tail emphasized because failures often appear there.
- Search/AST output: show first matches or generic head/tail and recommend narrowing the query.

No recognizer should silently discard the full original data; every oversized result spills first.

## Commands/tools decision

For v1, expose a compact slash command, not a model-visible tool:

```text
/diet-pi status
/diet-pi on
/diet-pi off
```

Reasoning: the main behavior should be automatic and low-prompt-overhead. A model-visible `result_diet` tool can be added later for rescue/status if there is a concrete need.

Runtime on/off can be in memory for v1. Persistent config can follow later if needed.

## Fallback if `tool_result` behavior changes

If manual testing shows patched `tool_result` content does not reach session/model despite docs and types, fallback order is:

1. `message_end` for `role === "toolResult"`, replacing the finalized message while keeping role unchanged.
2. `context` hook as a last-resort context-only filter for historical oversized messages.
3. Built-in tool overrides only for specific tools if result-message/session interception is insufficient.

The fallback should not be implemented until a failing manual test proves it is needed.

## Validation decision

Add a minimal manual verification extension/test fixture that returns a known oversized tool result and confirms:

1. the agent-visible result contains the pi-diet compact marker and spill path;
2. the session JSONL stores the compact result, not the full oversized payload;
3. the spill file contains the full original output.
