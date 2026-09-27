import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { LIBRARY_PORT_META } from "../packages/shared/src/ports";

/** 从当前页面配置获取文献服务接口地址。 */
async function libraryEndpoint(page: Page, resource: string): Promise<string> {
  const port = await page.locator(`meta[name="${LIBRARY_PORT_META}"]`).getAttribute("content");
  expect(port).toMatch(/^\d+$/);
  const url = new URL(page.url());
  if (!port) throw new Error("页面缺少文献服务端口");
  url.port = port;
  return new URL(resource, url.origin).toString();
}

test.beforeEach(async ({ request }) => {
  await request.put("/api/settings", {
    headers: { "ScholarAIO-Hub": "true" },
    data: { newSessionDefaults: { provider: "claude" } },
  });
});

test("import → keyword search → read → cited conversation → reload", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/library?import=1");
  const importDialog = page.getByRole("dialog", { name: "导入文献" });
  await expect(importDialog).toBeVisible();
  await page
    .getByLabel("选择 PDF 文件")
    .setInputFiles(path.resolve("e2e/fixtures/library/spectroscopy.pdf"));
  await importDialog.getByRole("button", { name: /确定导入/ }).click();
  await expect(importDialog.getByText(/已入库/)).toBeVisible({ timeout: 20000 });
  await page.keyboard.press("Escape");
  await expect(importDialog).toHaveCount(0);
  await page.goto("/library");
  await expect(page.getByLabel("检索文献")).toBeVisible();
  await page.getByLabel("检索文献").fill("molecular");
  await page.getByLabel("检索文献").press("Enter");
  await page.getByRole("button", { name: /Spectroscopy Research/ }).click();
  await expect(page.getByRole("complementary", { name: "文献详情" })).toBeVisible();
  await page.getByRole("button", { name: "阅读文献", exact: true }).click();
  await page.getByRole("button", { name: "全文", exact: true }).click();
  await expect(page.getByText("Spectroscopy detects molecular", { exact: false })).toBeVisible();
  const paperPath = new URL(page.url()).pathname;
  const pdfUrl = await libraryEndpoint(page, `/papers/${paperPath.split("/").at(-1)}/pdf`);
  const pdf = await request.get(pdfUrl, {
    headers: { Range: "bytes=0-19" },
  });
  expect(pdf.status()).toBe(206);
  expect((await pdf.body()).length).toBe(20);
  const cachedPdf = await request.get(pdfUrl, {
    headers: { "If-None-Match": pdf.headers().etag ?? "" },
  });
  expect(cachedPdf.status()).toBe(304);

  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("link", { name: "询问本文" }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("总结本文");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/?]+$/);
  await expect(page.getByText("文献回答", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("文献回答", { exact: false })).toHaveCount(1);
  await page.getByRole("link", { name: "1", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${paperPath}\\?mode=markdown&line=`));
  expect(errors).toEqual([]);
});

test("refresh during a run keeps approval and stop attached to the same session", async ({
  page,
}) => {
  await page.goto("/sessions");
  await page.getByRole("textbox", { name: "Message" }).fill("approval slow");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/?]+$/);
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow and accept edits" })).toBeVisible();
  const url = page.url();
  await page.reload();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await expect(page).toHaveURL(url);
  await expect(page.getByText("文献回答", { exact: false })).toHaveCount(1);
});

test("a reply renders tables, math, diff and incomplete Markdown safely", async ({ page }) => {
  await page.goto("/sessions");
  await page.getByRole("textbox", { name: "Message" }).fill("render sample");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: "历史阅读测试" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "42", exact: true })).toBeVisible();
  await expect(page.locator(".katex").first()).toBeVisible();
  await expect(
    page.getByText('const result = "未闭合代码块";', { exact: false }).first(),
  ).toBeVisible();
  // An edit folds to one line with its stats; opening it shows the diff.
  const edit = page.getByRole("button", { name: /result\.txt/ }).first();
  await edit.click();
  await expect(edit).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("diffs-container").first()).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__unsafeExecuted"))).toBeUndefined();
  expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
});

test("internal project → cards → reading → first message preserves project identity", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const projectName = `阅读项目-${Date.now()}`;
  await page.goto("/projects");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "新建 Workspace" });
  await createDialog.getByRole("textbox", { name: "Workspace 名称" }).fill(projectName);
  await createDialog.getByRole("button", { name: "创建并开始会话" }).click();
  await expect(page).toHaveURL(/\/sessions\?project=/);
  const projectId = new URL(page.url()).searchParams.get("project");
  if (!projectId) throw new Error("创建项目后未返回项目 ID");
  await page.goto("/projects");
  await expect(
    page.getByRole("main").getByRole("link", { name: projectName, exact: true }),
  ).toBeVisible();
  await page.goto("/library?import=1");
  await page
    .getByLabel("选择 PDF 文件")
    .setInputFiles(path.resolve("e2e/fixtures/library/spectroscopy.pdf"));
  const dialog = page.getByRole("dialog", { name: "导入文献" });
  await dialog.getByRole("button", { name: /确定导入/ }).click();
  // Another test may have imported the same fixture already; either outcome
  // means the queue is done with it.
  await expect(dialog.getByText(/已入库|已存在/)).toBeVisible({ timeout: 20000 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "多选", exact: true }).click();
  await page.getByRole("button", { name: /Spectroscopy Research/ }).click();
  const selectionBar = page.getByLabel("选中文献的操作");
  await expect(selectionBar.getByText("已选 1 篇", { exact: true })).toBeVisible();
  await selectionBar.getByRole("button", { name: "加入 Workspace" }).click();
  await selectionBar.getByRole("button", { name: projectName, exact: true }).click();
  await expect(selectionBar).toHaveCount(0);
  await page.goto(`/workspaces/${encodeURIComponent(projectId)}`);
  await page.getByRole("button", { name: "列表视图" }).click();
  await expect(page.getByRole("button", { name: "列表视图" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "卡片视图" }).click();
  await page.screenshot({ path: test.info().outputPath("library-cards.png") });
  await page.getByRole("button", { name: /Spectroscopy Research/ }).click();
  await page.getByRole("button", { name: "阅读文献", exact: true }).click();
  await expect(page.getByRole("button", { name: "概览", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "全文", exact: true }).click();
  await expect(page.getByText("Spectroscopy detects molecular", { exact: false })).toBeVisible();
  const readingUrl = new URL(page.url());
  readingUrl.searchParams.set("line", "1");
  await page.goto(readingUrl.toString());
  await page.reload();
  await expect(page.getByRole("button", { name: "全文", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(new URL(page.url()).searchParams.get("project")).toBe(projectId);
  await page.getByRole("button", { name: "← 返回", exact: true }).click();
  // Back to the workspace page it was opened from, view settings included.
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(`/workspaces/${encodeURIComponent(projectId)}`);
  await page.getByRole("button", { name: /Spectroscopy Research/ }).click();
  await page.getByRole("button", { name: "阅读文献", exact: true }).click();
  await page.getByRole("link", { name: "询问本文" }).click();
  await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Message" }).fill("总结项目中的文献");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);
  await expect(page.getByText("文献回答", { exact: false })).toBeVisible();
  const response = await request.get(
    `/api/sessions/${new URL(page.url()).pathname.split("/").at(-1)}`,
  );
  const session = await response.json().then((body) => body.data);
  expect(session.projectId).toBe(projectId);
  expect(session.messages.filter((m: { role: string }) => m.role === "user")).toHaveLength(1);
  await page.reload();
  await expect(page.getByText("文献回答", { exact: false })).toHaveCount(1);
  const nav = page.getByRole("complementary", { name: "工作台导航" });
  await expect(nav.getByRole("link", { name: "总结项目中的文献" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("settings persist defaults, sidebar resizes and Skills navigation works on mobile", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/settings");
  await page.getByRole("button", { name: /^Codex/ }).click();
  await expect(page.getByText("设置已保存", { exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/settings")).json().then((body) => body.data)).settings
          .newSessionDefaults.provider,
    )
    .toBe("codex");
  await page.reload();
  await expect(page.getByRole("button", { name: /^Codex/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({ path: test.info().outputPath("settings.png") });
  await page.getByRole("link", { name: "新对话", exact: true }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("使用默认工具");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);
  const sessionPath = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^Claude Code/ }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/settings")).json().then((body) => body.data)).settings
          .newSessionDefaults.provider,
    )
    .toBe("claude");
  expect(
    (await (await request.get(`/api${sessionPath}`)).json().then((body) => body.data)).provider,
  ).toBe("codex");
  const slider = page.getByRole("slider", { name: "侧边栏宽度" });
  await slider.focus();
  await slider.press("End");
  await expect(slider).toHaveValue("420");
  await page.reload();
  await expect(slider).toHaveValue("420");
  const sidebar = page.getByRole("complementary", { name: "工作台导航" });
  const bounds = await sidebar.boundingBox();
  const settingsBounds = await sidebar.getByRole("link", { name: "设置" }).boundingBox();
  expect(settingsBounds && bounds && settingsBounds.y > bounds.height * 0.7).toBeTruthy();
  await page.getByRole("button", { name: "收起导航" }).click();
  await expect(page.getByRole("button", { name: "展开导航" })).toBeVisible();
  await page.getByRole("link", { name: "Skills", exact: true }).click();
  await expect(page.getByRole("heading", { name: "科研 Skills" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Claude Code/ })).toBeVisible();
  await expect(sidebar).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("composer keeps project drafts, handles IME and recovers failed sends", async ({
  page,
  request,
}) => {
  const projectName = `草稿项目-${Date.now()}`;
  await page.goto("/sessions");
  const projectResponse = await request.post(await libraryEndpoint(page, "/projects"), {
    headers: { "ScholarAIO-Hub": "true" },
    data: { name: projectName },
  });
  expect(projectResponse.status()).toBe(201);
  const projectId = (await projectResponse.json()).data.id;
  await page.goto("/sessions");
  const input = page.getByRole("textbox", { name: "Message" });
  await input.fill("第一行");
  await input.press("Shift+Enter");
  await input.pressSequentially("second line");
  await expect(input).toHaveValue("第一行\nsecond line");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await input.dispatchEvent("compositionend");
  await expect(page).toHaveURL(/\/sessions$/);
  await page.reload();
  await expect(input).toHaveValue("第一行\nsecond line");
  const projectUrl = `/sessions?project=${encodeURIComponent(projectId)}`;
  await page.goto(projectUrl);
  await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  await input.fill("项目草稿");
  await page.goto("/sessions");
  await expect(input).toHaveValue("第一行\nsecond line");
  await page.goto(projectUrl);
  await expect(input).toHaveValue("项目草稿");
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 503,
        json: {
          id: "test-request",
          code: "LIBRARY_UNAVAILABLE",
          message: "Simulated service unavailable",
          data: null,
        },
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Simulated service unavailable").first()).toBeVisible();
  await expect(input).toHaveValue("项目草稿");
  await page.unroute("**/api/sessions");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);
  await expect(page.getByText("文献回答", { exact: false })).toBeVisible();
  await input.fill("已有会话草稿");
  await page.reload();
  await expect(input).toHaveValue("已有会话草稿");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeVisible();
  const bounds = await input.boundingBox();
  expect(bounds && bounds.y + bounds.height < 844).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath("mobile-composer.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("composer permission menu uses the provider's modes and saves settings", async ({
  page,
  request,
}) => {
  await page.goto("/sessions");
  // A new chat offers the provider's own permission modes before the first turn.
  await expect(page.getByRole("button", { name: "Default", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Message" }).fill("验证原权限控件");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);
  await expect(page.getByText("文献回答", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1);
  await page.getByRole("button", { name: "Default", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Plan Mode", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/sessions/${id}`)).json().then((body) => body.data))
          .permissionMode,
    )
    .toBe("plan");
  await page.getByRole("button", { name: "Plan Mode", exact: true }).click();
  const option = page.getByRole("menuitemradio", { name: "Accept edits", exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/sessions/${id}`)).json().then((body) => body.data))
          .permissionMode,
    )
    .toBe("acceptEdits");
  await page.reload();
  await expect(page.getByRole("button", { name: "Accept edits", exact: true })).toBeVisible();
});

test("original voice control inserts a transcript without sending or leaving recognition running", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class Recognition {
      onstart?: () => void;
      onresult?: (event: unknown) => void;
      onend?: () => void;
      start() {
        this.onstart?.();
        this.onresult?.({ results: [{ 0: { transcript: "语音文献问题" }, isFinal: true }] });
      }
      stop() {
        this.onend?.();
      }
      abort() {
        Reflect.set(window, "voiceStopped", true);
      }
    }
    Reflect.set(window, "SpeechRecognition", Recognition);
  });
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Start voice input", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("语音文献问题");
  await expect(page).toHaveURL(/\/sessions$/);
  await page.getByRole("link", { name: "文献库", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "voiceStopped"))).toBe(true);
});
