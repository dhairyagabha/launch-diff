import { expect, test, type Page } from "@playwright/test";
import type {
  AnalysisProgress,
  ComparisonResult,
  DetailedDiff,
  DiffLine,
  FunctionFold,
  LaunchResource,
  ResolvedFile,
  ResolvedLibrary,
  ResourceComparison,
  ResourceType,
  SplitDiffRow
} from "@/core/launch-analyzer";
import { expectNoAxeViolations } from "./support/a11y";

test.describe("comparison workspace acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await installMockAnalyzerWorker(page);
  });

  test("captures light and dark baselines and passes automated accessibility checks", async ({
    page
  }) => {
    await page.goto("/compare");
    await page.getByLabel("Use light theme").click();

    await expect(
      page.getByRole("heading", { name: "Compare deployed Adobe Tags libraries" })
    ).toBeVisible();
    await expect(page).toHaveScreenshot("compare-setup-light.png", {
      animations: "disabled"
    });
    await expectNoAxeViolations(page);

    await page.getByLabel("Use dark theme").click();
    await expect(page.getByLabel("Use dark theme")).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveScreenshot("compare-setup-dark.png", {
      animations: "disabled"
    });

    await runMockComparison(page);
    await expect(page.getByRole("heading", { name: "Checkout Tracking Rule" })).toBeVisible();
    await expectTableHeaderBeforeFirstDiffRow(page);
    await expect(page).toHaveScreenshot("compare-result-dark.png", {
      animations: "disabled"
    });
    await expectNoAxeViolations(page);

    await page.getByLabel("Use light theme").click();
    await expect(page).toHaveScreenshot("compare-result-light.png", {
      animations: "disabled"
    });
  });

  test("supports keyboard review workflow end to end", async ({ page }) => {
    await page.goto("/compare");
    await runMockComparison(page);

    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeHidden();

    await page.keyboard.press("v");
    await expect(page.locator(".compare-header__summary")).toContainText("1/3");
    await expect(
      page.getByRole("button", { name: /Checkout Tracking Rule.*Viewed/ })
    ).toBeVisible();

    await page.keyboard.press("j");
    await expect(page.getByRole("heading", { name: "Legacy Cleanup Rule" })).toBeVisible();
    await page.keyboard.press("k");
    await expect(page.getByRole("heading", { name: "Checkout Tracking Rule" })).toBeVisible();

    await page.keyboard.press("f");
    const search = page.getByPlaceholder("Search resources");
    await expect(search).toBeFocused();
    await page.keyboard.type("signup");
    await expect(page.getByRole("button", { name: /Signup Rule/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Checkout Tracking Rule/ })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await page.locator(".compare-diff-pane").click();
    await page.keyboard.press("]");
    await expect(page.getByRole("heading", { name: "Impacted Resources" })).toBeVisible();
  });

  test("shows the desktop-required gate below the compare breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/compare");

    await expect(page.getByRole("heading", { name: "Desktop workspace required" })).toBeVisible();
    await expect(page.locator(".compare-workspace")).toBeHidden();
    await expect(page).toHaveScreenshot("compare-desktop-required.png", {
      animations: "disabled"
    });
    await expectNoAxeViolations(page);
  });
});

async function runMockComparison(page: Page): Promise<void> {
  await page.getByLabel("Base library URL").fill("https://assets.example.test/base/launch.min.js");
  await page
    .getByLabel("Compare library URL")
    .fill("https://assets.example.test/compare/launch.min.js");
  await page.getByRole("button", { name: "Compare Libraries" }).click();
  await expect(page.getByText("Analysis completed with warnings")).toBeVisible();
}

async function installMockAnalyzerWorker(page: Page): Promise<void> {
  await page.addInitScript((comparison) => {
    class MockAnalyzerWorker {
      private listeners: Array<(event: { data: unknown }) => void> = [];

      addEventListener(type: string, listener: (event: { data: unknown }) => void) {
        if (type === "message") {
          this.listeners.push(listener);
        }
      }

      postMessage(message: { id: string; type: string }) {
        if (message.type === "cancel") {
          this.emit({ id: message.id, type: "cancelled" });
          return;
        }

        const progress: AnalysisProgress = {
          phase: "preparing-diffs",
          base: {
            completed: 2,
            total: 3
          }
        };

        window.setTimeout(() => this.emit({ id: message.id, type: "progress", progress }), 5);
        window.setTimeout(() => this.emit({ id: message.id, type: "result", comparison }), 15);
      }

      terminate() {
        this.listeners = [];
      }

      private emit(data: unknown) {
        for (const listener of this.listeners) {
          listener({ data });
        }
      }
    }

    Object.defineProperty(window, "Worker", {
      configurable: true,
      writable: true,
      value: MockAnalyzerWorker
    });
  }, fixtureComparison());
}

