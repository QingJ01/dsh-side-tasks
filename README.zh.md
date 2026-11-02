# DSH Side Tasks（侧边任务）

[English](README.md)

这是一个 DeepSeek Harness 双端插件：在当前会话顶部提供“侧边任务”入口，继承当前会话的上下文，在右侧栏独立执行。关闭标签或收起侧栏不会取消任务、创建普通会话，也不会让左侧会话列表多出一项。

## 功能

- 会话顶部的**侧边任务**按钮，同一个弹窗支持新建和恢复。
- 使用 Harness 标准 `fork` 子智能体后端继承上下文。
- 使用 `caller` 投递方式独立执行，完成后不自动向主对话注入消息。
- 恢复已有任务时不调用创建接口，不新建普通会话。
- 通过父会话的持久化子智能体目录找回，页面刷新后仍可恢复。
- 直接复用 Harness 的聊天、输入、停止和右侧栏，不维护一套分叉 UI。

## 环境要求

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0`
- 开发时需要 Node.js `>=24.9.0`
- profile 中具有标准 `fork` 子智能体提供方和 `dsh-client-ui-subagent`（官方 Web/Desktop 组合默认具备）

## 安装

从 [最新 Release](https://github.com/QingJ01/dsh-side-tasks/releases/latest) 下载 `dsh-side-tasks-0.1.0.tgz`，然后安装到 profile：

```sh
dsh plugin --profile desktop add ./dsh-side-tasks-0.1.0.tgz
```

Web profile 请改用 `--profile web`。安装后重启 Harness，打开一个会话，点击顶部的**侧边任务**。

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
| 新建侧边任务 | 创建一个 continuable 子会话，并把已有的 `subagentchat` 资源打开到右侧栏。 |
| 关闭标签或收起侧栏 | 只释放视图持有的会话引用；子会话仍在父会话目录中，不会被替换或复制。 |
| 重新打开 | 按原来的父子地址保留同一个子会话；不会再次调用创建 Remote，也不会创建普通会话。 |
| 任务完成 | 结果留在子会话记录中，不自动唤醒父会话模型。 |
| 父会话离线 | 沿用 Harness 的只读状态；父会话恢复后可继续输入。 |

**上下文范围**：创建时截取父会话最近一个完整回合结束之前的历史，未完成的当前回合不会纳入。上下文只截取一次，后续主会话的新消息不会持续同步到已经创建的侧边任务。

## 开发

```sh
pnpm install
pnpm check       # 类型检查、Host/Client 构建、Remote 描述和全部测试
pnpm test        # 构建并运行测试
pnpm --filter dsh-side-tasks pack --pack-destination dist
```

包结构：

- `src/index.ts`：Host 服务和 `sideTasks/create` Remote。
- `src/side-task.ts`：`fork + caller` 创建逻辑。
- `src/client/index.ts`：会话头部入口、创建后打开和已有任务恢复。
- `src/client/SideTaskAction.tsx`：新建/恢复弹窗。
- `artifacts/`：基于公开 `createTypertRemoteInfo` 的 Remote 描述与类型。
- `scripts/postbuild.mjs`：整理 Harness 约定的 `client.js` 和 Remote 构建产物。

插件没有调用 `uiWorkspace.startSession` 或普通 `session.fork`。左侧列表过滤、右侧聊天和父会话目录均使用 Harness 现有能力。

## 测试覆盖

当前测试覆盖：上下文 fork 和 caller 投递参数、空任务与取消、Remote 严格校验、标签和资源地址、创建后打开、恢复不再次创建，以及弹窗错误状态。

## License

MIT
