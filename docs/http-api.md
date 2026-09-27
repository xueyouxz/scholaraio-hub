# HTTP 接口约定

Node 服务负责会话、Provider、科研技能和应用设置；Python 服务负责文献、项目、导入、检索和维护任务。浏览器直接访问各服务。服务入口装配依赖和中间件，领域路由按功能平铺，业务操作由服务层执行。

## 普通 JSON 响应

成功与失败均返回 `{ id, code, message, data }`：

- `id` 是本次请求的关联标识，与 `X-Request-ID` 响应头一致。资源 ID 位于 `data` 内。
- `code` 是稳定的业务结果码，成功为 `success`。错误码定义于 shared 的 `http.ts`，Python 的响应模型声明相同集合，由契约测试检查。
- `message` 使用英文，成功时固定为 `success`；不作为客户端分支判断依据。
- `data` 是原有的业务数据。失败时为 `null`，或包含字段校验的 `issues`。

查询到失败的任务，仍返回 HTTP 200 和 `code: success`，任务的执行状态保存在 `data.state`。业务错误使用相应的 4xx/5xx，不能将失败转换成 HTTP 200。

```json
{
  "id": "request-id",
  "code": "VALIDATION_FAILED",
  "message": "Invalid request parameters.",
  "data": {
    "issues": [
      { "location": "body", "path": ["title"], "code": "too_small", "message": "Title must not be empty." }
    ]
  }
}
```

## 状态码

| HTTP | 用途 |
| --- | --- |
| 200 | 查询或操作完成，并返回数据 |
| 201 | 创建资源；具有详情接口的会话通过 Location 指明地址 |
| 202 | 接受后台任务，响应数据表示任务当前状态 |
| 204 | 无响应体，包括删除成功和会话当前没有活动流 |
| 400 | JSON 或 multipart 解析失败 |
| 403 | Host、CSRF 或跨域策略拒绝 |
| 404 | 资源或接口不存在 |
| 405 | 接口不支持该方法；Allow 列出支持的方法 |
| 409 | 当前状态与请求操作冲突 |
| 413 | 文件或请求体超过限制 |
| 415 | 接口不支持该请求体媒体类型 |
| 422 | 请求可解析，但参数或业务输入不合法 |
| 429 | 请求被限流 |
| 500 | 本服务内部错误，完整异常记入服务日志 |
| 502 | 上游服务返回失败或无效协议 |
| 503 | 文献服务不可连接 |
| 504 | 等待文献服务响应超时 |

## 文件和流式响应

PDF、附件、文件下载不使用 JSON 外壳，保留原有媒体类型、Range 和条件请求语义。会话使用 AI SDK UI Message Stream，文献变更使用 SSE。204、304 和 HEAD 响应没有 JSON 响应体。

流建立前的错误使用普通 JSON 错误协议。流建立后的错误沿用所属流协议。请求断开释放订阅，停止会话由停止接口处理。

## 代码入口

- Node `src/http.ts`：请求标识、校验、成功响应和错误转换；`src/middleware/security.ts`：访问策略。
- Node `src/routes/*.ts`：按领域平铺；`sessions.ts` 内分组组织记录、执行、交互、历史和文件接口。
- Python `interfaces/api/errors.py`：请求标识、成功包装及异常处理；`responses.py`：响应模型；`security.py`：访问策略。
- 前端 `core/http.ts`：统一解包数据、HTTP 错误、网络错误和取消处理。XHR 上传复用同一解码函数。
- `LibraryClient` 与 Python CLI：解包文献服务响应，保留业务错误信息。

Python 路由显式声明 `ApiSuccess[领域响应模型]`，OpenAPI 同时描述错误响应。修改后执行 `pnpm gen:library-types`，不手工修改生成文件。

核心函数使用中文功能注释。路由中保持路径、校验和 handler 相邻；公共层不读取业务存储、不执行会话或文献操作。

Node 成功响应使用 `success()`，创建响应使用 `created()`，无响应体使用 `emptyBody()`。注释使用中文，接口业务提示使用英文。

## 浏览器请求组织

业务请求按领域保留在 `core/sessions.ts`、`library.ts`、`providers.ts`、`skills.ts` 和 `settings.ts`。组件调用领域方法，查询缓存、失效和重试由 TanStack Query 管理。

`core/http.ts` 的 `createHttpClient()` 接受服务地址、默认请求头、默认超时和可注入的 fetch，创建两个实例：

- `hubHttp`：绑定 `/api`，服务于 Node 领域接口。
- `libraryHttp`：从页面配置读取文献服务地址，直接访问 Python 接口。

业务方法传入相对于服务的路径。`json` 选项自动序列化 JSON 并设置 Content-Type；`body` 选项用于 FormData 等原始请求体，两者互斥。文件上传保留浏览器生成的 multipart boundary。`json()` 返回解包后的数据，`read()` 在请求有效期内消费特殊响应，不向调用方交出尚未读取的响应体。

`core/libraryClient.ts` 使用 shared 导出的 `LibraryPaths`，从生成的 OpenAPI 类型约束路径、HTTP 方法、路径参数、查询参数、JSON 请求体及返回数据；路径和查询编码集中处理。multipart 请求接收 FormData，字段内容仍由服务端校验。文件与 SSE 接口不进入 JSON 客户端。

这些约束在编译期生效，响应外壳在运行时验证；业务数据的完整运行时校验仍由服务端模型负责。修改 Python 请求或响应模型后执行 `pnpm gen:library-types`，再通过 typecheck 检查业务方法。`libraryClient.test-d.ts` 随客户端 typecheck 检查类型约束。

## 超时、取消和重试

- 普通请求默认 30 秒，文件上传默认 120 秒；请求可通过 `timeoutMs` 单独设置正数超时。
- 超时覆盖请求发送及响应体读取。超时抛出 `REQUEST_TIMEOUT`，网络失败抛出 `NETWORK_ERROR`；调用方取消保留原始取消原因。结束时释放计时器和取消监听。
- HTTP 客户端不自行重试。查询层仅对 GET 的网络错误、超时和 HTTP 502/503/504 自动重试，最多两次，间隔为 1 秒、2 秒。
- 参数错误、状态冲突、限流、无效响应协议和主动取消不自动重试。所有 mutation 禁止自动重试。
- 会话首条消息发送失败后，仍按稳定的消息 ID 查询实际接收状态；不会自动重新发送消息。
- AI SDK 会话流和文献 SSE 保留各自的连接生命周期，不应用普通 JSON 请求的超时和重试策略。附件 XHR 上传保留进度通知，复用响应解码及上传超时设置。
