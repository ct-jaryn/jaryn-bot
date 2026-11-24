# Pages 与产物

> 适用版本：v1.11.0 · 状态：现行
> 说明如何生成可分享、可回滚的页面，以及如何保存和交付文件产物与 Office 文档。

## 1. 概览

| 能力 | v1.10.0 实现 |
|---|---|
| Pages | HTML 存在 SQLite；支持表格/报告模板、CSP 渲染、最多 20 版历史、回滚、导出、可设 TTL 的只读分享 token |
| 产物库 | 文件落在 `$JARY_HOME/artifacts/`，DB 记元数据（sha256、大小、MIME）；单文件 ≤20MB，`artifact.present` 返回交付元数据 |
| Office | `office.docx` / `office.xlsx` / `office.pptx` 用纯 TypeScript 生成，写入会话工作区，不依赖 LibreOffice |

Pages 是静态 HTML：渲染时 CSP 禁止脚本，不支持交互式 JS。产物库与 Office 是两条交付路径：前者有元数据和列表 API，后者是工作区文件。

## 2. 快速上手

下面的命令依次创建表格页、生成 24 小时分享链接、查看版本、回滚、导出，并列出与保存产物：

```bash
BASE=http://127.0.0.1:8787
AUTH="authorization: Bearer $JARY_API_TOKEN"

curl -s -X POST "$BASE/api/pages" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"title":"本周进展","template":"table","data":[{"事项":"部署","状态":"完成"}]}'

curl -s -X POST "$BASE/api/pages/<id>/share" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"enabled":true,"ttlHours":24}'

curl -s "$BASE/api/pages/<id>/versions" -H "$AUTH"
curl -s -X POST "$BASE/api/pages/<id>/rollback" -H "$AUTH" \
  -H 'content-type: application/json' -d '{"version":1}'
curl -s -OJ "$BASE/api/pages/<id>/export" -H "$AUTH"

curl -s "$BASE/api/artifacts" -H "$AUTH"
curl -s -X POST "$BASE/api/artifacts" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"report.md","content":"# 周报\n...","mime":"text/markdown"}'
```

创建返回 `{"page":{"id":...}}`；分享返回 `{"token","expiresAt"}`，浏览器打开 `$BASE/p/<token>`；撤销分享把 body 改为 `{"enabled":false}`；导出以附件形式下载 HTML。

Agent 侧通常直接调工具：

```bash
jary chat --bot default "把本周任务整理成一个表格页，然后生成季度汇报.pptx"
jary tools | grep -E 'pages\.|artifact\.|office\.'
```

## 3. 配置与参数

### 3.1 Pages

| 工具 | risk | 参数 |
|---|---|---|
| `pages.create` | write | `title`（必填）、`html?`、`template?`（`table` 或 `report`）、`data?` |
| `pages.update` | write | `id`、`title?`、`html?`、`data?`；更新前自动快照 |
| `pages.list` | read | 无 |
| `pages.versions` | read | `id`；返回 `{version,title,createdAt}` 列表（新到旧） |
| `pages.rollback` | write | `id`、`version`；回滚前也会快照当前版本 |
| `pages.export` | read | `id`；返回存储的 HTML |
| `pages.share` | external | `id`、`enabled?`、`ttlHours?`；返回 `{token?,expiresAt?}` |

| HTTP 端点 | 说明 |
|---|---|
| `GET /api/pages` | 列表（含 html 与 shareToken） |
| `POST /api/pages` | 创建；body `{title,html?,data?,template?}` |
| `POST /api/pages/<id>/share` | 生成/撤销分享；body `{enabled?,ttlHours?}` |
| `GET /api/pages/<id>/versions` | 版本历史 |
| `POST /api/pages/<id>/rollback` | 回滚；body `{version}` |
| `GET /api/pages/<id>/export` | 下载 HTML（`content-disposition` 附件） |
| `GET /pages/<id>` | 渲染页面（带 CSP） |
| `GET /p/<token>` | 分享链接渲染；过期或撤销后 404 |

页面对象字段：`id`、`title`、`html`、`data?`、`shareToken?`、`createdAt`、`updatedAt`。硬限制：create 校验 HTML ≤2MB（update 未重复校验）；版本最多保留 20 个；没有页面删除 API/工具；更新只能走 `pages.update`（没有 PATCH 路由）。

渲染 CSP 固定为 `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'`：允许内联样式与 data URI 图片，禁止脚本、外部资源与网络请求。

### 3.2 产物库

| 工具 | risk | 说明 |
|---|---|---|
| `artifact.save` | write | `name`、`content`（字符串）、`mime?`；≤20MB，文件名经 basename 与字符清洗 |
| `artifact.present` | write | `id`；返回 `{presented:true,id,name,path,mime,bytes}` 交付元数据，不复制文件、不落持久标记 |
| `artifact.list` | read | 列出元数据 |