async function expectTableHeaderBeforeFirstDiffRow(page: Page): Promise<void> {
  const tableHeader = await page.locator(".compare-diff-table thead").boundingBox();
  const firstDiffRow = await page.locator(".compare-diff-table tbody tr").first().boundingBox();

  expect(tableHeader?.y).toBeLessThan(firstDiffRow?.y ?? 0);
}

function fixtureComparison(): ComparisonResult {
  const modifiedBase = resource("rule", "RL-CHECKOUT", "Checkout Tracking Rule", "checkout-base");
  const modifiedCompare = resource(
    "rule",
    "RL-CHECKOUT",
    "Checkout Tracking Rule",
    "checkout-compare"
  );
  const added = resource("rule", "RL-SIGNUP", "Signup Rule", "signup");
  const removed = resource("rule", "RL-LEGACY", "Legacy Cleanup Rule", "legacy");
  const impacted = resource("data-element", "DE-MARKETING", "Marketing Source", "utm_source");
  const comparisons: ResourceComparison[] = [
    {
      base: modifiedBase,
      compare: modifiedCompare,
      status: "modified",
      match: {
        method: "launch-resource-id",
        confidence: "certain"
      },
      structuredChanges: [
        {
          id: "change:tracking-id",
          kind: "content-modified",
          path: ["actions", "0", "settings", "source"],
          description: "Custom code source changed."
        }
      ],
      impact: {
        impacted: false,
        paths: []
      },
      detailedDiffState: "ready",
      detailedDiff: modifiedDiff()
    },
    {
      compare: added,
      status: "added",
      structuredChanges: [
        {
          id: "change:added",
          kind: "resource-added",
          path: [],
          description: "Rule was added."
        }
      ],
      detailedDiffState: "ready",
      detailedDiff: addedDiff()
    },
    {
      base: removed,
      status: "removed",
      structuredChanges: [
        {
          id: "change:removed",
          kind: "resource-removed",
          path: [],
          description: "Rule was removed."
        }
      ],
      detailedDiffState: "ready",
      detailedDiff: removedDiff()
    },
    {
      base: impacted,
      compare: impacted,
      status: "unchanged",
      structuredChanges: [],
      impact: {
        impacted: true,
        paths: [
          {
            changedResourceId: "DE-CAMPAIGN",
            changedResourceName: "Campaign ID",
            resourceIds: ["DE-CAMPAIGN", "DE-MARKETING"],
            resourceNames: ["Campaign ID", "Marketing Source"],
            direct: false
          }
        ]
      },
      detailedDiffState: "not-started"
    }
  ];

  return {
    modelVersion: 1,
    base: library("https://assets.example.test/base/launch.min.js", [
      modifiedBase,
      removed,
      impacted
    ]),
    compare: {
      ...library("https://assets.example.test/compare/launch.min.js", [
        modifiedCompare,
        added,
        impacted
      ]),
      completeness: {
        state: "complete-with-warnings",
        discovered: 4,
        resolved: 3,
        failed: 1,
        failureRate: 0.25
      },
      files: [
        file("canonical", "https://assets.example.test/compare/launch.min.js", "resolved"),
        file("deferred-failed", "https://assets.example.test/compare/rules/missing.js", "failed")
      ]
    },
    resources: comparisons,
    impacts: comparisons.flatMap((comparison) => comparison.impact?.paths ?? []),
    warnings: [
      {
        id: "warning:failed-deferred",
        severity: "warning",
        code: "deferred-fetch-failed",
        message: "One parser-confirmed deferred resource failed to resolve.",
        fileId: "deferred-failed"
      }
    ],
    releaseNotes: [
      "# LaunchDiff Release Notes",
      "",
      "## Modified",
      "",
      "- Checkout Tracking Rule changed deployed custom code.",
      "",
      "## Added",
      "",
      "- Signup Rule was added.",
      "",
      "## Removed",
      "",
      "- Legacy Cleanup Rule was removed.",
      "",
      "## Analysis Warnings",
      "",
      "- One parser-confirmed deferred resource failed to resolve."
    ].join("\n")
  };
}

