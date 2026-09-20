import path from "node:path";
import { expect, test } from "@playwright/test";

test("import → keyword search → read → cited conversation → reload", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本地文献" })).toBeVisible();
  await page
    .getByLabel("选择 PDF 文件")
    .setInputFiles(path.resolve("e2e/fixtures/library/spectroscopy.pdf"));
  await expect(page.getByRole("link", { name: "Spectroscopy Research" })).toBeVisible();
  await page.getByLabel("检索文献").fill("molecular");
  await page.getByRole("button", { name: "检索", exact: true }).click();
  await page.getByRole("link", { name: "Spectroscopy Research" }).click();
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
  await page.getByRole("button", { name: "开始对话" }).click();
  await page.getByRole("textbox", { name: "输入问题" }).fill("总结本文");
  await page.getByRole("button", { name: "发送", exact: true }).click();
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
  await page.getByRole("button", { name: "开始对话" }).click();
  await page.getByRole("textbox", { name: "输入问题" }).fill("approval slow");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "允许", exact: true })).toBeVisible();
  const url = page.url();
  await page.reload();
  await page.getByRole("button", { name: "拒绝", exact: true }).click();
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
  await page.getByText("Edit · output-available", { exact: true }).click();
  await expect(page.locator("diffs-container")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__unsafeExecuted"))).toBeUndefined();
  expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
  await expect(page.getByRole("textbox", { name: "输入问题" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("这是导入的只读历史。新建会话后可继续提问。")).toBeVisible();
});
