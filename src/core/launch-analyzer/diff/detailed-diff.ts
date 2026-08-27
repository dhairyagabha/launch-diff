import { parse } from "@babel/parser";
import * as t from "@babel/types";
import { resourceGraphId } from "../dependencies/data-elements";
import type {
  ChangeStatus,
  ComparisonResult,
  DetailedDiff,
  DiffHunk,
  DiffLine,
  DiffToken,
  FunctionFold,
  LaunchResource,
  ResourceComparison,
  SourceLineRange,
  SplitDiffRow,
  SyntaxToken
} from "../model/types";

const DEFAULT_CONTEXT_LINE_COUNT = 3;
const MAX_DIFF_LCS_CELLS = 1_000_000;
const MAX_DIFF_DISPLAY_SOURCE_CHARS = 750_000;
const MAX_DIFF_LINE_CHARS = 12_000;
const MAX_INLINE_DIFF_CELLS = 750_000;
const MAX_SYNTAX_LINE_CHARS = 2_000;
const MAX_FUNCTION_FOLD_SOURCE_CHARS = 500_000;

export interface BuildDetailedDiffInput {
  baseSource?: string;
  compareSource?: string;
  fileId?: string;
  language?: DetailedDiff["language"];
  contextLineCount?: number;
}

export interface DetailedDiffQueueItem {
  id: string;
  resourceKey: string;
  comparisonIndex: number;
  priority: number;
  cacheKey: string;
}

export interface DetailedDiffQueueOptions {
  selectedResourceKey?: string;
}

export interface PopulateDetailedDiffOptions extends DetailedDiffQueueOptions {
  contextLineCount?: number;
  cache?: Map<string, DetailedDiff>;
}

