import "../setup-home";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentStore } from "../../src/store.js";
import { extractSnippet, formatSearchResult } from "../../src/server.js";
import { fencedCode, languageForSourcePath } from "../../src/util/code-display.js";
import { fencedCode as piFencedCode } from "../../src/adapters/pi/presentation.js";

describe("backing-file display hints", () => {
  it.each<[string | null | undefined, string | undefined]>([
    ["/tmp/backup.sh", "bash"], ["/tmp/worker.py", "python"],
    ["/tmp/component.TSX", "tsx"], ["C:\\work\\build.ts", "typescript"],
    ["/tmp/config.nix", "nix"], ["/tmp/data.json", "json"],
    ["/tmp/application.log", ""], ["/tmp/events.jsonl", ""], ["/tmp/api.h", ""],
    ["/tmp/Dockerfile", "dockerfile"], ["C:\\work\\Makefile", "makefile"],
    ["/tmp/guide.md", undefined], ["/tmp/page.mdx", undefined],
    ["/tmp/notes.txt", undefined], ["/tmp/guide.rst", undefined],
    ["/tmp/unknown.xyz", undefined], ["/tmp/script", undefined],
    [null, undefined], [undefined, undefined],
  ])("maps %s conservatively", (path, expected) => {
    expect(languageForSourcePath(path)).toBe(expected);
  });

  it("shares fence construction with Pi rather than importing a host renderer into the server", () => {
    expect(piFencedCode).toBe(fencedCode);
  });
});

describe("selective search result wrapping", () => {
  let scratch: string;
  let store: ContentStore;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "ctx-search-format-"));
    store = new ContentStore(join(scratch, "index.db"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    store.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  function fileResult(name: string, content: string, source = "fixture") {
    const path = join(scratch, name);
    writeFileSync(path, content);
    store.index({ path, source });
    const result = store.searchWithFallback("staging", 1, source)[0];
    expect(result).toBeDefined();
    // Keep non-timeline expectations independent of the database clock.
    return { ...result, timestamp: undefined };
  }

  it("fences source based on the backing path, not its misleading display label or prose classification", () => {
    const result = fileResult("backup.sh", 'staging=$(mktemp "${destination}.XXXXXX")\ntrap \'rm -f -- "$staging"\' EXIT', "guide.md");
    expect(result.contentType).toBe("prose");
    const before = JSON.stringify(result);
    const formatted = formatSearchResult(store, Object.freeze(result), "staging");
    expect(formatted).toBe(`--- [current-session | guide.md] ---\n### ${result.title}\n\n${fencedCode(result.content, "bash")}`);
    expect(JSON.stringify(result)).toBe(before);
    expect(store.searchWithFallback("staging", 1, "guide.md")[0].content).toBe(result.content);
  });

  it("wraps logs literally without inventing a syntax language", () => {
    const result = fileResult("application.log", "2026-09-30T16:00:00Z ERROR staging failed *literal*\n    keep indentation");
    expect(formatSearchResult(store, result, "staging")).toContain(`\n\n\`\`\`\n${result.content}\n\`\`\``);
  });

  it("preserves Markdown and its existing nested examples despite a code classification or misleading label", () => {
    const content = 'Use **staging** with [docs](https://example.com).\n\n```bash\nprintf staging\n```';
    const result = fileResult("guide.md", content, "fake.py");
    expect(result.contentType).toBe("code");
    expect(formatSearchResult(store, result, "staging"))
      .toBe(`--- [current-session | fake.py] ---\n### ${result.title}\n\n${result.content}`);
  });

  it.each(["notes.txt", "unknown.xyz", "script"])("leaves ambiguous backing file %s unchanged", (name) => {
    const result = fileResult(name, "**staging** details");
    expect(formatSearchResult(store, result, "staging")).toMatch(/\n\n\*\*staging\*\* details$/);
  });

  it("does not infer filetype from an unbacked source label", () => {
    store.index({ content: "**staging** details", source: "/tmp/misleading.sh" });
    const result = store.searchWithFallback("staging", 1)[0];
    expect(formatSearchResult(store, result, "staging")).toMatch(/\n\n\*\*staging\*\* details$/);
  });

  it.each(["prior-session", "auto-memory"])("does not use a same-label store file for %s results", (origin) => {
    const result = fileResult("backup.sh", "staging=1", "collision");
    const lookup = vi.spyOn(store, "getSourceMeta");
    const formatted = formatSearchResult(store, { ...result, origin, content: "**staging** notes" }, "staging");
    expect(formatted).toMatch(/\n\n\*\*staging\*\* notes$/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps timeline headers outside source fences", () => {
    const result = fileResult("worker.py", "staging = 1");
    expect(formatSearchResult(store, { ...result, origin: "current-session", timestamp: "2026-09-30T16:24:00Z" }, "staging"))
      .toBe(`--- [current-session | 2026-09-30 16:24 | fixture] ---\n### ${result.title}\n\n\`\`\`python\nstaging = 1\n\`\`\``);
  });

  it("uses a longer fence for literal backticks in source", () => {
    const result = fileResult("worker.py", 'staging = "```python"\nexample = "````"');
    expect(formatSearchResult(store, result, "staging"))
      .toContain(`\n\n\`\`\`\`\`python\n${result.content}\n\`\`\`\`\``);
  });

  it("wraps the existing truncated snippet without changing match windows", () => {
    const result = fileResult("worker.py", "pass\n".repeat(400) + "staging = 1\n" + "pass\n".repeat(400));
    expect(result.content.length).toBeGreaterThan(1500);
    const snippet = extractSnippet(result.content, "staging", 1500, result.highlighted);
    expect(snippet).toContain("…");
    expect(formatSearchResult(store, result, "staging")).toContain(fencedCode(snippet, "python"));
  });
});