function library(canonicalUrl: string, resources: LaunchResource[]): ResolvedLibrary {
  return {
    modelVersion: 1,
    metadata: {
      propertyId: "PR1234567890",
      propertyName: "Example Property",
      environmentName: canonicalUrl.includes("/base/") ? "Production" : "Staging",
      canonicalUrl,
      discoveredResourceCount: resources.length,
      resolvedResourceCount: resources.length,
      failedResourceCount: 0
    },
    resources,
    files: [file("canonical", canonicalUrl, "resolved")],
    dependencyGraph: {
      nodes: [],
      edges: []
    },
    warnings: [],
    completeness: {
      state: "complete",
      discovered: resources.length,
      resolved: resources.length,
      failed: 0,
      failureRate: 0
    }
  };
}

function resource(
  resourceType: ResourceType,
  launchResourceId: string,
  name: string,
  fingerprint: string
): LaunchResource {
  return {
    identity: {
      resourceType,
      launchResourceId,
      name
    },
    raw: {},
    normalized: {},
    normalizedSource: `// ${name}\n_satellite.getVar("Marketing Source");`,
    contentFingerprint: fingerprint,
    children: [
      {
        componentType: "action",
        name: "Custom Code",
        moduleType: "core/src/lib/actions/customCode.js",
        raw: {},
        normalized: {},
        normalizedSource: `console.log("${name}");`
      }
    ],
    fileIds: ["canonical"],
    dataElementReferences: [],
    metadata: {},
    warnings: []
  };
}

function file(id: string, authoritativeUrl: string, state: ResolvedFile["state"]): ResolvedFile {
  return {
    id,
    authoritativeUrl,
    aliases: [],
    state,
    fetch: {
      requestedUrl: authoritativeUrl,
      fetchedAt: "2026-08-26T12:00:00.000Z",
      httpStatus: state === "failed" ? 404 : 200,
      contentType: "application/javascript",
      byteLength: state === "failed" ? 0 : 2048,
      attempts: state === "failed" ? 1 : 1
    },
    owners: [],
    warningIds: []
  };
}

function modifiedDiff(): DetailedDiff {
  const contextA = row(
    "row:1",
    line("base", "context", 1, 1, "function trackCheckout() {"),
    line("compare", "context", 1, 1, "function trackCheckout() {")
  );
  const changedA = row(
    "row:2",
    line("base", "removed", 2, undefined, '  const eventName = "checkout_start";', [
      { value: '  const eventName = "', changed: false },
      { value: "checkout_start", changed: true },
      { value: '";', changed: false }
    ]),
    line("compare", "added", undefined, 2, '  const eventName = "checkout_submit";', [
      { value: '  const eventName = "', changed: false },
      { value: "checkout_submit", changed: true },
      { value: '";', changed: false }
    ]),
    true
  );
  const contextB = row(
    "row:3",
    line("base", "context", 3, 3, "  analytics.track(eventName);"),
    line("compare", "context", 3, 3, "  analytics.track(eventName);")
  );
  const contextC = row(
    "row:4",
    line("base", "context", 4, 4, "}"),
    line("compare", "context", 4, 4, "}")
  );
  const hidden = [
    row("row:5", line("base", "context", 5, 5, ""), line("compare", "context", 5, 5, "")),
    row(
      "row:6",
      line("base", "context", 6, 6, "function stableHelper() {"),
      line("compare", "context", 6, 6, "function stableHelper() {")
    ),
    row(
      "row:7",
      line("base", "context", 7, 7, "  return true;"),
      line("compare", "context", 7, 7, "  return true;")
    ),
    row("row:8", line("base", "context", 8, 8, "}"), line("compare", "context", 8, 8, "}"))
  ];
  const changedB = row(
    "row:9",
    line("base", "removed", 9, undefined, "const sampleRate = 0.1;", [
      { value: "const sampleRate = ", changed: false },
      { value: "0.1", changed: true },
      { value: ";", changed: false }
    ]),
    line("compare", "added", undefined, 9, "const sampleRate = 0.5;", [
      { value: "const sampleRate = ", changed: false },
      { value: "0.5", changed: true },
      { value: ";", changed: false }
    ]),
    true
  );
  const folds: FunctionFold[] = [
    {
      id: "fold:trackCheckout",
      name: "trackCheckout",
      kind: "function",
      baseRange: { startLine: 1, endLine: 4 },
      compareRange: { startLine: 1, endLine: 4 },
      containsChanges: true,
      collapsedByDefault: false,
      children: []
    },
    {
      id: "fold:stableHelper",
      name: "stableHelper",
      kind: "function",
      baseRange: { startLine: 6, endLine: 8 },
      compareRange: { startLine: 6, endLine: 8 },
      containsChanges: false,
      collapsedByDefault: true,
      children: []
    }
  ];

  return {
    fileId: "canonical",
    language: "javascript",
    functionFolds: folds,
    hunks: [
      {
        id: "hunk:1",
        oldStart: 1,
        oldLines: 4,
        newStart: 1,
        newLines: 4,
        lines: [],
        rows: [contextA, changedA, contextB, contextC],
        collapsed: false
      },
      {
        id: "hunk:2",
        oldStart: 5,
        oldLines: 4,
        newStart: 5,
        newLines: 4,
        lines: [],
        rows: [],
        hiddenRows: hidden,
        collapsed: true
      },
      {
        id: "hunk:3",
        oldStart: 9,
        oldLines: 1,
        newStart: 9,
        newLines: 1,
        lines: [],
        rows: [changedB],
        collapsed: false
      }
    ]
  };
}

