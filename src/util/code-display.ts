import { basename, extname } from "node:path";

/** A fence longer than any backtick run in the content preserves literal source,
 * including strings/comments that themselves contain Markdown examples. */
export function codeFence(code: string): string {
  let length = 3;
  for (const run of code.matchAll(/`+/g)) length = Math.max(length, run[0].length + 1);
  return "`".repeat(length);
}

export function fencedCode(code: string, language: string): string {
  const fence = codeFence(code);
  return `${fence}${language}\n${code}\n${fence}`;
}

// Deliberately an allowlist: documentation, extensionless text and unknown file
// types keep their existing Markdown. This is filetype mapping, not detection.
const SOURCE_LANGUAGES = new Map<string, string>([
  [".sh", "bash"], [".bash", "bash"], [".zsh", "bash"], [".ps1", "powershell"],
  [".js", "javascript"], [".mjs", "javascript"], [".cjs", "javascript"], [".jsx", "jsx"],
  [".ts", "typescript"], [".mts", "typescript"], [".cts", "typescript"], [".tsx", "tsx"],
  [".py", "python"], [".rb", "ruby"], [".php", "php"], [".lua", "lua"], [".pl", "perl"],
  [".go", "go"], [".rs", "rust"], [".c", "c"], [".h", ""],
  [".cc", "cpp"], [".cpp", "cpp"], [".cxx", "cpp"], [".hpp", "cpp"], [".hxx", "cpp"],
  [".java", "java"], [".kt", "kotlin"], [".kts", "kotlin"], [".scala", "scala"],
  [".cs", "csharp"], [".swift", "swift"], [".r", "r"], [".nix", "nix"], [".sql", "sql"],
  [".json", "json"], [".yaml", "yaml"], [".yml", "yaml"], [".toml", "toml"],
  [".xml", "xml"], [".html", "html"], [".css", "css"], [".scss", "scss"],
  [".log", ""], [".jsonl", ""], [".ndjson", ""],
]);
const SOURCE_BASENAMES = new Map<string, string>([
  ["dockerfile", "dockerfile"], ["containerfile", "dockerfile"],
  ["makefile", "makefile"], ["gnumakefile", "makefile"],
]);

/** Resolve only an actual backing file path, never an arbitrary display label.
 * Empty string means a plain literal block (logs or ambiguous code filetypes);
 * undefined means preserve existing Markdown. Does not read the file. */
export function languageForSourcePath(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const name = basename(path.replaceAll("\\", "/")).toLowerCase();
  return SOURCE_BASENAMES.get(name) ?? SOURCE_LANGUAGES.get(extname(name));
}
