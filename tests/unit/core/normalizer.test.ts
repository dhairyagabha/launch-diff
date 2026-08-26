import { describe, expect, it } from "vitest";
import {
  normalizeKnownUnorderedObjectKeys,
  normalizeResourceContent,
  suppressParserKnownGeneratedReferences
} from "@/core/launch-analyzer";

describe("resource normalizer", () => {
  it("normalizes formatting-only JavaScript differences without removing deployed comments", async () => {
    const compact = await normalizeResourceContent({
      contentType: "application/javascript",
      body: {
        kind: "text",
        text: `function example(){/* deployed comment */return "value";}`
      }
    });
    const spacious = await normalizeResourceContent({
      contentType: "application/javascript",
      body: {
        kind: "text",
        text: [
          "function example() {",
          "  /* deployed comment */",
          "  return \"value\";",
          "}"
        ].join("\n")
      }
    });
    const changedComment = await normalizeResourceContent({
      contentType: "application/javascript",
      body: {
        kind: "text",
        text: `function example(){/* changed deployed comment */return "value";}`
      }
    });

    expect(compact.normalizedSource).toBe(spacious.normalizedSource);
    expect(compact.normalizedSource).not.toBe(changedComment.normalizedSource);
    expect(compact.displaySourceOrigin).toBe("pretty-printed-deployed");
  });

  it("normalizes JSON object keys while preserving unknown array order", async () => {
    const first = await normalizeResourceContent({
      contentType: "application/json",
      body: {
        kind: "text",
        text: `{"b":2,"a":1,"items":["first","second"]}`
      }
    });
    const second = await normalizeResourceContent({
      contentType: "application/json",
      body: {
        kind: "text",
        text: `{"a":1,"b":2,"items":["second","first"]}`
      }
    });

    expect(first.normalizedSource).not.toBe(second.normalizedSource);
    expect(first.normalizedSource).toContain('"items": [\n    "first",\n    "second"\n  ]');
  });

  it("sorts only parser-known unordered object keys for structured values", () => {
    const normalized = normalizeKnownUnorderedObjectKeys(
      {
        known: { z: 1, a: 2 },
        unknown: { z: 1, a: 2 }
      },
      [["known"]]
    );

    expect(Object.keys((normalized as { known: object }).known)).toEqual(["a", "z"]);
    expect(Object.keys((normalized as { unknown: object }).unknown)).toEqual(["z", "a"]);
  });

  it("does not suppress arbitrary hash-like strings without parser provenance", async () => {
    const base = await normalizeResourceContent({
      contentType: "text/plain",
      body: {
        kind: "text",
        text: "asset.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js"
      }
    });
    const compare = await normalizeResourceContent({
      contentType: "text/plain",
      body: {
        kind: "text",
        text: "asset.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.js"
      }
    });

    expect(base.normalizedSource).not.toBe(compare.normalizedSource);
  });

  it("suppresses parser-known generated deferred filenames only when supplied explicitly", () => {
    const source = "load('rule-action.a1b2c3.js')";

    expect(
      suppressParserKnownGeneratedReferences(source, [
        {
          value: "rule-action.a1b2c3.js",
          replacement: "rule-action.[parser-known-generated].js"
        }
      ])
    ).toBe("load('rule-action.[parser-known-generated].js')");
  });

  it("fingerprints binary resources without byte-diff text", async () => {
    const binary = await normalizeResourceContent({
      body: {
        kind: "binary",
        bytes: new Uint8Array([1, 2, 3, 4])
      }
    });

    expect(binary.language).toBe("binary");
    expect(binary.normalizedSource).toBeUndefined();
    expect(binary.displaySource).toBeUndefined();
    expect(binary.contentFingerprint).toMatch(/^fnv1a32:/);
  });

  it("uses verified unminified source for display only", async () => {
    const withoutUnminified = await normalizeResourceContent({
      contentType: "application/javascript",
      body: {
        kind: "text",
        text: `function example(){return "deployed";}`
      }
    });
    const withUnminified = await normalizeResourceContent({
      contentType: "application/javascript",
      verifiedUnminifiedSource: [
        "function example() {",
        "  return \"changed only in display source\";",
        "}"
      ].join("\n"),
      body: {
        kind: "text",
        text: `function example(){return "deployed";}`
      }
    });

    expect(withUnminified.contentFingerprint).toBe(withoutUnminified.contentFingerprint);
    expect(withUnminified.normalizedSource).toBe(withoutUnminified.normalizedSource);
    expect(withUnminified.displaySource).toContain("changed only in display source");
    expect(withUnminified.displaySourceOrigin).toBe("verified-unminified");
  });
});
