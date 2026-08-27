import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/a11y";

test.describe("landing page", () => {
  test("renders the desktop product story with optimized visuals", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Compare Adobe Launch libraries with confidence." })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "LaunchDiff home" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Documentation" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Compare libraries" }).first()).toBeVisible();
    await expect(page.locator(".landing-story__visual")).toHaveCount(3);
    await expect
      .poll(async () =>
        page.locator(".landing-story__visual").evaluateAll((images) =>
          images.every((image) => {
            const screenshot = image as HTMLImageElement;
            return screenshot.complete && screenshot.naturalWidth > 0 && screenshot.naturalHeight > 0;
          })
        )
      )
      .toBe(true);
    const screenshotRatios = await page.locator(".landing-story__visual").evaluateAll((images) =>
      images.map((image) => {
        const screenshot = image as HTMLImageElement;
        const bounds = screenshot.getBoundingClientRect();

        return {
          natural: screenshot.naturalWidth / screenshot.naturalHeight,
          rendered: bounds.width / bounds.height
        };
      })
    );

    for (const ratio of screenshotRatios) {
      expect(ratio.natural).toBeCloseTo(16 / 9, 2);
      expect(Math.abs(ratio.natural - ratio.rendered)).toBeLessThan(0.01);
    }
    await expect(page.getByRole("heading", { name: "See every deployed change." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Understand downstream impact." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Validate the complete resource graph." })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "The review path is visible before analysis starts." })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Public fetch boundary" })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("uses mobile CTA copy and hands narrow screens to the compare gate", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 840 });
    await page.goto("/");

    await expect(page.getByText("Use desktop").first()).toBeVisible();
    await expect(page.getByText("For accurate split review")).toBeVisible();

    await page.getByRole("link", { name: "Compare libraries" }).first().click();
    await expect(page.getByRole("heading", { name: "Desktop workspace required" })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
