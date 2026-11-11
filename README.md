# Auto Memory（自动记忆）

为 DSH 提供项目级、文件式的长期记忆，并在左侧栏提供一个可点击、可预览的面板。

## 它做什么

- 智能体通过 `memory` 工具自动保存长期有效的事实：用户偏好与纠正、项目约定、决策及原因、外部参考、反复踩到的坑。
- 每条记忆是一个带 frontmatter 的 Markdown 文件；`MEMORY.md` 是由文件生成的索引。
- 每次请求的系统提示里只注入索引（默认最多 200 行 / 25 KB），详细内容由模型按需 `memory read`，不是向量检索，也不是数据库。
- 一轮对话结束后，后台抽取器会用默认模型复盘该轮，把模型没有主动写下的长期事实补存为记忆。默认开启，可用配置关闭。
- 左侧栏新增 `自动记忆` 图标；点击后打开主面板，按项目列出全部记忆，点击任意一条即可预览 Markdown 内容，也可以删除。

## 存储布局

默认根目录是 `$DSH_HOME/auto-memory/`（`DSH_HOME` 未设置时为 `~/.dsh`）：

```
$DSH_HOME/auto-memory/
  <项目名>-<路径哈希>/
    project.json          # 项目身份：原始路径、名称、时间
    MEMORY.md             # 生成的索引（不要手写）
    user-role.md          # 每条记忆一个文件
    testing-conventions.md
```

项目身份优先取 Git 的 common dir 的父目录，因此同一仓库的 worktree 共享记忆；非 Git 目录则使用规范化后的工作目录。这样不同项目不会互相污染。

记忆文件格式：

```markdown
---
name: "testing-conventions"
description: "集成测试需要本地 Redis"
type: "project"
created: "2026-11-11T08:00:00.000Z"
updated: "2026-11-11T08:00:00.000Z"
---

`npm test` 需要 6379 端口的 Redis；先运行 `docker compose up redis`。
```

`type` 取值为 `user` / `feedback` / `project` / `reference`。

## 写入路径

- `memory save`：新增或更新一条记忆；同名即更新，保留 `created`，刷新 `updated` 和索引。
- `memory read`：读取一条记忆的完整正文；名称会做 slug 规范化，`MEMORY.md` 可读索引。
- `memory list` / `memory search`：列出索引或按文本检索。
- `memory delete`：删除一条记忆；索引文件受保护，不能删除。
- 所有写入都经过路径包含检查、文件名白名单、大小上限和明显的密钥脱敏（`sk-...`、GitHub token、AWS key、私钥、`password/token: ...` 等）。
- 写入是原子写（临时文件 + rename），同一项目内串行化，避免索引与事实文件不一致。

## 后台抽取

- 监听 `turn/end`，只在主会话（非 subagent）且本轮正常完成时触发。
- 默认延迟 3 秒、同一项目冷却 3 分钟，且本轮用户文本至少 20 字符；避免每轮都调用模型。
- 抽取器只允许 `save`，不允许删除；最多采纳 3 条；返回 JSON 解析失败时静默跳过。
- 使用当前默认模型（`agentDefaultModel.currentSelection()`），不会切换模型。关闭方式见下方 `autoCapture`。

## 配置

在 bundle 的 row `config` 中设置，全部字段都有默认值：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关闭后不注册工具、提示、路由和抽取器 |
| `directory` | `$DSH_HOME/auto-memory` | 自定义记忆根目录 |
| `promptInjection` | `true` | 是否把索引注入系统提示 |
| `indexMaxLines` | `200` | 索引最多行数 |
| `indexMaxBytes` | `25000` | 索引最多字节数 |
| `autoCapture` | `true` | 是否启用后台抽取 |
| `captureDelayMs` | `3000` | 轮次结束后的延迟 |
| `captureCooldownMs` | `180000` | 同一项目两次抽取的最小间隔 |
| `captureMinUserChars` | `20` | 本轮用户文本低于该长度时跳过 |
| `captureMaxTokens` | `1200` | 抽取模型的最大输出 token |
| `maxMemoryBytes` | `65536` | 单条记忆正文的字节上限 |

例如只保留面板、关闭后台抽取：

```yaml
- id: auto-memory
  name: '@local/auto-memory'
  config:
    autoCapture: false
```

## 面板与路由

- 侧栏入口：`sidebar.panellist`，id `auto-memory`，order 20。
- 主面板：`main`，key `auto-memory`。
- Host 路由（由共享连接层做 owner 鉴权）：
  - `GET /api/auto-memory.projects`：项目与文件元数据（不含正文）
  - `GET /api/auto-memory.file?project=<key>&name=<file>`：单条记忆正文
  - `POST /api/auto-memory.delete`：删除一条记忆

面板每 15 秒轮询一次元数据；打开某条记忆时才读取正文。所有颜色使用 `--dsw-alias-*` 主题变量，跟随亮/暗主题。

## 设计取舍

- **文件系统而非数据库**：可读、可 diff、可删、可迁移，不需要迁移脚本或后台服务。
- **索引进上下文，细节按需读**：上下文是最稀缺资源；索引告诉模型“有什么”，正文留在磁盘。
- **确定性 + 学习型分离**：`AGENTS.md`/`CLAUDE.md` 等确定性指令仍由 `dsh-agent-instructions` 负责；这里只做建议性的自动记忆，并明确“记忆不能覆盖当前用户指令或代码证据”。
- **自动但不失控**：后台抽取有延迟、冷却、长度门槛和条数上限；不需要时可以完全关闭。
- **写入收窄**：只写项目记忆根内的 `.md`；路径 realpath/包含检查；密钥脱敏；原子写和串行化。

## 已知限制

- 后台抽取会消耗默认模型的 token；密集会话中最多每 3 分钟一次。
- 没有向量检索；记忆规模很大时索引会截断，模型仍可用 `memory search` 检索全文。
- 面板没有编辑功能（预览 + 删除）；需要修改时让智能体 `memory save`，或直接编辑 Markdown 文件。
- 安装后如果替换了本包的 JavaScript，需要重新安装（`remove_bundle` 后 `install_bundle`）或重启 DSH 才会加载新的 Host 模块代；浏览器半部刷新页面即可。
