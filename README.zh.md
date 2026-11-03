# DSH Side Tasks（侧边聊天）

[English](README.md)

这是一个 DeepSeek Harness 双端插件：在当前会话顶部提供“侧边聊天”入口，通过只读查询获取有界上下文，并在独立的 `sidechat` 根 Session 中运行。它只显示在右侧栏，不会出现在普通主会话列表；关闭对应标签时只停止并归档侧聊。

## 功能

- 会话右上角的**侧边聊天**小图标，点击在右侧栏当前面板准备一个 idle 子会话，直接使用 Harness 原生 Conversation 和 composer，包括编辑器、指令菜单、权限控件和发送/停止行为；没有手写首消息输入框，也没有合成首消息。
- 原生模型/推理等级和权限预设菜单。选择只持久化到侧边 child，不修改父会话或全局默认模型；完全权限保留原生风险确认。
- 右侧栏“开始”页的原生卡片，使用 Harness 同款 `IconNewChatOutlineRegular` 线性图标，点击打开同一套原生侧边聊天。
- 侧边聊天从空白开始，只显示自己的对话和用量；父会话已完成回合的上下文以子会话提示上下文注入，模型能接着做，底部统计只算侧边聊天自己的消耗。
- 子会话为空时显示“侧边聊天是临时聊天，关闭标签后会结束并移除”。
- 独立的 `sidechat` 资源和关闭钩子，不影响模型创建的普通子智能体标签。
- 回复完成后侧聊仍保持打开且可继续发送；只有显式关闭会停止并归档，收起侧栏不是关闭。
- `sideTasks/discard` 通过 child 自有 descriptor 和 `origin: sidechat` 校验所有权，只停止并归档 child，不触碰来源会话。
- 创建前要求 Host `SessionController` 与 Client workspace 过滤能力均可用；缺少任一能力都会显示错误并拒绝创建，不回退为普通会话或子智能体。

## 环境要求

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0`
- 开发时需要 Node.js `>=24.9.0`
- 使用应用了本仓库 [`compat/`](compat/README.md) 适配补丁的 RC.5 Harness 源码构建 Web/Desktop profile。补丁、Node 安全应用脚本和中英安装说明由仓库提供，不包含在 npm tarball 中。未经修改的 RC.5 会安全拒绝创建。

## 安装

**0.1.0 尚未发布。** 这里是开发中的 0.1.0，GitHub 上暂时没有 Release 和 tag。请从源码构建：

```sh
git clone https://github.com/QingJ01/dsh-side-tasks.git
cd dsh-side-tasks
pnpm install
pnpm build
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

先将补丁应用到干净且固定在 RC.5 commit 的 Harness 源码树，再构建并启动源码 profile；脚本会校验精确 commit、干净 tracked tree，并在写入前运行 `git apply --check`，不会下载或修改已安装的私有 runtime：

```sh
node compat/apply-harness-sidechat.mjs /path/to/deepseek-harness
cd /path/to/deepseek-harness
pnpm install
pnpm run build:artifacts
pnpm run build:check
pnpm dsh web
```

桌面 profile 命令见 [`compat/README.md`](compat/README.md)。安装后重启已打补丁的 Harness，打开一个会话并点击顶部的**侧边聊天**。

同一版本修改后需要先移除再安装（pnpm 不会重新展开同版本 `file:` 包）：