function addedDiff(): DetailedDiff {
  const rows = [
    row("added:1", undefined, line("compare", "added", undefined, 1, "function signup() {"), true),
    row(
      "added:2",
      undefined,
      line("compare", "added", undefined, 2, '  analytics.track("signup");'),
      true
    ),
    row("added:3", undefined, line("compare", "added", undefined, 3, "}"), true)
  ];

  return {
    fileId: "canonical",
    language: "javascript",
    functionFolds: [],
    hunks: [
      {
        id: "hunk:added",
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 3,
        lines: [],
        rows,
        collapsed: false
      }
    ]
  };
}

function removedDiff(): DetailedDiff {
  const rows = [
    row(
      "removed:1",
      line("base", "removed", 1, undefined, "function cleanup() {"),
      undefined,
      true
    ),
    row(
      "removed:2",
      line("base", "removed", 2, undefined, '  _satellite.cookie.remove("legacy");'),
      undefined,
      true
    ),
    row("removed:3", line("base", "removed", 3, undefined, "}"), undefined, true)
  ];

  return {
    fileId: "canonical",
    language: "javascript",
    functionFolds: [],
    hunks: [
      {
        id: "hunk:removed",
        oldStart: 1,
        oldLines: 3,
        newStart: 0,
        newLines: 0,
        lines: [],
        rows,
        collapsed: false
      }
    ]
  };
}

function row(id: string, base?: DiffLine, compare?: DiffLine, changed = false): SplitDiffRow {
  return {
    id,
    ...(base ? { base } : {}),
    ...(compare ? { compare } : {}),
    changed
  };
}

function line(
  side: "base" | "compare",
  type: DiffLine["type"],
  oldLineNumber: number | undefined,
  newLineNumber: number | undefined,
  content: string,
  tokens?: DiffLine["tokens"]
): DiffLine {
  return {
    id: `${side}:${oldLineNumber ?? newLineNumber ?? "blank"}:${content}`,
    side,
    type,
    oldLineNumber,
    newLineNumber,
    content,
    ...(tokens ? { tokens } : {}),
    syntaxTokens: tokenizeForFixture(content)
  };
}

function tokenizeForFixture(content: string): DiffLine["syntaxTokens"] {
  return (content.match(/\s+|".*?"|\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|./g) ?? []).map((value) => ({
    value,
    kind: /^\s+$/.test(value)
      ? "whitespace"
      : /^".*"$/.test(value)
        ? "string"
        : /^\d/.test(value)
          ? "number"
          : /^(const|function|return)$/.test(value)
            ? "keyword"
            : /^[{}()[\],;.]$/.test(value)
              ? "punctuation"
              : /^[A-Za-z_$]/.test(value)
                ? "identifier"
                : "operator"
  }));
}
