import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeToolResult,
  buildCompactedText,
  compactToolResult,
  extractSearchSummary,
  looksLikeLspJson,
  type DietPiSettings,
} from "../src/diet.ts";

const execFileAsync = promisify(execFile);

async function settings(): Promise<DietPiSettings> {
  const spillDir = await mkdtemp(join(tmpdir(), "pi-diet-test-"));
  return {
    enabled: true,
    thresholdChars: 100,
    headChars: 20,
    tailChars: 20,
    spillDir,
  };
}

test("small result passes unchanged", async () => {
  const patch = await compactToolResult({
    toolName: "bash",
    toolCallId: "abc",
    input: {},
    content: [{ type: "text", text: "short" }],
    details: undefined,
    isError: false,
    settings: await settings(),
  });
  assert.equal(patch, null);
});

test("large text spills and compacts", async () => {
  const cfg = await settings();
  const patch = await compactToolResult({
    toolName: "bash",
    toolCallId: "abc",
    input: { command: "yes" },
    content: [{ type: "text", text: "x".repeat(250) }],
    details: { code: 0 },
    isError: false,
    settings: cfg,
  });
  assert.ok(patch);
  const text = patch.content[0]?.text ?? "";
  assert.match(text, /pi-diet: compacted oversized bash result/);
  assert.match(text, /Full output:/);
  const spillPath = String((patch.details as any).dietPi.spillPath);
  const spill = await readFile(spillPath, "utf8");
  assert.match(spill, /"command": "yes"/);
});

test("LSP JSON recognized", () => {
  const text = JSON.stringify([
    { uri: "file:///tmp/a.ts", range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } } },
    { uri: "file:///tmp/b.ts", range: { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } } },
    { uri: "file:///tmp/c.ts", range: { start: { line: 3, character: 6 }, end: { line: 3, character: 7 } } }
  ]);
  assert.equal(looksLikeLspJson(text), true);
  const analyzed = analyzeToolResult("lsp_references", [{ type: "text", text }], undefined);
  assert.equal(analyzed.kind, "lsp-json");
  assert.match(analyzed.previewText ?? "", /compact LSP preview/);
  assert.match((analyzed.metadataLines || []).join("\n"), /Approx locations\/symbols: 3/);
});

test("image read recognized", () => {
  const analyzed = analyzeToolResult("read", [{ type: "image", source: { mediaType: "image/png", data: "a".repeat(300) } }, { type: "text", text: "Read image file [image/png]\nOriginal dimensions: 1024x768" }], undefined);
  assert.equal(analyzed.kind, "image-read");
  assert.match((analyzed.metadataLines || []).join("\n"), /Image types: image\/png/);
  assert.match((analyzed.previewText || ""), /image read summary/);
});

test("bash preview preserves head and tail", async () => {
  const cfg = await settings();
  const analyzed = analyzeToolResult("bash", [{ type: "text", text: "HEAD\n" + "a\n".repeat(150) + "TAIL\nexit code: 2" }], undefined);
  const rendered = buildCompactedText({ toolName: "bash", toolCallId: "call", analyze: analyzed, settings: cfg, spillPath: "/tmp/spill.txt" });
  assert.match(rendered, /--- head ---/);
  assert.match(rendered, /--- tail ---/);
  assert.match(rendered, /Exit code: 2/);
  assert.match(rendered, /Full output: \/tmp\/spill.txt/);
});

test("search preview recommends refinement", () => {
  const summary = extractSearchSummary("a.ts:1:2: one\nb.ts:3:4: two\nc.ts:5:6: three\n");
  assert.match(summary.previewText, /first matches/);
  assert.match(summary.metadataLines.join("\n"), /Tip: refine the query/);
});

test("rescue script rescues directory of session files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-diet-rescue-"));
  const inputDir = join(root, "sessions");
  const nestedDir = join(inputDir, "project");
  const outDir = join(root, "out");
  await mkdir(nestedDir, { recursive: true });

  const large = "x".repeat(70000);
  const sessionLine = JSON.stringify({
    id: "entry-1",
    message: {
      role: "toolResult",
      toolName: "bash",
      toolCallId: "call-1",
      content: [{ type: "text", text: large }],
      details: { code: 0 },
      isError: false,
    },
  });
  await writeFile(join(nestedDir, "session.jsonl"), `${sessionLine}\n`, "utf8");

  const { stdout } = await execFileAsync("node", ["scripts/rescue-session.mjs", inputDir, "--out", outDir], {
    cwd: process.cwd(),
  });
  assert.match(stdout, /summary files=1 rescued=1/);

  const rescued = await readFile(join(outDir, "session.rescued.jsonl"), "utf8");
  assert.match(rescued, /pi-diet: compacted oversized bash result/);
});
