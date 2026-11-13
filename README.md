# pushpilot

Web Push for apps that own their database.

pushpilot sends Web Push notifications from Node, Bun, Deno, or Cloudflare Workers. It gives you a route handler, a browser client, a React hook, a service worker helper, and a CLI for VAPID keys. You keep your auth and your database: pushpilot calls your code to store subscriptions and tells you which ones to delete after each send.

- **No storage adapters.** Save subscriptions in any database with your own queries.
- **One route.** A standard `Request -> Response` handler that mounts in Next.js, Hono, React Router, Astro, or anything else.
- **Safe by default.** Positive TTLs, limited concurrency, retries, payload limits, a push-host allowlist, and endpoints that never reach your logs.
- **Works on iOS.** The client reports when an iPhone user must add your app to the Home Screen first.

[Documentation](https://github.com/yousefelassal/pushpilot/tree/main/apps/docs) · [Examples](./examples)

## Install

```sh
npm install pushpilot
```

Requires Node 22 or later, Bun, Deno, or Cloudflare Workers. React is optional.

## Quickstart

### 1. Generate VAPID keys

```sh
npx pushpilot keygen
```

Copy the printed `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` into your environment. Keep the private key secret.

### 2. Create the server

```ts
// lib/push.ts
import { createPush } from 'pushpilot/server';

export const push = createPush({
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: 'mailto:you@example.com',
  },
});
```

### 3. Add the route

The handler validates every request and then calls your callbacks. Authenticate the user and write to your database there.

```ts
// app/api/push/route.ts (Next.js)
import { push } from '@/lib/push';

export const POST = push.handler({
  async onSubscribe({ request, subscription, previousEndpoint }) {
    const user = await getUser(request);
    if (!user) return new Response(null, { status: 401 });

    await db.saveSubscription(user.id, subscription, previousEndpoint);
  },

  async onUnsubscribe({ request, endpoint }) {
    const user = await getUser(request);
    if (!user) return new Response(null, { status: 401 });

    await db.deleteSubscription(user.id, endpoint);
  },
});
```

Hono, React Router, and Astro mount the same handler. See the framework guides in the docs.

### 4. Add the service worker

```ts
// sw.ts (bundle this to /sw.js and register it in your app)
import { handlePush } from 'pushpilot/sw';

handlePush({
  fallback: { title: 'My app', body: 'You have a new notification.' },
});
```

### 5. Add the button

```tsx
import { createPushClient } from 'pushpilot/client';
import { usePush } from 'pushpilot/react';

const client = createPushClient();

export function NotificationsButton() {
  const state = usePush(client);

  if (state.status === 'needs-install') {
    return <p>Add this app to your Home Screen to get notifications.</p>;
  }

  if (state.status === 'subscribed') {
    return <button onClick={() => client.disable()}>Turn off</button>;
  }

  return <button onClick={() => client.enable()}>Turn on notifications</button>;
}
```

Create the client once, at module scope. Call `enable()` directly from a click so the browser shows the permission prompt.

### 6. Send a notification

```ts
const rows = await db.subscriptionsForUser(userId);

const report = await push.send(rows, {
  title: 'New reply',
  body: 'Ana answered your question.',
  url: '/inbox',
});

const gone = report.results.filter((result) => result.status === 'gone');
await db.deleteSubscriptions(gone.map((result) => rows[result.index].id));
```

Each result points back to your input with `index`. Delete only `gone` subscriptions. A `failed` result with reason `configuration` means your VAPID keys are wrong, not that the subscription expired.

## Packages

| Import             | Runs in                      | Use it for                                |
| ------------------ | ---------------------------- | ----------------------------------------- |
| `pushpilot/server` | Node, Bun, Deno, Workers     | `createPush`, `send`, and the route       |
| `pushpilot/client` | Browser                      | Permission, subscribe, and unsubscribe    |
| `pushpilot/react`  | Browser and server rendering | The `usePush` hook                        |
| `pushpilot/sw`     | Service worker               | Showing notifications and handling clicks |
| `pushpilot` (CLI)  | Node                         | `keygen` and `doctor` for your VAPID keys |

## Contributing

```sh
pnpm install
pnpm check
pnpm --filter @pushpilot/docs dev
```

`pnpm check` runs type checks, tests, lint, formatting, the build, package checks, and runtime smoke tests.

## License

MIT, copyright Yousef Elassal.
