import { defineConfig } from 'tsdown'

const hostExternals = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-typert-protocol',
]

const clientExternals = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig([
  {
    name: 'dsh-side-tasks/host',
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: hostExternals },
  },
  {
    name: 'dsh-side-tasks/client',
    entry: { client: 'lib/types/client/index.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: true,
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: clientExternals,
      alwaysBundle: (specifier: string) => !clientExternals.includes(specifier),
    },
    outputOptions: {
      banner: 'window.__ModuleLoader__.load({ id: "dsh-side-tasks", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
