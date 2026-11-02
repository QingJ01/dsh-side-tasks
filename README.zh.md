# DSH Side Tasks（侧边聊天）

[English](README.md)

这是一个 DeepSeek Harness 双端插件：在当前会话顶部提供“侧边聊天”入口，继承当前会话的上下文，在独立的 `sidechat` 标签中临时运行。关闭对应标签时会停止并归档子会话，不会在左侧留下新的普通会话。

## 功能

- 会话顶部的**侧边聊天**按钮，同一个弹窗支持新建和关闭前恢复。
- 右侧栏“开始”页的原生卡片，使用 Harness 同款 `IconNewChatOutlineRegular` 线性图标，点击进入首个任务创建页。
- 使用 Harness 标准 `fork` 子智能体后端继承上下文。
- 子会话为空时显示“侧边聊天是临时聊天，关闭标签后会结束并移除”。
- 使用 `caller` 投递方式独立执行，完成后不自动向主对话注入消息。
- 独立的 `sidechat` 资源和关闭钩子，不影响模型创建的普通子智能体标签。
- `sideTasks/discard` 校验插件所有权，停止子会话并归档。
- 已归档子会话从插件的恢复列表中消失。

## 环境要求

- DeepSeek Harness `>=0.1.0-rc.5 <0.3.0`
- 开发时需要 Node.js `>=24.9.0`
- profile 中具有标准 `fork` 子智能体提供方、Workspace registry 和 `dsh-client-ui-subagent`（官方 Web/Desktop 组合默认具备）

## 安装

从 [最新 Release](https://github.com/QingJ01/dsh-side-tasks/releases/latest) 下载 `dsh-side-tasks-0.1.0.tgz`，然后安装到 profile：

```sh
dsh plugin --profile desktop add ./dsh-side-tasks-0.1.0.tgz
```

Web profile 请改用 `--profile web`。安装后重启 Harness，打开一个会话，点击顶部的**侧边聊天**。

从本地源码安装：

```sh
git clone https://github.com/QingJ01/dsh-side-tasks.git
cd dsh-side-tasks
pnpm install
pnpm build
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

## 使用与生命周期

| 操作 | 行为 |
| --- | --- |
| 新建侧边聊天 | 创建一个 continuable 子会话，并将它的 `sidechat` 资源打开到右侧栏。 |
| 关闭对应标签 | 调用 `sideTasks/discard`，停止并归档该子会话，不创建普通会话。 |
| 关闭前恢复 | 按原来的父子地址打开同一个子会话，不再次调用创建 Remote。 |
| 关闭后恢复 | 已归档子会话会从插件的恢复列表排除。 |
| 仅收起整个右侧栏 | 标签仍然保留，不触发归档。 |
| 任务完成 | 结果留在子会话记录中，不自动唤醒父会话模型。 |

**删除语义**：Harness 的公开插件 API 提供的是持久化归档，不提供物理删除会话日志。本插件使用受支持的生命周期，不直接修改会话文件；界面中的“结束并移除”不代表擦除磁盘记录。

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
- `artifacts/`：基于公开 `createTypertRemoteInfo` 的 Remote 描述与类型。
- `scripts/postbuild.mjs`：整理 Harness 约定的 `client.js` 和 Remote 构建产物。

## 测试覆盖

18 项测试覆盖：上下文 fork、caller 投递、空任务与取消、Remote 严格校验、标签地址、创建与恢复、关闭时停止并归档、拒绝误删普通子智能体、归档后隐藏恢复项，以及临时空状态提示。

## License

MIT
