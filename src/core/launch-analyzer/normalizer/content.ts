import { parse } from "@babel/parser";
import * as t from "@babel/types";
import type { Node } from "@babel/types";
import { format } from "prettier/standalone";
import * as babelPlugin from "prettier/plugins/babel";
import * as estreePlugin from "prettier/plugins/estree";
import * as htmlPlugin from "prettier/plugins/html";
import * as postcssPlugin from "prettier/plugins/postcss";
import { fingerprintBytes, fingerprintUnknown } from "../model/fingerprint";
import type { AnalysisWarning, DetailedDiff, DisplaySourceOrigin } from "../model/types";
import type { ResourceFetchBody } from "../fetcher/resource-fetcher";

export type NormalizedContentLanguage = DetailedDiff["language"];

export interface ParserKnownGeneratedReference {
  value: string;
  replacement: string;
}

export interface NormalizeResourceContentInput {
  body: ResourceFetchBody;
  contentType?: string;
  url?: string;
  verifiedUnminifiedSource?: string;
  parserKnownGeneratedReferences?: ParserKnownGeneratedReference[];
  unorderedObjectKeyPaths?: string[][];
}

export interface NormalizedResourceContent {
  language: NormalizedContentLanguage;
  normalizedSource?: string;
  contentFingerprint: string;
  displaySource?: string;
  displaySourceOrigin?: DisplaySourceOrigin;
  warnings: AnalysisWarning[];
}

export async function normalizeResourceContent(
  input: NormalizeResourceContentInput
): Promise<NormalizedResourceContent> {
  const language = detectLanguage(input);
  const warnings: AnalysisWarning[] = [];

  if (input.body.kind === "binary") {
    return {
      language: "binary",
      contentFingerprint: fingerprintBytes(input.body.bytes),
      warnings
    };
  }

  const deployedSource = normalizeTextLineEndings(input.body.text);
  const sourceForAuthority = suppressParserKnownGeneratedReferences(
    deployedSource,
    input.parserKnownGeneratedReferences ?? []
  );

  if (language === "javascript") {
    const registeredScriptSource = extractSatelliteRegisteredScriptSource(sourceForAuthority);
    const deployedRegisteredScriptSource = extractSatelliteRegisteredScriptSource(deployedSource);

    return normalizeJavaScriptSource({
      deployedSource: deployedRegisteredScriptSource ?? deployedSource,
      sourceForAuthority: registeredScriptSource ?? sourceForAuthority,
      verifiedUnminifiedSource: input.verifiedUnminifiedSource,
      warnings
    });
  }

  if (language === "json") {
    return normalizeJsonSource({
      deployedSource,
      sourceForAuthority,
      unorderedObjectKeyPaths: input.unorderedObjectKeyPaths,
      verifiedUnminifiedSource: input.verifiedUnminifiedSource,
      warnings
    });
  }

  return normalizeTextLikeSource({
    language,
    deployedSource,
    sourceForAuthority,
    verifiedUnminifiedSource: input.verifiedUnminifiedSource,
    warnings
  });
}