interface LineDiffOperation {
  type: "context" | "added" | "removed";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

interface ParsedFunctionRange {
  id: string;
  name?: string;
  kind: FunctionFold["kind"];
  range: SourceLineRange;
  matchKey: string;
}

export function buildDetailedDiff(input: BuildDetailedDiffInput): DetailedDiff {
  const language = input.language ?? detectDiffLanguage(input.baseSource, input.compareSource);

  if (language === "binary") {
    return {
      fileId: input.fileId ?? "binary",
      language,
      baseDisplaySource: input.baseSource,
      compareDisplaySource: input.compareSource,
      hunks: [],
      binaryChanged: input.baseSource !== input.compareSource,
      functionFolds: []
    };
  }

  const baseLines = splitSourceLines(input.baseSource);
  const compareLines = splitSourceLines(input.compareSource);
  const displayLimitWarning = oversizedDiffDisplayWarning(
    input.baseSource,
    input.compareSource,
    baseLines,
    compareLines
  );

  if (displayLimitWarning) {
    return buildLimitedDetailedDiff(input, language, baseLines, compareLines, displayLimitWarning);
  }

  const rows = buildSplitRows(diffLines(baseLines, compareLines), language);
  const hunks = buildHunks(rows, input.contextLineCount ?? DEFAULT_CONTEXT_LINE_COUNT);

  return {
    fileId: input.fileId ?? "source",
    language,
    baseDisplaySource: input.baseSource,
    compareDisplaySource: input.compareSource,
    hunks,
    functionFolds: buildFunctionFolds(input.baseSource, input.compareSource, rows, language)
  };
}

function oversizedDiffDisplayWarning(
  baseSource: string | undefined,
  compareSource: string | undefined,
  baseLines: string[],
  compareLines: string[]
): string | undefined {
  const totalCharacters = (baseSource?.length ?? 0) + (compareSource?.length ?? 0);

  if (totalCharacters > MAX_DIFF_DISPLAY_SOURCE_CHARS) {
    return [
      "Line-level rendering was limited because this resource is very large.",
      "The deployed artifact is still used for change classification; provide a non-minified Adobe Tags environment URL for readable review."
    ].join(" ");
  }

  if (baseLines.some(isOversizedLine) || compareLines.some(isOversizedLine)) {
    return [
      "Line-level rendering was limited because this resource contains a very long minified line.",
      "The deployed artifact is still used for change classification; provide a non-minified Adobe Tags environment URL for readable review."
    ].join(" ");
  }

  if (baseLines.length * compareLines.length > MAX_DIFF_LCS_CELLS) {
    return [
      "Line-level rendering was limited because this resource has too many lines for an interactive split diff.",
      "The deployed artifact is still used for change classification; provide a non-minified Adobe Tags environment URL for readable review."
    ].join(" ");
  }
}

function isOversizedLine(line: string): boolean {
  return line.length > MAX_DIFF_LINE_CHARS;
}

function buildLimitedDetailedDiff(
  input: BuildDetailedDiffInput,
  language: DetailedDiff["language"],
  baseLines: string[],
  compareLines: string[],
  warning: string
): DetailedDiff {
  const row: SplitDiffRow = {
    id: "row:0",
    ...(input.baseSource !== undefined
      ? {
          base: createSummaryDiffLine("removed", "base", baseLines.length, warning)
        }
      : {}),
    ...(input.compareSource !== undefined
      ? {
          compare: createSummaryDiffLine("added", "compare", compareLines.length, warning)
        }
      : {}),
    changed: true
  };

  return {
    fileId: input.fileId ?? "source",
    language,
    baseDisplaySource:
      input.baseSource === undefined ? undefined : displaySourceSummary("Base", baseLines, warning),
    compareDisplaySource:
      input.compareSource === undefined
        ? undefined
        : displaySourceSummary("Compare", compareLines, warning),
    displayWarning: warning,
    hunks: [
      {
        id: "hunk:1",
        oldStart: baseLines.length > 0 ? 1 : 0,
        oldLines: baseLines.length,
        newStart: compareLines.length > 0 ? 1 : 0,
        newLines: compareLines.length,
        lines: flattenRowsToLines([row]),
        rows: [row],
        collapsed: false
      }
    ],
    functionFolds: []
  };
}

function createSummaryDiffLine(
  type: DiffLine["type"],
  side: "base" | "compare",
  sourceLineCount: number,
  warning: string
): DiffLine {
  return {
    id: `row:0:${side}`,
    type,
    side,
    oldLineNumber: side === "base" && sourceLineCount > 0 ? 1 : undefined,
    newLineNumber: side === "compare" && sourceLineCount > 0 ? 1 : undefined,
    content: warning,
    syntaxTokens: [{ value: warning, kind: "text" }]
  };
}

function displaySourceSummary(side: "Base" | "Compare", lines: string[], warning: string): string {
  const lineLabel = lines.length === 1 ? "1 line" : `${lines.length} lines`;

  return `${side} source display limited (${lineLabel}). ${warning}\n`;
}

export function createDetailedDiffQueue(
  comparisons: ResourceComparison[],
  options: DetailedDiffQueueOptions = {}
): DetailedDiffQueueItem[] {
  return comparisons
    .map((comparison, comparisonIndex) => ({ comparison, comparisonIndex }))
    .filter(({ comparison }) => shouldGenerateDetailedDiff(comparison))
    .map(({ comparison, comparisonIndex }) => {
      const resourceKey = comparisonResourceKey(comparison);
      const selected = resourceKey === options.selectedResourceKey;

      return {
        id: `detailed-diff:${comparisonIndex}:${resourceKey}`,
        resourceKey,
        comparisonIndex,
        priority: selected ? 0 : comparisonIndex + 1,
        cacheKey: detailedDiffCacheKey(comparison)
      };
    })
    .sort((left, right) => left.priority - right.priority);
}

export function enqueueDetailedDiffs(
  comparisons: ResourceComparison[],
  options: DetailedDiffQueueOptions = {}
): ResourceComparison[] {
  const queuedIndexes = new Set(
    createDetailedDiffQueue(comparisons, options).map((item) => item.comparisonIndex)
  );

  return comparisons.map((comparison, index) =>
    queuedIndexes.has(index)
      ? {
          ...comparison,
          detailedDiffState: "queued"
        }
      : comparison
  );
}

export function populateDetailedDiffs(
  comparisons: ResourceComparison[],
  options: PopulateDetailedDiffOptions = {}
): ResourceComparison[] {
  const queue = createDetailedDiffQueue(comparisons, options);
  const generated = new Map<number, DetailedDiff>();

  for (const item of queue) {
    const comparison = comparisons[item.comparisonIndex]!;
    const cached = options.cache?.get(item.cacheKey);
    const detailedDiff =
      cached ?? buildDetailedDiff(comparisonToDetailedDiffInput(comparison, options));

    options.cache?.set(item.cacheKey, detailedDiff);
    generated.set(item.comparisonIndex, detailedDiff);
  }

  return comparisons.map((comparison, index) => {
    const detailedDiff = generated.get(index);

    if (!detailedDiff) {
      return comparison;
    }

    return {
      ...comparison,
      detailedDiffState: "ready",
      detailedDiff
    };
  });
}

export function populateComparisonDetailedDiffs(
  comparison: ComparisonResult,
  options: PopulateDetailedDiffOptions = {}
): ComparisonResult {
  return {
    ...comparison,
    resources: populateDetailedDiffs(comparison.resources, options)
  };
}

export function detailedDiffCacheKey(comparison: ResourceComparison): string {
  return [
    comparison.status,
    comparison.base?.contentFingerprint ?? "none",
    comparison.compare?.contentFingerprint ?? "none",
    comparisonFileId(comparison)
  ].join(":");
}

export function comparisonResourceKey(comparison: ResourceComparison): string {
  const resource = comparison.compare ?? comparison.base;

  return resource ? resourceGraphId(resource) : "unidentified";
}

export function tokenizeSyntaxLine(
  content: string,
  language: DetailedDiff["language"]
): SyntaxToken[] {
  if (language === "html") {
    return tokenizeHtmlLine(content);
  }

  if (language === "css") {
    return tokenizeCodeLikeLine(content, cssKeywords());
  }

  if (language === "javascript" || language === "json") {
    return tokenizeCodeLikeLine(content, codeKeywords(language));
  }

  return tokenizePlainTextLine(content);
}

function comparisonToDetailedDiffInput(
  comparison: ResourceComparison,
  options: PopulateDetailedDiffOptions
): BuildDetailedDiffInput {
  const baseSource = comparison.base ? resourceSource(comparison.base) : undefined;
  const compareSource = comparison.compare ? resourceSource(comparison.compare) : undefined;

  return {
    baseSource,
    compareSource,
    fileId: comparisonFileId(comparison),
    language: detectDiffLanguage(baseSource, compareSource),
    contextLineCount: options.contextLineCount
  };
}

function shouldGenerateDetailedDiff(comparison: ResourceComparison): boolean {
  if (!isChangedStatus(comparison.status)) {
    return false;
  }

  return Boolean(
    (comparison.base && resourceSource(comparison.base) !== undefined) ||
    (comparison.compare && resourceSource(comparison.compare) !== undefined)
  );
}

function isChangedStatus(status: ChangeStatus): boolean {
  return status === "added" || status === "removed" || status === "modified";
}

function resourceSource(resource: LaunchResource): string | undefined {
  const displaySource = resourceDisplaySource(resource.normalized);

  if (displaySource !== undefined) {
    return displaySource;
  }

  if (resource.normalizedSource !== undefined) {
    return resource.normalizedSource;
  }

  if (typeof resource.normalized === "string") {
    return resource.normalized;
  }
}

function resourceDisplaySource(value: unknown): string | undefined {
  try {
    if (typeof value === "string") {
      return `${looksLikeJavaScriptSource(value) ? formatJavaScriptLikeSource(value) : value}\n`;
    }

    return `${renderDisplayValue(value, 0)}\n`;
  } catch {
    return undefined;
  }
}

function renderDisplayValue(value: unknown, depth: number): string {
  if (typeof value === "string") {
    return renderDisplayString(value, depth);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return renderDisplayArray(value, depth);
  }

  if (value === undefined) {
    return "undefined";
  }

  if (value && typeof value === "object") {
    return renderDisplayObject(value as Record<string, unknown>, depth);
  }

  return JSON.stringify(value);
}

function renderDisplayArray(values: unknown[], depth: number): string {
  if (values.length === 0) {
    return "[]";
  }

  const childIndent = indentation(depth + 1);
  const currentIndent = indentation(depth);
  const rendered = values.map((value) => `${childIndent}${renderDisplayValue(value, depth + 1)}`);

  return `[\n${rendered.join(",\n")}\n${currentIndent}]`;
}

function renderDisplayObject(value: Record<string, unknown>, depth: number): string {
  const entries = Object.entries(value);

  if (entries.length === 0) {
    return "{}";
  }

  const childIndent = indentation(depth + 1);
  const currentIndent = indentation(depth);
  const rendered = entries.map(
    ([key, entryValue]) =>
      `${childIndent}${displayObjectKey(key)}: ${renderDisplayValue(entryValue, depth + 1)}`
  );

  return `{\n${rendered.join(",\n")}\n${currentIndent}}`;
}

function renderDisplayString(value: string, depth: number): string {
  const displayValue = looksLikeJavaScriptSource(value) ? formatJavaScriptLikeSource(value) : value;

  if (displayValue.includes("\n")) {
    const childIndent = indentation(depth + 1);
    const lines = splitSourceLines(displayValue).map((line) => `${childIndent}${line}`);

    return `|\n${lines.join("\n")}`;
  }

  return JSON.stringify(displayValue);
}

function displayObjectKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function indentation(depth: number): string {
  return "  ".repeat(depth);
}

function looksLikeJavaScriptSource(value: string): boolean {
  const trimmed = value.trim();

  return (
    /\b(function|return|const|let|var|if|for|while|class|new)\b/.test(trimmed) ||
    /_satellite\.(getVar|track|logger)/.test(trimmed) ||
    (trimmed.includes("{") && trimmed.includes(";"))
  );
}

function formatJavaScriptLikeSource(source: string): string {
  const lines: string[] = [];
  let current = "";
  let blockDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: string | undefined;
  let escaped = false;

  function depth() {
    return blockDepth + bracketDepth;
  }

  function pushLine() {
    const trimmed = current.trim();

    if (trimmed) {
      lines.push(`${indentation(depth())}${trimmed}`);
    }

    current = "";
  }

  function appendCollapsedSpace() {
    if (current && !/\s$/.test(current)) {
      current += " ";
    }
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;

    if (quote) {
      current += character;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = undefined;
      }

      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "{") {
      current = `${current.trimEnd()} {`;
      pushLine();
      blockDepth += 1;
      continue;
    }

    if (character === "}") {
      pushLine();
      blockDepth = Math.max(0, blockDepth - 1);
      current = "}";
      continue;
    }

    if (character === "[") {
      const trimmed = current.trimEnd();
      const separator = trimmed.endsWith(":") ? " " : "";

      current = `${trimmed}${separator}[`;
      pushLine();
      bracketDepth += 1;
      continue;
    }

    if (character === "]") {
      pushLine();
      bracketDepth = Math.max(0, bracketDepth - 1);
      current = "]";
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      current += character;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += character;
      continue;
    }

    if (character === ",") {
      current = `${current.trimEnd()},`;

      if (blockDepth > 0 || bracketDepth > 0 || parenDepth === 0) {
        pushLine();
      } else {
        current += " ";
      }

      continue;
    }

    if (character === ";") {
      current = `${current.trimEnd()};`;
      pushLine();
      continue;
    }

    if (character === ":") {
      current = `${current.trimEnd()}: `;
      continue;
    }

    if (character === "\n") {
      pushLine();
      continue;
    }

    if (character === "=" && shouldFormatAsAssignment(source, index)) {
      current = `${current.trimEnd()} = `;
      continue;
    }

    if (/\s/.test(character)) {
      appendCollapsedSpace();
      continue;
    }

    if (current === "}" && /[A-Za-z_$]/.test(character)) {
      current += " ";
    }

    current += character;
  }