HTTP：`GET /api/artifacts` 列出；`POST /api/artifacts` 保存（`name` + 字符串 `content`，可选 `mime`）。产物元数据含 `id`、`name`、`mime`、`bytes`、`sha256`、`path`、`sessionId`、`createdAt`。

保留期清理通过注册参数启用：`artifactToolsPlugin({ retentionDays: 30 })` 每 6 小时调用 `cleanup(retentionDays)`，删除超期文件与元数据（`cleanup` 自身默认 30 天）。当前 CLI 以无参注册，因此默认不自动清理，见 `packages/cli/src/index.ts`。

### 3.3 Office

| 工具 | 输入 |
|---|---|
| `office.docx` | `path`、`markdown`（标题/列表/段落）、`title?` |
| `office.xlsx` | `path`、`rows`（二维数组，首行表头；单元格为 string/number/null）、`sheet?` |
| `office.pptx` | `path`、`slides[{title,bullets?}]` |

`path` 相对会话工作目录，越界路径会被拒绝；生成文件留在工作区，不会自动进入产物库。

## 4. 常见任务

**4.1 用表格模板做日报/周报。** `pages.create` 传 `template:"table"` 和对象数组 `data`，首行的键渲染为表头；后续用 `pages.update` 传入同一 id 覆盖该页面，更新会留下版本供回滚。模板只在 create 时渲染，之后仅改 `data` 不会重新生成 HTML。

**4.2 分享与撤销。** `pages.share` 传 `ttlHours` 设置过期时间，不传则长期有效；分享链接只读。撤销用 `{"enabled":false}` 清空 token。token 是 16 字节随机 hex，撤销后重新分享会生成新 token。

**4.3 导出离线 HTML。** `pages.export` / `GET /api/pages/<id>/export` 返回存储的 HTML（模板页是完整文档；自定义 `html` 则原样返回），可直接保存离线查看。CSP 只在服务端渲染 `/pages/*` 与 `/p/*` 时注入，导出文件本身不带服务端包装。

**4.4 交付文件产物。** 用 `artifact.save` 保存文本内容（工具与 HTTP 参数是字符串；服务内部也接受二进制，但当前未暴露为工具参数），`artifact.present` 返回元数据与宿主路径；Web UI 的产物面板读取 `GET /api/artifacts`。v1.10.0 没有产物下载/删除的 HTTP 路由，文件需按 `path` 从宿主取用。

**4.5 生成 Office 交付件。** `office.docx` 用近似 markdown 文本生成 Word；`office.xlsx` 用行数组生成表格；`office.pptx` 用标题+要点生成幻灯片（每页最多 8 个要点）。生成后是工作区文件，需要另行复制到宿主或通过工作区文件接口下载。

**4.6 控制产物保留期。** 自定义注册 `artifactToolsPlugin({retentionDays})` 后启用定时清理；否则产物与文件会一直保留到手动清理。手工删除 `$JARY_HOME/artifacts/` 中的文件会让元数据指向不存在的路径。

## 5. 安全边界与限制

- **Pages 是静态页面。** CSP 禁止脚本与外部资源，因此 v1.10.0 不支持交互式脚本、看板筛选、外链图表库；页面 HTML 不做白名单清洗，安全边界由 CSP 承担。
- **页面渲染入口不是 Bearer 鉴权保护的。** `/pages/<id>` 与 `/p/<token>` 不校验 API token，随机 id / token 即访问凭据；不要泄露页面 id，敏感内容应只走受控分享并设置 TTL。
- **分享是只读且可撤销的。** token 通过 `byToken` 校验过期时间；撤销会清空 token；没有密码保护、访问日志或按用户授权。
- **版本历史有限。** 只保留最近 20 版，回滚本身也会占用一个快照位；没有审计记录。
- **产物库不是通用文件服务器。** 仅 20MB 上限、无下载/删除路由、无病毒扫描；`artifact.present` 只返回元数据，不复制文件。
- **产物清理默认关闭。** 不注册 `retentionDays` 时不会自动删除；删除文件与元数据由 `cleanup` 同时处理。
- **Office 能力有限。** 纯 TypeScript 生成，仅覆盖标题/列表/段落、行数据表格、标题+要点幻灯片；不支持公式计算、图表、复杂样式或模板套用，也不走 LibreOffice 转换。
- **明确不做：** 公共页面托管/建站、交互式脚本、产物外链分享、Office 在线编辑。

## 6. 相关文档

- [工具参考](../reference/tools.md)
- [HTTP API 参考](../reference/http-api.md)
- [Web UI 指南](web-ui.md)
- [部署与数据目录](../operations/deployment.md)
- [安全边界](../operations/security.md)
- [故障排查](../operations/troubleshooting.md)
- [设计决策](../design/decisions.md)
