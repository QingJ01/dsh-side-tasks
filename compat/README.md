# Harness sidechat source adapter

This repository ships the adapter material under `compat/`; it is not part of the `dsh-side-tasks` npm tarball. Verify those repository-delivered files with `node compat/verify-adapter-pack.mjs`.

The patch adapts the exact `dsh-v0.2.1-rc.5` source revision (`b830ec950faba0a46dda564be3e2d854afed94f1`). It is a source change, not a runtime patch for an installed application.

Start with a clean source checkout at that commit. From this repository, run:

```sh
node compat/apply-harness-sidechat.mjs /absolute/path/to/deepseek-harness
cd /absolute/path/to/deepseek-harness
pnpm install --frozen-lockfile
pnpm run build:artifacts
```

Use the standard source profile to run the compatible Host and Client together:

```sh
pnpm dsh web
```

The Web profile is `apps/web/cordis.yml`; `pnpm dsh web` is the supported source launch path. Do not copy compiled files into an installed app. Install a compatible Harness build before opening sidechat logs: the pinned reader refuses their new `origin` value.
