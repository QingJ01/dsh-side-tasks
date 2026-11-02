# dsh-side-tasks

Development build of a DeepSeek Harness 0.1.0 plugin for temporary,
context-inheriting side chats in the right sidebar. **This version is
unreleased and has no Git tag or GitHub Release.**

Full documentation, installation, architecture, known limitations, and
development commands live in the repository root:

- [English README](https://github.com/QingJ01/dsh-side-tasks/blob/main/README.md)
- [中文说明](https://github.com/QingJ01/dsh-side-tasks/blob/main/README.zh.md)

Build the package from the repository root:

```sh
pnpm install
pnpm build
dsh plugin --profile desktop add ./packages/plugins/side-tasks
```

For same-version local changes, remove the plugin before re-adding because
pnpm does not re-expand a same-version `file:` package.
