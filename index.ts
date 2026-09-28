import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compactToolResult, DEFAULT_SETTINGS, resolveAgentDir, type DietPiSettings, type ToolContentBlock } from "./src/diet.ts";

const STATUS_KEY = "pi-diet";
const STATUS_CONFIG = join(resolveAgentDir(), "pi-diet", "config.json");

export default function dietPi(pi: ExtensionAPI) {
  let settings: DietPiSettings = { ...DEFAULT_SETTINGS };
  let showStatus = true;

  async function loadStatusPreference() {
    try {
      const config = JSON.parse(await readFile(STATUS_CONFIG, "utf8")) as { showStatus?: unknown };
      if (typeof config.showStatus === "boolean") showStatus = config.showStatus;
    } catch {
      // Missing or invalid config keeps the default visible status.
    }
  }

  async function saveStatusPreference(value: boolean) {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(await readFile(STATUS_CONFIG, "utf8")) as Record<string, unknown>;
    } catch {
      // Create a new config when none exists.
    }
    config.showStatus = value;
    await mkdir(join(resolveAgentDir(), "pi-diet"), { recursive: true });
    await writeFile(STATUS_CONFIG, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  function statusText(): string {
    return `pi-diet ${settings.enabled ? "on" : "off"} · threshold=${settings.thresholdChars} · head=${settings.headChars} · tail=${settings.tailChars}`;
  }

  function refreshStatus(ctx: {
    hasUI: boolean;
    ui: {
      setStatus: (key: string, text: string | undefined) => void;
      theme: { fg: (color: "success" | "dim", text: string) => string };
    };
  }) {
    if (!ctx.hasUI) return;
    if (!showStatus) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const text = settings.enabled
      ? ctx.ui.theme.fg("success", "diet: on")
      : ctx.ui.theme.fg("dim", "diet: off");
    ctx.ui.setStatus(STATUS_KEY, text);
  }

  pi.registerCommand("diet", {
    description: "Control pi-diet result compaction and its footer",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "footer" || action.startsWith("footer ")) {
        const footerAction = action.slice("footer".length).trim();
        if (footerAction !== "on" && footerAction !== "off") {
          ctx.ui.notify("Usage: /diet footer on|off", "warning");
          return;
        }
        showStatus = footerAction === "on";
        try {
          await saveStatusPreference(showStatus);
        } catch (error) {
          ctx.ui.notify(`Could not save pi-diet footer preference: ${String(error)}`, "warning");
        }
        refreshStatus(ctx);
        ctx.ui.notify(`pi-diet footer ${showStatus ? "enabled" : "hidden"}`, "info");
        return;
      }
      if (!action) {
        settings = { ...settings, enabled: !settings.enabled };
        ctx.ui.notify(`pi-diet ${settings.enabled ? "enabled" : "disabled"}`, "info");
        refreshStatus(ctx);
        return;
      }
      if (action === "on") {
        settings = { ...settings, enabled: true };
        ctx.ui.notify("pi-diet enabled", "info");
        refreshStatus(ctx);
        return;
      }
      if (action === "off") {
        settings = { ...settings, enabled: false };
        ctx.ui.notify("pi-diet disabled", "info");
        refreshStatus(ctx);
        return;
      }
      ctx.ui.notify("Usage: /diet on|off | /diet footer on|off", "warning");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await loadStatusPreference();
    refreshStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("tool_result", async (event: ToolResultEvent) => {
    const patch = await compactToolResult({
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: event.input,
      content: event.content as ToolContentBlock[],
      details: event.details,
      isError: event.isError,
      settings,
    });
    return patch ?? undefined;
  });
}
