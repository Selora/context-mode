import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPiRendering, piRenderers } from "../src/entries/pi-render.ts";

const theme = { bold: (text) => text, fg: (_color, text) => text };
const ui = {
  Text: class {
    constructor(text) { this.text = text; }
    setText(text) { this.text = text; }
    render() { return this.text.split("\n"); }
    invalidate() {}
  },
  highlightCode: (code, lang) => code.split("\n").map((line) => `[${lang}]${line}`),
  getLanguageFromPath: (file) => file.endsWith(".ts") ? "typescript" : undefined,
};

const expanded = { expanded: true, isPartial: false };
const result = (text) => ({ content: [{ type: "text", text }] });
const rendered = (view) => view.render(80).join("\n");

test("optional Pi UI can use the legacy package names or fall back to the default renderer", async () => {
  const importer = async (name) => {
    if (name.startsWith("@earendil-works/")) throw new Error("not installed");
    return ui;
  };
  assert.deepEqual(await loadPiRendering(importer), ui);
  assert.equal(await loadPiRendering(async () => ({})), undefined);
  assert.equal(piRenderers("ctx_index", ui), undefined);
});

test("ctx_execute highlights the input but never treats stdout as source code", () => {
  const view = piRenderers("ctx_execute", ui);
  const code = "print(42)";
  assert.equal(rendered(view.renderCall({ language: "py", code }, theme)), "ctx_execute py\n[python]print(42)");
  const reply = result('plain output\n\n{"x":42}\n\x1b[31malready colored\x1b[0m');
  const snapshot = structuredClone(reply);
  assert.equal(rendered(view.renderResult(reply, expanded, theme)), 'plain output\n\n[json]{"x":42}\n\x1b[31malready colored\x1b[0m');
  assert.deepEqual(reply, snapshot);
});

test("ctx_batch highlights v2 command strings and shell prompts in reports", () => {
  const view = piRenderers("ctx_batch", ui);
  assert.match(rendered(view.renderCall({ commands: ["echo ok"], queries: ["ok"] }, theme)), /\[bash\]\$ echo ok/);
  assert.equal(rendered(view.renderResult(result('## ok\n{"x":42}\n$ echo ok'), expanded, theme)),
    '## ok\n[json]{"x":42}\n$ [bash]echo ok');
});

test("ctx_search highlights explicit fences and filename snippets without changing report framing", () => {
  const view = piRenderers("ctx_search", ui);
  const reply = result('Query "x":\nnotes.md #0: ~~~py\nprint(42)\n~~~\nsrc/a.ts #1: const x = 42;\n  const y = x;\nMore: next');
  assert.equal(rendered(view.renderResult(reply, expanded, theme)),
    'Query "x":\nnotes.md #0: ~~~py\n[python]print(42)\n~~~\nsrc/a.ts #1: [typescript]const x = 42;\n[typescript]  const y = x;\nMore: next');
  const incomplete = result("notes.md #0: ```py\nprint(42)");
  assert.equal(rendered(view.renderResult(incomplete, expanded, theme)), incomplete.content[0].text);
});

test("collapsed rows are bounded and the existing component is reusable", () => {
  const view = piRenderers("ctx_execute", ui);
  const reply = result(Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"));
  const compact = view.renderResult(reply, { expanded: false, isPartial: false }, theme, { keyHint: () => "Ctrl+O to expand" });
  assert.match(rendered(compact), /line 8\n… \(Ctrl\+O to expand\)$/);
  assert.equal(view.renderResult(reply, expanded, theme, { lastComponent: compact }), compact);
  assert.equal(rendered(compact), reply.content[0].text);
});
