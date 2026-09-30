/** Shared Pi presentation primitives. No tool names, response parsing contracts,
 * execution, or model-facing content changes belong in this layer. */
export { codeFence, fencedCode } from "../../util/code-display.js";

export interface DisplayComponent {
  render(width: number): string[];
  invalidate(): void;
}

export interface RenderTheme {
  bold(text: string): string;
  fg(color: string, text: string): string;
}

// Structural contracts keep Pi optional for all the other context-mode hosts.
// These packages are supplied by Pi's extension loader, not bundled with us.
export interface PiRendering {
  Text: new (text: string, paddingX: number, paddingY: number) => DisplayComponent;
  Markdown: new (text: string, paddingX: number, paddingY: number, theme: unknown) => DisplayComponent;
  highlightCode(code: string, language?: string): string[];
  getMarkdownTheme(): unknown;
  keyHint?(action: string, description: string): string;
}

export async function loadPiRendering(
  importer: (name: string) => Promise<any>,
): Promise<PiRendering | undefined> {
  try {
    const tui = await importer("@earendil-works/pi-tui");
    const agent = await importer("@earendil-works/pi-coding-agent");
    if ([tui.Text, tui.Markdown, agent.highlightCode, agent.getMarkdownTheme]
      .some((value) => typeof value !== "function")) return undefined;
    return {
      Text: tui.Text,
      Markdown: tui.Markdown,
      highlightCode: agent.highlightCode,
      getMarkdownTheme: agent.getMarkdownTheme,
      keyHint: typeof agent.keyHint === "function" ? agent.keyHint : undefined,
    };
  } catch {
    // CLI-only consumers and non-Pi hosts can still use the plain renderer.
    return undefined;
  }
}

const LANGUAGE_ALIASES: Record<string, string> = {
  shell: "bash", sh: "bash", zsh: "bash", js: "javascript", ts: "typescript",
  py: "python", "c#": "csharp",
};
const ANSI_COLOR = /\u001b\[[\d;:]*m/;

export function hasAnsiColor(text: string): boolean {
  return ANSI_COLOR.test(text);
}

// Detection is only a hint for colouring the original bytes, never a JSON
// round-trip (which could change whitespace, duplicate keys, or large numbers).
export function isJsonContainer(text: string): boolean {
  if (hasAnsiColor(text) || !/^[\s]*[\[{]/.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function closingFence(lines: string[], start: number): number {
  const opening = lines[start].match(/^\s*(`{3,}|~{3,})\s*[\w#+.-]*\s*$/);
  if (!opening) return -1;
  const marker = opening[1];
  const close = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`);
  for (let end = start + 1; end < lines.length; end++) {
    if (close.test(lines[end])) return end;
  }
  return -1;
}

/** Highlight explicitly identified code. Preserve native colours and fall back
 * to literal text if the host cannot highlight it. Never infer stdout's language
 * from the program that produced it. */
export function highlightCode(code: string, language: string, ui: PiRendering): string {
  if (hasAnsiColor(code)) return code;
  try {
    const normalized = language.toLowerCase();
    return ui.highlightCode(code, LANGUAGE_ALIASES[normalized] ?? normalized).join("\n");
  } catch {
    return code;
  }
}

/** Apply explicit fence/prompt hints and complete JSON detection to terminal
 * output. Other text retains its literal formatting, indentation and colours;
 * it is never interpreted as general Markdown. */
export function highlightTerminalOutput(output: string, ui: PiRendering, theme: RenderTheme): string {
  const lines = output.split("\n");
  const rendered: string[] = [];
  let plain: string[] = [];
  const flush = () => {
    if (plain.length === 0) return;
    const text = plain.join("\n");
    rendered.push(isJsonContainer(text) ? highlightCode(text, "json", ui) : text);
    plain = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^\s*(`{3,}|~{3,})\s*([\w#+.-]+)?\s*$/);
    if (fence) {
      const end = closingFence(lines, i);
      // No closing fence: leave it literal rather than swallowing stdout.
      if (end >= 0) {
        flush();
        rendered.push(theme.fg("dim", lines[i]));
        rendered.push(highlightCode(lines.slice(i + 1, end).join("\n"), fence[2] ?? "", ui));
        rendered.push(theme.fg("dim", lines[end]));
        i = end;
        continue;
      }
    }
    const command = lines[i].match(/^(\s*\$\s+)(.+)$/);
    if (command) {
      flush();
      rendered.push(theme.fg("dim", command[1]) + highlightCode(command[2], "bash", ui));
    } else {
      plain.push(lines[i]);
    }
  }
  flush();
  return rendered.join("\n");
}

/** All Markdown consumers use the same aliases, ANSI preservation and fallback. */
export function renderMarkdown(text: string, ui: PiRendering): DisplayComponent {
  return new ui.Markdown(text, 0, 0, {
    ...ui.getMarkdownTheme() as object,
    highlightCode: (code: string, language?: string) => highlightCode(code, language ?? "", ui).split("\n"),
  });
}

/** A fallback colour (e.g. error) must not overwrite syntax or subprocess colours. */
export function renderTerminalOutput(
  text: string,
  ui: PiRendering,
  theme: RenderTheme,
  fallbackColor?: string,
): DisplayComponent {
  const displayed = highlightTerminalOutput(text, ui, theme);
  return new ui.Text(fallbackColor && !hasAnsiColor(displayed) ? theme.fg(fallbackColor, displayed) : displayed, 0, 0);
}
