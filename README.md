# DSH Side Tasks

[中文文档](README.zh.md)

A dual-face DeepSeek Harness plugin for temporary, Codex-style side chats. It creates a continuable child with the current session's completed-turn context and opens it in an independent `sidechat` tab. Closing that tab stops and archives the child instead of leaving another ordinary session in the left list.

## Features

- A small **Side chat** icon at the right of the conversation header; it prepares one idle child in the current right-sidebar pane, then renders Harness's native Conversation and composer, including its editor, command menu, permission controls, and send/stop behavior. No handwritten first-message input or synthetic prompt is used.
- Native model/reasoning and permission-preset menus. User choices persist on the child only; they do not change the parent or the global model default. Full access retains Harness's risk confirmation.
- A native card on the right sidebar's Start page, using Harness's `IconNewChatOutlineRegular` and opening the same native side chat.
- The side chat starts empty and keeps its own transcript and usage. The parent's completed-turn conversation is attached as per-agent prompt context, so the model continues with it while the footer counts only the side chat's own work.
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
| Click **Side chat** again | Expands and focuses the existing tab without creating another child; an already visible sidebar stays open. |
| Reload with an unsent draft | The native Session body remains mounted even for an empty chat, retaining Harness's browser-local draft persistence. |
| Task completes | Updates the child transcript. The current Harness cold-resume path may also notify and wake the parent. |

**Deletion semantics:** Harness exposes durable archival, not physical deletion of session logs through its public plugin API. This plugin uses that supported lifecycle and never edits session files directly. The UI describes this as ending and removing the temporary chat, not erasing its files.

**Child settings:** Native menu components use a plugin-owned configuration endpoint authenticated against the child's parent lineage and own provider descriptor. Idle settings writers are disposed before sending is enabled; live manager-owned Agents are never disposed by a settings change. A resumed child restores its selected model and image-admission options from its own durable selection. Cold-resumed children still use the runtime's default parent settlement delivery, which may wake the parent.

**Known limitations:** the built-in Harness subagent catalog does not filter archived children, so a closed side chat can still be enumerated there until Harness provides a deletion or catalog-filter seam. This plugin never rewrites the parent's immutable session log to hide it. Close writes a browser-local pending marker before its Remote request and retries it on later activations, bounded to five attempts and seven days, skipping children still retained elsewhere. Losing that browser storage remains a window where archival can be missed.

The inherited background is the parent's latest completed-turn conversation: user input and assistant replies, excluding an in-flight turn and non-human context injections. It is read again when a child is cold-resumed, so a resumed side chat inherits the parent's progress up to that moment. No parent turn is copied into the child's transcript, so the child's messages and token usage stay its own.

Here, a completed turn means one with a recorded `turn/end`, including failed or stopped turns, not only successful responses. Unloading the plugin or disposing a child cancels pending context reads and prevents late results from installing new context.

This is a bounded text snapshot, not a clone of the parent's complete model input: it keeps at most the latest 120 non-empty human/assistant messages and then the last 100,000 characters. Images, tool results, and compaction summaries are not included. It reads the original conversation log rather than the compacted model-visible surface, so replaced historical messages can still appear. While the same child Agent remains live, later parent messages are not continuously synchronized; each cold resume takes a new snapshot, including the first send after an idle side chat was prepared.

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
