# Source Inspector Monorepo

Yarn workspaces monorepo focused on the React ecosystem with a Next.js App Router test app.

## Workspaces

- `@deshlo/core`
  Shared helper/wrapper APIs (webpack rule injection + transform helpers) and overlay contracts.
- `@deshlo/loader`
  Source inspector webpack loader runtime package (root loader export only).
- `@deshlo/react`
  React runtime package (overlay UI + bundler adapters via subpaths).
- `@deshlo/react-github`
  React wrapper package for the GitHub plugin.
- `@deshlo/nextjs`
  Next.js bundler utilities (Webpack + Turbopack wiring).
- `@deshlo/plugin-github`
  Framework-agnostic GitHub plugin logic (API calls, config, workflow).
- `@deshlo/plugin-azure`
  Scaffold package for future Azure plugin logic.
- `@deshlo/next-test-app`
  Local Next App Router test app.
- `@deshlo/react-sample-app`
  Local plain React sample app (Vite).

## Monorepo commands

```bash
yarn install
yarn build
yarn test
yarn dev:test-app
yarn dev:react-sample
```

## Run the Next test app

```bash
NEXT_PUBLIC_SOURCE_INSPECTOR=1 yarn dev:test-app
```

Hold `Alt` and click elements to select source locations.
`next-test-app` runs Turbopack by default (`next dev` / `next build`).
Webpack scripts are also available:
`yarn workspace @deshlo/next-test-app dev:webpack` and `build:webpack`.

Configure Next integration explicitly via `webpack` and `turbopack`:

```js
const {
  createSourceInspectorTurbopackRules,
  withSourceInspectorWebpack,
} = require("@deshlo/nextjs");

const sourceInspectorOptions = {
  enabled: process.env.NEXT_PUBLIC_SOURCE_INSPECTOR === "1",
  include: ["app", "components"],
  wrapLooseTextNodes: true,
  annotateLeafNodesOnly: true,
};

module.exports = {
  reactStrictMode: true,
  webpack(config) {
    return withSourceInspectorWebpack(config, sourceInspectorOptions);
  },
  turbopack: {
    rules: createSourceInspectorTurbopackRules(sourceInspectorOptions),
  },
};
```

`wrapLooseTextNodes: true` wraps meaningful loose JSX text nodes in `<span data-src-loc="...">`.
`annotateLeafNodesOnly: true` skips annotating elements that contain JSX child elements.
Next.js does not expose a generic plugin array for this; use the `webpack` and `turbopack` config fields.

### Manual webpack loader usage

For direct webpack customization, use the loader package root:

```js
webpackConfig.module.rules.unshift({
  test: /\.[jt]sx?$/,
  include: loaderOptions.includePaths,
  exclude: /node_modules/,
  enforce: "pre",
  use: [
    {
      loader: "@deshlo/loader",
      options: loaderOptions,
    },
  ],
});
```

## Overlay plugin contract

`@deshlo/react/overlay` exports a plugin-first API:

- `OverlaySubmitInput`: `{ sourceLoc, tagName, selectedText, proposedText }`
- `OverlaySubmitResult`: `{ ok, message, links? }`
- `OverlayPlugin`: `{ id, submit(input, context) }`
- `OverlayGate` `onSubmit(input, context)` fallback for custom handlers

`OverlayGate` is the single runtime component you render. Submit resolution order:
1. Wrapper plugin submit (`<GithubPlugin>`)
2. `OverlayGate onSubmit`
3. fallback error (`PROVIDER_ERROR: No submit handler configured.`)

```tsx
<GithubPlugin config={githubConfig}>
  <OverlayGate />
</GithubPlugin>
```

Custom implementation without plugin wrapper:

```tsx
<OverlayGate
  onSubmit={async (input, context) => ({
    ok: true,
    message: `Handled ${input.tagName} on ${context.host}`,
  })}
/>
```

## Plugin usage in Next test app

`apps/next-test-app` uses the GitHub React wrapper directly in `app/layout.tsx`:
- `<GithubPlugin config={...}><OverlayGate /></GithubPlugin>`

## GitHub browser plugin env

`@deshlo/plugin-github` supports explicit config props or env fallback.

```bash
NEXT_PUBLIC_SOURCE_INSPECTOR=1
NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_TOKEN=ghp_xxx
NEXT_PUBLIC_SOURCE_INSPECTOR_BRANCH_PREFIX=source-inspector
NEXT_PUBLIC_SOURCE_INSPECTOR_GITHUB_PATH_PREFIX=apps/next-test-app
NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG='{
  "localhost:3000": {
    "apiBaseUrl": "https://api.github.com",
    "owner": "your-org",
    "repo": "your-repo",
    "defaultBaseBranch": "main"
  }
}'
```

### `NEXT_PUBLIC_SOURCE_INSPECTOR_HOST_CONFIG` shape

JSON object keyed by host:

```json
{
  "host:port": {
    "apiBaseUrl": "https://api.github.com",
    "owner": "org-or-user",
    "repo": "repo-name",
    "defaultBaseBranch": "main"
  }
}
```

Notes:
- `apiBaseUrl` is optional and defaults to `https://api.github.com`.
- Host lookup supports exact host and host-without-port fallback.

## Bundler adapter imports

`@deshlo/react` root is runtime/UI-focused. Use explicit bundler subpaths for adapters:

```js
const { withSourceInspectorWebpack } = require("@deshlo/react/webpack");
const { withSourceInspectorVite } = require("@deshlo/react/vite");
```

GitHub React wrapper package:

```tsx
import { GithubPlugin } from "@deshlo/react-github";
```

`@deshlo/nextjs` is now utilities-only:

```js
const {
  withSourceInspectorWebpack,
  createSourceInspectorTurbopackRules,
} = require("@deshlo/nextjs");
```

## Migration note

- `@deshlo/loader` owns the raw webpack loader runtime (root export).
- `@deshlo/core` owns helper/wrapper APIs (option building, webpack rule injection, transform helpers).
- Canonical raw loader usage is `loader: "@deshlo/loader"`.

## Run the React sample app

```bash
VITE_SOURCE_INSPECTOR=1 yarn dev:react-sample
```
