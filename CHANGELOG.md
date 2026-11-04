# Changelog

## 0.1.0 (unreleased)

- Independent temporary side chats in the right sidebar, using native Harness Conversation controls and the required Harness adapter.
- Read-only context inheritance from the latest completed source turns, limited to 120 human/assistant messages and 100,000 characters.
- Child-owned transcripts, settings and drafts; the source Session is never resumed or modified.
- Completion leaves the chat open. Only explicit close stops and archives it; collapsing the sidebar does not archive.
- Closing is silent: the tab closes immediately and stop/archive retries in the background, including after reconnection and reload when browser storage is available.
- Saved child context is used if a cold-attach source refresh fails, with a Host warning to restart Harness to retry the refresh.