  pushLine();

  return lines.length > 0 ? lines.join("\n") : source;
}

function shouldFormatAsAssignment(source: string, index: number): boolean {
  const previous = source[index - 1];
  const next = source[index + 1];

  return (
    previous !== "=" &&
    previous !== "!" &&
    previous !== "<" &&
    previous !== ">" &&
    next !== "=" &&
    next !== ">"
  );
}

function comparisonFileId(comparison: ResourceComparison): string {
  const resource = comparison.compare ?? comparison.base;
  const fileId = resource?.fileIds[0];

  return fileId ?? comparisonResourceKey(comparison);
}

function detectDiffLanguage(baseSource?: string, compareSource?: string): DetailedDiff["language"] {
  const source = (compareSource ?? baseSource ?? "").trim();

  if (!source) {
    return "text";
  }

  if (source.startsWith("<")) {
    return "html";
  }

  if ((source.startsWith("{") || source.startsWith("[")) && isJson(source)) {
    return "json";
  }

  return "javascript";
}

function splitSourceLines(source: string | undefined): string[] {
  if (!source) {
    return [];
  }

  const normalized = source.replace(/\r\n?/g, "\n");
  const withoutFinalNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;

  return withoutFinalNewline === "" ? [] : withoutFinalNewline.split("\n");
}

