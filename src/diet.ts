import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type ToolContentBlock = {
  type: string;
  text?: string;
  source?: { type?: string; mediaType?: string; data?: string };
  [key: string]: unknown;
};

export type DietPiSettings = {
  enabled: boolean;
  thresholdChars: number;
  headChars: number;
  tailChars: number;
  spillDir: string;
};

export type SpillRecord = {
  toolName: string;
  toolCallId: string;
  input: unknown;
  isError: boolean;
  content: unknown;
  details: unknown;
};

export type CompactionPatch = {
  content: ToolContentBlock[];
  details: unknown;
  isError?: boolean;
};

export type AnalyzeResult = {
  text: string;
  charCount: number;
  kind: "bash" | "image-read" | "lsp-json" | "searchish" | "generic";
  metadataLines: string[];
  previewText?: string;
};

export const DEFAULT_SETTINGS: DietPiSettings = {
  enabled: true,
  thresholdChars: 64_000,
  headChars: 8_000,
  tailChars: 8_000,
  spillDir: join(resolveAgentDir(), "pi-diet", "spills"),
};

export function resolveAgentDir(): string {
  try {
    return getAgentDir();
  } catch {
    return join(homedir(), ".pi", "agent");
  }
}

export function sanitizeForFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export function timestampForFileName(date = new Date()): string {
  return date.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
}

export function renderContentBlocks(content: ToolContentBlock[]): string {
  const lines: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      lines.push(block.text ?? "");
      continue;
    }

    if (block.type === "image") {
      const mediaType = typeof block.source?.mediaType === "string" ? block.source.mediaType : "image/unknown";
      const dataLength = typeof block.source?.data === "string" ? block.source.data.length : 0;
      lines.push(`[image block ${mediaType}${dataLength ? ` data=${dataLength} chars` : ""}]`);
      continue;
    }

    lines.push(`[${block.type} block] ${safeJson(block)}`);
  }
  return lines.join("\n");
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function analyzeToolResult(toolName: string, content: ToolContentBlock[], details: unknown): AnalyzeResult {
  const text = renderContentBlocks(content);
  const detailsText = details === undefined ? "" : `\n\n--- details ---\n${safeJson(details)}`;
  const fullText = `${text}${detailsText}`;

  const lspPreview = looksLikeLspJson(fullText) ? extractLspSummary(fullText) : null;
  if (lspPreview) {
    return {
      text: fullText,
      charCount: fullText.length,
      kind: "lsp-json",
      metadataLines: [
        `Approx locations/symbols: ${lspPreview.count}`,
        ...(lspPreview.samples.length ? [`Sample locations: ${lspPreview.samples.join("; ")}`] : []),
      ],
      previewText: lspPreview.previewText,
    };
  }

  if (toolName === "read" && hasImagePayload(content, text)) {
    const imagePreview = extractImageSummary(content, fullText, details);
    return {
      text: fullText,
      charCount: fullText.length,
      kind: "image-read",
      metadataLines: imagePreview.metadataLines,
      previewText: imagePreview.previewText,
    };
  }

  if (toolName === "bash") {
    const bashPreview = extractBashSummary(fullText);
    return {
      text: fullText,
      charCount: fullText.length,
      kind: "bash",
      metadataLines: bashPreview.metadataLines,
      previewText: bashPreview.previewText,
    };
  }

  if (toolName.includes("search") || toolName.includes("grep") || toolName.includes("references") || toolName.includes("symbols")) {
    const searchPreview = extractSearchSummary(fullText);
    return {
      text: fullText,
      charCount: fullText.length,
      kind: "searchish",
      metadataLines: searchPreview.metadataLines,
      previewText: searchPreview.previewText,
    };
  }

  return {
    text: fullText,
    charCount: fullText.length,
    kind: "generic",
    metadataLines: [],
  };
}

export function buildPreview(analyze: AnalyzeResult, settings: DietPiSettings): string {
  if (analyze.previewText) return analyze.previewText;

  const head = analyze.text.slice(0, settings.headChars);
  const tail = analyze.text.slice(-settings.tailChars);
  if (analyze.text.length <= settings.headChars + settings.tailChars) return head;
  return `--- head ---\n${head}\n\n--- tail ---\n${tail}`;
}

export function buildCompactedText(args: {
  toolName: string;
  toolCallId: string;
  analyze: AnalyzeResult;
  settings: DietPiSettings;
  spillPath: string;
}): string {
  const { toolName, toolCallId, analyze, settings, spillPath } = args;
  const omitted = Math.max(0, analyze.charCount - Math.min(analyze.charCount, settings.headChars + settings.tailChars));
  const metadata = analyze.metadataLines.length ? `${analyze.metadataLines.join("\n")}\n` : "";
  return [
    `[pi-diet: compacted oversized ${toolName} result]`,
    `Tool call: ${toolCallId}`,
    `Recognizer: ${analyze.kind}`,
    `Original size: ${analyze.charCount} chars`,
    `Preview: first ${settings.headChars} chars + last ${settings.tailChars} chars shown unless specialized`,
    `Omitted: ${omitted} chars`,
    `Full output: ${spillPath}`,
    metadata.trimEnd(),
    buildPreview(analyze, settings),
  ].filter(Boolean).join("\n\n");
}