```sh
dsh plugin --profile desktop remove dsh-side-tasks
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

## 使用与生命周期

| 操作 | 行为 |
| --- | --- |
| 新建侧边聊天 | 通过只读查询读取来源，创建独立根 Session 并在右侧栏打开。 |
| 关闭对应标签 | 校验 child 自有 descriptor 后，只停止并归档该侧聊 Session。 |
| 仅收起整个右侧栏 | 标签仍然保留，不触发归档。 |
| 再次点击顶部侧边聊天入口 | 展开并聚焦已有标签，不重复创建 child；侧栏已展开时不会反向收起。 |
| 有未发送草稿时刷新 | 即使侧聊尚未发送，原生 Session body 也保持挂载，沿用 Harness 的浏览器本地草稿持久化。 |
| 任务完成 | 侧聊继续保持打开，可发送后续消息；完成不会自动归档。 |

**删除语义**：Harness 的公开插件 API 提供的是持久化归档，不提供物理删除会话日志。本插件使用受支持的生命周期，不直接修改会话文件；界面中的“结束并移除”不代表擦除磁盘记录。

**子会话设置**：原生 Conversation 提供唯一一组模型/推理等级与权限菜单，调用 child 自己的原生 Session controller。Harness 适配确保侧聊模型选择不修改全局默认值。模型/推理等级、preset、工作目录与有效权限选择均通过只读来源查询捕获，并独立记录和恢复在 child 上；不会恢复或激活来源。保留的兼容配置接口仍校验独立 origin 与 child 自有 descriptor，并将模型选择交给同一个原生 controller。

**旧侧聊**：旧 continuable 地址只用于显示迁移提示和提供安全关闭。冷的旧 child 可通过只读查询校验后归档；仍驻留的旧 child 会被拒绝。请先重启已打补丁的 Harness，再关闭旧标签或创建新的独立侧聊。插件不会恢复、配置或发送旧 child，也不会改写历史日志。

关闭会先把待归档地址写入浏览器本地队列再发 Remote 请求，并在后续插件激活时重试；重试有 5 次/7 天上限，并会跳过仍在别处打开的 child。浏览器本地存储丢失仍是可能漏归档的窗口。

**上下文范围**：侧边聊天会携带父会话已完成回合中的用户输入和助手回复，以提示上下文注入，不复制到侧聊的聊天记录中。未完成的当前回合不会纳入。同一个 child Agent 存活期间不持续同步父会话的新消息；每次冷恢复都会重新截取父会话当时的已完成历史，包括准备空白侧聊后的首次发送。

这是一份有上限的文本快照，不是父会话完整模型输入的克隆：最多取最近 120 条非空人机消息，并确保包含固定说明前缀在内的完整注入文本不超过 100,000 个字符；不包含图片、工具结果或压缩摘要。精确注入文本会在注册前记录到 child，而不是复制到来源或 child transcript。读取的是原始对话日志，而非压缩后的有效模型上下文，因此已被压缩替换的旧消息仍可能出现；来源不存在或已归档时使用 child 自己最后记录的文本。

这里的“已完成回合”指已经写入 `turn/end` 的回合，包括失败或主动停止，不仅限于成功回复。插件卸载或 child 释放时会取消待完成的上下文读取，迟到结果不会再注册新上下文。

## 开发

```sh
pnpm install
pnpm check       # 类型检查、Host/Client 构建、Remote 描述和全部测试
pnpm test        # 构建并运行测试
pnpm --filter dsh-side-tasks pack --pack-destination dist
```

包结构：

- `src/index.ts`：Host 服务及 `create` / `discard` Remote。
- `src/side-task.ts`：上下文创建、所有权校验、停止与归档。
- `src/client/index.ts`：会话头部入口、资源打开和关闭生命周期。
- `src/client/sidebar-chat.tsx`：独立标签适配与临时空状态提示。
- `artifacts/`：内置惰性 Remote 描述工厂，避免受 profile 中旧的 Typert 协议子路径影响。
- `scripts/postbuild.mjs`：整理 Harness 约定的 `client.js` 和 Remote 构建产物。

## 测试覆盖

测试覆盖：继承上下文格式化与回合截断、标签复用及收起后重新展开、无 seed 创建、原生模型选择委托与 composer 控件非替换、父会话不变性、冷恢复模型、配置 Remote 校验、专用 provider 的回合截断、caller 投递、空任务与取消、Gateway 取消信号、Remote 参数/结果钉扎、真实 keyed SlotCore 所有权、标签地址与标题、归档优先的关闭生命周期、跨版本 descriptor 所有权校验、拒绝伪装标签误删、父 Agent 离线归档、持久化且有界的重试队列、存储 getter 抛错隔离、UI 异步注册失败回滚与 locale 冲突隔离、idle 创建时释放 writer、StrictMode 去重、创建后关闭的迟到结果清理、原生 Conversation 接入、首回合边界、并发重试队列合并、header 单面板打开原生会话、资源失败帧、多资源引用与最终释放、卸载/释放时取消上下文读取并忽略迟到结果、子会话/归档父会话禁止创建、包导出完整性，以及临时空状态提示。

## License

MIT