export function normalizeTextLineEndings(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

export function suppressParserKnownGeneratedReferences(
  source: string,
  references: ParserKnownGeneratedReference[]
): string {
  return references.reduce(
    (normalized, reference) => normalized.split(reference.value).join(reference.replacement),
    source
  );
}

export function normalizeKnownUnorderedObjectKeys(
  value: unknown,
  unorderedObjectKeyPaths: string[][]
): unknown {
  return normalizeObjectKeyOrder(value, unorderedObjectKeyPaths, []);
}

export function extractSatelliteRegisteredScriptSource(source: string): string | undefined {
  let ast: t.File;

  try {
    ast = parse(source, {
      sourceType: "unambiguous"
    });
  } catch {
    return undefined;
  }

  const statements = ast.program.body.filter(
    (statement) => !t.isEmptyStatement(statement)
  );

  if (statements.length !== 1) {
    return undefined;
  }

  const statement = statements[0];

  if (!statement || !t.isExpressionStatement(statement) || !t.isCallExpression(statement.expression)) {
    return undefined;
  }

  const call = statement.expression;

  if (!isSatelliteRegisterScriptCallee(call.callee)) {
    return undefined;
  }

  const scriptArgument = call.arguments[1];

  if (t.isStringLiteral(scriptArgument)) {
    return normalizeTextLineEndings(scriptArgument.value);
  }

  if (t.isTemplateLiteral(scriptArgument) && scriptArgument.expressions.length === 0) {
    return normalizeTextLineEndings(
      scriptArgument.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("")
    );
  }

  return undefined;
}

async function normalizeJavaScriptSource(input: {
  deployedSource: string;
  sourceForAuthority: string;
  verifiedUnminifiedSource?: string;
  warnings: AnalysisWarning[];
}): Promise<NormalizedResourceContent> {
  try {
    const ast = parse(input.sourceForAuthority, {
      sourceType: "unambiguous",
      attachComment: true
    });
    const normalizedSource = canonicalizeAst(ast);
    const prettySource = await formatDisplaySource(input.deployedSource, "babel");

    return {
      language: "javascript",
      normalizedSource,
      contentFingerprint: fingerprintUnknown(normalizedSource),
      displaySource: input.verifiedUnminifiedSource ?? prettySource,
      displaySourceOrigin: displayOrigin(input.verifiedUnminifiedSource, prettySource),
      warnings: input.warnings
    };
  } catch {
    input.warnings.push(
      createNormalizationWarning(
        "javascript-parse-failed",
        "JavaScript could not be parsed for structural normalization. Falling back to text normalization."
      )
    );

    return normalizeTextLikeSource({
      language: "javascript",
      deployedSource: input.deployedSource,
      sourceForAuthority: input.sourceForAuthority,
      verifiedUnminifiedSource: input.verifiedUnminifiedSource,
      warnings: input.warnings
    });
  }
}

async function normalizeJsonSource(input: {
  deployedSource: string;
  sourceForAuthority: string;
  unorderedObjectKeyPaths?: string[][];
  verifiedUnminifiedSource?: string;
  warnings: AnalysisWarning[];
}): Promise<NormalizedResourceContent> {
  try {
    const parsed = JSON.parse(input.sourceForAuthority) as unknown;
    const normalized = normalizeKnownUnorderedObjectKeys(parsed, input.unorderedObjectKeyPaths ?? [[]]);
    const normalizedSource = JSON.stringify(normalized, null, 2);

    return {
      language: "json",
      normalizedSource,
      contentFingerprint: fingerprintUnknown(normalizedSource),
      displaySource: input.verifiedUnminifiedSource ?? `${normalizedSource}\n`,
      displaySourceOrigin: input.verifiedUnminifiedSource ? "verified-unminified" : "pretty-printed-deployed",
      warnings: input.warnings
    };
  } catch {
    input.warnings.push(
      createNormalizationWarning(
        "json-parse-failed",
        "JSON could not be parsed for stable normalization. Falling back to text normalization."
      )
    );

    return normalizeTextLikeSource({
      language: "json",
      deployedSource: input.deployedSource,
      sourceForAuthority: input.sourceForAuthority,
      verifiedUnminifiedSource: input.verifiedUnminifiedSource,
      warnings: input.warnings
    });
  }
}

async function normalizeTextLikeSource(input: {
  language: NormalizedContentLanguage;
  deployedSource: string;
  sourceForAuthority: string;
  verifiedUnminifiedSource?: string;
  warnings: AnalysisWarning[];
}): Promise<NormalizedResourceContent> {
  const prettySource = await formatTextLikeDisplaySource(input.deployedSource, input.language);

  return {
    language: input.language,
    normalizedSource: input.sourceForAuthority,
    contentFingerprint: fingerprintUnknown(input.sourceForAuthority),
    displaySource: input.verifiedUnminifiedSource ?? prettySource,
    displaySourceOrigin: displayOrigin(input.verifiedUnminifiedSource, prettySource),
    warnings: input.warnings
  };
}

async function formatTextLikeDisplaySource(
  source: string,
  language: NormalizedContentLanguage
): Promise<string> {
  if (language === "html") {
    return formatDisplaySource(source, "html");
  }

  if (language === "css") {
    return formatDisplaySource(source, "css");
  }

  return source;
}

async function formatDisplaySource(source: string, parser: "babel" | "html" | "css"): Promise<string> {
  try {
    return await format(source, {
      parser,
      plugins: [babelPlugin, estreePlugin, htmlPlugin, postcssPlugin],
      printWidth: 100,
      trailingComma: "none"
    });
  } catch {
    return source;
  }
}

function displayOrigin(
  verifiedUnminifiedSource: string | undefined,
  prettySource: string
): DisplaySourceOrigin {
  if (verifiedUnminifiedSource) {
    return "verified-unminified";
  }

  return prettySource ? "pretty-printed-deployed" : "deployed";
}

function canonicalizeAst(ast: Node): string {
  return JSON.stringify(stripParserNoise(ast));
}

function isSatelliteRegisterScriptCallee(
  callee: t.Expression | t.V8IntrinsicIdentifier
): boolean {
  if (!t.isMemberExpression(callee) || callee.computed) {
    return false;
  }

  if (!t.isIdentifier(callee.property, { name: "__registerScript" })) {
    return false;
  }

  return isSatelliteObject(callee.object);
}

function isSatelliteObject(node: t.Expression | t.Super): boolean {
  if (t.isIdentifier(node, { name: "_satellite" })) {
    return true;
  }

  return (
    t.isMemberExpression(node) &&
    !node.computed &&
    t.isIdentifier(node.object, { name: "window" }) &&
    t.isIdentifier(node.property, { name: "_satellite" })
  );
}

function stripParserNoise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripParserNoise);
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort()) {
      if (isParserNoiseKey(key)) {
        continue;
      }

      result[key] = stripParserNoise((value as Record<string, unknown>)[key]);
    }

    return result;
  }

  return value;
}

