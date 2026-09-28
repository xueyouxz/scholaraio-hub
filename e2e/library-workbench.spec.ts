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

test("collection → cards → reading → a session that refers to the paper", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const collectionName = `阅读集合-${Date.now()}`;
  await page.goto("/library/collections");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "新建文献集合" });
  await createDialog.getByRole("textbox", { name: "文献集合名称" }).fill(collectionName);
  await createDialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page).toHaveURL(/\/library\/collections\/[^/?]+$/);
  const collectionPath = new URL(page.url()).pathname;
  const collectionId = decodeURIComponent(collectionPath.split("/").at(-1) ?? "");
  await page.goto("/library/collections");
  await expect(
    page.getByRole("main").getByRole("link", { name: collectionName, exact: true }),
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
  await selectionBar.getByRole("button", { name: "加入文献集合" }).click();
  await selectionBar.getByRole("button", { name: collectionName, exact: true }).click();
  await expect(selectionBar).toHaveCount(0);
  await page.goto(collectionPath);
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
  const paperId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1) ?? "");
  const readingUrl = new URL(page.url());
  readingUrl.searchParams.set("line", "1");
  await page.goto(readingUrl.toString());
  await page.reload();
  await expect(page.getByRole("button", { name: "全文", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(new URL(page.url()).searchParams.get("collection")).toBe(collectionId);
  await page.getByRole("button", { name: "← 返回", exact: true }).click();
  // Back to the collection page it was opened from, view settings included.
  await expect.poll(() => new URL(page.url()).pathname).toBe(collectionPath);
  await page.getByRole("button", { name: /Spectroscopy Research/ }).click();
  await page.getByRole("button", { name: "阅读文献", exact: true }).click();
  await page.getByRole("link", { name: "询问本文" }).click();
  // The new chat refers to the paper, and can stop referring to it before it starts.
  await expect(page.getByRole("button", { name: /不再引用 Spectroscopy Research/ })).toBeVisible();
  await page.getByRole("textbox", { name: "Message" }).fill("总结集合中的文献");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w:.-]+$/);
  await expect(page.getByText("文献回答", { exact: false })).toBeVisible();
  const response = await request.get(
    `/api/sessions/${new URL(page.url()).pathname.split("/").at(-1)}`,
  );
  const session = await response.json().then((body) => body.data);
  expect(session.references).toEqual([{ kind: "paper", id: paperId }]);
  expect(session.messages.filter((m: { role: string }) => m.role === "user")).toHaveLength(1);
  await page.reload();
  await expect(page.getByText("文献回答", { exact: false })).toHaveCount(1);
  // Started without a project, it is listed among the sessions that belong to none.
  const nav = page.getByRole("complementary", { name: "工作台导航" });
  await nav.getByRole("button", { name: "未归属会话" }).click();
  await expect(nav.getByRole("link", { name: /总结集合中的文献/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("@ refers a chat to a literature collection, and the session keeps it", async ({
  page,
  request,
}) => {
  const name = `引用集合${Date.now()}`;
  await page.goto("/sessions");
  const created = await request.post(await libraryEndpoint(page, "/collections"), {
    headers: { "ScholarAIO-Hub": "true" },
    data: { name },
  });
  const collection = (await created.json()).data;
  const input = page.getByRole("textbox", { name: "Message" });
  await input.fill(`对比 @${name.slice(0, 4)}`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(input).toHaveValue(`对比 @${name} `);
  await expect(page.getByRole("button", { name: `不再引用 ${name}` })).toBeVisible();
  await input.pressSequentially("里的方法");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w:.-]+$/);
  await expect(page.getByText("文献回答", { exact: false })).toBeVisible();
  const url = `/api${new URL(page.url()).pathname}`;
  expect((await (await request.get(url)).json()).data.references).toEqual([
    { kind: "collection", id: collection.id },
  ]);
  // In the open session the reference stays, shown above the composer, until removed.
  await expect(page.getByRole("button", { name: `不再引用 ${name}` })).toBeVisible();
  await page.getByRole("button", { name: `不再引用 ${name}` }).click();
  await expect
    .poll(async () => (await (await request.get(url)).json()).data.references)
    .toEqual([]);
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
  await expect(page).toHaveURL(/\/sessions\/[\w:.-]+$/);
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

test("composer keeps each project's draft, handles IME and recovers failed sends", async ({
  page,
  request,
}) => {
  // Any real directory can be a project; this one is the test's own fixtures.
  const added = await request.post("/api/projects", {
    headers: { "ScholarAIO-Hub": "true" },
    data: { path: path.resolve("e2e/fixtures/library") },
  });
  expect(added.status()).toBe(201);
  const project = (await added.json()).data;
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
  const projectUrl = `/sessions?project=${encodeURIComponent(project.id)}`;
  await page.goto(projectUrl);
  await expect(page.getByRole("button", { name: `项目：${project.name}` })).toBeVisible();
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
  await expect(page).toHaveURL(/\/sessions\/[\w:.-]+$/);
  await expect(page.getByText("文献回答", { exact: false })).toBeVisible();
  const created = await request.get(`/api${new URL(page.url()).pathname}`);
  expect((await created.json()).data).toMatchObject({ cwd: project.path, projectId: project.id });
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

test("the last prompt is corrected in the composer, replacing its turn", async ({ page }) => {
  await page.goto("/sessions");
  const input = page.getByRole("textbox", { name: "Message" });
  const send = page.getByRole("button", { name: "Send", exact: true });
  const prompts = page.locator(".message-list .message-user-prompt");
  const replies = page.locator(".message-list").getByText("文献回答", { exact: false });
  await input.fill("第一问");
  await send.click();
  await expect(page).toHaveURL(/\/sessions\/[\w:.-]+$/);
  await expect(replies).toHaveCount(1);
  await input.fill("第二问");
  await send.click();
  await expect(prompts).toHaveText(["第一问", "第二问"]);
  await expect(replies).toHaveCount(2);

  // Only the last prompt can be edited or taken back.
  const edit = page.getByRole("button", { name: "编辑消息" });
  await expect(edit).toHaveCount(1);
  await edit.click();
  await expect(page.getByText("正在编辑上一条消息")).toBeVisible();
  await expect(input).toHaveValue("第二问");
  await input.fill("改过的第二问");
  await input.press("Enter");
  await expect(page.getByText("正在编辑上一条消息")).toHaveCount(0);
  await expect(prompts).toHaveText(["第一问", "改过的第二问"]);
  await expect(replies).toHaveCount(2);
  await page.reload();
  await expect(prompts).toHaveText(["第一问", "改过的第二问"]);

  // Cancelling an edit changes nothing and gives the composer back.
  await input.fill("未发送的草稿");
  await edit.click();
  await expect(input).toHaveValue("改过的第二问");
  await input.press("Escape");
  await expect(page.getByText("正在编辑上一条消息")).toHaveCount(0);
  await expect(input).toHaveValue("未发送的草稿");
  await expect(prompts).toHaveText(["第一问", "改过的第二问"]);
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
  await expect(page).toHaveURL(/\/sessions\/[\w:.-]+$/);
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
