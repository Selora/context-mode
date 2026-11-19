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
export interface PiRendering {
    Text: new (text: string, paddingX: number, paddingY: number) => DisplayComponent;
    Markdown: new (text: string, paddingX: number, paddingY: number, theme: unknown) => DisplayComponent;
    highlightCode(code: string, language?: string): string[];
    getMarkdownTheme(): unknown;
    keyHint?(action: string, description: string): string;
}
export declare function loadPiRendering(importer: (name: string) => Promise<any>): Promise<PiRendering | undefined>;
export declare function hasAnsiColor(text: string): boolean;
export declare function isJsonContainer(text: string): boolean;
export declare function closingFence(lines: string[], start: number): number;
/** Highlight explicitly identified code. Preserve native colours and fall back
 * to literal text if the host cannot highlight it. Never infer stdout's language
 * from the program that produced it. */
export declare function highlightCode(code: string, language: string, ui: PiRendering): string;
/** Apply explicit fence/prompt hints and complete JSON detection to terminal
 * output. Other text retains its literal formatting, indentation and colours;
 * it is never interpreted as general Markdown. */
export declare function highlightTerminalOutput(output: string, ui: PiRendering, theme: RenderTheme): string;
/** All Markdown consumers use the same aliases, ANSI preservation and fallback. */
export declare function renderMarkdown(text: string, ui: PiRendering): DisplayComponent;
/** A fallback colour (e.g. error) must not overwrite syntax or subprocess colours. */
export declare function renderTerminalOutput(text: string, ui: PiRendering, theme: RenderTheme, fallbackColor?: string): DisplayComponent;
