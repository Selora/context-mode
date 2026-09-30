import "../setup-home";
/**
 * Pi extension — lazy MCP bridge bootstrap for real agent turns (#534, #809).
 *
 * Pi may load extensions for CLI-only paths such as `pi --help`, `pi install`,
 * `pi list`, `pi config`, and `pi --list-models`. Those paths do not dispatch
 * an agent turn or provide a dependable `session_shutdown`, so bootstrapping the
 * long-lived MCP bridge during extension discovery can orphan the bridge child
 * (#534) or keep package commands alive forever (#809).
 *
 * Normally the bridge starts from `before_agent_start`, including print-mode
 * subagents. Interactive sessions with saved ctx_* history may start it earlier
 * from session_start, before Pi draws those messages. Neither path requires a
 * brittle argv allowlist, and merely discovering the extension never starts MCP.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiRendering } from "../../src/adapters/pi/renderers.js";

let scratch: string;
let originalArgv: string[];

type HandlerFn = (...args: any[]) => any;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "ctx-pi-lazy-bridge-"));
  originalArgv = process.argv;
  vi.resetModules();
});

afterEach(() => {
  process.argv = originalArgv;
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  delete process.env.PI_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  vi.restoreAllMocks();
});

function createMockPi() {
  const handlers: Record<string, HandlerFn[]> = {};
  return {
    on: vi.fn((event: string, handler: HandlerFn) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
    }),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    sendMessage: vi.fn(),
    _trigger: async (event: string, ...args: any[]) => {
      for (const handler of handlers[event] ?? []) {
        await handler(...args);
      }
    },
  };
}

async function registerWithBootstrapSpy(argv: string[], rendering?: PiRendering) {
  process.argv = ["/usr/bin/pi", "pi-coding-agent", ...argv];
  process.env.PI_PROJECT_DIR = scratch;
  process.env.CLAUDE_PROJECT_DIR = scratch;

  const bridgeMod = await import("../../src/adapters/pi/mcp-bridge.js");
  const shutdown = vi.fn();
  const spy = vi
    .spyOn(bridgeMod, "bootstrapMCPTools")
    .mockResolvedValue({
      tools: [],
      shutdown,
      client: { _spawnEnv: null } as unknown as InstanceType<
        typeof bridgeMod.MCPStdioClient
      >,
    });

  const extMod = await import("../../src/adapters/pi/extension.js");
  const pi = createMockPi();
  extMod.default(pi, rendering);
  await extMod._mcpBridgeReady;

  return { pi, spy, shutdown };
}

describe("piExtension — restore renderers before displaying saved context-mode history", () => {
  // Opaque UI dependency: these lifecycle tests do not render components.
  const rendering = {} as PiRendering;
  const call = { role: "assistant", content: [{ type: "toolCall", name: "ctx_execute", arguments: { code: "must not run" } }] };
  const result = { role: "toolResult", toolName: "ctx_execute", content: [{ type: "text", text: "saved output" }] };
  const context = (messages: unknown[], mode = "tui") => ({
    mode,
    hasUI: mode === "tui" || mode === "rpc",
    sessionManager: {
      getSessionFile: () => join(scratch, "restored.jsonl"),
      getBranch: vi.fn(() => messages.map((message) => ({ type: "message", message }))),
      getEntries: vi.fn(() => { throw new Error("Must inspect only the active branch"); }),
    },
  });

  it.each(["startup", "resume", "reload", "fork"])("initializes on %s with saved calls, only once, and shuts down normally", async (reason) => {
    const { pi, spy, shutdown } = await registerWithBootstrapSpy(["--continue"], rendering);
    const ctx = context([call, result]);
    expect(spy).not.toHaveBeenCalled();
    await pi._trigger("session_start", { reason }, ctx);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][2]).toMatchObject({ foreground: true, rendering });
    expect(ctx.sessionManager.getEntries).not.toHaveBeenCalled();
    await pi._trigger("before_agent_start", { prompt: "continue", systemPrompt: "" }, ctx);
    expect(spy).toHaveBeenCalledOnce();
    await pi._trigger("session_shutdown");
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it.each([call, result])("recognises a saved call or result independently", async (message) => {
    const { pi, spy } = await registerWithBootstrapSpy([], rendering);
    await pi._trigger("session_start", { reason: "startup" }, context([message]));
    expect(spy).toHaveBeenCalledOnce();
  });

  it.each([
    [],
    [{ role: "user", content: "Please use ctx_execute" }],
    [{ role: "assistant", content: [{ type: "text", text: "ctx_execute" }] }],
    [{ role: "toolResult", toolName: "bash", content: [] }],
  ])("does not start for an empty or unrelated active branch: %j", async (...messages) => {
    const { pi, spy } = await registerWithBootstrapSpy([], rendering);
    await pi._trigger("session_start", { reason: "startup" }, context(messages));
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(["rpc", "json", "print"])("keeps %s sessions lazy even with saved context-mode calls", async (mode) => {
    const { pi, spy } = await registerWithBootstrapSpy([], rendering);
    await pi._trigger("session_start", { reason: "startup" }, context([call, result], mode));
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps hosts without rendering helpers lazy", async () => {
    const { pi, spy } = await registerWithBootstrapSpy([]);
    await pi._trigger("session_start", { reason: "resume" }, context([call, result]));
    expect(spy).not.toHaveBeenCalled();
  });

  it("awaits registration before session_start completes", async () => {
    const { pi, spy, shutdown } = await registerWithBootstrapSpy([], rendering);
    let release!: () => void;
    spy.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ tools: ["ctx_execute"], shutdown, client: {} as any });
    }));
    let finished = false;
    const pending = pi._trigger("session_start", { reason: "resume" }, context([call])).then(() => { finished = true; });
    await Promise.resolve();
    expect(spy).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    release();
    await pending;
    expect(finished).toBe(true);
  });

  it("allows the session to open with plain rendering when bootstrap fails", async () => {
    const { pi, spy } = await registerWithBootstrapSpy([], rendering);
    spy.mockRejectedValueOnce(new Error("MCP unavailable"));
    await expect(pi._trigger("session_start", { reason: "resume" }, context([call]))).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("piExtension — lazy MCP bootstrap avoids brittle argv detection (#534, #809)", () => {
  it.each([
    ["--help"],
    ["-v"],
    ["help"],
    ["--list-models"],
    ["install", "npm:context-mode"],
    ["install", "--help"],
    ["remove", "npm:context-mode"],
    ["uninstall", "npm:context-mode"],
    ["update"],
    ["list"],
    ["config"],
  ])("does NOT bootstrap during extension discovery for argv: %s", async (...argv) => {
    const { spy } = await registerWithBootstrapSpy(argv);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it.each([
    [],
    ["-p", "task"],
    ["--print", "task"],
    ["--resume"],
    ["--mode", "json", "-p", "--no-session", "task"],
    ["--model", "sonnet", "task"],
  ])("bootstraps when before_agent_start fires for real agent argv: %s", async (...argv) => {
    const { pi, spy } = await registerWithBootstrapSpy(argv);

    await pi._trigger("before_agent_start", { prompt: "task", systemPrompt: "" });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("does not bootstrap more than once per extension registration", async () => {
    const { pi, spy } = await registerWithBootstrapSpy(["-p", "task"]);

    await pi._trigger("before_agent_start", { prompt: "first", systemPrompt: "" });
    await pi._trigger("before_agent_start", { prompt: "second", systemPrompt: "" });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