function diffLines(baseLines: string[], compareLines: string[]): LineDiffOperation[] {
  const matrix = buildLcsMatrix(baseLines, compareLines);
  const operations: LineDiffOperation[] = [];
  let baseIndex = 0;
  let compareIndex = 0;

  while (baseIndex < baseLines.length && compareIndex < compareLines.length) {
    if (baseLines[baseIndex] === compareLines[compareIndex]) {
      operations.push({
        type: "context",
        oldLineNumber: baseIndex + 1,
        newLineNumber: compareIndex + 1,
        content: baseLines[baseIndex]!
      });
      baseIndex += 1;
      compareIndex += 1;
      continue;
    }

    if (matrix[baseIndex + 1]![compareIndex]! >= matrix[baseIndex]![compareIndex + 1]!) {
      operations.push({
        type: "removed",
        oldLineNumber: baseIndex + 1,
        content: baseLines[baseIndex]!
      });
      baseIndex += 1;
    } else {
      operations.push({
        type: "added",
        newLineNumber: compareIndex + 1,
        content: compareLines[compareIndex]!
      });
      compareIndex += 1;
    }
  }

  while (baseIndex < baseLines.length) {
    operations.push({
      type: "removed",
      oldLineNumber: baseIndex + 1,
      content: baseLines[baseIndex]!
    });
    baseIndex += 1;
  }

  while (compareIndex < compareLines.length) {
    operations.push({
      type: "added",
      newLineNumber: compareIndex + 1,
      content: compareLines[compareIndex]!
    });
    compareIndex += 1;
  }

  return operations;
}

function buildLcsMatrix(baseLines: string[], compareLines: string[]): number[][] {
  const matrix = Array.from({ length: baseLines.length + 1 }, () =>
    Array.from({ length: compareLines.length + 1 }, () => 0)
  );

  for (let baseIndex = baseLines.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let compareIndex = compareLines.length - 1; compareIndex >= 0; compareIndex -= 1) {
      matrix[baseIndex]![compareIndex] =
        baseLines[baseIndex] === compareLines[compareIndex]
          ? matrix[baseIndex + 1]![compareIndex + 1]! + 1
          : Math.max(matrix[baseIndex + 1]![compareIndex]!, matrix[baseIndex]![compareIndex + 1]!);
    }
  }

  return matrix;
}

