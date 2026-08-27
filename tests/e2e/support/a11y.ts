import { expect, type Page } from "@playwright/test";
import axe from "axe-core";

export async function expectNoAxeViolations(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const axeRuntime = (
      window as unknown as Window & {
        axe: {
          run: (
            context: Document,
            options: {
              runOnly: {
                type: "tag";
                values: string[];
              };
            }
          ) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              help: string;
              nodes: Array<{ target: string[] }>;
            }>;
          }>;
        };
      }
    ).axe;
    const result = await axeRuntime.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
      }
    });

    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(" "))
    }));
  });

  expect(violations).toEqual([]);
}
