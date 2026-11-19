/** A fence longer than any backtick run in the content preserves literal source,
 * including strings/comments that themselves contain Markdown examples. */
export declare function codeFence(code: string): string;
export declare function fencedCode(code: string, language: string): string;
/** Resolve only an actual backing file path, never an arbitrary display label.
 * Empty string means a plain literal block (logs or ambiguous code filetypes);
 * undefined means preserve existing Markdown. Does not read the file. */
export declare function languageForSourcePath(path: string | null | undefined): string | undefined;
