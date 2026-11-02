# DSH Side Tasks

[中文文档](README.zh.md)

A dual-face DeepSeek Harness plugin for Codex-style side tasks. It creates a continuable child with the current session's completed-turn context and opens it in the right sidebar. Closing or collapsing the sidebar does not cancel the task, create an ordinary session, or add a row to the left session list.

## Features

- A **Side tasks** action in the conversation header.
- Context inheritance through Harness's standard `fork` subagent backend.
- Independent execution with `caller` delivery: completion does not inject a message into the parent conversation.
- Create and reopen from the same dialog; reopening never calls the creation API.
- Durable recovery through the parent's subagent catalog, including after a page refresh.
- Existing Harness chat, composer, stop, and right-sidebar behavior; no forked UI implementation.

## Requirements

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0`
- Node.js `>=24.9.0` for development
- A Web or Desktop profile with the standard `fork` subagent provider and `dsh-client-ui-subagent`

## Install

Download `dsh-side-tasks-0.1.0.tgz` from the [latest release](https://github.com/QingJ01/dsh-side-tasks/releases/latest), then install it into your profile:

```sh
dsh plugin --profile desktop add ./dsh-side-tasks-0.1.0.tgz
```

Use `--profile web` for a Web profile. Restart Harness after installation, then open any conversation and select **Side tasks** in the header.

For a local checkout:

```sh
git clone https://github.com/QingJ01/dsh-side-tasks.git
cd dsh-side-tasks
pnpm install
pnpm build
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

## Behavior

| Action | Result |
| --- | --- |
| Create a side task | Allocates one continuable subagent child and opens its existing `subagentchat` resource on the right. |
| Close a tab or collapse the sidebar | Releases only the view's session reference. The child remains in the parent catalog and is not replaced. |
| Reopen a task | Retains the same child address; no creation RPC and no ordinary session. |
| Task completes | Updates the child transcript without waking the parent model. |
| Parent is offline | The existing Harness continuation UI becomes read-only until the parent is available. |

Context is captured once from the parent's latest completed-turn prefix. An in-flight parent turn is intentionally excluded. A side task does not continuously track later parent messages.

## Development

```sh
pnpm install
pnpm check       # TypeScript, Host/Client bundles, Remote descriptors, and tests
pnpm test        # Build and run all tests
pnpm --filter dsh-side-tasks pack --pack-destination dist
```

The package has Host (`src/index.ts`) and browser (`src/client/index.ts`) faces. `cordis.patch.yml` mounts the Host service, while `dsh.client` advertises the browser entry. Remote metadata uses the public `createTypertRemoteInfo` protocol with Agent lookup and Zod codecs. Build artifacts are copied into `lib/` by `scripts/postbuild.mjs`.

## License

MIT
