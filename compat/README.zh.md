# Harness sidechat 源码适配器

此仓库在 `compat/` 下提供适配文件；这些文件不包含在 `dsh-side-tasks` npm 包中。运行 `node compat/verify-adapter-pack.mjs` 可验证仓库交付的文件。

此补丁适配精确版本 `dsh-v0.2.1-rc.5`（`b830ec950faba0a46dda564be3e2d854afed94f1`）的源码。它是源码改动，不是对已安装应用的运行时补丁。

先准备位于该提交且工作区干净的源码检出。在本仓库中运行：

```sh
node compat/apply-harness-sidechat.mjs /absolute/path/to/deepseek-harness
cd /absolute/path/to/deepseek-harness
pnpm install --frozen-lockfile
pnpm run build:artifacts
```

在 Harness 源码目录中，先将构建好的插件安装到同一个 Web profile，再启动兼容的 Host 与 Client（请替换插件的绝对路径）：

```sh
pnpm dsh plugin --profile web add /absolute/path/to/dsh-side-tasks/packages/plugins/side-tasks
pnpm dsh web
```

Web 配置位于 `apps/web/cordis.yml`；`pnpm dsh web` 是受支持的源码启动方式。不要将编译文件复制到已安装应用中。在打开 sidechat 日志前，请先安装兼容的 Harness 构建版本：固定版本的读取器会拒绝新增的 `origin` 值。

此流程仅涵盖 Web；未在此验证 Desktop 安装与启动。
