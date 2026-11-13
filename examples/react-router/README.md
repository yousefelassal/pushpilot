# react-router example

Run this from the repository root with Node 22+ and pnpm 10.

```sh
pnpm install
pnpm build
pnpm --filter @pushpilot/example-react-router exec pushpilot keygen
export VAPID_PUBLIC_KEY='your-generated-public-key'
export VAPID_PRIVATE_KEY='your-generated-private-key'
export VAPID_SUBJECT='mailto:you@example.com'
export DEMO_SECRET='a-long-random-local-demo-password'
pnpm --filter @pushpilot/example-react-router dev
```

Open http://localhost:3000 and enter DEMO_SECRET in the password field. Wait for setup, click Enable notifications, grant permission, and click Send test notification. The server sends only to subscriptions created in this local process.

This is a local demo. It uses one password and in-memory subscription storage. It is not a production identity system. The password remains in the page's input and request headers, never localStorage. Restarting the server clears subscriptions. Use your own authenticated session, ownership checks, database, rate limit, and CSRF protection in production.

`../shared/server.ts` owns the demo sender and callback logic. `../shared/browser.ts` owns the browser UI. `../shared/build.mjs` bundles `public/browser.js` and `public/sw.js`. Do not commit generated files. The app registers its worker before starting the push client.

Desktop localhost is a secure context. Test phones through HTTPS. iOS and iPadOS need installation on the Home Screen. The sample manifest has no app icons; add your own production icons before using it as an installable PWA.

For a production build, run `pnpm --filter @pushpilot/example-react-router build`, then `pnpm --filter @pushpilot/example-react-router start`. Environment variables must remain available to the server. Never expose the private VAPID key to frontend bundles.
