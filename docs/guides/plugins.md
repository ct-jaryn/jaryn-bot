# 插件开发与使用指南

> 适用版本：v1.11.0 · 状态：现行
> 从内核原语、组合与 patch 行，到写出一个可加载的工具插件、声明权限、选择进程外宿主。

## 概览

内核只有四个原语（`packages/kernel/src/`）：

- **Context / Effect**：`ctx.get/provide/has`、`child(scope)`；`ctx.effect(() => disposer)` 注册即效果，卸载逆序回滚。
- **Event / Loader**：`EventBus` 的 `emit/parallel/serial/waterfall`；`composeProfile`/`applyPatch`/`loadComposition` 按 `provides`/`inject` 拓扑加载。

一个插件是 `{name, provides?, inject?, optional?, config?, apply(ctx, config)}`，`definePlugin()` 只保留类型。运行方式有两种：**进程内**（与内核同堆，可注册服务/工具/事件）与**进程外宿主**（子进程 JSON-RPC，只代理工具）。

## 组合：profile 与 patch 行

组合结果是一串行：`{id, name, config?, disabled?}`。`id` 是组合内唯一的行标识，`name` 是插件注册名。`$JARY_HOME/profile.json`（默认 `~/.jary/profile.json`，`jary init` 生成）：

```json
{
  "name": "default",
  "bundles": [{ "name": "base", "patchFile": "/abs/path/packages/bundles/base/patch.json" }],
  "patches": []
}
```

加载顺序：按 `bundles` 顺序展开 → 叠加 `patches` → 叠加命令行 `--patch <file>`；后层覆盖前层，**config 是整值替换，不做深合并**。patch 文件是操作数组：

| 操作 | 写法 | 语义 |
|---|---|---|
| 插入 | `{"insert":[{"id":"x","name":"@jaryn/x","config":{}}]}` | 按 id 追加；同 id 整行替换 |
| 改配置 | `{"id":"x","config":{"a":1}}` | 整值替换 config |
| 禁用 | `{"id":"x","disabled":true}` | 不加载该行 |

```bash
jary config print              # 最终行、顺序、禁用状态
jary plugin doctor             # 静态检查 name 未注册、inject 无人提供
jary plugin disable shell      # 写入 profile.patches，重启生效
jary tools                     # 禁用 shell 后不再出现 shell.run
```

加载器 fail-loud：`name` 未注册、`inject` 服务无启用行提供、`provides` 重复、依赖成环都会直接报错，不会静默跳过。禁用一行后其服务与工具都不存在，模型也就看不到对应工具（`packages/cli/test/acceptance.test.ts` 用禁用 `tools-shell` 验证）。

## 最小插件包（进程内）

结构为 `packages/plugin-echo/{package.json, src/index.ts}`。`package.json`（本仓库源码直跑，不编译；发布到 npm 时改为编译产物入口）：

```json
{
  "name": "@jaryn/plugin-echo",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "jaryn": { "permissions": { "fs": "none", "network": [], "process": false, "secrets": [] } },
  "dependencies": { "@jaryn/kernel": "workspace:*", "@jaryn/agent-core": "workspace:*" }
}
```

`packages/plugin-echo/src/index.ts`：同一个插件既 `provides` 服务、又 `inject` 工具注册表并 `register` 一个工具：

```ts
import { definePlugin } from '@jaryn/kernel'
import type { Plugin } from '@jaryn/kernel'
import type { Tool } from '@jaryn/agent-core'

export interface EchoConfig { prefix?: string }
export interface EchoService { say(text: string): { said: string } }

export function echoPlugin(): Plugin<EchoConfig> {
  return definePlugin({
    name: '@jaryn/plugin-echo',
    provides: ['echo'],
    inject: ['tools'],
    config: { parse: (i) => ({ prefix: String((i as any)?.prefix ?? '') }) },
    apply(ctx, config) {
      ctx.provide<EchoService>('echo', { say: (text) => ({ said: `${config.prefix ?? ''}${text}` }) })
      const tools = ctx.get<{ register(tool: Tool): () => void }>('tools')!
      const echo = ctx.get<EchoService>('echo')!
      ctx.effect(() => tools.register({  // register 返回 disposer，交给 effect 自动回滚
        name: 'echo.say',
        description: '回显传入文本，可配置前缀',
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        risk: 'read',
        async execute(args) { return echo.say(String(args.text ?? '')) },
      }))
    },
  })
}
```

接入需要三步（加载器只认静态注册表，见「限制与边界」）：

```ts
// packages/cli/package.json 的 dependencies 加 "@jaryn/plugin-echo": "workspace:*"
// packages/cli/src/index.ts
import { echoPlugin } from '@jaryn/plugin-echo'
// allPlugins() 的 Map 中加一行：
['@jaryn/plugin-echo', echoPlugin()],
```

再在 `$JARY_HOME/profile.json` 的 `patches` 插入行并重启：

```json
{ "insert": [{ "id": "echo", "name": "@jaryn/plugin-echo", "config": { "prefix": ">> " } }] }
```

验证：`jary config print` 出现 `echo: @jaryn/plugin-echo` → `jary plugin doctor` 输出 `ok: all plugins resolve` → `jary tools` 出现 `echo.say` → `jary serve` 后模型可调用。工具 `risk` 决定审批：`read`/`write`/`network` 默认放行，`execute`/`external`/`destructive` 默认弹审批（`packages/agent-core/src/approvals.ts`）。

## 权限声明

每个包在 `package.json` 的 `jaryn.permissions` 声明能力：