function buildSplitRows(
  operations: LineDiffOperation[],
  language: DetailedDiff["language"]
): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let index = 0;

  while (index < operations.length) {
    const operation = operations[index]!;

    if (operation.type === "context") {
      const base = createDiffLine(operation, "base", language, `row:${rows.length}:base`);
      const compare = createDiffLine(operation, "compare", language, `row:${rows.length}:compare`);
      rows.push({
        id: `row:${rows.length}`,
        base,
        compare,
        changed: false
      });
      index += 1;
      continue;
    }

    const removed: LineDiffOperation[] = [];
    const added: LineDiffOperation[] = [];

    while (index < operations.length && operations[index]!.type !== "context") {
      const changedOperation = operations[index]!;

      if (changedOperation.type === "removed") {
        removed.push(changedOperation);
      } else {
        added.push(changedOperation);
      }

      index += 1;
    }

    const pairCount = Math.max(removed.length, added.length);

    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const removedOperation = removed[pairIndex];
      const addedOperation = added[pairIndex];
      const inline =
        removedOperation && addedOperation
          ? diffInlineTokens(removedOperation.content, addedOperation.content)
          : undefined;

      rows.push({
        id: `row:${rows.length}`,
        base: removedOperation
          ? createDiffLine(
              removedOperation,
              "base",
              language,
              `row:${rows.length}:base`,
              inline?.base
            )
          : undefined,
        compare: addedOperation
          ? createDiffLine(
              addedOperation,
              "compare",
              language,
              `row:${rows.length}:compare`,
              inline?.compare
            )
          : undefined,
        changed: true
      });
    }
  }

  return rows;
}

function createDiffLine(
  operation: LineDiffOperation,
  side: "base" | "compare",
  language: DetailedDiff["language"],
  id: string,
  tokens?: DiffToken[]
): DiffLine {
  return {
    id,
    type: operation.type,
    side,
    oldLineNumber: side === "base" ? operation.oldLineNumber : undefined,
    newLineNumber: side === "compare" ? operation.newLineNumber : undefined,
    content: operation.content,
    ...(tokens ? { tokens } : {}),
    syntaxTokens: tokenizeSyntaxLineForDiff(operation.content, language)
  };
}

function buildHunks(rows: SplitDiffRow[], contextLineCount: number): DiffHunk[] {
  if (rows.length === 0) {
    return [];
  }

  const changedIndexes = rows.flatMap((row, index) => (row.changed ? [index] : []));

  if (changedIndexes.length === 0) {
    return [createHunk("hunk:1", rows, 0, rows.length - 1, false)];
  }

  const visibleRanges = mergeRanges(
    changedIndexes.map((index) => ({
      start: Math.max(0, index - contextLineCount),
      end: Math.min(rows.length - 1, index + contextLineCount)
    }))
  );
  const hunks: DiffHunk[] = [];
  let cursor = 0;

  for (const range of visibleRanges) {
    if (cursor < range.start) {
      hunks.push(createHunk(`hunk:${hunks.length + 1}`, rows, cursor, range.start - 1, true));
    }

    hunks.push(createHunk(`hunk:${hunks.length + 1}`, rows, range.start, range.end, false));
    cursor = range.end + 1;
  }

  if (cursor < rows.length) {
    hunks.push(createHunk(`hunk:${hunks.length + 1}`, rows, cursor, rows.length - 1, true));
  }

  return hunks;
}

function createHunk(
  id: string,
  allRows: SplitDiffRow[],
  start: number,
  end: number,
  collapsed: boolean
): DiffHunk {
  const segmentRows = allRows.slice(start, end + 1);
  const oldNumbers = segmentRows.flatMap((row) =>
    row.base?.oldLineNumber === undefined ? [] : [row.base.oldLineNumber]
  );
  const newNumbers = segmentRows.flatMap((row) =>
    row.compare?.newLineNumber === undefined ? [] : [row.compare.newLineNumber]
  );

  return {
    id,
    oldStart: oldNumbers[0] ?? 0,
    oldLines: oldNumbers.length,
    newStart: newNumbers[0] ?? 0,
    newLines: newNumbers.length,
    lines: collapsed ? [] : flattenRowsToLines(segmentRows),
    rows: collapsed ? [] : segmentRows,
    ...(collapsed ? { hiddenRows: segmentRows } : {}),
    collapsed
  };
}

function flattenRowsToLines(rows: SplitDiffRow[]): DiffLine[] {
  return rows.flatMap((row) => {
    if (row.base && row.compare && !row.changed) {
      return [
        {
          ...row.base,
          id: `${row.id}:context`,
          side: undefined,
          newLineNumber: row.compare.newLineNumber
        }
      ];
    }

    return [row.base, row.compare].filter((line): line is DiffLine => Boolean(line));
  });
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{
  start: number;
  end: number;
}> {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];

    if (!previous || range.start > previous.end + 1) {
      merged.push({ ...range });
      continue;
    }

    previous.end = Math.max(previous.end, range.end);
  }

  return merged;
}

