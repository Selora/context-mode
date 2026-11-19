/** Tool-specific Pi adapters: extract display content and select its presentation.
 * Never rewrites tool arguments or model-facing content. */
import { type DisplayComponent, type PiRendering, type RenderTheme } from "./presentation.js";
export { loadPiRendering, highlightTerminalOutput } from "./presentation.js";
export type { DisplayComponent, PiRendering, RenderTheme } from "./presentation.js";
export interface RenderContext {
    args?: unknown;
    expanded?: boolean;
    isError?: boolean;
    lastComponent?: unknown;
}
export declare function createContextModeRenderers(toolName: string, ui: PiRendering): {
    renderCall(input: unknown, theme: RenderTheme, context?: RenderContext): DisplayComponent;
    renderResult(result: {
        content?: ReadonlyArray<{
            type?: string;
            text?: string;
        }>;
        isError?: boolean;
    }, { expanded, isPartial }: {
        expanded: boolean;
        isPartial: boolean;
    }, theme: RenderTheme, context?: RenderContext): DisplayComponent;
};
