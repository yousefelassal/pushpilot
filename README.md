# pushpilot

Web Push for applications that own their infrastructure. One package provides a server sender, a `Request -> Response` subscription handler, a browser client, a React hook, a service worker helper, and a VAPID CLI. You own authentication and storage. There are no required database interfaces, migrations, or hosted services.

Requires Node 22+, Bun, Deno, or Cloudflare Workers with WebCrypto and fetch. React is optional.

```sh
pnpm add pushpilot
pnpm exec pushpilot keygen
```

```ts
import { createPush } from 'pushpilot/server';

const push = createPush({
	vapid: {
		publicKey: process.env.VAPID_PUBLIC_KEY,
		privateKey: process.env.VAPID_PRIVATE_KEY,
		subject: 'mailto:ops@example.com',
	},
});

export const POST = push.handler({
	async onSubscribe({ request, subscription, previousEndpoint }) {
		// Authenticate and upsert in your database. Scope replacement to this user.
		await saveSubscription(request, subscription, previousEndpoint);
	},
	async onUnsubscribe({ request, endpoint }) {
		await deleteOwnedSubscription(request, endpoint);
	},
});

const rows = await subscriptionsForUser(userId);
const report = await push.send(rows, { title: 'New reply', url: '/inbox' });
const expired = report.results.filter((result) => result.status === 'gone');
await deleteRows(expired.map((result) => rows[result.index]!.id));
```

The database and auth functions above are application code. Subscribe callbacks must authenticate before writing. Endpoints are secrets. Reports use `endpointHash` and input indexes so you can log outcomes without exposing subscription URLs. Delete only `gone` subscriptions. A 401 or 403 is a configuration error, not an expired subscription.

```ts
// In a bundled service worker:
import { handlePush } from 'pushpilot/sw';
handlePush({
	fallback: { title: 'My app', body: 'You have a new notification.' },
});

// In the browser, after your app registers that worker:
import { createPushClient } from 'pushpilot/client';
const client = createPushClient();
const stop = client.start();
// Call client.enable() directly from a click handler once initialization finishes.
```

For React, create a module-level client and pass it to `usePush(client)` from `pushpilot/react`. The hook returns a discriminated state. Actions stay on the client. Its server snapshot never accesses browser globals.

## Work on this repository

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm docs:build
pnpm --filter @pushpilot/docs dev
```

The Starlight docs include the complete quickstart, API reference, Hono, Next.js, React Router, and Astro examples, storage recipes, key rotation, iOS installation, and troubleshooting. Each example README has its run command. No package has been published by this implementation task.

MIT, copyright Yousef Elassal.