function diffInlineTokens(
  base: string,
  compare: string
): {
  base: DiffToken[];
  compare: DiffToken[];
} | undefined {
  const baseParts = splitInlineParts(base);
  const compareParts = splitInlineParts(compare);

  if (baseParts.length * compareParts.length > MAX_INLINE_DIFF_CELLS) {
    return undefined;
  }

  const matrix = buildLcsMatrix(baseParts, compareParts);
  const baseTokens: DiffToken[] = [];
  const compareTokens: DiffToken[] = [];
  let baseIndex = 0;
  let compareIndex = 0;

  while (baseIndex < baseParts.length && compareIndex < compareParts.length) {
    if (baseParts[baseIndex] === compareParts[compareIndex]) {
      baseTokens.push({ value: baseParts[baseIndex]!, changed: false });
      compareTokens.push({ value: compareParts[compareIndex]!, changed: false });
      baseIndex += 1;
      compareIndex += 1;
      continue;
    }

    if (matrix[baseIndex + 1]![compareIndex]! >= matrix[baseIndex]![compareIndex + 1]!) {
      baseTokens.push({ value: baseParts[baseIndex]!, changed: true });
      baseIndex += 1;
    } else {
      compareTokens.push({ value: compareParts[compareIndex]!, changed: true });
      compareIndex += 1;
    }
  }

  while (baseIndex < baseParts.length) {
    baseTokens.push({ value: baseParts[baseIndex]!, changed: true });
    baseIndex += 1;
  }

  while (compareIndex < compareParts.length) {
    compareTokens.push({ value: compareParts[compareIndex]!, changed: true });
    compareIndex += 1;
  }

  return {
    base: baseTokens,
    compare: compareTokens
  };
}

function splitInlineParts(value: string): string[] {
  return value.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|\s+|./g) ?? [];
}

function tokenizeSyntaxLineForDiff(
  content: string,
  language: DetailedDiff["language"]
): SyntaxToken[] {
  if (content.length > MAX_SYNTAX_LINE_CHARS) {
    return [{ value: content, kind: "text" }];
  }

  return tokenizeSyntaxLine(content, language);
}

function tokenizePlainTextLine(content: string): SyntaxToken[] {
  return (content.match(/\s+|\S+/g) ?? []).map((value) => ({
    value,
    kind: /^\s+$/.test(value) ? "whitespace" : "text"
  }));
}

function tokenizeHtmlLine(content: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let index = 0;

  while (index < content.length) {
    const character = content[index]!;

    if (/\s/.test(character)) {
      const value = consumeWhile(content, index, (next) => /\s/.test(next));
      tokens.push({ value, kind: "whitespace" });
      index += value.length;
      continue;
    }

    if (character === "<") {
      const end = content.indexOf(">", index);
      const value = end === -1 ? content.slice(index) : content.slice(index, end + 1);
      tokens.push({ value, kind: "tag" });
      index += value.length;
      continue;
    }

    const value = consumeWhile(content, index, (next) => next !== "<" && !/\s/.test(next));
    tokens.push({ value, kind: "text" });
    index += value.length;
  }

  return tokens;
}

function tokenizeCodeLikeLine(content: string, keywords: Set<string>): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let index = 0;

  while (index < content.length) {
    const character = content[index]!;
    const nextCharacter = content[index + 1];

    if (/\s/.test(character)) {
      const value = consumeWhile(content, index, (next) => /\s/.test(next));
      tokens.push({ value, kind: "whitespace" });
      index += value.length;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      tokens.push({ value: content.slice(index), kind: "comment" });
      break;
    }

    if (character === "/" && nextCharacter === "*") {
      const end = content.indexOf("*/", index + 2);
      const value = end === -1 ? content.slice(index) : content.slice(index, end + 2);
      tokens.push({ value, kind: "comment" });
      index += value.length;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      const value = consumeQuotedString(content, index, character);
      tokens.push({ value, kind: "string" });
      index += value.length;
      continue;
    }

    if (/\d/.test(character)) {
      const value = consumeWhile(content, index, (next) => /[\d.]/.test(next));
      tokens.push({ value, kind: "number" });
      index += value.length;
      continue;
    }

    if (/[A-Za-z_$]/.test(character)) {
      const value = consumeWhile(content, index, (next) => /[\w$]/.test(next));
      tokens.push({
        value,
        kind: keywordKind(value, keywords)
      });
      index += value.length;
      continue;
    }

    if (/[{}()[\],;]/.test(character)) {
      tokens.push({ value: character, kind: "punctuation" });
      index += 1;
      continue;
    }

    tokens.push({ value: character, kind: "operator" });
    index += 1;
  }

  return tokens;
}

