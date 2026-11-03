# DSH Side Tasks

[中文文档](README.zh.md)

A dual-face DeepSeek Harness plugin for temporary, Codex-style side chats. It creates an independent root Session (`origin: sidechat`) visible only in the right sidebar. The source contributes bounded, one-way text context; it is never resumed or changed.

## Features

- A small **Side chat** icon at the right of the conversation header; it prepares one idle child in the current right-sidebar pane, then renders Harness's native Conversation and composer, including its editor, command menu, permission controls, and send/stop behavior. No handwritten first-message input or synthetic prompt is used.
- Native model/reasoning and permission-preset menus. User choices persist on the child only; they do not change the parent or the global model default. Full access retains Harness's risk confirmation.
- A native card on the right sidebar's Start page, using Harness's `IconNewChatOutlineRegular` and opening the same native side chat.
- The side chat starts empty and keeps its own transcript and usage. The parent's completed-turn conversation is attached as per-agent prompt context, so the model continues with it while the footer counts only the side chat's own work.
- A centered temporary-chat notice while the child is empty.
- New chats use Harness's native root controller and native Conversation/composer; each child owns its model, permissions, transcript, usage, and draft.
- Completion leaves the chat available for follow-up. Only explicit close stops and archives; collapsing the sidebar is not close.
- Context is limited to 120 human/assistant messages and 100,000 characters, refreshed on cold attach, and recorded on the child log rather than copied into its transcript.
- Legacy continuable chats are never resumed or sent to. They show a migration notice; cold legacy sessions may be safely archived, while resident ones require a Harness restart first.
- Creation requires both the Host `SessionController` and Client workspace side-chat capabilities. Missing or old capabilities fail visibly before the source is read or a child is created; there is no ordinary-session or subagent fallback.

## Requirements

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0`
- Node.js `>=24.9.0` for development
- A Web or Desktop profile built from Harness RC.5 with the side-chat adapter applied. The patch, safe apply helper, and bilingual instructions are in this repository's [`compat/`](compat/README.md); they are not included in the npm tarball. Stock RC.5 fails closed.

## Install

**0.1.0 is unreleased.** This repository is the in-development 0.1.0 and publishes no GitHub releases or tags yet. Build from the checkout:

```sh
git clone https://github.com/QingJ01/dsh-side-tasks.git
cd dsh-side-tasks
pnpm install
pnpm build
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

The compatibility patch and safe apply helper are repository-distributed under [`compat/`](compat/README.md), not included in the npm tarball. Apply the patch to a clean pinned RC.5 Harness source checkout, then build the source profile. The helper requires the exact pinned commit and a clean tracked tree, checks the patch before applying it, and never downloads code or modifies an installed runtime:

```sh
node compat/apply-harness-sidechat.mjs /path/to/deepseek-harness
cd /path/to/deepseek-harness
pnpm install
pnpm run build:artifacts
pnpm run build:check
pnpm dsh web
```

Use the Desktop source-profile command documented in `compat/README.md` for Desktop. Restart the patched profile after plugin installation.

For local development after editing the same version, remove before adding; pnpm does not re-expand a same-version `file:` tarball:

```sh
dsh plugin --profile desktop remove dsh-side-tasks
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

## Behavior

| Action | Result |
| --- | --- |
| Create a side chat | Reads the source through query-only observation and creates an independent root Session in the right sidebar. |
| Close the corresponding tab | Authenticates the child's own descriptor and origin, then stops and archives only that child. |
| Merely collapse the right sidebar | Does not close the tab or trigger archival. |
| Click **Side chat** again | Expands and focuses the existing tab without creating another child; an already visible sidebar stays open. |
| Reload with an unsent draft | The native Session body remains mounted even for an empty chat, retaining Harness's browser-local draft persistence. |
| Task completes | Leaves the child open and usable; follow-up remains available. Completion never archives it. |

**Deletion semantics:** Harness exposes durable archival, not physical deletion of session logs through its public plugin API. This plugin uses that supported lifecycle and never edits session files directly. The UI describes this as ending and removing the temporary chat, not erasing its files.

**Child settings:** The native Conversation owns the only model/reasoning and permission menus, using the child's native Session controller. The Harness adapter keeps sidechat model choices out of the shared default. Model/reasoning, preset, working directory, and effective permission choices are captured through query-only source reads and restored from the child's own durable records. The source is never resumed, activated, or written. The compatibility configuration endpoint still validates the child's independent origin and own descriptor and delegates model choices to that same native controller.

**Legacy chats:** Existing continuable side-task addresses are recognized only to show a migration notice and offer a safe close path. A cold legacy child can be archived after a query-only ownership check. A resident legacy child is refused; restart the patched Harness first, then close it or create a new independent side chat. The plugin never resumes, configures, or sends to legacy children and does not rewrite historical logs.

Close writes a browser-local pending marker before its Remote request and retries it in serial, bounded five-attempt bursts with backoff. Exhausted or terminal markers remain visible for an explicit Retry; reconnects retry transient markers, and children still retained elsewhere are skipped. If browser storage is unavailable, the marker remains in memory and retries while the application stays open.

The inherited background is the parent's latest completed-turn conversation: user input and assistant replies, excluding an in-flight turn and non-human context injections. It is read again when a child is cold-resumed, so a resumed side chat inherits the parent's progress up to that moment. No parent turn is copied into the child's transcript, so the child's messages and token usage stay its own.

Here, a completed turn means one with a recorded `turn/end`, including failed or stopped turns, not only successful responses. Unloading the plugin or disposing a child cancels pending context reads and prevents late results from installing new context.

This is a bounded text snapshot, not a clone of the parent's complete model input: it keeps at most the latest 120 non-empty human/assistant messages and ensures the full injected text, including its fixed prefix, stays within 100,000 characters. Images, tool results, and compaction summaries are not included. The exact injected text, including an empty snapshot, is recorded on the child before registration, not copied into the source or child transcript. It reads the original conversation log rather than the compacted model-visible surface, so replaced historical messages can still appear. While the same child Agent remains live, later parent messages are not continuously synchronized; a cold attach takes a fresh snapshot. If that source refresh fails but the child has a saved context record, the saved context is used and the Host emits a warning that restarting Harness is required to retry the refresh; a genuine failure without a saved record rejects child admission. An absent or archived source remains a known fallback case.

## Development

```sh
pnpm install
pnpm check       # TypeScript, Host/Client bundles, Remote descriptors, and tests
pnpm test        # Build and run all tests
pnpm --filter dsh-side-tasks pack --pack-destination dist
```

The package has Host (`src/index.ts`) and browser (`src/client/index.ts`) faces. `src/client/sidebar-chat.tsx` owns the resource, empty state, and tab adapter. Remote metadata embeds the protocol's lazy info factory so profile-level protocol hoisting cannot break the subpath import; authorization readers name the source or child Session IDs directly. Build artifacts are copied into `lib/` by `scripts/postbuild.mjs`.

## License

MIT
