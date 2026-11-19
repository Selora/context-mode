// Pi-only presentation. Tool replies, indexing and journaling still see the upstream text.
interface TextComponent {
  setText(text: string): void;
  render(width: number): string[];
  invalidate(): void;
}

export interface PiRendering {
  Text: new (text: string, paddingX: number, paddingY: number) => TextComponent;
  highlightCode(code: string, language: string): string[];
  getLanguageFromPath?(path: string): string | undefined;
}

export async function loadPiRendering(importer: (name: string) => Promise<unknown>): Promise<PiRendering | undefined> {
  for (const scope of ["@earendil-works", "@mariozechner"]) {
    try {
      const tui = await importer(`${scope}/pi-tui`) as Partial<PiRendering>;
      const agent = await importer(`${scope}/pi-coding-agent`) as Partial<PiRendering>;
      if (typeof tui.Text === "function" && typeof agent.highlightCode === "function") {
        return { Text: tui.Text, highlightCode: agent.highlightCode, getLanguageFromPath: agent.getLanguageFromPath };
      }
    } catch { /* Older or non-interactive hosts can fall back to Pi's plain rendering. */ }
  }
}

interface Theme {
  bold(text: string): string;
  fg(color: string, text: string): string;
}

interface RenderContext {
  expanded?: boolean;
  isError?: boolean;
  lastComponent?: TextComponent;
  keyHint?(action: string, description: string): string;
}

const TOOLS = new Set(["ctx_execute", "ctx_batch", "ctx_search"]);
const ANSI = /\x1b\[[\d;:]*m/;
const PREVIEW_LINES = 8;
const PREVIEW_CHARS = 2000;
const FENCE = /^\s*(`{3,}|~{3,})[ \t]*([\w#+.-]*)[ \t\r]*$/;
const ALIASES = new Map([["shell", "bash"], ["sh", "bash"], ["zsh", "bash"], ["js", "javascript"],
  ["ts", "typescript"], ["py", "python"], ["c#", "csharp"]]);

function highlight(ui: PiRendering, code: string, language: string): string {
  if (!language || !code || ANSI.test(code)) return code;
  try {
    const lang = language.toLowerCase();
    return ui.highlightCode(code, ALIASES.get(lang) ?? lang).join("\n");
  } catch { return code; }
}

function json(text: string): boolean {
  if (!/^\s*[\[{]/.test(text)) return false;
  try { JSON.parse(text); return true; } catch { return false; }
}

// Treat stdout and snippets as literal text. Only explicit fences, shell prompts
// and complete JSON provide language hints; never use the runtime as a hint for stdout.
function output(text: string, ui: PiRendering, theme: Theme): string {
  const lines = text.split("\n");
  const parts: string[] = [];
  let plain: string[] = [];
  const flush = (): void => {
    if (plain.length === 0) return;
    const block = plain.join("\n");
    parts.push(json(block) ? highlight(ui, block, "json") : block);
    plain = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(FENCE);
    const marker = fence?.[1];
    if (marker) {
      const close = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`);
      let end = i + 1;
      while (end < lines.length && !close.test(lines[end])) end++;
      if (end === lines.length) { plain.push(...lines.slice(i)); break; }
      flush();
      parts.push(theme.fg("dim", line), highlight(ui, lines.slice(i + 1, end).join("\n"), fence[2]), theme.fg("dim", lines[end]));
      i = end;
    } else {
      const command = line.match(/^(\s*\$ )(.+)$/);
      if (command || /^\s*$/.test(line) || /^## |^more: ctx_search\(/.test(line)) {
        flush();
        parts.push(command ? command[1] + highlight(ui, command[2], "bash") : line);
      } else if (json(line)) {
        flush();
        parts.push(highlight(ui, line, "json"));
      } else {
        plain.push(line);
      }
    }
  }
  flush();
  return parts.join("\n");
}

// V2 search replies prefix a snippet's first line with "<label> #<ordinal>: ".
// An ordinary filename label is only a UI hint; never resolve or read a path.
function searchOutput(text: string, ui: PiRendering, theme: Theme): string {
  const rows = text.split(/(^[^\n]+? (?:#\d+|\[\d+\]): |^(?:Query "|Same as above: |More: ))/m);
  let rendered = output(rows[0], ui, theme);
  for (let i = 1; i < rows.length; i += 2) {
    const prefix = rows[i];
    const snippet = rows[i + 1];
    const file = prefix.match(/^([\w./\\-]+\.[a-zA-Z0-9]+) #\d+: /)?.[1];
    const language = file && ui.getLanguageFromPath?.(file);
    // The newline separating two rows isn't part of the source snippet.
    const body = snippet.endsWith("\n") ? snippet.slice(0, -1) : snippet;
    rendered += prefix + (language ? highlight(ui, body, language) : output(body, ui, theme)) + snippet.slice(body.length);
  }
  return rendered;
}

function component(ui: PiRendering, text: string, context: RenderContext): TextComponent {
  if (!context.lastComponent) return new ui.Text(text, 0, 0);
  context.lastComponent.setText(text);
  return context.lastComponent;
}

export interface PiRenderers {
  renderCall(args: unknown, theme: Theme, context?: RenderContext): TextComponent;
  renderResult(result: { content: readonly { type: string; text?: string }[] },
    options: { expanded: boolean; isPartial: boolean }, theme: Theme, context?: RenderContext): TextComponent;
}

export function piRenderers(name: string, ui: PiRendering): PiRenderers | undefined {
  if (!TOOLS.has(name)) return;
  return {
    renderCall(input, theme, context = {}) {
      const args = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
      let text = theme.fg("toolTitle", theme.bold(name));
      const language = typeof args.language === "string" ? args.language : "";
      if (language) text += " " + theme.fg("muted", language);
      if (typeof args.file === "string") text += " " + theme.fg("accent", args.file);
      if (typeof args.source === "string") text += " " + theme.fg("muted", args.source);
      if (Array.isArray(args.queries)) text += " " + theme.fg("accent", args.queries.filter((q) => typeof q === "string").join(" · ").slice(0, PREVIEW_CHARS));
      const commands = Array.isArray(args.commands) ? args.commands.filter((cmd) => typeof cmd === "string") : [];
      const code = typeof args.code === "string" ? args.code : commands.map((cmd) => "$ " + cmd).join("\n");
      if (code) {
        const preview = context.expanded ? code : code.split("\n", PREVIEW_LINES).join("\n").slice(0, PREVIEW_CHARS);
        text += "\n" + highlight(ui, preview, commands.length ? "bash" : language);
        if (preview !== code) text += "\n" + theme.fg("dim", "… expand for full input");
      }
      return component(ui, text, context);
    },
    renderResult(result, { expanded, isPartial }, theme, context = {}) {
      if (isPartial) return component(ui, theme.fg("warning", "working…"), context);
      const raw = result.content.map((part) => part.type === "text" ? part.text ?? "" : "").join("\n");
      if (!raw.trim()) return component(ui, theme.fg("dim", "(no output)"), context);
      const preview = expanded ? raw : raw.split("\n", PREVIEW_LINES).join("\n").slice(0, PREVIEW_CHARS);
      let text = name === "ctx_search" ? searchOutput(preview, ui, theme) : output(preview, ui, theme);
      if (context.isError && !ANSI.test(text)) text = theme.fg("error", text);
      if (preview !== raw) {
        const hint = context.keyHint?.("app.tools.expand", "to expand") || "expand for full output";
        text += "\n" + theme.fg("dim", `… (${hint})`);
      }
      return component(ui, text, context);
    },
  };
}
