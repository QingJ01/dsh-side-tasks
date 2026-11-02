# DSH Side Tasks（侧边聊天）

[English](README.md)

这是一个 DeepSeek Harness 双端插件：在当前会话顶部提供“侧边聊天”入口，继承当前会话的上下文，在独立的 `sidechat` 标签中临时运行。关闭对应标签时会停止并归档子会话，不会在左侧留下新的普通会话。

## 功能

- 会话右上角的**侧边聊天**小图标，点击在右侧栏当前面板准备一个 idle 子会话，直接使用 Harness 原生 Conversation 和 composer，包括编辑器、指令菜单、权限控件和发送/停止行为；没有手写首消息输入框，也没有合成首消息。
- 原生模型/推理等级和权限预设菜单。选择只持久化到侧边 child，不修改父会话或全局默认模型；完全权限保留原生风险确认。
- 右侧栏“开始”页的原生卡片，使用 Harness 同款 `IconNewChatOutlineRegular` 线性图标，点击打开同一套原生侧边聊天。
- 注册专用 `side-task` 子智能体后端，在创建时复制父会话已完成回合的上下文。
- 子会话为空时显示“侧边聊天是临时聊天，关闭标签后会结束并移除”。
- 创建完成后先释放 AgentHandle，再让原生发送流程冷恢复 child，避免重复持有写入句柄。
- 独立的 `sidechat` 资源和关闭钩子，不影响模型创建的普通子智能体标签。
- `sideTasks/discard` 通过持久化 `side-task` provider descriptor 校验所有权，停止子会话并归档。

## 环境要求

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0`
- 开发时需要 Node.js `>=24.9.0`
- profile 中具有子智能体运行时、Session Query、Workspace registry 和 `dsh-client-ui-subagent`（官方 Web/Desktop 组合默认具备）

## 安装

**0.1.0 尚未发布。** 这里是开发中的 0.1.0，GitHub 上暂时没有 Release 和 tag。请从源码构建：

```sh
git clone https://github.com/QingJ01/dsh-side-tasks.git
cd dsh-side-tasks
pnpm install
pnpm build
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

Web profile 请改用 `--profile web`。安装后重启 Harness，打开一个会话，点击顶部的**侧边聊天**。

同一版本修改后需要先移除再安装（pnpm 不会重新展开同版本 `file:` 包）：

```sh
dsh plugin --profile desktop remove dsh-side-tasks
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

## 使用与生命周期

| 操作 | 行为 |
| --- | --- |
| 新建侧边聊天 | 创建一个 continuable 子会话，并将它的 `sidechat` 资源打开到右侧栏。 |
| 关闭对应标签 | 调用 `sideTasks/discard`，停止并归档该子会话，不创建普通会话。 |
| 仅收起整个右侧栏 | 标签仍然保留，不触发归档。 |
| 任务完成 | 结果留在子会话记录中；当前 Harness 冷恢复路径也可能通知并唤醒父会话。 |

**删除语义**：Harness 的公开插件 API 提供的是持久化归档，不提供物理删除会话日志。本插件使用受支持的生命周期，不直接修改会话文件；界面中的“结束并移除”不代表擦除磁盘记录。

**子会话设置**：原生菜单接到插件专用配置接口，校验父子关系与 child 自己的 provider descriptor。空闲配置使用临时 writer，释放后才恢复发送；运行中的 manager Agent 不会被设置操作释放。冷恢复会从 child 自己的持久化选择恢复模型及图片能力检查选项。冷恢复后的完成通知仍使用运行时默认的父会话投递策略，可能唤醒父会话。

**已知限制**：Harness 内置子智能体目录不会过滤已归档子会话，因此关闭后的侧边聊天仍可能在该目录中被枚举，直到 Harness 提供删除或目录过滤扩展点。本插件不会改写父会话的不可变日志来隐藏它。关闭会先把待归档地址写入浏览器本地队列再发 Remote 请求，并在后续插件激活时重试；重试有 5 次/7 天上限，并会跳过仍在别处打开的 child。浏览器本地存储丢失仍是可能漏归档的窗口。

**上下文范围**：创建时截取父会话最近一个完整回合结束之前的历史，未完成的当前回合不会纳入。上下文只截取一次，后续主会话的新消息不会持续同步到已经创建的侧边聊天。

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

66 项测试覆盖：原生模型/权限控件适配、父会话不变性、配置期间暂停发送、冷恢复模型、配置 Remote 校验、专用 provider 的回合截断、caller 投递、空任务与取消、Gateway 取消信号、Remote 参数/结果钉扎、真实 keyed SlotCore 所有权、标签地址与标题、归档优先的关闭生命周期、跨版本 descriptor 所有权校验、拒绝伪装标签误删、父 Agent 离线归档、持久化且有界的重试队列、存储 getter 抛错隔离、UI 异步注册失败回滚与 locale 冲突隔离、idle 创建时释放 writer、StrictMode 去重、创建后关闭的迟到结果清理、原生 Conversation 接入、首回合边界、并发重试队列合并、header 单面板打开原生会话、资源失败帧、子会话/归档父会话禁止创建、包导出完整性，以及临时空状态提示。

## License

MIT