function isParserNoiseKey(key: string): boolean {
  return key === "start" || key === "end" || key === "loc" || key === "range";
}

function normalizeObjectKeyOrder(
  value: unknown,
  unorderedObjectKeyPaths: string[][],
  path: string[]
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      normalizeObjectKeyOrder(item, unorderedObjectKeyPaths, [...path, String(index)])
    );
  }

  if (!isRecord(value)) {
    return value;
  }

  const keys = Object.keys(value);
  const orderedKeys = pathIsKnownUnordered(path, unorderedObjectKeyPaths) ? keys.sort() : keys;
  const result: Record<string, unknown> = {};

  for (const key of orderedKeys) {
    result[key] = normalizeObjectKeyOrder(value[key], unorderedObjectKeyPaths, [...path, key]);
  }

  return result;
}

function pathIsKnownUnordered(path: string[], unorderedObjectKeyPaths: string[][]): boolean {
  return unorderedObjectKeyPaths.some(
    (candidate) =>
      candidate.length === path.length &&
      candidate.every((segment, index) => segment === path[index])
  );
}

function detectLanguage(input: NormalizeResourceContentInput): NormalizedContentLanguage {
  if (input.body.kind === "binary") {
    return "binary";
  }

  const contentType = input.contentType?.toLowerCase() ?? "";
  const url = input.url?.toLowerCase() ?? "";

  if (contentType.includes("javascript") || /\.[cm]?js(?:$|[?#])/.test(url)) {
    return "javascript";
  }

  if (contentType.includes("json") || /\.json(?:$|[?#])/.test(url)) {
    return "json";
  }

  if (contentType.includes("html") || /\.html?(?:$|[?#])/.test(url)) {
    return "html";
  }

  if (contentType.includes("css") || /\.css(?:$|[?#])/.test(url)) {
    return "css";
  }

  if (contentType.startsWith("text/")) {
    return "text";
  }

  return "unknown";
}

function createNormalizationWarning(code: string, message: string): AnalysisWarning {
  return {
    id: `normalizer:${code}`,
    severity: "warning",
    code,
    message
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
