/** Tool-specific Pi adapters: extract display content and select its presentation.
 * Never rewrites tool arguments or model-facing content. */
import { closingFence, codeFence, fencedCode, hasAnsiColor, highlightCode, highlightTerminalOutput, isJsonContainer, renderMarkdown, renderTerminalOutput, } from "./presentation.js";
// Preserve the existing entrypoint for the bridge and Pi's extension loader.
export { loadPiRendering, highlightTerminalOutput } from "./presentation.js";
const MARKDOWN_TOOLS = new Set([
    "ctx_search", "ctx_index", "ctx_fetch_and_index", "ctx_stats", "ctx_doctor", "ctx_batch_execute",
]);
const PREVIEW_LINES = 8;
const PREVIEW_CHARS = 2000;
/** Batch results are reports, not raw stdout. Fence only recognised command
 * inventory entries, shell echoes and complete JSON paragraphs for Pi Markdown.
 * Existing code fences are left intact, including those with blank lines. */
function batchMarkdown(output) {
    const lines = output.split("\n");
    const rendered = [];
    let commands = false;
    for (let i = 0; i < lines.length; i++) {
        const end = closingFence(lines, i);
        if (end >= 0) {
            rendered.push(...lines.slice(i, end + 1));
            i = end;
            continue;
        }
        if (/^\s*(`{3,}|~{3,})\s*[\w#+.-]*\s*$/.test(lines[i])) {
            // A truncated search excerpt may end inside a code block.
            rendered.push(...lines.slice(i));
            break;
        }
        if (/^## /.test(lines[i]))
            commands = lines[i] === "## Commands";
        const inventory = commands && lines[i].match(/^- (.+): `(.+)`$/);
        if (inventory) {
            rendered.push(`- ${inventory[1]}:\n\n${fencedCode(inventory[2], "bash")}\n`);
        }
        else if (/^\$\s+/.test(lines[i])) {
            rendered.push(`\n${fencedCode(lines[i], "bash")}\n`);
        }
        else if ((i === 0 || !lines[i - 1].trim()) && /^\s*[\[{]/.test(lines[i])) {
            let end = i + 1;
            while (end < lines.length && lines[end].trim())
                end++;
            const paragraph = lines.slice(i, end).join("\n");
            if (isJsonContainer(paragraph)) {
                rendered.push(fencedCode(paragraph, "json"));
                i = end - 1;
            }
            else {
                rendered.push(lines[i]);
            }
        }
        else {
            rendered.push(lines[i]);
        }
    }
    return rendered.join("\n");
}
/** Match the server's buildExecuteEcho contract exactly; never strip arbitrary
 * fences or command output. Missing args (e.g. an old transcript) keep the echo. */
function withoutSourceEcho(toolName, output, input) {
    if (toolName !== "ctx_execute" && toolName !== "ctx_execute_file")
        return output;
    if (!input || typeof input !== "object")
        return output;
    const args = input;
    if (typeof args.code !== "string" || !args.code || typeof args.language !== "string")
        return output;
    if (toolName === "ctx_execute_file" && typeof args.path !== "string")
        return output;
    const path = toolName === "ctx_execute_file" ? `path=${args.path}\n` : "";
    // CODE_ECHO_MAX in server.ts; only a confirmed prefix is hidden in the UI.
    const code = args.code.length > 2000 ? args.code.slice(0, 2000) + "\n… (truncated)" : args.code;
    const echo = `${path}\`\`\`${args.language}\n${code}\n\`\`\`\n\n`;
    return output.startsWith(echo) ? output.slice(echo.length) : output;
}
function stringArg(args, name) {
    return typeof args[name] === "string" ? args[name] : "";
}
export function createContextModeRenderers(toolName, ui) {
    return {
        renderCall(input, theme, context = {}) {
            const args = input && typeof input === "object" ? input : {};
            let title = theme.fg("toolTitle", theme.bold(toolName));
            const language = stringArg(args, "language");
            const path = stringArg(args, "path");
            const source = stringArg(args, "source");
            if (language)
                title += " " + theme.fg("muted", language);
            if (path)
                title += " " + theme.fg("accent", path);
            if (source)
                title += " " + theme.fg("muted", `source=${source}`);
            if (Array.isArray(args.queries)) {
                title += " " + theme.fg("accent", args.queries.filter((q) => typeof q === "string").join(" · "));
            }
            const url = stringArg(args, "url");
            if (url)
                title += " " + theme.fg("accent", url);
            const code = stringArg(args, "code");
            if (code) {
                const preview = context.expanded ? code : code.split("\n").slice(0, PREVIEW_LINES).join("\n").slice(0, PREVIEW_CHARS);
                const fence = codeFence(preview);
                title += "\n" + theme.fg("dim", fence + language) + "\n" + highlightCode(preview, language, ui)
                    + "\n" + theme.fg("dim", fence);
                if (preview !== code)
                    title += "\n" + theme.fg("dim", "… expand to see full code");
            }
            if (Array.isArray(args.commands)) {
                const commands = context.expanded ? args.commands : args.commands.slice(0, PREVIEW_LINES);
                for (const item of commands) {
                    if (!item || typeof item !== "object" || typeof item.command !== "string")
                        continue;
                    const command = context.expanded ? item.command : item.command.slice(0, PREVIEW_CHARS);
                    title += "\n" + theme.fg("dim", "$ ") + highlightCode(command, "bash", ui);
                    if (command !== item.command)
                        title += theme.fg("dim", " … expand for full command");
                }
                if (commands.length !== args.commands.length)
                    title += "\n" + theme.fg("dim", "… expand for all commands");
            }
            return new ui.Text(title, 0, 0);
        },
        renderResult(result, { expanded, isPartial }, theme, context = {}) {
            if (isPartial)
                return new ui.Text(theme.fg("warning", "working…"), 0, 0);
            const raw = (result.content ?? [])
                .filter((c) => c?.type === "text" && typeof c.text === "string")
                .map((c) => c.text).join("\n");
            const output = withoutSourceEcho(toolName, raw, context.args);
            const isError = context.isError || result.isError;
            if (!output.trim())
                return new ui.Text(theme.fg("dim", "(no output)"), 0, 0);
            if (!expanded) {
                const lines = output.trim().split(/\r?\n/);
                const firstLine = lines[0].trim();
                const shortened = firstLine.length > 180 || /^(```|~~~|path=)/.test(firstLine);
                const summary = shortened ? `${toolName} ${isError ? "failed" : "completed"}` : firstLine;
                const displayed = highlightTerminalOutput(summary, ui, theme);
                let text = hasAnsiColor(displayed) ? displayed
                    : theme.fg(isError ? "error" : "toolOutput", displayed);
                if (shortened || lines.length > 1) {
                    const remaining = shortened ? "" : `: ${lines.length - 1} more ${lines.length === 2 ? "line" : "lines"}`;
                    const hint = ui.keyHint?.("app.tools.expand", "to expand") ?? "expand for full output";
                    text += "\n" + theme.fg("dim", `… (preview truncated${remaining}; ${hint})`);
                }
                return new ui.Text(text, 0, 0);
            }
            if (isError)
                return renderTerminalOutput(output, ui, theme, "error");
            if (MARKDOWN_TOOLS.has(toolName)) {
                return renderMarkdown(toolName === "ctx_batch_execute" ? batchMarkdown(output) : output, ui);
            }
            return renderTerminalOutput(output, ui, theme);
        },
    };
}
