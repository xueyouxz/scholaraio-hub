import path from "node:path";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.put("/api/settings", {
    headers: { "ScholarAIO-Hub": "true" },
    data: { newSessionDefaults: { provider: "claude" } },
  });
});

test("import → keyword search → read → cited conversation → reload", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/library?manage=1");
  await expect(page.getByRole("heading", { name: "本地文献" })).toBeVisible();
  await page
    .getByLabel("选择 PDF 文件")
    .setInputFiles(path.resolve("e2e/fixtures/library/spectroscopy.pdf"));
  await expect(page.getByRole("link", { name: "Spectroscopy Research" })).toBeVisible({
    timeout: 20000,
  });
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "检索文献", exact: true })).toBeVisible();
  await page.getByLabel("检索文献").fill("molecular");
  await page.getByLabel("检索文献").press("Enter");
  await page.getByRole("button", { name: /Spectroscopy Research/ }).click();
  await expect(page.getByRole("complementary", { name: "文献详情" })).toBeVisible();
  await page.getByRole("button", { name: "阅读文献", exact: true }).click();
  await page.getByRole("button", { name: "全文", exact: true }).click();
  await expect(page.getByText("Spectroscopy detects molecular", { exact: false })).toBeVisible();
  const paperPath = new URL(page.url()).pathname;
  const pdf = await request.get(`/api/library/papers/${paperPath.split("/").at(-1)}/pdf`, {
    headers: { Range: "bytes=0-19" },
  });
  expect(pdf.status()).toBe(206);
  expect((await pdf.body()).length).toBe(20);
  const cachedPdf = await request.get(`/api/library/papers/${paperPath.split("/").at(-1)}/pdf`, {
    headers: { "If-None-Match": pdf.headers().etag ?? "" },
  });
  expect(cachedPdf.status()).toBe(304);

  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("link", { name: "询问本文" }).click();
  await page.getByRole("textbox", { name: "输入问题" }).fill("总结本文");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/?]+$/);
  await expect(page.getByText("文献回答", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
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
  await page.getByRole("textbox", { name: "输入问题" }).fill("approval slow");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/?]+$/);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve + Accept Edits" })).toBeVisible();
  const url = page.url();
  await page.reload();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await expect(page).toHaveURL(url);
  await expect(page.getByText("文献回答", { exact: false })).toHaveCount(1);
});

