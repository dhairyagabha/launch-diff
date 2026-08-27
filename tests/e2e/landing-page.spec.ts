import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/a11y";

test.describe("landing page", () => {
  test("renders the desktop product story with optimized visuals", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Compare Adobe Launch libraries with confidence." })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "LaunchDiff home" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Compare libraries" }).first()).toBeVisible();
    await expect(page.locator(".landing-story__visual")).toHaveCount(3);
    await expect(page.getByRole("heading", { name: "See every deployed change." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Understand downstream impact." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Validate the complete resource graph." })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("uses mobile CTA copy and hands narrow screens to the compare gate", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 840 });
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Explore on desktop" }).first()).toBeVisible();
    await expect(page.getByText("The detailed comparison workspace opens at 1024 CSS pixels")).toBeVisible();

    await page.getByRole("link", { name: "Explore on desktop" }).first().click();
    await expect(page.getByRole("heading", { name: "Desktop workspace required" })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