function keywordKind(value: string, keywords: Set<string>): SyntaxToken["kind"] {
  if (value === "true" || value === "false" || value === "null" || value === "undefined") {
    return "literal";
  }

  return keywords.has(value) ? "keyword" : "identifier";
}

function codeKeywords(language: DetailedDiff["language"]): Set<string> {
  if (language === "json") {
    return new Set();
  }

  return new Set([
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "else",
    "export",
    "for",
    "function",
    "if",
    "import",
    "let",
    "new",
    "return",
    "switch",
    "throw",
    "try",
    "var",
    "while"
  ]);
}

function cssKeywords(): Set<string> {
  return new Set(["important", "media", "supports"]);
}

function consumeQuotedString(source: string, start: number, quote: string): string {
  let index = start + 1;

  while (index < source.length) {
    const character = source[index]!;

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === quote) {
      return source.slice(start, index + 1);
    }

    index += 1;
  }

  return source.slice(start);
}

function consumeWhile(
  source: string,
  start: number,
  predicate: (character: string) => boolean
): string {
  let index = start;

  while (index < source.length && predicate(source[index]!)) {
    index += 1;
  }

  return source.slice(start, index);
}

function buildFunctionFolds(
  baseSource: string | undefined,
  compareSource: string | undefined,
  rows: SplitDiffRow[],
  language: DetailedDiff["language"]
): FunctionFold[] {
  if (language !== "javascript") {
    return [];
  }

  if (sourceTooLargeForFunctionFolds(baseSource) || sourceTooLargeForFunctionFolds(compareSource)) {
    return [];
  }

  const baseChangedLines = changedLinesForSide(rows, "base");
  const compareChangedLines = changedLinesForSide(rows, "compare");
  const baseFunctions = parseFunctionRanges(baseSource);
  const compareFunctions = parseFunctionRanges(compareSource);
  const folds = pairFunctionFolds(
    baseFunctions,
    compareFunctions,
    baseChangedLines,
    compareChangedLines
  );

  return nestFunctionFolds(folds);
}

function sourceTooLargeForFunctionFolds(source: string | undefined): boolean {
  return (source?.length ?? 0) > MAX_FUNCTION_FOLD_SOURCE_CHARS;
}

function changedLinesForSide(rows: SplitDiffRow[], side: "base" | "compare"): Set<number> {
  const lines = new Set<number>();

  for (const row of rows) {
    if (!row.changed) {
      continue;
    }

    const line = side === "base" ? row.base : row.compare;
    const lineNumber = side === "base" ? line?.oldLineNumber : line?.newLineNumber;

    if (lineNumber !== undefined) {
      lines.add(lineNumber);
    }
  }

  return lines;
}

function parseFunctionRanges(source: string | undefined): ParsedFunctionRange[] {
  if (!source) {
    return [];
  }

  let ast: t.File;

  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true
    });
  } catch {
    return [];
  }

  const ranges: ParsedFunctionRange[] = [];

  walkAst(ast, (node, parent) => {
    const kind = functionFoldKind(node);

    if (!kind || !node.loc) {
      return;
    }

    const name = functionRangeName(node, parent);
    const range = {
      startLine: node.loc.start.line,
      endLine: node.loc.end.line
    };

    ranges.push({
      id: `function:${ranges.length + 1}:${range.startLine}-${range.endLine}`,
      name,
      kind,
      range,
      matchKey: `${kind}:${name ?? "<anonymous>"}:${range.endLine - range.startLine}`
    });
  });

  return ranges;
}

function pairFunctionFolds(
  baseFunctions: ParsedFunctionRange[],
  compareFunctions: ParsedFunctionRange[],
  baseChangedLines: Set<number>,
  compareChangedLines: Set<number>
): FunctionFold[] {
  const folds: FunctionFold[] = [];
  const baseByKey = groupByMatchKey(baseFunctions);
  const compareByKey = groupByMatchKey(compareFunctions);
  const consumedCompare = new Set<ParsedFunctionRange>();

  for (const baseFunction of baseFunctions) {
    const baseMatches = baseByKey.get(baseFunction.matchKey) ?? [];
    const compareMatches = compareByKey.get(baseFunction.matchKey) ?? [];

    if (baseMatches.length === 1 && compareMatches.length === 1) {
      const compareFunction = compareMatches[0]!;
      consumedCompare.add(compareFunction);
      folds.push(
        createFunctionFold(baseFunction, compareFunction, baseChangedLines, compareChangedLines)
      );
      continue;
    }

    folds.push(createFunctionFold(baseFunction, undefined, baseChangedLines, compareChangedLines));
  }

  for (const compareFunction of compareFunctions) {
    if (!consumedCompare.has(compareFunction)) {
      folds.push(
        createFunctionFold(undefined, compareFunction, baseChangedLines, compareChangedLines)
      );
    }
  }

  return folds;
}

