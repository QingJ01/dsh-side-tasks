# DSH Side Tasks

[中文文档](README.zh.md)

A dual-face DeepSeek Harness plugin for temporary, Codex-style side chats. It creates a continuable child with the current session's completed-turn context and opens it in an independent `sidechat` tab. Closing that tab stops and archives the child instead of leaving another ordinary session in the left list.

## Features

- A small **Side chat** icon at the right of the conversation header; it prepares one idle child in the current right-sidebar pane, then renders Harness's native Conversation and composer, including its editor, command menu, permission controls, and send/stop behavior. No handwritten first-message input or synthetic prompt is used.
- A native card on the right sidebar's Start page, using Harness's `IconNewChatOutlineRegular` and opening the same native side chat.
- A dedicated `side-task` subagent provider that copies the parent's completed-turn context once.
- A centered temporary-chat notice while the child is empty.
- Blank preparation releases its AgentHandle before native input can cold-resume the child, preventing writer ownership collisions.
- A dedicated `sidechat` resource and close handler; model-delegated subagent tabs are unaffected.
- `sideTasks/discard` authenticates the persisted `side-task` provider descriptor, archives it with active work stopped, then best-effort drains the resident child.
- Client activation is crash-isolated. `$mount` is local, so a disabled Host service is detected only when its first RPC fails.

## Requirements

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0`
- Node.js `>=24.9.0` for development
- A Web or Desktop profile with subagent runtime, Session Query, Workspace registry, and `dsh-client-ui-subagent` (all standard in the shipped Web/Desktop composition)

## Install

**0.1.0 is unreleased.** This repository is the in-development 0.1.0 and publishes no GitHub releases or tags yet. Build from the checkout:

```sh
git clone https://github.com/QingJ01/dsh-side-tasks.git
cd dsh-side-tasks
pnpm install
pnpm build
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

Use `--profile web` for a Web profile. Restart Harness after installation, then open a conversation and select **Side chat** in the header.

For local development after editing the same version, remove before adding; pnpm does not re-expand a same-version `file:` tarball:

```sh
dsh plugin --profile desktop remove dsh-side-tasks
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

## Behavior

| Action | Result |
| --- | --- |
| Create a side chat | Allocates one continuable subagent child and opens its `sidechat` resource on the right. |
| Close the corresponding tab | Calls `sideTasks/discard`, archives the child with work stopped, and drains it best-effort. No ordinary session is created. |
| Merely collapse the right sidebar | Does not close the tab or trigger archival. |
| Task completes | Updates the child transcript. The current Harness cold-resume path may also notify and wake the parent. |

**Deletion semantics:** Harness exposes durable archival, not physical deletion of session logs through its public plugin API. This plugin uses that supported lifecycle and never edits session files directly. The UI describes this as ending and removing the temporary chat, not erasing its files.

**Native child controls:** Harness currently hides its model-selection seat for addressed subagents; the child inherits the parent's selected model. Cold-resumed children use the runtime's default parent settlement delivery, which may wake the parent. The plugin does not patch the runtime manager to suppress it.

**Known limitations:** the built-in Harness subagent catalog does not filter archived children, so a closed side chat can still be enumerated there until Harness provides a deletion or catalog-filter seam. This plugin never rewrites the parent's immutable session log to hide it. Close writes a browser-local pending marker before its Remote request and retries it on later activations, bounded to five attempts and seven days, skipping children still retained elsewhere. Losing that browser storage remains a window where archival can be missed.

Context is captured once from the parent's latest completed-turn prefix. An in-flight parent turn is intentionally excluded. A side chat does not continuously track later parent messages.

## Development

```sh
pnpm install
pnpm check       # TypeScript, Host/Client bundles, Remote descriptors, and tests
pnpm test        # Build and run all tests
pnpm --filter dsh-side-tasks pack --pack-destination dist
```

The package has Host (`src/index.ts`) and browser (`src/client/index.ts`) faces. `src/client/sidebar-chat.tsx` owns the resource, empty state, and tab adapter. Remote metadata embeds the protocol's lazy info factory so profile-level protocol hoisting cannot break the subpath import, while retaining Agent lookup for creation, descriptor ownership checks for discard, and Zod codecs. Build artifacts are copied into `lib/` by `scripts/postbuild.mjs`.

## License

MIT
