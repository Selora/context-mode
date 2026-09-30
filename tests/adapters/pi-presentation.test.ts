import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closingFence, codeFence, fencedCode, hasAnsiColor, highlightCode,
  highlightTerminalOutput, isJsonContainer, loadPiRendering,
  renderMarkdown, renderTerminalOutput,
} from "../../src/adapters/pi/presentation.js";
import {
  highlightTerminalOutput as legacyHighlight,
  loadPiRendering as legacyLoader,
} from "../../src/adapters/pi/renderers.js";

class Text {
  constructor(public text = "") {}
  invalidate() {}
  render(_width?: number) { return this.text.split("\n"); }
}
class Markdown extends Text {
  constructor(text: string, _paddingX: number, _paddingY: number, public theme: any) {
    super(text);
  }
}

const nativeHighlight = vi.fn((code: string, language?: string) => [`\u001b[36m${language}:${code}\u001b[0m`]);
const heading = (text: string) => `heading:${text}`;
const ui = { Text, Markdown, highlightCode: nativeHighlight, getMarkdownTheme: () => ({ heading }) };
const theme = { bold: (s: string) => s, fg: (color: string, s: string) => `<${color}>${s}</${color}>` };

beforeEach(() => vi.clearAllMocks());

describe("Pi shared presentation", () => {
  it("preserves the existing renderer module's public entrypoints", () => {
    expect(legacyHighlight).toBe(highlightTerminalOutput);
    expect(legacyLoader).toBe(loadPiRendering);
  });

  it.each([
    ["shell", "bash"], ["SH", "bash"], ["zsh", "bash"],
    ["js", "javascript"], ["TS", "typescript"], ["py", "python"],
    ["c#", "csharp"], ["python", "python"], ["future-lang", "future-lang"], ["", ""],
  ])("uses the shared language hint %s → %s", (input, expected) => {
    highlightCode("original bytes", input, ui);
    expect(nativeHighlight).toHaveBeenCalledWith("original bytes", expected);
  });

  it("preserves native ANSI without invoking the syntax highlighter", () => {
    const code = "\u001b[1;31mfailed\u001b[0m\n  caret";
    expect(hasAnsiColor(code)).toBe(true);
    expect(highlightCode(code, "bash", ui)).toBe(code);
    expect(nativeHighlight).not.toHaveBeenCalled();
    expect(hasAnsiColor("\u001b[2Kclear line")).toBe(false);
  });

  it("returns the exact input when the host highlighter fails", () => {
    const failing = { ...ui, highlightCode: () => { throw new Error("unsupported"); } };
    const code = "  code\n\n";
    expect(highlightCode(code, "future-lang", failing)).toBe(code);
  });

  it("builds collision-safe fences without changing their contents", () => {
    const code = '```bash\nprintf "````"\n```\n';
    expect(codeFence(code)).toBe("`````");
    expect(fencedCode(code, "")).toBe(["`````", code, "`````"].join("\n"));
    expect(codeFence("no backticks")).toBe("```");
  });

  it.each([
    { lines: ["````ts", "```", "~~~~", "````"], expected: 3 },
    { lines: ["~~~py", "```", "~~~"], expected: 2 },
    { lines: ["```json", "{}"], expected: -1 },
    { lines: ["not a fence", "```"], expected: -1 },
  ])("matches only complete fences with the right delimiter: %j", ({ lines, expected }) => {
    expect(closingFence(lines, 0)).toBe(expected);
  });

  it.each<[string, boolean]>([
    [' {"large":9007199254740993,"large":2} \n', true],
    ['[1,{"ok":true}]', true],
    ['42', false], ['"text"', false], ['true', false],
    ['{not json}', false], ['[compiler] error', false],
    ['{"ok":true}\ntrailing log', false],
    ['\u001b[32m{"ok":true}\u001b[0m', false],
  ])("only infers complete JSON objects/arrays: %j", (text, expected) => {
    expect(isJsonContainer(text)).toBe(expected);
  });

  it("passes JSON's original bytes to highlighting, without round-tripping", () => {
    const json = ' {"large":9007199254740993,"large":2} \n';
    renderTerminalOutput(json, ui, theme);
    expect(nativeHighlight).toHaveBeenCalledWith(json, "json");
  });

  it("keeps unrecognised terminal text literal, unlike Markdown", () => {
    const output = "# not a heading\n*literal* _text_\n  keep indentation\n";
    const component = renderTerminalOutput(output, ui, theme);
    expect(component).not.toBeInstanceOf(Markdown);
    expect(component.render(80).join("\n")).toBe(output);
    expect(nativeHighlight).not.toHaveBeenCalled();
  });

  it("uses one highlighting policy for explicit fences and shell prompts", () => {
    const output = '~~~JS\nconst n = 1;\n~~~\n$ printf hello\nplain';
    const rendered = highlightTerminalOutput(output, ui, theme);
    expect(nativeHighlight.mock.calls).toEqual([["const n = 1;", "javascript"], ["printf hello", "bash"]]);
    expect(rendered).toContain("<dim>~~~JS</dim>");
    expect(rendered).toContain("<dim>$ </dim>");
    expect(rendered).toMatch(/\nplain$/);
  });

  it("uses fallback colour only for otherwise-uncoloured terminal output", () => {
    expect(renderTerminalOutput("failed", ui, theme, "error").render(80).join("\n"))
      .toBe("<error>failed</error>");
    const ansi = "\u001b[32mretained\u001b[0m";
    expect(renderTerminalOutput(ansi, ui, theme, "error").render(80).join("\n")).toBe(ansi);
    expect(renderTerminalOutput('{"error":true}', ui, theme, "error").render(80).join("\n"))
      .not.toContain("<error>");
  });

  it("preserves Markdown and delegates code blocks to the same highlighting policy", () => {
    const markdown = '# Heading\n\n```py\nprint(1)\n```\n\n[link](https://example.com)';
    const component = renderMarkdown(markdown, ui) as Markdown;
    expect(component).toBeInstanceOf(Markdown);
    expect(component.text).toBe(markdown);
    expect(component.theme.heading).toBe(heading);
    component.theme.highlightCode("print(1)", "py");
    expect(nativeHighlight).toHaveBeenCalledWith("print(1)", "python");
    const ansi = "\u001b[31mnative\u001b[0m";
    expect(component.theme.highlightCode(ansi, "bash")).toEqual([ansi]);
    expect(nativeHighlight).toHaveBeenCalledTimes(1);
  });
});
