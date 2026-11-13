# Astro example

An Astro example. `src/pages/index.astro` sets the identity cookie with `Astro.cookies` and drives the UI from a `<script>` using `pushpilot/client`. `src/pages/api/push.ts` and `api/notify.ts` are on-demand endpoints.

Run this from the repository root with Node 22+ and pnpm 10.

```sh
pnpm install
pnpm build
pnpm --filter @pushpilot/example-astro exec pushpilot keygen
export VAPID_PUBLIC_KEY='your-generated-public-key'
export VAPID_PRIVATE_KEY='your-generated-private-key'
export VAPID_SUBJECT='mailto:you@example.com'
pnpm --filter @pushpilot/example-astro dev
```

Open http://localhost:3000, click Enable notifications, grant permission, then click Send test notification. `dev` and `build` first bundle the service worker to `public/sw.js`, which is generated and gitignored.

`src/push.server.ts` holds the handler, the store, and the test send. `src/sw.ts` is bundled to `public/sw.js`. Build with `pnpm --filter @pushpilot/example-astro build`, then run `start`.

The standalone adapter allowlists `http://localhost:3000` and `http://127.0.0.1:3000` in `astro.config.mjs` so it preserves the request origin. Set `security.allowedDomains` to your deployment origin before deploying.

## Before production

- The `demo_user` cookie is an unauthenticated random id. Replace it with your real session.
- Subscriptions live in an in-memory `Map`. Use a database and delete rows when `send` reports `gone`.
- Add `Secure` to the cookie, rate-limit the send action, and keep VAPID keys out of client bundles.
- Test phones over HTTPS. iOS and iPadOS need the app installed to the Home Screen, which needs a web manifest with icons.
