#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { compactToolResult, DEFAULT_SETTINGS } from "../src/diet.ts";

async function collectJsonlFiles(inputPath) {
  const info = await stat(inputPath);
  if (info.isFile()) return [inputPath];
  if (!info.isDirectory()) return [];

  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const next = join(dir, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(next);
    }
  }

  await walk(inputPath);
  return found.sort();
}

async function rescueFile(resolvedInput, outDir) {
  const text = await readFile(resolvedInput, 'utf8');
  const lines = text.split('\n');
  let changed = 0;

  const nextLines = await Promise.all(lines.map(async (line) => {
    if (!line.trim()) return line;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return line;
    }

    const message = parsed?.message;
    if (!message || message.role !== 'toolResult' || !Array.isArray(message.content)) {
      return line;
    }

    const patch = await compactToolResult({
      toolName: message.toolName ?? 'tool',
      toolCallId: message.toolCallId ?? parsed.id ?? 'tool-call',
      input: message.input ?? {},
      content: message.content,
      details: message.details,
      isError: Boolean(message.isError),
      settings: DEFAULT_SETTINGS,
    });

    if (!patch) return line;
    changed += 1;
    parsed.message = {
      ...message,
      content: patch.content,
      details: patch.details,
      isError: patch.isError ?? message.isError,
    };
    return JSON.stringify(parsed);
  }));

  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${basename(resolvedInput, '.jsonl')}.rescued.jsonl`);
  await writeFile(outPath, nextLines.join('\n'), 'utf8');
  return { changed, outPath };
}

async function main() {
  const [, , inputPath, ...args] = process.argv;
  if (!inputPath) {
    console.error('Usage: node scripts/rescue-session.mjs <session.jsonl|dir> [--out DIR]');
    process.exit(1);
  }

  const outIndex = args.indexOf('--out');
  const outRoot = outIndex >= 0 ? resolve(args[outIndex + 1]) : dirname(resolve(inputPath));
  const resolvedInput = resolve(inputPath);
  const files = await collectJsonlFiles(resolvedInput);
  if (!files.length) {
    console.error(`No .jsonl files found under ${resolvedInput}`);
    process.exit(1);
  }

  let totalChanged = 0;
  for (const file of files) {
    const relativeDir = files.length === 1 ? '' : dirname(relative(resolvedInput, file));
    const outDir = join(outRoot, relativeDir);
    const result = await rescueFile(file, outDir);
    totalChanged += result.changed;
    console.log(`file=${file} rescued=${result.changed} output=${result.outPath}`);
  }
  console.log(`summary files=${files.length} rescued=${totalChanged} out=${outRoot}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
