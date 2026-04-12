import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/api/projects") {
      await route.fulfill({ json: { projects: [] } });
      return;
    }

    if (url.pathname === "/api/providers") {
      await route.fulfill({
        json: {
          providers: [
            {
              name: "claude",
              displayName: "Claude",
              installed: true,
              authenticated: true,
              enabled: true,
            },
            {
              name: "codex",
              displayName: "Codex",
              installed: true,
              authenticated: true,
              enabled: true,
            },
          ],
        },
      });
      return;
    }

    if (url.pathname === "/api/processes") {
      await route.fulfill({
        json: {
          processes: [],
          terminatedProcesses: [],
        },
      });
      return;
    }

    if (url.pathname === "/api/settings") {
      await route.fulfill({
        json: {
          settings: {
            globalInstructions: "",
            newSessionDefaults: {
              provider: "claude",
              permissionMode: "default",
            },
          },
        },
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: "Unhandled test route" },
    });
  });
});

test("loads the dashboard shell in Chromium", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "极简会话台" })).toBeVisible();
  await expect(page.getByText("基于现有 server API 的轻量前端")).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新" })).toBeVisible();
});