function createFunctionFold(
  baseFunction: ParsedFunctionRange | undefined,
  compareFunction: ParsedFunctionRange | undefined,
  baseChangedLines: Set<number>,
  compareChangedLines: Set<number>
): FunctionFold {
  const containsChanges = Boolean(
    (baseFunction && rangeContainsAny(baseFunction.range, baseChangedLines)) ||
    (compareFunction && rangeContainsAny(compareFunction.range, compareChangedLines))
  );
  const id = ["fold", baseFunction?.id ?? "none", compareFunction?.id ?? "none"].join(":");

  return {
    id,
    name: compareFunction?.name ?? baseFunction?.name,
    kind: compareFunction?.kind ?? baseFunction!.kind,
    baseRange: baseFunction?.range,
    compareRange: compareFunction?.range,
    containsChanges,
    collapsedByDefault: !containsChanges,
    children: []
  };
}

function nestFunctionFolds(folds: FunctionFold[]): FunctionFold[] {
  const clones: FunctionFold[] = folds.map((fold) => ({
    ...fold,
    children: []
  }));
  const topLevel: FunctionFold[] = [];

  for (const fold of clones) {
    const parent = clones
      .filter((candidate) => candidate !== fold && foldContains(candidate, fold))
      .sort((left, right) => foldLineSpan(left) - foldLineSpan(right))[0];

    if (parent) {
      parent.children.push(fold);
    } else {
      topLevel.push(fold);
    }
  }

  return topLevel.sort((left, right) => foldStartLine(left) - foldStartLine(right));
}

function foldContains(parent: FunctionFold, child: FunctionFold): boolean {
  const parentRange = foldPrimaryRange(parent);
  const childRange = foldPrimaryRange(child);

  if (!parentRange || !childRange) {
    return false;
  }

  return parentRange.startLine < childRange.startLine && parentRange.endLine >= childRange.endLine;
}

function foldPrimaryRange(fold: FunctionFold): SourceLineRange | undefined {
  return fold.compareRange ?? fold.baseRange;
}

function foldStartLine(fold: FunctionFold): number {
  return foldPrimaryRange(fold)?.startLine ?? Number.MAX_SAFE_INTEGER;
}

function foldLineSpan(fold: FunctionFold): number {
  const range = foldPrimaryRange(fold);

  return range ? range.endLine - range.startLine : Number.MAX_SAFE_INTEGER;
}

function rangeContainsAny(range: SourceLineRange, lines: Set<number>): boolean {
  for (const line of lines) {
    if (line >= range.startLine && line <= range.endLine) {
      return true;
    }
  }

  return false;
}

function groupByMatchKey(functions: ParsedFunctionRange[]): Map<string, ParsedFunctionRange[]> {
  const byKey = new Map<string, ParsedFunctionRange[]>();

  for (const functionRange of functions) {
    byKey.set(functionRange.matchKey, [
      ...(byKey.get(functionRange.matchKey) ?? []),
      functionRange
    ]);
  }

  return byKey;
}

function functionFoldKind(node: t.Node): FunctionFold["kind"] | undefined {
  if (t.isArrowFunctionExpression(node)) {
    return "arrow-function";
  }

  if (t.isClassMethod(node) || t.isClassPrivateMethod(node)) {
    return "class-method";
  }

  if (t.isObjectMethod(node)) {
    return "object-method";
  }

  if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
    return "function";
  }

  return undefined;
}

function functionRangeName(node: t.Node, parent: t.Node | undefined): string | undefined {
  if ((t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) && node.id) {
    return node.id.name;
  }

  if (
    (t.isClassMethod(node) || t.isClassPrivateMethod(node) || t.isObjectMethod(node)) &&
    t.isIdentifier(node.key)
  ) {
    return node.key.name;
  }

  if (
    (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) &&
    parent &&
    t.isVariableDeclarator(parent) &&
    t.isIdentifier(parent.id)
  ) {
    return parent.id.name;
  }

  if (
    (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) &&
    parent &&
    t.isAssignmentExpression(parent)
  ) {
    return memberName(parent.left);
  }

  return undefined;
}

function memberName(node: t.Node): string | undefined {
  if (t.isIdentifier(node)) {
    return node.name;
  }

  if (t.isMemberExpression(node)) {
    if (t.isIdentifier(node.property)) {
      return node.property.name;
    }

    if (t.isStringLiteral(node.property)) {
      return node.property.value;
    }
  }

  return undefined;
}

function walkAst(
  node: t.Node,
  visitor: (node: t.Node, parent: t.Node | undefined) => void,
  parent?: t.Node
): void {
  visitor(node, parent);

  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const value = (node as unknown as Record<string, unknown>)[key];

    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) {
          walkAst(child, visitor, node);
        }
      }
      continue;
    }

    if (isNode(value)) {
      walkAst(value, visitor, node);
    }
  }
}

function isNode(value: unknown): value is t.Node {
  return Boolean(value && typeof value === "object" && "type" in value);
}

function isJson(source: string): boolean {
  try {
    JSON.parse(source);
    return true;
  } catch {
    return false;
  }
}