| 字段 | 取值 | 含义 |
|---|---|---|
| `fs` | `none` / `readonly` / `workspace` / `full` | 文件访问范围 |
| `network` | 域名数组，`"*"` 表示全部 | 出网目标 |
| `process` | 布尔 | 是否起子进程 |
| `secrets` | 字符串数组 | 需要读取的 secret 名 |

```bash
jary plugin permissions   # 高危声明，如 @jaryn/computer: {"fs":"workspace","process":true,"network":["*"]}
```

实际约束要看清：内核不读取也不拦截 `jaryn.permissions`；该命令只扫描仓库内 `packages/*/package.json` 并列出高危声明。真正的隔离边界是**进程外宿主**，以及工具自身对 workspace、域名白名单的限制。第三方安装时的 `--trust` 只是消除警告，不是授权开关。

## 进程外宿主（二选一）

不可信或独立发布的插件不要进内核进程。`@jaryn/plugin-host` 用子进程 + 换行分隔 JSON 代理工具：

| 方向 | 消息 | 说明 |
|---|---|---|
| 子→父 | `{"type":"ready","tools":[{name,description,schema,risk}]}` | 握手，20 秒超时 |
| 父→子 | `{"type":"call","id","tool","args"}` | 调用工具，默认 60 秒超时 |
| 子→父 | `{"type":"result","id","ok","output" 或 "error"}` | 返回结果 |
| 子→父 | `{"type":"fatal","error"}` | 握手失败 |

在 profile patch 中给已有的 `plugin-host` 行换成 hosts 配置即可（config 整值替换）：

```json
{ "id": "plugin-host", "name": "@jaryn/plugin-host",
  "config": { "hosts": [
    { "id": "demo", "command": "node",
      "args": ["examples/plugin-host/echo-plugin.ts"], "timeoutMs": 60000 }
  ] } }
```

工具以 `<hostId>.<toolName>` 注册（上例为 `demo.echo`）；子进程未声明 `risk` 时默认 `external`，即默认需要审批。示例实现见 `examples/plugin-host/echo-plugin.ts`。宿主只代理工具，不代理服务、事件订阅或上下文；子进程与主进程同 OS 用户，隔离的是堆、崩溃面与依赖，不是权限沙箱。

| 维度 | 进程内插件 | 进程外宿主 |
|---|---|---|
| 能做什么 | 注册服务、工具、事件、effect | 只能提供工具 |
| 需要改 `allPlugins()` | 需要 | 不需要，改 patch 配置即可 |
| 崩溃影响 | 拖垮服务端进程 | 只影响宿主与它的工具 |

## 插件 CLI

| 命令 | 行为 |
|---|---|
| `jary plugin list` | 打印组合行：enabled/disabled、id、name |
| `jary plugin doctor` | 静态检查 name 未注册、`inject` 服务无人提供；有问题返回 1 |
| `jary plugin permissions` | 扫描包 manifest 的高危权限声明 |
| `jary plugin add npm:<pkg>@<ver>` / `git:<url>` / `file:<path>` | `npm install` 到 `$JARY_HOME/profiles/default`，并向 profile.patches 追加行；`--trust` 仅消除进程内运行警告 |
| `jary plugin remove <name>` | 按插件 name 删除 patch 行（不卸载 node_modules） |
| `jary plugin enable` / `disable <id>` | 向 profile.patches 追加/覆盖 `{id,disabled}`，重启生效 |
| `jary plugin index add <url>` | 记录索引源到 `$JARY_HOME/plugin-index.json`；无参数时打印 |

## 排错

| 现象 | 原因与处理 |
|---|---|
| `unknown plugin: <name> (row <id>)` | name 没进 `allPlugins()`；仓内插件补注册，或改用进程外宿主 |
| `plugin doctor` 报 `MISSING DEP` | 被注入的服务没有任何启用行提供；检查提供者是否被 disabled |
| 报 `service X provided twice` | 两行声明了同一个 `provides`；合并或禁用其一 |
| 报 `circular dependency at row X` | `inject` 成环；拆出公共依赖行 |
| 改了 config 不生效 | patch 是整值替换；用 `jary config print` 核对最终行 |

## 限制与边界

- 加载器没有动态导入：`packages/cli/src/index.ts` 的 `allPlugins()` 是唯一注册表。`jary plugin add` 只完成 npm 安装与写行，**不会**让该包被内核加载，`plugin doctor` 会报 MISSING。第三方插件请走进程外宿主，或自行在注册表登记。
- `optional` 只出现在 `Plugin` 类型与少数内置包的声明里；`Context.mount` 与 `loadComposition` 只校验 `inject`，软依赖需在 `apply` 里用 `ctx.get` 判空。
- 没有 HMR：改插件、enable/disable 都要重启 `jary serve`。进程内插件与内核同权限，插件崩溃会带走服务端；权限声明也不是运行时强制，`plugin permissions` 只扫仓库内 `packages/*`（不覆盖 npm 安装的第三方包）。
- 进程外宿主只代理工具：没有服务注入、事件订阅、上下文访问；子进程工具在 `ready` 后才注册，启动瞬间可能短暂不可见。
- `plugin index` 只记录索引 URL，没有 search 与从索引安装；`plugin remove` 不清理 `node_modules`。
- 单进程组合：同一服务名只能有一个提供者，多副本部署不会共享插件状态。

## 相关文档

- [快速开始](../getting-started.md) · [核心概念](../concepts.md) · [工具参考](../reference/tools.md) · [配置参考](../reference/configuration.md)
- [CLI 参考](../reference/cli.md) · [事件参考](../reference/events.md) · [架构](../design/architecture.md) · [决策记录](../design/decisions.md) · [审计](../design/audit.md)
- [测试](../operations/testing.md) · [故障排查](../operations/troubleshooting.md) · [Web UI](../guides/web-ui.md) · [客户端](../guides/clients.md)
