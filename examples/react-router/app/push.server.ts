import { createCookie } from 'react-router';
import { createPush, type PushSubscriptionRecord } from 'pushpilot/server';

export const demoUser = createCookie('demo_user', {
	httpOnly: true,
	sameSite: 'lax',
	path: '/',
});

type Stored = { userId: string; subscription: PushSubscriptionRecord };

const push = createPush({
	vapid: {
		publicKey: process.env.VAPID_PUBLIC_KEY,
		privateKey: process.env.VAPID_PRIVATE_KEY,
		subject: process.env.VAPID_SUBJECT,
	},
});

const store = new Map<string, Stored>();

export async function userIdFrom(request: Request) {
	const value: unknown = await demoUser.parse(request.headers.get('cookie'));
	return typeof value === 'string' ? value : undefined;
}

function unauthorized() {
	return new Response(null, {
		status: 401,
		headers: { 'cache-control': 'no-store' },
	});
}

export const pushHandler = push.handler({
	async onSubscribe({ request, subscription, previousEndpoint }) {
		const userId = await userIdFrom(request);
		if (!userId) return unauthorized();

		if (previousEndpoint && store.get(previousEndpoint)?.userId === userId)
			store.delete(previousEndpoint);
		store.set(subscription.endpoint, { userId, subscription });
	},
	async onUnsubscribe({ request, endpoint }) {
		const userId = await userIdFrom(request);
		if (!userId) return unauthorized();

		if (store.get(endpoint)?.userId === userId) store.delete(endpoint);
	},
});

export async function notify(request: Request): Promise<Response> {
	const origin = request.headers.get('origin');
	if (origin && origin !== new URL(request.url).origin)
		return new Response(null, { status: 403 });

	const userId = await userIdFrom(request);
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
