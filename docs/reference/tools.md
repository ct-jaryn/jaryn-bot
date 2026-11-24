# 工具清单

> 适用版本：v1.11.0 · 状态：自动生成（`npm run inventory`）

模型可见的 **74** 个工具，按用途分组。风险等级决定审批行为，见 [核心概念](../concepts.md)。

说明列是工具注册时给模型的原始描述，与运行时一致；分组标题为中文归类。

| 风险 | 数量 | 默认行为 |
|---|---|---|
| `read` | 26 | 自动允许 |
| `write` | 29 | 自动允许（工作区内） |
| `execute` | 10 | 逐次审批 |
| `network` | 3 | 自动允许（SSRF 防护） |
| `external` | 5 | 逐次审批 |
| `destructive` | 1 | 逐次审批 |

## 文件系统

| 工具 | 风险 | 说明 |
|---|---|---|
| `fs.edit` | write | Replace a literal string in a file (must be unique unless all=true). |
| `fs.glob` | read | Find files by glob pattern (e.g. src/**/*.ts) inside the workspace. |
| `fs.grep` | read | Search file contents with a regex inside the workspace (capped). |
| `fs.list` | read | List a directory inside the workspace (names only, capped). |
| `fs.read` | read | Read a UTF-8 text file inside the workspace. |
| `fs.write` | write | Create or overwrite a UTF-8 text file inside the workspace (parent dirs created). |

## 网络

| 工具 | 风险 | 说明 |
|---|---|---|
| `web.fetch` | network | Fetch a public web page and return its readable text (SSRF guarded). |
| `web.search` | network | Search the web and return titles, URLs and snippets. Configure search.baseUrl (searxng) for reliability. |

## Shell

| 工具 | 风险 | 说明 |
|---|---|---|
| `shell.run` | execute | Run a shell command in the session workspace and return stdout/stderr. |

## 记忆

| 工具 | 风险 | 说明 |
|---|---|---|
| `memory.catalog` | read | List memory categories and counts (browse without loading everything). |
| `memory.forget` | write | Delete a memory by id or matching keywords. |
| `memory.list` | read | List memory entries by kind or tag. |
| `memory.read` | read | Read one memory entry by id. |
| `memory.remember` | write | Store a durable fact, preference or rule for future turns. |
| `memory.search` | read | Search long-term memory by keywords. |

## 任务板

| 工具 | 风险 | 说明 |
|---|---|---|
| `task.claim` | write | Claim a task (compare-and-set). |
| `task.complete` | write | Mark a claimed task done. |
| `task.create` | write | Create a shared task on the session task board. |
| `task.list` | read | List tasks on the board. |

## Bot / 子任务

| 工具 | 风险 | 说明 |
|---|---|---|
| `bot.inbox` | read | Read queued messages sent to a bot. |
| `bot.list_agents` | read | List available bots in the roster. |
| `bot.send_message` | external | Send a message to another bot (max 2 hops). |

## 浏览器

| 工具 | 风险 | 说明 |
|---|---|---|
| `browser.click` | execute | Click an element by CSS selector. |
| `browser.extract` | read | Extract visible text from the current page. |
| `browser.goto` | network | Open a URL in the bot computer browser. |
| `browser.screenshot` | read | Capture the page screenshot to a PNG file. |
| `browser.type` | execute | Type into an input by CSS selector. |

## 云电脑

| 工具 | 风险 | 说明 |
|---|---|---|
| `computer.exec` | execute | Run a shell command inside the bot computer container (Docker backend only). |
| `computer.restart` | execute | Restart the bot computer (fresh browser profile session). |
| `computer.restore` | execute | Restore a computer snapshot. |
| `computer.snapshot` | write | Snapshot workspace and browser profile. |
| `computer.start` | execute | Start the bot computer (Chrome + workspace). |
| `computer.status` | read | Check the bot computer state. |
| `computer.stop` | execute | Stop the bot computer. |
| `computer.usage` | read | Show runtime usage and limits for the bot computer. |

