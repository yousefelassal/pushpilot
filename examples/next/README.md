# Next.js example

An App Router example. A server component page renders a `'use client'` button built on `usePush` from `pushpilot/react`. `middleware.ts` sets the identity cookie, `app/api/push/route.ts` exports the handler, and `app/api/notify/route.ts` sends the test notification.

Run this from the repository root with Node 22+ and pnpm 10.

```sh
pnpm install
pnpm build
pnpm --filter @pushpilot/example-next exec pushpilot keygen
export VAPID_PUBLIC_KEY='your-generated-public-key'
export VAPID_PRIVATE_KEY='your-generated-private-key'
export VAPID_SUBJECT='mailto:you@example.com'
pnpm --filter @pushpilot/example-next dev
```

Open http://localhost:3000, click Enable notifications, grant permission, then click Send test notification. `dev` and `build` first bundle the service worker to `public/sw.js`, which is generated and gitignored.

`app/push.server.ts` holds the handler, the store, and the test send. `app/sw.ts` is bundled to `public/sw.js`. Build with `pnpm --filter @pushpilot/example-next build`, then run `start`.

## Before production

- The `demo_user` cookie is an unauthenticated random id. Replace it with your real session.
- Subscriptions live in an in-memory `Map`. Use a database and delete rows when `send` reports `gone`.
- Add `Secure` to the cookie, rate-limit the send action, and keep VAPID keys out of client bundles.
- Test phones over HTTPS. iOS and iPadOS need the app installed to the Home Screen, which needs a web manifest with icons.