test("imported history renders tables, math, diff and incomplete Markdown safely", async ({
  page,
  request,
}) => {
  const text = [
    "# 历史阅读测试",
    "",
    "| 项目 | 数值 |",
    "| --- | --- |",
    "| 样本 | 42 |",
    "",
    "$E=mc^2$",
    "",
    '<script>window.__unsafeExecuted=true</script><img src=x onerror="window.__unsafeExecuted=true">',
    "[危险链接](javascript:alert(1))",
    "",
    ...Array.from({ length: 50 }, (_, index) => `中文长消息段落 ${index}，用于检查内容保留。`),
    "",
    "```typescript",
    'const result = "未闭合代码块";',
  ].join("\n");
  const content = [
    { type: "user", message: { content: "展示阅读结果" } },
    {
      type: "assistant",
      message: {
        id: "history-text",
        content: [
          { type: "text", text },
          {
            type: "tool_use",
            id: "edit",
            name: "Edit",
            input: { file_path: "result.txt", old_string: "before\n", new_string: "after\n" },
          },
        ],
      },
    },
    {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "edit", content: "Edited" }] },
    },
  ]
    .map((value) => JSON.stringify(value))
    .join("\n");
  const response = await request.post("/api/sessions/import", {
    headers: { "ScholarAIO-Hub": "true" },
    data: { provider: "claude", title: "渲染测试", content },
  });
  expect(response.status()).toBe(201);
  const session = await response.json();
  await page.goto(`/sessions/${session.id}`);
  await expect(page.getByRole("heading", { name: "历史阅读测试" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "42", exact: true })).toBeVisible();
  await expect(page.locator(".katex").first()).toBeVisible();
  await expect(
    page.getByText('const result = "未闭合代码块";', { exact: false }).first(),
  ).toBeVisible();
  // Edit rows open by default, as in the pre-refactor tool timeline.
  await expect(page.getByRole("button", { name: /Edit\s*result\.txt/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator("diffs-container")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__unsafeExecuted"))).toBeUndefined();
  expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
  await expect(page.getByRole("textbox", { name: "输入问题" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("这是导入的只读历史。新建会话后可继续提问。")).toBeVisible();
});

test("internal project → cards → reading → first message preserves project identity", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const projectName = `阅读项目-${Date.now()}`;
  await page.goto("/library?newProject=1");
  await page.getByRole("textbox", { name: "项目名称" }).fill(projectName);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "查看文献项目" })).toHaveValue(projectName);
  await page.getByRole("combobox", { name: "查看文献项目" }).selectOption("");
  await page
    .getByLabel("选择 PDF 文件")
    .setInputFiles(path.resolve("e2e/fixtures/library/spectroscopy.pdf"));
  await expect(
    page.getByRole("link", { name: "Spectroscopy Research", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "选择 Spectroscopy Research" }).check();
  await page.getByRole("combobox", { name: "添加到项目" }).selectOption(projectName);
  await page.getByRole("button", { name: "添加到项目", exact: true }).click();
  await expect(page.getByText("已选 1 / 100 篇", { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "查看文献项目" }).selectOption(projectName);
  await page.goto(`/library?project=${encodeURIComponent(projectName)}`);
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
  expect(new URL(page.url()).searchParams.get("project")).toBe(projectName);
  await page.getByRole("button", { name: "← 返回", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("project")).toBe(projectName);
  await page.getByRole("button", { name: /Spectroscopy Research/ }).click();
  await page.getByRole("button", { name: "阅读文献", exact: true }).click();
  await page.getByRole("link", { name: "询问本文" }).click();
  await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "输入问题" }).fill("总结项目中的文献");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);
  await expect(page.getByText("文献回答", { exact: false })).toBeVisible();
  const response = await request.get(
    `/api/sessions/${new URL(page.url()).pathname.split("/").at(-1)}`,
  );
  const session = await response.json();
  expect(session.projectId).toBe(projectName);
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
  await page.getByRole("combobox", { name: "默认模型" }).fill("test-model");
  await page.getByRole("button", { name: "保存模型" }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/settings")).json()).settings.newSessionDefaults.model,
    )
    .toBe("test-model");
  await page.reload();
  await expect(page.getByRole("button", { name: /^Codex/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("combobox", { name: "默认模型" })).toHaveValue("test-model");
  await page.screenshot({ path: test.info().outputPath("settings.png") });
  await page.getByRole("link", { name: "新对话", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "模型（可选）" })).toHaveValue("test-model");
  await page.getByRole("textbox", { name: "输入问题" }).fill("使用默认工具");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);
  const sessionPath = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^Claude Code/ }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/settings")).json()).settings.newSessionDefaults.provider,
    )
    .toBe("claude");
  expect((await (await request.get(`/api${sessionPath}`)).json()).provider).toBe("codex");
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
  await expect(page.getByRole("heading", { name: "Agent", exact: true })).toBeVisible();
  await expect(sidebar).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("composer keeps project drafts, handles IME and recovers failed sends", async ({
  page,
  request,
}) => {
  const projectName = `草稿项目-${Date.now()}`;
  await request.post("/api/library/projects", {
    headers: { "ScholarAIO-Hub": "true" },
    data: { name: projectName },
  });
  await page.goto("/sessions");
  const input = page.getByRole("textbox", { name: "输入问题" });
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
  const projectUrl = `/sessions?project=${encodeURIComponent(projectName)}`;
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
      await route.fulfill({ status: 503, json: { error: "模拟服务暂不可用" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("模拟服务暂不可用").first()).toBeVisible();
  await expect(input).toHaveValue("项目草稿");
  await page.unroute("**/api/sessions");
  await page.getByRole("button", { name: "发送", exact: true }).click();
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

test("original composer permission menu saves settings and is not clipped", async ({
  page,
  request,
}) => {
  await page.goto("/sessions");
  // As before the refactor, a new chat only offers thinking; the mode belongs to the session.
  await expect(page.getByRole("button", { name: "Default", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "输入问题" }).fill("验证原权限控件");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);
  await expect(page.getByText("文献回答", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1);
  await page.getByRole("button", { name: "Default", exact: true }).click();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect
    .poll(async () => (await (await request.get(`/api/sessions/${id}`)).json()).permissionMode)
    .toBe("plan");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  const option = page.getByRole("button", { name: "Accept edits", exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect
    .poll(async () => (await (await request.get(`/api/sessions/${id}`)).json()).permissionMode)
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
  await expect(page.getByRole("textbox", { name: "输入问题" })).toHaveValue("语音文献问题");
  await expect(page).toHaveURL(/\/sessions$/);
  await page.getByRole("link", { name: "文献库", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "voiceStopped"))).toBe(true);
});