## Vault

| 工具 | 风险 | 说明 |
|---|---|---|
| `vault.fill` | external | Fill a saved login into the current browser page (model never sees the secret). |
| `vault.fill_card` | destructive | Fill a saved card into the checkout page. Disabled by default; every use requires approval. |
| `vault.grant` | write | Grant or revoke a bot access to a credential item. |
| `vault.list` | read | List saved credential metadata (never returns secrets). |
| `vault.remove` | write | Delete a saved credential. |
| `vault.rotate` | write | Replace the stored secret for an item (value never returned to the model). |
| `vault.secure_form` | write | Create a one-time secure form link so the user can enter a credential without exposing it to the model. |

## 页面

| 工具 | 风险 | 说明 |
|---|---|---|
| `pages.create` | write | Create an interactive page (report/dashboard) from HTML or a table template. |
| `pages.export` | read | Export a page as a self-contained HTML document. |
| `pages.list` | read | List pages. |
| `pages.rollback` | write | Restore a page to a previous version. |
| `pages.share` | external | Create or revoke a read-only share token for a page. |
| `pages.update` | write | Update an existing page. |
| `pages.versions` | read | List saved versions of a page. |

## 产物

| 工具 | 风险 | 说明 |
|---|---|---|
| `artifact.list` | read | List artifacts. |
| `artifact.present` | write | Mark an artifact as a deliverable for the user (returns its id and path). |
| `artifact.save` | write | Save a text/binary artifact and return its id and path. |

## Office

| 工具 | 风险 | 说明 |
|---|---|---|
| `office.docx` | write | Create a Word .docx from markdown-ish text (headings, bullets, paragraphs). |
| `office.pptx` | write | Create a PowerPoint .pptx from slides (title + bullets). |
| `office.xlsx` | write | Create an Excel .xlsx from rows (first row is the header). |

## 主动提议

| 工具 | 风险 | 说明 |
|---|---|---|
| `initiative.accept` | execute | Accept a proposal, create the task and run it now (pass run=false to only create it). |
| `initiative.dismiss` | write | Dismiss a proposal (optionally mute this type). |
| `initiative.list` | read | List pending proactive proposals. |
| `initiative.scan` | read | Scan for proactive proposals (failed jobs, stale tasks). |

## 教学

| 工具 | 风险 | 说明 |
|---|---|---|
| `teach.draft` | write | Draft a SKILL.md from a title and steps. |
| `teach.list` | read | List taught skills. |
| `teach.record_start` | write | Start recording user/bot actions on the computer to turn into a skill. |
| `teach.record_stop` | write | Stop recording and draft a SKILL.md from the captured steps. |
| `teach.save` | write | Save a taught skill to the workspace skills directory. |

## 例程

| 工具 | 风险 | 说明 |
|---|---|---|
| `schedule.cancel` | write | Disable or remove a scheduled job. |
| `schedule.create` | write | Create a recurring job: mission runs on a cron/every/webhook trigger with a budget. |
| `schedule.list` | read | List scheduled jobs and their next run time. |

## 目标

| 工具 | 风险 | 说明 |
|---|---|---|
| `goal.pause` | write | Pause or clear the active goal. |
| `goal.run` | execute | Drive the active goal for up to maxRounds turns until DONE/BLOCKED. |
| `goal.set` | write | Set (or replace) the persistent goal for this session. |
| `goal.status` | read | Show the active goal and its progress. |

## 其它

| 工具 | 风险 | 说明 |
|---|---|---|
| `ask_user` | external | Ask the user a question and wait for their answer (use sparingly, for blocking ambiguity). |
| `skill.load` | read | Load the full SKILL.md for a taught skill by name. |
| `spawn_worker` | external | Delegate a task to another bot (child session, its own workspace) and return its result. |
