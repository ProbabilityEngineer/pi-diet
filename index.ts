import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { compactToolResult, DEFAULT_SETTINGS, type DietPiSettings, type ToolContentBlock } from "./src/diet.ts";

const STATUS_KEY = "pi-diet";

export default function dietPi(pi: ExtensionAPI) {
  let settings: DietPiSettings = { ...DEFAULT_SETTINGS };

  function statusText(): string {
    return `pi-diet ${settings.enabled ? "on" : "off"} · threshold=${settings.thresholdChars} · head=${settings.headChars} · tail=${settings.tailChars}`;
  }

  function footerStatusText(): string {
    return `diet:${settings.enabled ? "on" : "off"}`;
  }

  function refreshStatus(ctx: { hasUI: boolean; ui: { setStatus: (key: string, text: string | undefined) => void } }) {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, footerStatusText());
  }

  pi.registerCommand("diet", {
    description: "Control pi-diet result compaction: status | on | off",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (!action || action === "status") {
        ctx.ui.notify(statusText(), "info");
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
      ctx.ui.notify("Usage: /diet status|on|off", "warning");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
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
