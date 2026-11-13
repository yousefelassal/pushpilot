import { createPush, type PushSubscriptionRecord } from 'pushpilot/server';

export const DEMO_COOKIE = 'demo_user';

type Stored = { userId: string; subscription: PushSubscriptionRecord };

const push = createPush({
	vapid: {
		publicKey: process.env.VAPID_PUBLIC_KEY,
		privateKey: process.env.VAPID_PRIVATE_KEY,
		subject: process.env.VAPID_SUBJECT,
	},
});

const store = new Map<string, Stored>();

export function userIdFrom(request: Request): string | undefined {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const [name, ...value] = part.trim().split('=');
		if (name === DEMO_COOKIE) return value.join('=') || undefined;
	}
}

function unauthorized() {
	return new Response(null, {
		status: 401,
		headers: { 'cache-control': 'no-store' },
	});
}

export const pushHandler = push.handler({
	onSubscribe({ request, subscription, previousEndpoint }) {
		const userId = userIdFrom(request);
		if (!userId) return unauthorized();

		if (previousEndpoint && store.get(previousEndpoint)?.userId === userId)
			store.delete(previousEndpoint);
		store.set(subscription.endpoint, { userId, subscription });
	},
	onUnsubscribe({ request, endpoint }) {
		const userId = userIdFrom(request);
		if (!userId) return unauthorized();

		if (store.get(endpoint)?.userId === userId) store.delete(endpoint);
	},
});

export async function notify(request: Request): Promise<Response> {
	const origin = request.headers.get('origin');
	if (origin && origin !== new URL(request.url).origin)
		return new Response(null, { status: 403 });

	const userId = userIdFrom(request);
	if (!userId) return unauthorized();

	const own = [...store.values()].filter((row) => row.userId === userId);
	const report = await push.send(
		own.map((row) => row.subscription),
		{
			title: 'Hello from pushpilot',
			body: 'Your local example is working.',
			url: '/',
		},
	);

	for (const result of report.results) {
		const row = own[result.index];
		if (result.status === 'gone' && row)
			store.delete(row.subscription.endpoint);
	}

	return Response.json(report, { headers: { 'cache-control': 'no-store' } });
}