export async function writeSpillFile(record: SpillRecord, settings: DietPiSettings): Promise<string> {
  const fileName = `${timestampForFileName()}-${sanitizeForFileName(record.toolName)}-${sanitizeForFileName(record.toolCallId)}.txt`;
  const spillPath = join(settings.spillDir, fileName);
  await mkdir(dirname(spillPath), { recursive: true });
  await writeFile(spillPath, safeJson(record), "utf8");
  return spillPath;
}

export async function compactToolResult(args: {
  toolName: string;
  toolCallId: string;
  input: unknown;
  content: ToolContentBlock[];
  details: unknown;
  isError: boolean;
  settings: DietPiSettings;
}): Promise<CompactionPatch | null> {
  const { toolName, toolCallId, input, content, details, isError, settings } = args;
  if (!settings.enabled) return null;

  const analyzed = analyzeToolResult(toolName, content, details);
  if (analyzed.charCount <= settings.thresholdChars) return null;

  const spillPath = await writeSpillFile({ toolName, toolCallId, input, content, details, isError }, settings);
  const compactedText = buildCompactedText({ toolName, toolCallId, analyze: analyzed, settings, spillPath });

  return {
    content: [{ type: "text", text: compactedText }],
    details: mergeDietDetails(details, {
      compacted: true,
      spillPath,
      originalSizeChars: analyzed.charCount,
      thresholdChars: settings.thresholdChars,
      recognizer: analyzed.kind,
    }),
    isError,
  };
}

export function mergeDietDetails(details: unknown, dietPi: Record<string, unknown>): unknown {
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return { ...(details as Record<string, unknown>), dietPi };
  }
  return { originalDetails: details ?? null, dietPi };
}

export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    index = text.indexOf(needle, index);
    if (index === -1) return count;
    count += 1;
    index += needle.length;
  }
}

export function looksLikeLspJson(text: string): boolean {
  return countOccurrences(text, '"uri"') >= 3 && countOccurrences(text, '"range"') >= 3 && countOccurrences(text, '"line"') >= 3;
}

export function hasImagePayload(content: ToolContentBlock[], text: string): boolean {
  if (content.some((block) => block.type === "image")) return true;
  return /image\/(png|jpeg|jpg|gif|webp)/i.test(text) || /read image file/i.test(text);
}

export function extractLspSummary(text: string): { count: number; samples: string[]; previewText: string } | null {
  const matches = Array.from(text.matchAll(/"uri"\s*:\s*"file:\/\/([^"\n]+)"[\s\S]{0,160}?"line"\s*:\s*(\d+)[\s\S]{0,80}?"character"\s*:\s*(\d+)/g));
  if (!matches.length) return null;
  const samples = matches.slice(0, 5).map((match) => `${basename(match[1])}:${Number(match[2]) + 1}:${Number(match[3]) + 1}`);
  return {
    count: countOccurrences(text, '"uri"'),
    samples,
    previewText: [
      "--- compact LSP preview ---",
      ...samples.map((sample, index) => `${index + 1}. ${sample}`),
      matches.length > samples.length ? `... and more in spill file` : "",
    ].filter(Boolean).join("\n"),
  };
}

export function extractImageSummary(content: ToolContentBlock[], text: string, details: unknown): { metadataLines: string[]; previewText: string } {
  const mediaTypes = content
    .filter((block) => block.type === "image")
    .map((block) => block.source?.mediaType)
    .filter((value): value is string => typeof value === "string");
  const metadataLines = [
    ...(mediaTypes.length ? [`Image types: ${Array.from(new Set(mediaTypes)).join(", ")}`] : []),
    ...(findDimensionHints(text).length ? [`Dimensions: ${findDimensionHints(text).join(", ")}`] : []),
  ];
  const detailsText = details === undefined ? "" : safeJson(details).slice(0, 500);
  const textualHints = text.split(/\r?\n/).filter((line) => line.trim() && !/base64|^[A-Za-z0-9+/=]{60,}$/.test(line)).slice(0, 6);
  return {
    metadataLines,
    previewText: [
      "--- image read summary ---",
      ...textualHints,
      ...(detailsText ? ["", "--- details excerpt ---", detailsText] : []),
    ].join("\n").trim(),
  };
}

export function extractBashSummary(text: string): { metadataLines: string[]; previewText: string } {
  const exitCode = text.match(/exit code:?\s*(\d+)/i)?.[1];
  const stderrHint = text.match(/stderr:?\s*(.*)/i)?.[1];
  const metadataLines = [
    ...(exitCode ? [`Exit code: ${exitCode}`] : []),
    ...(stderrHint ? [`stderr hint: ${stderrHint.slice(0, 160)}`] : []),
  ];
  const lines = text.split(/\r?\n/);
  const head = lines.slice(0, 20).join("\n");
  const tail = lines.slice(-20).join("\n");
  return {
    metadataLines,
    previewText: `--- head ---\n${head}\n\n--- tail ---\n${tail}`,
  };
}

export function extractSearchSummary(text: string): { metadataLines: string[]; previewText: string } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const matches = lines.filter((line) => /:\d+(:\d+)?:/.test(line) || /file:\/\//.test(line));
  const metadataLines = [
    `Approx matches: ${matches.length || lines.length}`,
    "Tip: refine the query if you need a smaller in-context result.",
  ];
  return {
    metadataLines,
    previewText: [
      "--- first matches ---",
      ...lines.slice(0, 20),
    ].join("\n"),
  };
}

export function findDimensionHints(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/\b(\d{2,5}x\d{2,5})\b/gi)).map((match) => match[1]))).slice(0, 5);
}
