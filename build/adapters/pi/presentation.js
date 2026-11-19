/** Shared Pi presentation primitives. No tool names, response parsing contracts,
 * execution, or model-facing content changes belong in this layer. */
export { codeFence, fencedCode } from "../../util/code-display.js";
export async function loadPiRendering(importer) {
    try {
        const tui = await importer("@earendil-works/pi-tui");
        const agent = await importer("@earendil-works/pi-coding-agent");
        if ([tui.Text, tui.Markdown, agent.highlightCode, agent.getMarkdownTheme]
            .some((value) => typeof value !== "function"))
            return undefined;
        return {
            Text: tui.Text,
            Markdown: tui.Markdown,
            highlightCode: agent.highlightCode,
            getMarkdownTheme: agent.getMarkdownTheme,
            keyHint: typeof agent.keyHint === "function" ? agent.keyHint : undefined,
        };
    }
    catch {
        // CLI-only consumers and non-Pi hosts can still use the plain renderer.
        return undefined;
    }
}
const LANGUAGE_ALIASES = {
    shell: "bash", sh: "bash", zsh: "bash", js: "javascript", ts: "typescript",
    py: "python", "c#": "csharp",
};
const ANSI_COLOR = /\u001b\[[\d;:]*m/;
export function hasAnsiColor(text) {
    return ANSI_COLOR.test(text);
}
// Detection is only a hint for colouring the original bytes, never a JSON
// round-trip (which could change whitespace, duplicate keys, or large numbers).
export function isJsonContainer(text) {
    if (hasAnsiColor(text) || !/^[\s]*[\[{]/.test(text))
        return false;
    try {
        JSON.parse(text);
        return true;
    }
    catch {
        return false;
    }
}
export function closingFence(lines, start) {
    const opening = lines[start].match(/^\s*(`{3,}|~{3,})\s*[\w#+.-]*\s*$/);
    if (!opening)
        return -1;
    const marker = opening[1];
    const close = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`);
    for (let end = start + 1; end < lines.length; end++) {
        if (close.test(lines[end]))
            return end;
    }
    return -1;
}
/** Highlight explicitly identified code. Preserve native colours and fall back
 * to literal text if the host cannot highlight it. Never infer stdout's language
 * from the program that produced it. */
export function highlightCode(code, language, ui) {
    if (hasAnsiColor(code))
        return code;
    try {
        const normalized = language.toLowerCase();
        return ui.highlightCode(code, LANGUAGE_ALIASES[normalized] ?? normalized).join("\n");
    }
    catch {
        return code;
    }
}
/** Apply explicit fence/prompt hints and complete JSON detection to terminal
 * output. Other text retains its literal formatting, indentation and colours;
 * it is never interpreted as general Markdown. */
export function highlightTerminalOutput(output, ui, theme) {
    const lines = output.split("\n");
    const rendered = [];
    let plain = [];
    const flush = () => {
        if (plain.length === 0)
            return;
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
        }
        else {
            plain.push(lines[i]);
        }
    }
    flush();
    return rendered.join("\n");
}
/** All Markdown consumers use the same aliases, ANSI preservation and fallback. */
export function renderMarkdown(text, ui) {
    return new ui.Markdown(text, 0, 0, {
        ...ui.getMarkdownTheme(),
        highlightCode: (code, language) => highlightCode(code, language ?? "", ui).split("\n"),
    });
}
/** A fallback colour (e.g. error) must not overwrite syntax or subprocess colours. */
export function renderTerminalOutput(text, ui, theme, fallbackColor) {
    const displayed = highlightTerminalOutput(text, ui, theme);
    return new ui.Text(fallbackColor && !hasAnsiColor(displayed) ? theme.fg(fallbackColor, displayed) : displayed, 0, 0);
}
