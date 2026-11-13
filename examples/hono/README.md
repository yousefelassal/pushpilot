# Hono example

A `hono/jsx` page, a `hono/cookie` identity cookie, and `POST /api/push` backed by `push.handler`. A small browser script uses `pushpilot/client`.

Run this from the repository root with Node 22+ and pnpm 10.

```sh
pnpm install
pnpm build
pnpm --filter @pushpilot/example-hono exec pushpilot keygen
export VAPID_PUBLIC_KEY='your-generated-public-key'
export VAPID_PRIVATE_KEY='your-generated-private-key'
export VAPID_SUBJECT='mailto:you@example.com'
pnpm --filter @pushpilot/example-hono dev
```

Open http://localhost:3000, click Enable notifications, grant permission, then click Send test notification. `dev` and `build` first bundle the service worker to `public/sw.js`, which is generated and gitignored.

`src/push.server.ts` holds the handler, the store, and the test send. `src/client.ts` and `src/sw.ts` are bundled with esbuild into `public/`. `pnpm build` then `pnpm start` serves the production build.

## Before production

- The `demo_user` cookie is an unauthenticated random id. Replace it with your real session.
- Subscriptions live in an in-memory `Map`. Use a database and delete rows when `send` reports `gone`.
- Add `Secure` to the cookie, rate-limit the send action, and keep VAPID keys out of client bundles.
- Test phones over HTTPS. iOS and iPadOS need the app installed to the Home Screen, which needs a web manifest with icons.
