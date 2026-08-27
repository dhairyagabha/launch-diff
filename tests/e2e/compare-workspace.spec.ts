import { readFile } from "node:fs/promises";
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

  test("validates direct URLs and supports saved config upload", async ({ page }) => {
    const duplicatedUrl = "https://assets.example.test/base/launch.min.js";

    await page.goto("/compare");
    await page.getByLabel("Base library URL").fill(duplicatedUrl);
    await page.getByLabel("Compare library URL").fill(duplicatedUrl);
    await page.getByRole("button", { name: "Compare libraries" }).click();
    await expect(page.getByText("Base and compare URLs must be different.")).toBeVisible();

    await page.getByRole("tab", { name: "Saved Config" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "launchdiff.config.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          sites: [
            {
              name: "Example Site",
              environments: [
                {
                  name: "Production",
                  url: "https://assets.example.test/base/launch.min.js"
                },
                {
                  name: "Staging",
                  url: "https://assets.example.test/compare/launch.min.js"
                }
              ]
            }
          ]
        })
      )
    });
    await expect(page.getByLabel("Site")).toHaveValue("Example Site");
    await expect(page.getByLabel("Base environment")).toHaveValue("Production");
    await expect(page.getByLabel("Compare environment")).toHaveValue("Staging");

    const configDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download config" }).click();
    const configDownload = await configDownloadPromise;
    const configDownloadPath = await configDownload.path();
    const downloadedConfig = JSON.parse(await readFile(configDownloadPath!, "utf8")) as {
      sites: Array<{ name: string }>;
    };

    expect(configDownload.suggestedFilename()).toBe("launchdiff.config.json");
    expect(downloadedConfig.sites[0]?.name).toBe("Example Site");

    await page.getByRole("button", { name: "Compare libraries" }).click();
    await expect(page.getByRole("heading", { name: "Checkout Tracking Rule" })).toBeVisible();
  });

  test("captures light and dark baselines and passes automated accessibility checks", async ({
    page
  }) => {
    await page.goto("/compare");
    await page.getByLabel("Use light theme").click();

    await expect(
      page.getByRole("heading", { name: "Compare deployed Adobe Tags libraries" })
    ).toBeVisible();
    await expect(page.getByText("Prefer a non-minified Adobe Tags environment URL")).toBeVisible();
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
    await expect(page.locator(".compare-filter-summary")).toContainText("4 matching");
    await expectTableHeaderBeforeFirstDiffRow(page);
    await expectReviewDetailsBeforeDiffTable(page);
    await expectLineMarkerBesideNumber(page);
    await expect(page).toHaveScreenshot("compare-result-dark.png", {
      animations: "disabled"
    });
    await expectNoAxeViolations(page);

    await page.getByLabel("Use light theme").click();
    await expect(page).toHaveScreenshot("compare-result-light.png", {
      animations: "disabled"
    });
    await page.getByRole("tab", { name: "Source" }).click();
    await expect(page.getByLabel("Base resource source")).toContainText("function trackCheckout");
    await expect(page.getByLabel("Compare resource source")).toContainText("checkout_submit");
    await expect(page).toHaveScreenshot("compare-source-view-light.png", {
      animations: "disabled"
    });
  });

  test("captures added, removed, impacted, resolved, and release note states", async ({
    context,
    page
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/compare");
    await page.getByLabel("Use light theme").click();
    await runMockComparison(page);
    await expect(page.getByRole("button", { name: "Retry failed resources" })).toHaveText("Retry");

    await page.getByRole("button", { name: "Copy sanitized diagnostic report" }).click();
    await expect(
      page.getByRole("button", { name: "Sanitized diagnostic report copied" })
    ).toBeVisible();
    const diagnosticReport = await page.evaluate(() => navigator.clipboard.readText());
    expect(diagnosticReport).toContain('"version": "0.1.0"');
    expect(diagnosticReport).toContain('"inputMode": "direct-url"');
    expect(diagnosticReport).toContain('"deferred-fetch-failed"');
    expect(diagnosticReport).not.toContain("https://");
    expect(diagnosticReport).not.toContain("Checkout Tracking Rule");
    expect(diagnosticReport).not.toContain("Signup Rule");
    expect(diagnosticReport).not.toContain("Legacy Cleanup Rule");
    expect(diagnosticReport).not.toContain("Marketing Source");
    expect(diagnosticReport).not.toContain("RL-CHECKOUT");
    expect(diagnosticReport).not.toContain("RL-SIGNUP");
    expect(diagnosticReport).not.toContain("# LaunchDiff Release Notes");

    await page.getByRole("button", { name: /Signup Rule/ }).click();
    await expect(page.getByRole("heading", { name: "Signup Rule" })).toBeVisible();
    await expect(page).toHaveScreenshot("compare-added-resource.png", {
      animations: "disabled"
    });

    await page.getByRole("button", { name: /Legacy Cleanup Rule/ }).click();
    await expect(page.getByRole("heading", { name: "Legacy Cleanup Rule" })).toBeVisible();
    await expect(page).toHaveScreenshot("compare-removed-resource.png", {
      animations: "disabled"
    });

    await page.getByRole("button", { name: "Impacted 1" }).click();
    await expect(page.getByRole("heading", { name: "Impacted Resources" })).toBeVisible();
    await expect(page).toHaveScreenshot("compare-impacted.png", {
      animations: "disabled"
    });
    await expectNoAxeViolations(page);

    await page.getByRole("button", { name: "Resolved Files" }).click();
    await expect(page.getByRole("heading", { name: "Resolved Files" })).toBeVisible();
    await expect(page.getByText("missing.js")).toBeVisible();
    await expect(page).toHaveScreenshot("compare-resolved-files.png", {
      animations: "disabled"
    });

    await page.getByRole("button", { name: "Release Notes" }).click();
    await expect(page.getByRole("heading", { name: "Release Notes", exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot("compare-release-notes-preview.png", {
      animations: "disabled"
    });
    await page.getByRole("tab", { name: "Raw" }).click();
    await expect(page.getByText("# LaunchDiff Release Notes")).toBeVisible();
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("launchdiff-release-notes.md");
  });

  test("keeps a representative large comparison responsive", async ({ page }) => {
    await installMockAnalyzerWorker(page, largeFixtureComparison(), { resultDelayMs: 250 });
    await page.goto("/compare");
    await page.getByLabel("Use light theme").click();

    await startHeartbeat(page);
    await runMockComparison(page);
    await expect(page.getByRole("button", { name: /Large Rule 149/ })).toBeVisible();

    const heartbeat = await stopHeartbeat(page);
    expect(heartbeat.ticks).toBeGreaterThanOrEqual(8);
    expect(heartbeat.maxGapMs).toBeLessThan(250);

    await page.getByPlaceholder("Search resources").fill("Large Rule 149");
    await expect(page.getByRole("button", { name: /Large Rule 149/ })).toBeVisible();
    await page.getByRole("button", { name: /Large Rule 149/ }).click();
    await expect(page.getByRole("heading", { name: "Large Rule 149" })).toBeVisible();

    const postRenderFrames = await countAnimationFrames(page, 250);
    expect(postRenderFrames).toBeGreaterThanOrEqual(8);

    await page.keyboard.press("v");
    await expect(page.getByRole("button", { name: /Large Rule 149.*Viewed/ })).toBeVisible();
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
    await page
      .getByRole("group", { name: "Status filter" })
      .getByRole("button", { name: /^Added 1$/ })
      .click();
    await expect(page.getByRole("button", { name: /Signup Rule/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Checkout Tracking Rule/ })).toHaveCount(0);
    await page
      .getByRole("group", { name: "Status filter" })
      .getByRole("button", { name: /^Same 1$/ })
      .click();
    await expect(page.getByRole("button", { name: /Marketing Source/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Signup Rule/ })).toHaveCount(0);
    await page
      .getByRole("group", { name: "Status filter" })
      .getByRole("button", { name: /^All 4$/ })
      .click();
    await page.getByRole("button", { name: /Checkout Tracking Rule/ }).click();
    await expect(page.getByRole("heading", { name: "Checkout Tracking Rule" })).toBeVisible();
    await page.locator(".compare-diff-pane").click();
    await expect(page.getByRole("button", { name: "Wrap" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expectDiffTableToFitViewport(page);
    await page.getByRole("tab", { name: "Source" }).click();
    await expect(page.getByLabel("Base resource source")).toContainText("function trackCheckout");
    await expect(page.getByLabel("Compare resource source")).toContainText("checkout_submit");
    await page.getByRole("tab", { name: "Changes" }).click();
    await page.keyboard.press("]");
    await expect(page.getByRole("heading", { name: "Impacted Resources" })).toBeVisible();

    await page.keyboard.press("[");
    await page.getByRole("button", { name: /Checkout Tracking Rule/ }).click();
    await expect(page.getByRole("heading", { name: "Checkout Tracking Rule" })).toBeVisible();
    const stableReturnLines = page.locator(".compare-code-cell code", { hasText: "return true;" });

    await expect(stableReturnLines).toHaveCount(0);
    await page.getByRole("button", { name: "4 unchanged lines" }).click();
    await expect(stableReturnLines).toHaveCount(0);
    await page.getByRole("button", { name: "stableHelper" }).click();
    await expect(stableReturnLines).toHaveCount(2);
    await page.getByRole("button", { name: "stableHelper" }).click();
    await expect(stableReturnLines).toHaveCount(0);
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
  await page.getByRole("button", { name: "Compare libraries" }).click();
  await expect(page.getByText("Analysis completed with warnings")).toBeVisible();
}

async function installMockAnalyzerWorker(
  page: Page,
  comparison: ComparisonResult = fixtureComparison(),
  options: { resultDelayMs?: number } = {}
): Promise<void> {
  await page.addInitScript(
    ({ comparison, resultDelayMs }) => {
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
          window.setTimeout(
            () => this.emit({ id: message.id, type: "result", comparison }),
            resultDelayMs
          );
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
    },
    { comparison, resultDelayMs: options.resultDelayMs ?? 15 }
  );
}

async function expectTableHeaderBeforeFirstDiffRow(page: Page): Promise<void> {
  const tableHeader = await page.locator(".compare-diff-table thead").boundingBox();
  const firstDiffRow = await page.locator(".compare-diff-table tbody tr").first().boundingBox();

  expect(tableHeader?.y).toBeLessThan(firstDiffRow?.y ?? 0);
}

async function expectReviewDetailsBeforeDiffTable(page: Page): Promise<void> {
  const structuredChanges = await page.locator(".compare-structured-changes").boundingBox();
  const toolbar = await page.locator(".compare-review-toolbar").boundingBox();
  const table = await page.locator(".compare-diff-table").boundingBox();

  expect(structuredChanges).not.toBeNull();
  expect(toolbar).not.toBeNull();
  expect(table).not.toBeNull();
  expect(structuredChanges?.y).toBeLessThan(table?.y ?? 0);
  expect(toolbar?.y).toBeLessThan(table?.y ?? 0);
}

async function expectDiffTableToFitViewport(page: Page): Promise<void> {
  const fits = await page.locator(".compare-diff-table-wrap").evaluate((element) => {
    return element.scrollWidth <= element.clientWidth + 1;
  });

  expect(fits).toBe(true);
}

async function expectLineMarkerBesideNumber(page: Page): Promise<void> {
  const marker = await page
    .locator(".compare-line-number.is-added .compare-line-marker")
    .first()
    .boundingBox();
  const value = await page
    .locator(".compare-line-number.is-added .compare-line-number__value")
    .first()
    .boundingBox();

  expect(marker).not.toBeNull();
  expect(value).not.toBeNull();
  expect(Math.abs((marker?.y ?? 0) - (value?.y ?? 0))).toBeLessThan(2);
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

function largeFixtureComparison(): ComparisonResult {
  const comparison = fixtureComparison();
  const baseResources = [...comparison.base.resources];
  const compareResources = [...comparison.compare.resources];
  const resourceComparisons: ResourceComparison[] = [...comparison.resources];
  const warnings = [...comparison.warnings];
  const impacts = [...comparison.impacts];

  for (let index = 0; index < 180; index += 1) {
    const suffix = index.toString().padStart(3, "0");
    const id = `RL-LARGE-${suffix}`;
    const base = resource("rule", id, `Large Rule ${suffix}`, `large-base-${suffix}`);
    const compare = resource("rule", id, `Large Rule ${suffix}`, `large-compare-${suffix}`);

    baseResources.push(base);
    compareResources.push(compare);
    resourceComparisons.push({
      base,
      compare,
      status: "modified",
      match: {
        method: "launch-resource-id",
        confidence: "certain"
      },
      structuredChanges: [
        {
          id: `change:${id}:source`,
          kind: "content-modified",
          path: ["actions", "0", "settings", "source"],
          description: "Representative custom code source changed."
        }
      ],
      impact: {
        impacted: false,
        paths: []
      },
      detailedDiffState: "ready",
      detailedDiff: modifiedDiff()
    });
  }

  for (let index = 0; index < 25; index += 1) {
    const suffix = index.toString().padStart(3, "0");
    const id = `RL-LARGE-ADDED-${suffix}`;
    const compare = resource("rule", id, `Large Added Rule ${suffix}`, `large-added-${suffix}`);

    compareResources.push(compare);
    resourceComparisons.push({
      compare,
      status: "added",
      structuredChanges: [
        {
          id: `change:${id}:added`,
          kind: "resource-added",
          path: [],
          description: "Representative rule was added."
        }
      ],
      detailedDiffState: "ready",
      detailedDiff: addedDiff()
    });
  }

  for (let index = 0; index < 25; index += 1) {
    const suffix = index.toString().padStart(3, "0");
    const id = `RL-LARGE-REMOVED-${suffix}`;
    const base = resource("rule", id, `Large Removed Rule ${suffix}`, `large-removed-${suffix}`);

    baseResources.push(base);
    resourceComparisons.push({
      base,
      status: "removed",
      structuredChanges: [
        {
          id: `change:${id}:removed`,
          kind: "resource-removed",
          path: [],
          description: "Representative rule was removed."
        }
      ],
      detailedDiffState: "ready",
      detailedDiff: removedDiff()
    });
  }

  for (let index = 0; index < 20; index += 1) {
    const suffix = index.toString().padStart(3, "0");
    const id = `DE-LARGE-${suffix}`;
    const resourceName = `Large Data Element ${suffix}`;
    const base = resource("data-element", id, resourceName, `large-data-base-${suffix}`);
    const compare = resource("data-element", id, resourceName, `large-data-compare-${suffix}`);
    const impactPath = {
      changedResourceId: "DE-CAMPAIGN",
      changedResourceName: "Campaign ID",
      resourceIds: ["DE-CAMPAIGN", id],
      resourceNames: ["Campaign ID", resourceName],
      direct: index % 2 === 0
    };

    baseResources.push(base);
    compareResources.push(compare);
    impacts.push(impactPath);
    resourceComparisons.push({
      base,
      compare,
      status: "unchanged",
      structuredChanges: [],
      impact: {
        impacted: true,
        paths: [impactPath]
      },
      detailedDiffState: "not-started"
    });
  }

  return {
    ...comparison,
    base: {
      ...comparison.base,
      resources: baseResources,
      metadata: {
        ...comparison.base.metadata,
        discoveredResourceCount: baseResources.length,
        resolvedResourceCount: baseResources.length
      },
      completeness: {
        state: "complete",
        discovered: baseResources.length,
        resolved: baseResources.length,
        failed: 0,
        failureRate: 0
      }
    },
    compare: {
      ...comparison.compare,
      resources: compareResources,
      metadata: {
        ...comparison.compare.metadata,
        discoveredResourceCount: compareResources.length,
        resolvedResourceCount: compareResources.length,
        failedResourceCount: 1
      },
      completeness: {
        state: "complete-with-warnings",
        discovered: compareResources.length + 1,
        resolved: compareResources.length,
        failed: 1,
        failureRate: 1 / (compareResources.length + 1)
      }
    },
    resources: resourceComparisons,
    impacts,
    warnings,
    releaseNotes: [
      comparison.releaseNotes,
      "",
      "## Large Fixture Summary",
      "",
      "- 180 representative custom-code rules changed.",
      "- 25 representative rules were added.",
      "- 25 representative rules were removed.",
      "- 20 data elements have dependency impact."
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
    baseDisplaySource: [
      "function trackCheckout() {",
      '  const eventName = "checkout_start";',
      "  analytics.track(eventName);",
      "}",
      "",
      "function stableHelper() {",
      "  return true;",
      "}",
      "const sampleRate = 0.1;"
    ].join("\n"),
    compareDisplaySource: [
      "function trackCheckout() {",
      '  const eventName = "checkout_submit";',
      "  analytics.track(eventName);",
      "}",
      "",
      "function stableHelper() {",
      "  return true;",
      "}",
      "const sampleRate = 0.5;"
    ].join("\n"),
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
    compareDisplaySource: ["function signup() {", '  analytics.track("signup");', "}"].join("\n"),
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
    baseDisplaySource: ["function cleanup() {", '  _satellite.cookie.remove("legacy");', "}"].join(
      "\n"
    ),
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

async function startHeartbeat(page: Page): Promise<void> {
  await page.evaluate(() => {
    const startedAt = performance.now();
    const heartbeat = {
      id: 0,
      ticks: 0,
      maxGapMs: 0,
      startedAt,
      lastAt: startedAt
    };

    heartbeat.id = window.setInterval(() => {
      const now = performance.now();

      heartbeat.ticks += 1;
      heartbeat.maxGapMs = Math.max(heartbeat.maxGapMs, now - heartbeat.lastAt);
      heartbeat.lastAt = now;
    }, 20);

    (
      window as unknown as {
        __launchDiffHeartbeat?: typeof heartbeat;
      }
    ).__launchDiffHeartbeat = heartbeat;
  });
}

async function stopHeartbeat(page: Page): Promise<{ ticks: number; maxGapMs: number }> {
  return page.evaluate(() => {
    const host = window as unknown as {
      __launchDiffHeartbeat?: {
        id: number;
        ticks: number;
        maxGapMs: number;
      };
    };
    const heartbeat = host.__launchDiffHeartbeat;

    if (!heartbeat) {
      return { ticks: 0, maxGapMs: Number.POSITIVE_INFINITY };
    }

    window.clearInterval(heartbeat.id);

    return {
      ticks: heartbeat.ticks,
      maxGapMs: heartbeat.maxGapMs
    };
  });
}

async function countAnimationFrames(page: Page, durationMs: number): Promise<number> {
  return page.evaluate((duration) => {
    return new Promise<number>((resolve) => {
      const start = performance.now();
      let frames = 0;

      function tick() {
        frames += 1;

        if (performance.now() - start >= duration) {
          resolve(frames);
          return;
        }

        requestAnimationFrame(tick);
      }

      requestAnimationFrame(tick);
    });
  }, durationMs);
}
