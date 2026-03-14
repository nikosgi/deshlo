# Source Inspector Monorepo

Yarn workspaces monorepo with split framework packages and a Next.js pages test app.

## Workspaces

- `@couch-heroes/source-inspector-core`
  Shared loader injection/types.
- `@fdb/react`
  React adapter and `SourceInspectorOverlay`.
- `@fdb/vue`
  Vue adapter.
- `@fdb/nextjs`
  Next.js adapter and `@fdb/nextjs/overlay`.
- `@fdb/next-test-app`
  Local test app (App Router).

## Monorepo commands

```bash
yarn install
yarn build
yarn test
yarn dev:test-app
```

## Run the test app

```bash
NEXT_PUBLIC_SOURCE_INSPECTOR=1 yarn dev:test-app
```

Then hold `Alt` and click elements in the app to see source locations.
