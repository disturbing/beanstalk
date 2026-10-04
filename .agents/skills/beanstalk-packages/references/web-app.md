# The web app (vinext)

`packages/web` is the only human-facing UI: the canvas, decision pages, world previews. It is a vinext app (Next.js App Router API on Vite) deployed as a Worker.

## Contents
- Create the app
- Bindings and calling Workers
- Routing rules
- WebSockets and streaming
- Lint and format exceptions
- Previews

## Create the app

```bash
pnpm dlx create-vinext-app@latest packages/web --legacy-wrangler-cloudflare-init
```

The flag keeps Wrangler and `wrangler.jsonc` instead of the beta `cf` CLI and `cloudflare.config.ts`, which matches every other package (decision: one deploy tool until after 2026-10-14). Check `pnpm dlx create-vinext-app@latest --help` if the flag has moved. Then:

1. Rename the package to `@beanstalk/web` and the Worker to `beanstalk-web`; set `compatibility_date` to today; enable observability and traces.
2. Replace literal dependency versions with `catalog:` entries (add `vinext`, `react`, `react-dom`, `@cloudflare/vite-plugin`, `vite`, `tailwindcss` to the catalog if missing).
3. Add `"typecheck": "tsc -p tsconfig.json"` and `"types": "wrangler types"` scripts; extend `../../tsconfig.base.json` with the DOM lib added for the client tsconfig.
4. `pnpm install && pnpm -F @beanstalk/web types && pnpm check`.

The vinext repository ships a `migrate-to-vinext` skill; it is for converting an existing Next.js app and is not needed here.

## Bindings and calling Workers

```ts
import { env } from 'cloudflare:workers';

export default async function WorldPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const world = await env.GATEWAY.getWorld(id); // service binding RPC, typed by wrangler types
  return <WorldView world={world} />;
}
```

- Server components, route handlers and server actions read bindings through `cloudflare:workers`; no `getPlatformProxy`, no custom worker entry.
- Data comes from backend Workers through service-binding RPC (`services` in `wrangler.jsonc`), never by fetching their public URLs. Browser code that must call an API uses the Hono `hc<AppType>` client against the gateway's public routes.
- No business logic in the web app: it renders what the gateway returns and sends commands back through RPC or the gateway API.

## Routing rules

- App Router only (`app/`), server components by default, `'use client'` only for interactive canvas pieces.
- The canvas (tldraw) is a client component; its data arrives through the gateway's view endpoints and the canvas DO's WebSocket.
- Keep route files thin; put rendering logic in `components/<feature>/` and data shaping in the gateway, not in the page.

## WebSockets and streaming

vinext drops the WebSocket handle if an upgrade reaches its handler. WebSocket endpoints (tldraw sync, live overlays) live on the gateway or canvas Worker, and the browser connects to them directly; the web Worker never proxies upgrades. SSE from server routes is fine.

## Lint and format exceptions

`app/**` route files must use default exports; the root `.oxlintrc.json` already allows that there. Components elsewhere use named exports and `kebab-case` file names (`world-view.tsx` exporting `WorldView`).

## Previews

Workers Builds deploys `main` as production and gives every other branch of the connected repo a preview URL; branches of forks do not get previews. World previews for the demo are served by the gateway from `world-<hash>` branches of the connected repo (see `docs/claude-13-demo-plan.md`).
